import { NextResponse } from "next/server";
import { z } from "zod";

import { toMusicMaterialDto } from "@/lib/music-database";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateMusicMaterialSchema = z.object({
  title: z.string().min(1).optional(),
  materialType: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  summary: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  moods: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  musicalKey: z.string().optional().nullable(),
  mode: z.string().optional().nullable(),
  bpm: z.number().int().optional().nullable(),
  meter: z.string().optional().nullable(),
  sectionRole: z.string().optional().nullable(),
  energy: z.number().int().min(1).max(10).optional().nullable(),
  relatedSongId: z.string().optional().nullable(),
  relatedSoundId: z.string().optional().nullable(),
  status: z.string().min(1).optional(),
  favorite: z.boolean().optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateMusicMaterialSchema.parse(await request.json());
  const item = await prisma.musicMaterial.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.materialType !== undefined ? { materialType: body.materialType } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.summary !== undefined ? { summary: body.summary || null } : {}),
      ...(body.source !== undefined ? { source: body.source || null } : {}),
      ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl || null } : {}),
      ...(body.genre !== undefined ? { genre: body.genre || null } : {}),
      ...(body.moods !== undefined ? { moodJson: JSON.stringify(body.moods) } : {}),
      ...(body.tags !== undefined ? { tagsJson: JSON.stringify(body.tags) } : {}),
      ...(body.musicalKey !== undefined ? { musicalKey: body.musicalKey || null } : {}),
      ...(body.mode !== undefined ? { mode: body.mode || null } : {}),
      ...(body.bpm !== undefined ? { bpm: body.bpm ?? null } : {}),
      ...(body.meter !== undefined ? { meter: body.meter || null } : {}),
      ...(body.sectionRole !== undefined ? { sectionRole: body.sectionRole || null } : {}),
      ...(body.energy !== undefined ? { energy: body.energy ?? null } : {}),
      ...(body.relatedSongId !== undefined ? { relatedSongId: body.relatedSongId || null } : {}),
      ...(body.relatedSoundId !== undefined ? { relatedSoundId: body.relatedSoundId || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.favorite !== undefined ? { favorite: body.favorite } : {})
    },
    include: {
      relatedSong: { select: { id: true, title: true } },
      relatedSound: { select: { id: true, name: true, family: true, previewPath: true, assetPath: true } }
    }
  });

  return NextResponse.json(toMusicMaterialDto(item));
}
