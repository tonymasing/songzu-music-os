import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateClipSchema = z.object({
  startSeconds: z.number().min(0).optional(),
  offsetSeconds: z.number().min(0).optional(),
  durationSeconds: z.number().positive().nullable().optional(),
  gain: z.number().min(0).max(4).optional(),
  fadeInSeconds: z.number().min(0).max(60).optional(),
  fadeOutSeconds: z.number().min(0).max(60).optional(),
  locked: z.boolean().optional(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  zeroCrossingAdjusted: z.boolean().optional(),
  crossfadeGroupId: z.string().nullable().optional(),
  operationGroupId: z.string().min(1).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function projectForClip(id: string) {
  const clip = await prisma.dawClip.findUnique({
    where: { id },
    include: { track: true }
  });
  return clip ? getDawProjectById(clip.track.projectId) : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.dawClip.findUnique({ where: { id }, include: { track: { select: { projectId: true } } } });
  if (!current) {
    return NextResponse.json({ error: "DAW clip not found" }, { status: 404 });
  }

  const body = UpdateClipSchema.parse(await request.json());
  const updateKeys = Object.keys(body).filter((key) => key !== "operationGroupId");
  if (current.locked && !(updateKeys.length === 1 && body.locked === false)) {
    return NextResponse.json({ error: "Clip 已鎖定，請先解除鎖定再編輯。" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.dawClip.update({
      where: { id },
      data: {
        ...(body.startSeconds !== undefined ? { startSeconds: body.startSeconds } : {}),
        ...(body.offsetSeconds !== undefined ? { offsetSeconds: body.offsetSeconds } : {}),
        ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
        ...(body.gain !== undefined ? { gain: body.gain } : {}),
        ...(body.fadeInSeconds !== undefined ? { fadeInSeconds: body.fadeInSeconds } : {}),
        ...(body.fadeOutSeconds !== undefined ? { fadeOutSeconds: body.fadeOutSeconds } : {}),
        ...(body.locked !== undefined ? { locked: body.locked } : {}),
        ...(body.label !== undefined ? { label: body.label || null } : {}),
        ...(body.color !== undefined ? { color: body.color || null } : {}),
        ...(body.groupId !== undefined ? { groupId: body.groupId || null } : {}),
        ...(body.zeroCrossingAdjusted !== undefined ? { zeroCrossingAdjusted: body.zeroCrossingAdjusted } : {}),
        ...(body.crossfadeGroupId !== undefined ? { crossfadeGroupId: body.crossfadeGroupId || null } : {})
      }
    });
    await recordDawEditOperation(tx, {
      projectId: current.track.projectId,
      operationType: "update",
      entityType: "clip",
      entityId: id,
      label: `編輯片段 ${current.label ?? current.id}`,
      before: current,
      after: updated,
      groupId: body.operationGroupId ?? null
    });
  });

  const clip = await prisma.dawClip.findUnique({ where: { id }, include: { track: true } });
  const project = clip ? await getDawProjectById(clip.track.projectId) : null;
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const clip = await prisma.dawClip.findUnique({ where: { id } });
  const project = await projectForClip(id);
  if (!project || !clip) {
    return NextResponse.json({ error: "DAW clip not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dawClip.delete({ where: { id } });
    await recordDawEditOperation(tx, {
      projectId: project.id,
      operationType: "delete",
      entityType: "clip",
      entityId: id,
      label: `刪除片段 ${clip?.label ?? id}`,
      before: clip,
      after: null
    });
  });
  const updated = await getDawProjectById(project.id);
  return NextResponse.json({ project: updated ? toDawProjectDto(updated) : null });
}
