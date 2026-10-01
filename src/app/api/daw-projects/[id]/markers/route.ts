import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateMarkerSchema = z.object({
  markerType: z.string().min(1).default("idea"),
  label: z.string().min(1),
  timestampSeconds: z.number().min(0).default(0),
  color: z.string().nullable().optional(),
  relatedModel: z.string().nullable().optional(),
  relatedId: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateMarkerSchema.parse(await request.json());
  const project = await prisma.dawProject.findUnique({ where: { id } });

  if (!project) {
    return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  }

  const marker = await prisma.dawMarker.create({
    data: {
      projectId: id,
      markerType: body.markerType,
      label: body.label,
      timestampSeconds: body.timestampSeconds,
      color: body.color ?? null,
      relatedModel: body.relatedModel ?? null,
      relatedId: body.relatedId ?? null,
      notes: body.notes ?? null
    }
  });

  await prisma.timelineEvent.create({
    data: {
      songId: project.songId,
      eventType: "daw_marker_added",
      title: `DAW Marker：${marker.label}`,
      description: marker.notes,
      relatedModel: "DawMarker",
      relatedId: marker.id,
      metadataJson: JSON.stringify({
        markerType: marker.markerType,
        timestampSeconds: marker.timestampSeconds
      })
    }
  });

  const updated = await getDawProjectById(id);
  return NextResponse.json({ project: updated ? toDawProjectDto(updated) : null }, { status: 201 });
}
