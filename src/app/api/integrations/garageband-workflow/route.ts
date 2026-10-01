import { NextResponse } from "next/server";
import { z } from "zod";

import { buildGarageBandWorkflow } from "@/lib/integrations";

const WorkflowSchema = z.object({
  songId: z.string().optional().nullable()
});

export async function GET() {
  return NextResponse.json(await buildGarageBandWorkflow());
}

export async function POST(request: Request) {
  const body = WorkflowSchema.parse(await request.json());
  return NextResponse.json(await buildGarageBandWorkflow(body.songId ?? undefined));
}
