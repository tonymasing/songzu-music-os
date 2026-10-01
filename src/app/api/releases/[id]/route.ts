import { NextResponse } from "next/server";
import { z } from "zod";

import { releaseStatusLabels } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { releaseInclude, toReleaseDto } from "@/lib/releases";
import { ensurePublishedSongPreview } from "@/lib/storefront";

type RouteContext = { params: Promise<{ id: string }> };

const PatchReleaseSchema = z.object({
  title: z.string().trim().min(1).optional(),
  status: z.enum(Object.keys(releaseStatusLabels) as [string, ...string[]]).optional(),
  releaseDate: z.string().optional().nullable(),
  upc: z.string().optional().nullable(),
  copyrightLine: z.string().optional().nullable(),
  publishingLine: z.string().optional().nullable()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchReleaseSchema.parse(await request.json());
  const current = await prisma.release.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到發行專案" }, { status: 404 });
  const release = await prisma.release.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.releaseDate !== undefined ? { releaseDate: body.releaseDate ? new Date(body.releaseDate) : null } : {}),
      ...(body.upc !== undefined ? { upc: body.upc || null } : {}),
      ...(body.copyrightLine !== undefined ? { copyrightLine: body.copyrightLine || null } : {}),
      ...(body.publishingLine !== undefined ? { publishingLine: body.publishingLine || null } : {})
    },
    include: releaseInclude
  });
  const previewAutomation =
    body.status === "RELEASED" && current.status !== "RELEASED"
      ? await Promise.all(
          release.tracks.map((track) => ensurePublishedSongPreview(track.songId, { releaseId: release.id }))
        )
      : [];
  return NextResponse.json({ ...toReleaseDto(release), previewAutomation });
}
