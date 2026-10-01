import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { publicPreviewRecord, songPreviewPath } from "@/lib/storefront";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ token: string }> };

function streamResponse(path: string, start: number, end: number, size: number, partial: boolean) {
  const nodeStream = createReadStream(path, { start, end });
  const body = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "audio/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Disposition": 'inline; filename="songzu-preview-30s.m4a"',
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
    }
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const preview = await publicPreviewRecord(token);
  if (!preview?.previewFileName) return NextResponse.json({ error: "試聽檔不存在。" }, { status: 404 });
  const path = songPreviewPath(preview.songId, preview.previewFileName);
  try {
    const file = await stat(path);
    const range = request.headers.get("range");
    if (!range) return streamResponse(path, 0, file.size - 1, file.size, false);
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= file.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    }
    return streamResponse(path, start, end, file.size, true);
  } catch {
    return NextResponse.json({ error: "試聽檔遺失，請通知創作者重新產生。" }, { status: 404 });
  }
}
