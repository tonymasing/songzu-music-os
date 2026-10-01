import { NextResponse } from "next/server";

import { songInclude, toSongDto } from "@/lib/music";
import { compareAudioVersions } from "@/lib/production-director";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  return NextResponse.json(compareAudioVersions(toSongDto(song)));
}
