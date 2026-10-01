import { NextResponse } from "next/server";
import { z } from "zod";

import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateSetupChecklistSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  sortOrder: z.number().int().optional(),
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
  const body = UpdateSetupChecklistSchema.parse(await request.json());
  const current = await prisma.songSetupChecklistItem.findUniqueOrThrow({ where: { id } });

  await prisma.songSetupChecklistItem.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    }
  });

  return loadSong(current.songId);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.songSetupChecklistItem.findUniqueOrThrow({ where: { id } });
  await prisma.songSetupChecklistItem.delete({ where: { id } });
  return loadSong(current.songId);
}
