import { NextResponse } from "next/server";
import { z } from "zod";

import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateSongSoundUseSchema = z.object({
  role: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  status: z.string().optional(),
  notes: z.string().optional().nullable()
});

async function loadSong(songId: string) {
  const song = await prisma.song.findUniqueOrThrow({
    where: { id: songId },
    include: songInclude
  });
  return NextResponse.json(toSongDto(song));
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateSongSoundUseSchema.parse(await request.json());
  const current = await prisma.songSoundUse.findUniqueOrThrow({ where: { id } });

  await prisma.songSoundUse.update({
    where: { id },
    data: {
      ...(body.role !== undefined ? { role: body.role || null } : {}),
      ...(body.section !== undefined ? { section: body.section || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    }
  });

  return loadSong(current.songId);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.songSoundUse.findUniqueOrThrow({ where: { id } });
  await prisma.songSoundUse.delete({ where: { id } });
  return loadSong(current.songId);
}
