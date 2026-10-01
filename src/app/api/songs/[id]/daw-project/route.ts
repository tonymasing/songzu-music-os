import { NextResponse } from "next/server";

import { getOrCreateDawProject, getSongDawProject, toDawProjectDto } from "@/lib/daw";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getSongDawProject(id);
  if (!project) {
    return NextResponse.json({ project: null });
  }

  return NextResponse.json({ project: toDawProjectDto(project) });
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await getOrCreateDawProject(id);
  if (!project) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  return NextResponse.json({ project: toDawProjectDto(project) }, { status: 201 });
}
