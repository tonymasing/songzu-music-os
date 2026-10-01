import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { NextResponse } from "next/server";

import { dawExportPath, getDawProjectById, writeDawProjectManifest } from "@/lib/daw";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const fileName = url.searchParams.get("file");
  const project = await getDawProjectById(id);

  if (!project) {
    return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  }

  if (!fileName) {
    const output = await writeDawProjectManifest(id);
    return NextResponse.json({ output });
  }

  const safeName = basename(fileName);
  try {
    const bytes = await readFile(dawExportPath(project.songId, safeName));
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`
      }
    });
  } catch {
    return NextResponse.json({ error: "Project manifest 不存在" }, { status: 404 });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const output = await writeDawProjectManifest(id);
    return NextResponse.json({ output }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Project manifest 輸出失敗" },
      { status: 400 }
    );
  }
}
