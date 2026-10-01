import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateTrackSchema = z.object({
  name: z.string().min(1),
  trackType: z.string().min(1).default("audio"),
  sortOrder: z.number().int().min(0).optional(),
  color: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateTrackSchema.parse(await request.json());
  const existing = await prisma.dawProject.findUnique({
    where: { id },
    include: { tracks: { select: { sortOrder: true } } }
  });

  if (!existing) {
    return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  }

  const maxOrder = Math.max(0, ...existing.tracks.map((track) => track.sortOrder));
  await prisma.$transaction(async (tx) => {
    const track = await tx.dawTrack.create({
      data: {
      projectId: id,
      name: body.name,
      trackType: body.trackType,
      sortOrder: body.sortOrder ?? maxOrder + 1,
      color: body.color ?? null
      }
    });
    await recordDawEditOperation(tx, {
      projectId: id,
      operationType: "create",
      entityType: "track",
      entityId: track.id,
      label: `新增音軌 ${track.name}`,
      before: null,
      after: track
    });
  });

  const project = await getDawProjectById(id);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null }, { status: 201 });
}
