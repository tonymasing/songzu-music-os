import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { storagePath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

const CONTENT_TYPES: Record<string, string> = {
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav"
};

function safeAssetPath(parts: string[]) {
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return null;
  const root = resolve(/* turbopackIgnore: true */ storagePath("sounds"));
  const filePath = resolve(root, ...parts);
  const child = relative(root, filePath);
  if (child.startsWith("..") || isAbsolute(child)) return null;
  return filePath;
}

function parseRange(header: string | null, size: number) {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  const { path: parts } = await context.params;
  const filePath = safeAssetPath(parts);
  if (!filePath) return NextResponse.json({ error: "素材路徑不安全。" }, { status: 400 });

  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    if (!fileStat.isFile()) throw new Error("not_file");
    const range = parseRange(request.headers.get("range"), fileStat.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? fileStat.size - 1;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(end - start + 1),
      "Content-Type": CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    return new Response(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ filePath, { start, end })) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers
    });
  } catch {
    return NextResponse.json({ error: "音色素材不存在或外接磁碟尚未連接。" }, { status: 404 });
  }
}
