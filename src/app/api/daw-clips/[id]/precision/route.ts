import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { createAutomaticCrossfade, snapClipToZeroCrossing } from "@/lib/daw-precision";

export const runtime = "nodejs";
export const maxDuration = 60;
type RouteContext = { params: Promise<{ id: string }> };
const PrecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("zero_crossing"), boundary: z.enum(["start", "end"]), searchMs: z.number().min(2).max(50).default(20) }),
  z.object({ action: z.literal("auto_crossfade"), durationSeconds: z.number().min(0.005).max(0.2).default(0.012) })
]);

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = PrecisionSchema.parse(await request.json());
    const result = body.action === "zero_crossing"
      ? await snapClipToZeroCrossing(id, body.boundary, body.searchMs)
      : await createAutomaticCrossfade(id, body.durationSeconds);
    const project = await getDawProjectById(result.projectId);
    return NextResponse.json({ result, project: project ? toDawProjectDto(project) : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "精準剪輯失敗。" }, { status: 400 });
  }
}
