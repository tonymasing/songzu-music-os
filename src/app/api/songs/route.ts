import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

const CreateSongSchema = z.object({
  title: z.string().min(1),
  workingTitle: z.string().optional().nullable(),
  status: z.string().default("IDEA"),
  bpm: z.number().int().min(20).max(300).optional().nullable(),
  musicalKey: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  subgenre: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  mood: z.array(z.string()).optional(),
  summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  targetReleaseDate: z.string().optional().nullable()
});

export async function GET() {
  const songs = await prisma.song.findMany({
    include: songInclude,
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json(songs.map(toSongDto));
}

export async function POST(request: Request) {
  const body = CreateSongSchema.parse(await request.json());
  const song = await prisma.song.create({
    data: {
      title: body.title,
      workingTitle: body.workingTitle || null,
      status: body.status,
      bpm: body.bpm ?? null,
      musicalKey: body.musicalKey || null,
      genre: body.genre || null,
      subgenre: body.subgenre || null,
      language: body.language || "zh-TW",
      moodJson: JSON.stringify(body.mood ?? []),
      summary: body.summary || null,
      notes: body.notes || null,
      targetReleaseDate: body.targetReleaseDate ? new Date(body.targetReleaseDate) : null,
      statusHistory: {
        create: {
          toStatus: body.status,
          note: "建立作品"
        }
      }
    },
    include: songInclude
  });

  return NextResponse.json(toSongDto(song), { status: 201 });
}
