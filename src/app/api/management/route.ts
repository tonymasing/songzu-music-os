import { NextResponse } from "next/server";
import { z } from "zod";

import { generateManagementCycle, getManagementOverview } from "@/lib/management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GenerateCycleSchema = z.object({
  type: z.enum(["daily", "weekly", "monthly"])
});

export async function GET() {
  return NextResponse.json(await getManagementOverview());
}

export async function POST(request: Request) {
  const body = GenerateCycleSchema.parse(await request.json());
  return NextResponse.json(await generateManagementCycle(body.type), { status: 201 });
}
