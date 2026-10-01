import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { validateDawRoute } from "@/lib/daw-routing";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

const CreateRouteSchema = z.object({
  sourceTrackId: z.string().min(1).nullable().optional(),
  destinationTrackId: z.string().min(1).nullable().optional(),
  routeType: z.enum(["output", "send", "cue", "sidechain"]).default("send"),
  name: z.string().min(1),
  preFader: z.boolean().default(false),
  gain: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
  muted: z.boolean().default(false)
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getDawProjectById(id);
  if (!project) return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  return NextResponse.json({ project: toDawProjectDto(project) });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateRouteSchema.parse(await request.json());
  try {
    await validateDawRoute({
      projectId: id,
      sourceTrackId: body.sourceTrackId ?? null,
      destinationTrackId: body.destinationTrackId ?? null,
      routeType: body.routeType
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "路由設定不合法。" }, { status: 400 });
  }
  const route = await prisma.$transaction(async (tx) => {
    const created = await tx.dawRoute.create({ data: { projectId: id, ...body } });
    await recordDawEditOperation(tx, {
      projectId: id,
      operationType: "create",
      entityType: "route",
      entityId: created.id,
      label: `新增路由 ${created.name}`,
      before: null,
      after: created
    });
    return created;
  });
  const project = await getDawProjectById(id);
  return NextResponse.json({ route, project: project ? toDawProjectDto(project) : null }, { status: 201 });
}
