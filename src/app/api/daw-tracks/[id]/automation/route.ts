import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const PointSchema = z.object({
  timeSeconds: z.number().min(0),
  value: z.number(),
  curve: z.enum(["step", "linear", "smooth"]).default("linear")
});
const AutomationSchema = z.object({
  parameter: z.enum(["volume", "pan", "send", "lowGain", "midGain", "highGain", "compression", "reverb", "echo"]),
  mode: z.enum(["off", "read", "touch", "latch", "write"]).default("read"),
  enabled: z.boolean().default(true),
  minValue: z.number().default(0),
  maxValue: z.number().default(1),
  points: z.array(PointSchema).max(4096).default([])
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = AutomationSchema.parse(await request.json());
  const track = await prisma.dawTrack.findUnique({ where: { id } });
  if (!track) return NextResponse.json({ error: "DAW track not found" }, { status: 404 });
  const existing = await prisma.dawAutomationLane.findUnique({
    where: { trackId_parameter: { trackId: id, parameter: body.parameter } },
    include: { points: true }
  });
  const lane = await prisma.$transaction(async (tx) => {
    const saved = await tx.dawAutomationLane.upsert({
      where: { trackId_parameter: { trackId: id, parameter: body.parameter } },
      create: { trackId: id, parameter: body.parameter, mode: body.mode, enabled: body.enabled, minValue: body.minValue, maxValue: body.maxValue },
      update: { mode: body.mode, enabled: body.enabled, minValue: body.minValue, maxValue: body.maxValue }
    });
    await tx.dawAutomationPoint.deleteMany({ where: { laneId: saved.id } });
    if (body.points.length) await tx.dawAutomationPoint.createMany({ data: body.points.map((point) => ({ laneId: saved.id, ...point })) });
    const after = await tx.dawAutomationLane.findUniqueOrThrow({ where: { id: saved.id }, include: { points: true } });
    await recordDawEditOperation(tx, {
      projectId: track.projectId,
      operationType: existing ? "update" : "create",
      entityType: "automation_lane",
      entityId: saved.id,
      label: `${body.parameter} Automation`,
      before: existing,
      after
    });
    return after;
  });
  const project = await getDawProjectById(track.projectId);
  return NextResponse.json({ lane, project: project ? toDawProjectDto(project) : null });
}
