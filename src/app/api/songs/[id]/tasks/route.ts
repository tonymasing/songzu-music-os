import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

const TaskSchema = z.object({
  title: z.string().min(1),
  status: z.string().default("TODO"),
  category: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = TaskSchema.parse(await request.json());

  await prisma.task.create({
    data: {
      songId: id,
      title: body.title,
      status: body.status,
      category: body.category || null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null
    }
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
