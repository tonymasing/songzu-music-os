import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { dawHistorySummary, stepDawHistory } from "@/lib/daw-history";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const HistorySchema = z.object({ action: z.enum(["undo", "redo"]), expectedOperationId: z.string().optional() });

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return NextResponse.json(await dawHistorySummary(id));
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = HistorySchema.parse(await request.json());
  let operation;
  try {
    operation = await stepDawHistory(id, body.action, body.expectedOperationId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法復原" }, { status: 409 });
  }
  const project = await getDawProjectById(id);
  if (!project) return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  return NextResponse.json({
    project: toDawProjectDto(project),
    operation: operation ? { id: operation.id, label: operation.label, action: body.action } : null,
    history: await dawHistorySummary(id)
  });
}
