import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { validateDawRoute } from "@/lib/daw-routing";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const UpdateSchema = z.object({
  destinationTrackId: z.string().min(1).nullable().optional(),
  routeType: z.enum(["output", "send", "cue", "sidechain"]).optional(),
  name: z.string().min(1).optional(),
  preFader: z.boolean().optional(),
  gain: z.number().min(0).max(2).optional(),
  pan: z.number().min(-1).max(1).optional(),
  muted: z.boolean().optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateSchema.parse(await request.json());
  const current = await prisma.dawRoute.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到路由。" }, { status: 404 });
  try {
    await validateDawRoute({
      projectId: current.projectId,
      sourceTrackId: current.sourceTrackId,
      destinationTrackId: body.destinationTrackId === undefined ? current.destinationTrackId : body.destinationTrackId,
      routeType: body.routeType ?? (current.routeType as "output" | "send" | "cue" | "sidechain"),
      ignoreRouteId: id
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "路由設定不合法。" }, { status: 400 });
  }
  const route = await prisma.$transaction(async (tx) => {
    const updated = await tx.dawRoute.update({ where: { id }, data: body });
    await recordDawEditOperation(tx, {
      projectId: current.projectId,
      operationType: "update",
      entityType: "route",
      entityId: id,
      label: `調整路由 ${current.name}`,
      before: current,
      after: updated
    });
    return updated;
  });
  const project = await getDawProjectById(route.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.dawRoute.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到路由。" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.dawRoute.delete({ where: { id } });
    await recordDawEditOperation(tx, {
      projectId: current.projectId,
      operationType: "delete",
      entityType: "route",
      entityId: id,
      label: `刪除路由 ${current.name}`,
      before: current,
      after: null
    });
  });
  const project = await getDawProjectById(current.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}
