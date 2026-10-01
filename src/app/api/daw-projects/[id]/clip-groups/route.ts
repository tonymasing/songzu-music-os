import { NextResponse } from "next/server";
import { z } from "zod";

import { toDawProjectDto } from "@/lib/daw";
import { groupDawClips } from "@/lib/daw-precision";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = z.object({ clipIds: z.array(z.string().min(1)).min(2).max(128) }).parse(await request.json());
    const result = await groupDawClips(id, [...new Set(body.clipIds)]);
    return NextResponse.json({ groupId: result.groupId, project: result.project ? toDawProjectDto(result.project) : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "片段群組失敗。" }, { status: 400 });
  }
}
