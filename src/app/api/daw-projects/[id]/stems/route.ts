import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { NextResponse } from "next/server";

import { dawExportPath, exportDawStemsZip, getDawProjectById } from "@/lib/daw";

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
    return NextResponse.json({ error: "缺少 file 參數，請先輸出 stems zip。" }, { status: 400 });
  }

  const safeName = basename(fileName);
  try {
    const bytes = await readFile(dawExportPath(project.songId, safeName));
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`
      }
    });
  } catch {
    return NextResponse.json({ error: "stems zip 不存在" }, { status: 404 });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const output = await exportDawStemsZip(id);
    return NextResponse.json({ output }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "stems zip 輸出失敗" },
      { status: 400 }
    );
  }
}
