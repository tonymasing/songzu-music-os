import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateTrackSchema = z.object({
  name: z.string().min(1).optional(),
  trackType: z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  muted: z.boolean().optional(),
  solo: z.boolean().optional(),
  armed: z.boolean().optional(),
  monitoring: z.boolean().optional(),
  volume: z.number().min(0).max(2).optional(),
  pan: z.number().min(-1).max(1).optional(),
  color: z.string().nullable().optional(),
  inputSource: z.string().nullable().optional(),
  outputTarget: z.string().min(1).optional(),
  polarityInverted: z.boolean().optional(),
  stereoMode: z.enum(["mono", "stereo", "mid_side"]).optional(),
  effects: z.array(z.record(z.string(), z.unknown())).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateTrackSchema.parse(await request.json());
  const current = await prisma.dawTrack.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "DAW track not found" }, { status: 404 });
  const track = await prisma.$transaction(async (tx) => {
    // v1 records one physical input at a time. Arm and input monitoring are
    // therefore exclusive so the button the user just pressed is always the
    // real capture target instead of a decorative persisted flag.
    if (body.armed === true) {
      await tx.dawTrack.updateMany({
        where: { projectId: current.projectId, id: { not: id }, armed: true },
        data: { armed: false }
      });
    }
    if (body.monitoring === true) {
      await tx.dawTrack.updateMany({
        where: { projectId: current.projectId, id: { not: id }, monitoring: true },
        data: { monitoring: false }
      });
    }
    const updated = await tx.dawTrack.update({
      where: { id },
      data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.trackType !== undefined ? { trackType: body.trackType } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.muted !== undefined ? { muted: body.muted } : {}),
      ...(body.solo !== undefined ? { solo: body.solo } : {}),
      ...(body.armed !== undefined ? { armed: body.armed } : {}),
      ...(body.monitoring !== undefined ? { monitoring: body.monitoring } : {}),
      ...(body.volume !== undefined ? { volume: body.volume } : {}),
      ...(body.pan !== undefined ? { pan: body.pan } : {}),
      ...(body.color !== undefined ? { color: body.color || null } : {}),
      ...(body.inputSource !== undefined ? { inputSource: body.inputSource || null } : {}),
      ...(body.outputTarget !== undefined ? { outputTarget: body.outputTarget } : {}),
      ...(body.polarityInverted !== undefined ? { polarityInverted: body.polarityInverted } : {}),
      ...(body.stereoMode !== undefined ? { stereoMode: body.stereoMode } : {}),
      ...(body.effects !== undefined ? { effectsJson: JSON.stringify(body.effects) } : {})
      }
    });
    await recordDawEditOperation(tx, {
      projectId: current.projectId,
      operationType: "update",
      entityType: "track",
      entityId: id,
      label: `調整音軌 ${current.name}`,
      before: current,
      after: updated
    });
    return updated;
  });

  const project = await getDawProjectById(track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const track = await prisma.dawTrack.findUnique({
    where: { id },
    include: { clips: true, takeLanes: true }
  });
  if (!track) {
    return NextResponse.json({ error: "DAW track not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.dawTrack.delete({ where: { id } });
    await recordDawEditOperation(tx, {
      projectId: track.projectId,
      operationType: "delete",
      entityType: "track",
      entityId: id,
      label: `刪除音軌 ${track.name}`,
      before: track,
      after: null
    });
  });
  const project = await getDawProjectById(track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}
