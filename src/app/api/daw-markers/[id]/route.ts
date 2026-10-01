import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateMarkerSchema = z.object({
  markerType: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  timestampSeconds: z.number().min(0).optional(),
  color: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateMarkerSchema.parse(await request.json());
  const marker = await prisma.dawMarker.update({
    where: { id },
    data: {
      ...(body.markerType !== undefined ? { markerType: body.markerType } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.timestampSeconds !== undefined ? { timestampSeconds: body.timestampSeconds } : {}),
      ...(body.color !== undefined ? { color: body.color || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    select: { projectId: true }
  });
  const project = await getDawProjectById(marker.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const marker = await prisma.dawMarker.findUnique({ where: { id }, select: { projectId: true } });
  if (!marker) {
    return NextResponse.json({ error: "DAW marker not found" }, { status: 404 });
  }
  await prisma.dawMarker.delete({ where: { id } });
  const project = await getDawProjectById(marker.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}
