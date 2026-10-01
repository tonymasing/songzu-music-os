import { NextResponse } from "next/server";
import { z } from "zod";

import { buildDawProjectManifest, getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateSnapshotSchema = z.object({
  title: z.string().min(1).default("Mix Snapshot"),
  snapshot: z.record(z.string(), z.unknown()).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateSnapshotSchema.parse(await request.json());
  const project = await getDawProjectById(id);

  if (!project) {
    return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  }

  await prisma.dawMixSnapshot.create({
    data: {
      projectId: id,
      title: body.title,
      snapshotJson: JSON.stringify(body.snapshot ?? buildDawProjectManifest(project))
    }
  });

  await prisma.timelineEvent.create({
    data: {
      songId: project.songId,
      eventType: "daw_mix_snapshot_created",
      title: body.title,
      description: "儲存 DAW Core mix snapshot；只記錄 metadata，不改原始音檔。",
      relatedModel: "DawProject",
      relatedId: id
    }
  });

  const updated = await getDawProjectById(id);
  return NextResponse.json({ project: updated ? toDawProjectDto(updated) : null }, { status: 201 });
}
