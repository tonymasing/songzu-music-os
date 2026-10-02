import { NextResponse } from "next/server";

import { streamAudioFileResponse } from "@/lib/audio-file-response";
import { prisma } from "@/lib/prisma";
import { getReferenceVideo } from "@/lib/reference-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const item = await prisma.musicMaterial.findFirst({
    where: { id, materialType: "style_reference" }, select: { id: true }
  });
  const video = item ? await getReferenceVideo(item.id) : null;
  if (!video) return NextResponse.json({ error: "這首歌曲尚未加入可播放的 MV。" }, { status: 404 });
  return streamAudioFileResponse(request, {
    id, fileName: "MV.mp4", filePath: video.path, mimeType: "video/mp4"
  }, { allowDownload: false, cacheControl: "private, no-store" });
}
