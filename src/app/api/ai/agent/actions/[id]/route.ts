import { NextResponse } from "next/server";
import { z } from "zod";

import { decideAiAgentAction } from "@/lib/ai-agent";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const DecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = DecisionSchema.parse(await request.json());
    return NextResponse.json({ conversation: await decideAiAgentAction(id, body.decision) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法處理 AI 動作。" }, { status: 400 });
  }
}
