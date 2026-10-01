import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

const LyricsSchema = z.object({
  versionName: z.string().min(1),
  content: z.string().min(1),
  sections: z.array(z.object({ label: z.string(), startLine: z.number().optional(), endLine: z.number().optional() })).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = LyricsSchema.parse(await request.json());

  await prisma.$transaction(async (tx) => {
    if (body.isPrimary) {
      await tx.lyricsVersion.updateMany({
        where: { songId: id },
        data: { isPrimary: false }
      });
    }

    const lyricsVersion = await tx.lyricsVersion.create({
      data: {
        songId: id,
        versionName: body.versionName,
        content: body.content,
        sectionsJson: body.sections ? JSON.stringify(body.sections) : null,
        isPrimary: body.isPrimary,
        notes: body.notes || null
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId: id,
        eventType: "lyrics_version_created",
        title: "新增歌詞版本",
        description: `${body.versionName} 已加入歌詞版本紀錄。`,
        relatedModel: "LyricsVersion",
        relatedId: lyricsVersion.id
      }
    });
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
