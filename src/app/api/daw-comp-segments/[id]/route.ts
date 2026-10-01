import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const UpdateSchema = z.object({
  sourceStartSeconds: z.number().min(0).optional(),
  sourceEndSeconds: z.number().positive().optional(),
  timelineStartSeconds: z.number().min(0).optional(),
  fadeInSeconds: z.number().min(0).max(2).optional(),
  fadeOutSeconds: z.number().min(0).max(2).optional(),
  active: z.boolean().optional()
});

async function currentSegment(id: string) {
  return prisma.dawTakeCompSegment.findUnique({ where: { id }, include: { takeLane: { include: { track: true } } } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateSchema.parse(await request.json());
  const current = await currentSegment(id);
  if (!current) return NextResponse.json({ error: "找不到 Comp 區段。" }, { status: 404 });
  const merged = { ...current, ...body };
  if (merged.sourceEndSeconds <= merged.sourceStartSeconds) return NextResponse.json({ error: "Comp 結束必須晚於開始。" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    const updated = await tx.dawTakeCompSegment.update({ where: { id }, data: body });
    await recordDawEditOperation(tx, {
      projectId: current.takeLane.track.projectId,
      operationType: "update",
      entityType: "comp_segment",
      entityId: id,
      label: "調整 Take Comp 區段",
      before: current,
      after: updated
    });
  });
  const project = await getDawProjectById(current.takeLane.track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await currentSegment(id);
  if (!current) return NextResponse.json({ error: "找不到 Comp 區段。" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.dawTakeCompSegment.delete({ where: { id } });
    await recordDawEditOperation(tx, {
      projectId: current.takeLane.track.projectId,
      operationType: "delete",
      entityType: "comp_segment",
      entityId: id,
      label: "刪除 Take Comp 區段",
      before: current,
      after: null
    });
  });
  const project = await getDawProjectById(current.takeLane.track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}
