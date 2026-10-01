import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { publicPreviewRecord } from "@/lib/storefront";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ token: string }> };

function coverMime(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const preview = await publicPreviewRecord(token);
  const cover = preview?.song.audioFiles.find(
    (file) => file.fileType === "cover" && file.filePath && /\.(png|jpe?g|webp)$/i.test(file.fileName)
  );
  if (!cover?.filePath) return NextResponse.json({ error: "沒有封面。" }, { status: 404 });
  try {
    return new Response(await readFile(cover.filePath), {
      headers: { "Content-Type": coverMime(cover.fileName), "Cache-Control": "public, max-age=3600" }
    });
  } catch {
    return NextResponse.json({ error: "封面檔案遺失。" }, { status: 404 });
  }
}
