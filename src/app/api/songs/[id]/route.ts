import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { buildReleaseReadiness, songInclude, toSongDto } from "@/lib/music";
import { ensurePublishedSongPreview } from "@/lib/storefront";

const UpdateSongSchema = z.object({
  title: z.string().min(1).optional(),
  workingTitle: z.string().optional().nullable(),
  status: z.string().optional(),
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  return NextResponse.json(toSongDto(song));
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.song.findUnique({ where: { id }, include: songInclude });
  if (!current) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const body = UpdateSongSchema.parse(await request.json());

  if (body.status === "READY_FOR_RELEASE") {
    const candidate = {
      ...current,
      bpm: body.bpm !== undefined ? body.bpm : current.bpm,
      musicalKey: body.musicalKey !== undefined ? body.musicalKey || null : current.musicalKey,
      genre: body.genre !== undefined ? body.genre || null : current.genre,
      summary: body.summary !== undefined ? body.summary || null : current.summary,
      targetReleaseDate: body.targetReleaseDate !== undefined
        ? body.targetReleaseDate ? new Date(body.targetReleaseDate) : null
        : current.targetReleaseDate
    };
    const readiness = buildReleaseReadiness(candidate);
    if (!readiness.ready) {
      return NextResponse.json(
        {
          error: "作品尚未通過統一發行門檻。",
          readiness
        },
        { status: 409 }
      );
    }
    const blockingMaster = current.audioFiles.find((file) => file.fileType === "master" && file.qualityStatus === "fail");
    if (blockingMaster) {
      return NextResponse.json(
        { error: `Master 音質未通過：${blockingMaster.fileName}。請先重新輸出或重新分析後再進入準備發行。` },
        { status: 409 }
      );
    }
  }

  const song = await prisma.song.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.workingTitle !== undefined ? { workingTitle: body.workingTitle || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.bpm !== undefined ? { bpm: body.bpm ?? null } : {}),
      ...(body.musicalKey !== undefined ? { musicalKey: body.musicalKey || null } : {}),
      ...(body.genre !== undefined ? { genre: body.genre || null } : {}),
      ...(body.subgenre !== undefined ? { subgenre: body.subgenre || null } : {}),
      ...(body.language !== undefined ? { language: body.language || "zh-TW" } : {}),
      ...(body.mood !== undefined ? { moodJson: JSON.stringify(body.mood) } : {}),
      ...(body.summary !== undefined ? { summary: body.summary || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.targetReleaseDate !== undefined
        ? { targetReleaseDate: body.targetReleaseDate ? new Date(body.targetReleaseDate) : null }
        : {}),
      ...(body.status && body.status !== current.status
        ? {
            statusHistory: {
              create: {
                fromStatus: current.status,
                toStatus: body.status,
                note: "手動更新狀態"
              }
            }
          }
        : {})
    },
    include: songInclude
  });

  const previewAutomation =
    body.status === "RELEASED" && current.status !== "RELEASED"
      ? await ensurePublishedSongPreview(song.id)
      : null;
  return NextResponse.json({ ...toSongDto(song), previewAutomation });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.song.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
