import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateMediaExport,
  listMediaExports,
  mediaExportContentType,
  mediaExportPath,
  mediaExportTargets,
  type MediaExportTarget
} from "@/lib/media-export";
import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ExportSchema = z.object({
  target: z.enum(mediaExportTargets.map((target) => target.value) as [string, ...string[]])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getSongDto(id: string) {
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });
  return song ? toSongDto(song) : null;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const fileName = url.searchParams.get("file");

  if (!fileName) {
    return NextResponse.json(await listMediaExports(id));
  }

  const safeName = basename(fileName);
  const filePath = mediaExportPath(id, safeName);
  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        "Content-Type": mediaExportContentType(safeName),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`
      }
    });
  } catch {
    return NextResponse.json({ error: "輸出檔案不存在" }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ExportSchema.parse(await request.json());
  const song = await getSongDto(id);

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  try {
    const output = await generateMediaExport(song, body.target as MediaExportTarget);
    return NextResponse.json(output, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "媒體輸出失敗" },
      { status: 400 }
    );
  }
}
