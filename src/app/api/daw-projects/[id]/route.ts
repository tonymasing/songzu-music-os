import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateProjectSchema = z.object({
  title: z.string().min(1).optional(),
  bpm: z.number().int().min(20).max(300).nullable().optional(),
  musicalKey: z.string().nullable().optional(),
  sampleRate: z.number().int().min(8000).max(384000).optional(),
  bitDepth: z.number().int().min(16).max(32).optional(),
  timeSignature: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  engineMode: z.string().min(1).optional(),
  projectMeta: z.record(z.string(), z.unknown()).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateProjectSchema.parse(await request.json());

  const current = await prisma.dawProject.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    const updated = await tx.dawProject.update({
      where: { id },
      data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.bpm !== undefined ? { bpm: body.bpm } : {}),
      ...(body.musicalKey !== undefined ? { musicalKey: body.musicalKey || null } : {}),
      ...(body.sampleRate !== undefined ? { sampleRate: body.sampleRate } : {}),
      ...(body.bitDepth !== undefined ? { bitDepth: body.bitDepth } : {}),
      ...(body.timeSignature !== undefined ? { timeSignature: body.timeSignature } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.engineMode !== undefined ? { engineMode: body.engineMode } : {}),
      ...(body.projectMeta !== undefined ? { projectJson: JSON.stringify(body.projectMeta) } : {})
      }
    });
    await recordDawEditOperation(tx, {
      projectId: id,
      operationType: "update",
      entityType: "project",
      entityId: id,
      label: "調整專案設定",
      before: current,
      after: updated
    });
  });

  const project = await getDawProjectById(id);
  if (!project) {
    return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  }

  return NextResponse.json({ project: toDawProjectDto(project) });
}
