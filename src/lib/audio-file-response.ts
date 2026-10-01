import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { resolveStoredFilePath } from "@/lib/paths";

type StreamableAudioFile = {
  id: string;
  fileName: string;
  filePath: string | null;
  mimeType: string | null;
};

function cancellableFileStream(stream: ReturnType<typeof createReadStream>) {
  const iterator = stream[Symbol.asyncIterator]();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const result = await iterator.next();
        if (closed) return;
        if (result.done) {
          closed = true;
          try { controller.close(); } catch { /* The browser may already have cancelled the response. */ }
          return;
        }
        try {
          controller.enqueue(result.value);
        } catch {
          closed = true;
          stream.destroy();
        }
      } catch (error) {
        if (closed) return;
        closed = true;
        try { controller.error(error); } catch { /* The response controller is already closed. */ }
      }
    },
    async cancel() {
      if (closed) return;
      closed = true;
      stream.destroy();
      try { await iterator.return?.(); } catch { /* Destruction already completed cleanup. */ }
    }
  });
}

function mimeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function parseRange(header: string | null, size: number) {
  if (!header) return undefined;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function streamAudioFileResponse(
  request: Request,
  file: StreamableAudioFile,
  options: { allowDownload?: boolean; cacheControl?: string } = {}
) {
  if (!file.filePath) return NextResponse.json({ error: "檔案不存在" }, { status: 404 });
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  if (wantsDownload && options.allowDownload === false) {
    return NextResponse.json({ error: "這個分享包沒有開放下載。" }, { status: 403 });
  }

  try {
    const resolvedFilePath = resolveStoredFilePath(file.filePath);
    const fileStat = await stat(/* turbopackIgnore: true */ resolvedFilePath);
    if (!fileStat.isFile()) throw Object.assign(new Error("not_file"), { code: "ENOENT" });
    const range = parseRange(request.headers.get("range"), fileStat.size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${fileStat.size}` }
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? fileStat.size - 1;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": options.cacheControl || "private, max-age=0, must-revalidate",
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`,
      "Content-Length": String(end - start + 1),
      "Content-Type": file.mimeType ?? mimeFor(file.fileName)
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    return new Response(
      cancellableFileStream(createReadStream(/* turbopackIgnore: true */ resolvedFilePath, { start, end })),
      { status: range ? 206 : 200, headers }
    );
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return NextResponse.json(
      {
        error: "檔案路徑存在於資料庫，但本機找不到原始檔案",
        code: code || "FILE_READ_FAILED",
        audioFileId: file.id,
        fileName: file.fileName,
        filePath: file.filePath
      },
      { status: code === "ENOENT" ? 404 : 500 }
    );
  }
}
