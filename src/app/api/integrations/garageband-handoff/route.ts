import { NextResponse } from "next/server";
import { z } from "zod";

import { buildGarageBandHandoff } from "@/lib/integrations";

const HandoffSchema = z.object({
  songId: z.string().optional().nullable()
});

export async function GET() {
  return NextResponse.json(await buildGarageBandHandoff());
}

export async function POST(request: Request) {
  const body = HandoffSchema.parse(await request.json());
  return NextResponse.json(await buildGarageBandHandoff(body.songId ?? undefined));
}
