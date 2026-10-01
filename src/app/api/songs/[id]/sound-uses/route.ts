import { NextResponse } from "next/server";
import { z } from "zod";

import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const SongSoundUseSchema = z.object({
  soundLibraryItemId: z.string().min(1),
  role: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  status: z.string().optional().default("PLANNED"),
  notes: z.string().optional().nullable()
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = SongSoundUseSchema.parse(await request.json());

  const item = await prisma.soundLibraryItem.findUnique({
    where: { id: body.soundLibraryItemId }
  });

  if (!item) {
    return NextResponse.json({ error: "Sound library item not found" }, { status: 404 });
  }

  const existing = await prisma.songSoundUse.findFirst({
    where: {
      songId: id,
      soundLibraryItemId: body.soundLibraryItemId
    }
  });

  if (existing) {
    await prisma.songSoundUse.update({
      where: { id: existing.id },
      data: {
        role: body.role || existing.role,
        section: body.section || existing.section,
        status: body.status,
        notes: body.notes || existing.notes
      }
    });
  } else {
    const usage = await prisma.songSoundUse.create({
      data: {
        songId: id,
        soundLibraryItemId: body.soundLibraryItemId,
        role: body.role || null,
        section: body.section || null,
        status: body.status,
        notes: body.notes || null
      }
    });

    await prisma.timelineEvent.create({
      data: {
        songId: id,
        eventType: "sound_blueprint",
        title: `加入音色藍圖：${item.name}`,
        description: [body.section, body.role, body.notes].filter(Boolean).join(" · ") || "已加入單曲音色藍圖。",
        relatedModel: "SongSoundUse",
        relatedId: usage.id,
        metadataJson: JSON.stringify({ soundLibraryItemId: item.id, status: body.status })
      }
    });
  }

  const song = await prisma.song.findUniqueOrThrow({
    where: { id },
    include: songInclude
  });

  return NextResponse.json(toSongDto(song), { status: 201 });
}
