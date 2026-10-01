import { NextResponse } from "next/server";

import { streamAudioFileResponse } from "@/lib/audio-file-response";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = await prisma.audioFile.findUnique({ where: { id } });

  if (!file?.filePath) {
    return NextResponse.json({ error: "檔案不存在" }, { status: 404 });
  }
  return streamAudioFileResponse(request, file);
}
