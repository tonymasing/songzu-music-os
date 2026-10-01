import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const SegmentSchema = z.object({
  sourceStartSeconds: z.number().min(0),
  sourceEndSeconds: z.number().positive(),
  timelineStartSeconds: z.number().min(0),
  fadeInSeconds: z.number().min(0).max(2).default(0.01),
  fadeOutSeconds: z.number().min(0).max(2).default(0.01),
  active: z.boolean().default(true)
}).refine((value) => value.sourceEndSeconds > value.sourceStartSeconds, { message: "Comp 結束必須晚於開始。" });

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = SegmentSchema.parse(await request.json());
  const lane = await prisma.dawTakeLane.findUnique({ where: { id }, include: { track: true, compSegments: true } });
  if (!lane) return NextResponse.json({ error: "找不到 Take lane。" }, { status: 404 });
  const segment = await prisma.$transaction(async (tx) => {
    const created = await tx.dawTakeCompSegment.create({ data: { takeLaneId: id, sortOrder: lane.compSegments.length + 1, ...body } });
    await recordDawEditOperation(tx, {
      projectId: lane.track.projectId,
      operationType: "create",
      entityType: "comp_segment",
      entityId: created.id,
      label: "新增 Take Comp 區段",
      before: null,
      after: created
    });
    return created;
  });
  const project = await getDawProjectById(lane.track.projectId);
  return NextResponse.json({ segment, project: project ? toDawProjectDto(project) : null }, { status: 201 });
}
