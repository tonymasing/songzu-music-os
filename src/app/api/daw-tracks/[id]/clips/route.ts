import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateClipSchema = z.object({
  audioFileId: z.string().min(1),
  startSeconds: z.number().min(0).default(0),
  offsetSeconds: z.number().min(0).default(0),
  durationSeconds: z.number().positive().nullable().optional(),
  gain: z.number().min(0).max(4).default(1),
  fadeInSeconds: z.number().min(0).max(60).default(0),
  fadeOutSeconds: z.number().min(0).max(60).default(0),
  locked: z.boolean().default(false),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateClipSchema.parse(await request.json());
  const track = await prisma.dawTrack.findUnique({ where: { id } });

  if (!track) {
    return NextResponse.json({ error: "DAW track not found" }, { status: 404 });
  }

  const audioFile = await prisma.audioFile.findUnique({ where: { id: body.audioFileId } });
  if (!audioFile) {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const clip = await tx.dawClip.create({
      data: {
      trackId: id,
      audioFileId: body.audioFileId,
      startSeconds: body.startSeconds,
      offsetSeconds: body.offsetSeconds,
      durationSeconds: body.durationSeconds ?? audioFile.durationSeconds,
      gain: body.gain,
      fadeInSeconds: body.fadeInSeconds,
      fadeOutSeconds: body.fadeOutSeconds,
      locked: body.locked,
      label: body.label ?? audioFile.versionName ?? audioFile.fileName,
      color: body.color ?? track.color
      }
    });
    await recordDawEditOperation(tx, {
      projectId: track.projectId,
      operationType: "create",
      entityType: "clip",
      entityId: clip.id,
      label: `新增片段 ${clip.label ?? clip.id}`,
      before: null,
      after: clip
    });
  });

  const project = await getDawProjectById(track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null }, { status: 201 });
}
