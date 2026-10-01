import { NextResponse } from "next/server";

import { assertReferenceAudioPath, referenceAudioContentType, referenceAudioName } from "@/lib/reference-library";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const nodeFs = process.getBuiltinModule("fs") as typeof import("node:fs");
const nodeFsPromises = process.getBuiltinModule("fs/promises") as typeof import("node:fs/promises");

function cancellableWebStream(stream: import("node:fs").ReadStream) {
  const iterator = stream[Symbol.asyncIterator]();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (closed) return;
        if (result.done) {
          closed = true;
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (!closed) {
          closed = true;
          controller.error(error);
        }
      }
    },
    async cancel() {
      closed = true;
      stream.destroy();
      await iterator.return?.();
    }
  });
}

function streamAudio(path: string, name: string, size: number, start: number, end: number, partial: boolean) {
  const body = cancellableWebStream(nodeFs.createReadStream(/* turbopackIgnore: true */ path, { start, end }));
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(end - start + 1),
      "Content-Type": referenceAudioContentType(name),
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
    }
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const item = await prisma.musicMaterial.findFirst({
    where: { id, materialType: "style_reference" },
    select: { externalAudioPath: true, externalFileName: true }
  });
  if (!item) return NextResponse.json({ error: "找不到風格參考音檔。" }, { status: 404 });

  try {
    const path = assertReferenceAudioPath(item.externalAudioPath);
    const file = await nodeFsPromises.stat(/* turbopackIgnore: true */ path);
    const name = referenceAudioName(item);
    const range = request.headers.get("range");
    if (!range) return streamAudio(path, name, file.size, 0, file.size - 1, false);

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= file.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    }
    return streamAudio(path, name, file.size, start, end, true);
  } catch {
    return NextResponse.json({ error: "外部參考音檔目前無法讀取。" }, { status: 404 });
  }
}
