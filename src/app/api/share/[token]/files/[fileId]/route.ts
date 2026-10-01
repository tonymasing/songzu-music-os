import { NextResponse } from "next/server";

import { streamAudioFileResponse } from "@/lib/audio-file-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string; fileId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { token, fileId } = await context.params;
  const file = await prisma.audioFile.findUnique({ where: { id: fileId } });
  if (!file?.filePath) return NextResponse.json({ error: "分享音檔不存在。" }, { status: 404 });

  const pack = await prisma.pitchPack.findFirst({
    where: { token, songs: { some: { songId: file.songId } } },
    select: { allowDownload: true }
  });
  if (!pack) return NextResponse.json({ error: "分享連結無效，或這個音檔不在分享包內。" }, { status: 404 });

  return streamAudioFileResponse(request, file, {
    allowDownload: pack.allowDownload,
    cacheControl: "private, no-store, max-age=0"
  });
}
