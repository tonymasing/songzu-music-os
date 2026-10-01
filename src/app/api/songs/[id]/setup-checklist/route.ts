import { NextResponse } from "next/server";
import { z } from "zod";

import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const SetupChecklistSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional().default("錄音準備"),
  status: z.string().optional().default("TODO"),
  priority: z.string().optional().default("medium"),
  sortOrder: z.number().int().optional().default(0),
  notes: z.string().optional().nullable()
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = SetupChecklistSchema.parse(await request.json());

  const item = await prisma.songSetupChecklistItem.create({
    data: {
      songId: id,
      title: body.title,
      category: body.category,
      status: body.status,
      priority: body.priority,
      sortOrder: body.sortOrder,
      notes: body.notes || null
    }
  });

  await prisma.timelineEvent.create({
    data: {
      songId: id,
      eventType: "recording_setup",
      title: `新增錄音準備：${item.title}`,
      description: `${item.category} · ${item.priority}`,
      relatedModel: "SongSetupChecklistItem",
      relatedId: item.id
    }
  });

  const song = await prisma.song.findUniqueOrThrow({
    where: { id },
    include: songInclude
  });

  return NextResponse.json(toSongDto(song), { status: 201 });
}
