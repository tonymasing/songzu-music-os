import { NextResponse } from "next/server";
import { z } from "zod";

import { getIntegrations, upsertIntegration } from "@/lib/integrations";

const IntegrationSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  status: z.string().min(1),
  connectionKind: z.string().min(1),
  endpoint: z.string().optional().nullable(),
  apiKeyEnv: z.string().optional().nullable(),
  threadUrl: z.string().optional().nullable(),
  threadId: z.string().optional().nullable(),
  projectPath: z.string().optional().nullable(),
  commandPath: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export async function GET() {
  return NextResponse.json(await getIntegrations());
}

export async function POST(request: Request) {
  const body = IntegrationSchema.parse(await request.json());
  const integration = await upsertIntegration(body);
  return NextResponse.json(integration);
}
