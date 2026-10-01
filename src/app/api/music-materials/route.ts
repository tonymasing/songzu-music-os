import { NextResponse } from "next/server";
import { z } from "zod";

import { getMusicMaterials, toMusicMaterialDto } from "@/lib/music-database";
import { prisma } from "@/lib/prisma";

const MusicMaterialSchema = z.object({
  title: z.string().min(1),
  materialType: z.string().min(1).default("concept"),
  content: z.string().min(1),
  summary: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  moods: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  musicalKey: z.string().optional().nullable(),
  mode: z.string().optional().nullable(),
  bpm: z.number().int().optional().nullable(),
  meter: z.string().optional().nullable(),
  sectionRole: z.string().optional().nullable(),
  energy: z.number().int().min(1).max(10).optional().nullable(),
  relatedSongId: z.string().optional().nullable(),
  relatedSoundId: z.string().optional().nullable(),
  status: z.string().min(1).default("COLLECTED"),
  favorite: z.boolean().optional().default(false)
});

export async function GET() {
  return NextResponse.json(await getMusicMaterials());
}

export async function POST(request: Request) {
  const body = MusicMaterialSchema.parse(await request.json());
  const item = await prisma.musicMaterial.create({
    data: {
      title: body.title,
      materialType: body.materialType,
      content: body.content,
      summary: body.summary || null,
      source: body.source || null,
      sourceUrl: body.sourceUrl || null,
      genre: body.genre || null,
      moodJson: JSON.stringify(body.moods),
      tagsJson: JSON.stringify(body.tags),
      musicalKey: body.musicalKey || null,
      mode: body.mode || null,
      bpm: body.bpm ?? null,
      meter: body.meter || null,
      sectionRole: body.sectionRole || null,
      energy: body.energy ?? null,
      relatedSongId: body.relatedSongId || null,
      relatedSoundId: body.relatedSoundId || null,
      status: body.status,
      favorite: body.favorite
    },
    include: {
      relatedSong: { select: { id: true, title: true } },
      relatedSound: { select: { id: true, name: true, family: true, previewPath: true, assetPath: true } }
    }
  });

  return NextResponse.json(toMusicMaterialDto(item), { status: 201 });
}
