import { NextResponse } from "next/server";
import { z } from "zod";

import { claimMobilePairingCode, mobileTrustCorsHeaders, MobileTrustError } from "@/lib/mobile-trust";

export const runtime = "nodejs";

const ClaimSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  deviceKey: z.string().trim().min(8).max(120),
  name: z.string().trim().min(1).max(80),
  platform: z.string().trim().min(1).max(32)
});

export async function POST(request: Request) {
  try {
    const body = ClaimSchema.parse(await request.json());
    const result = await claimMobilePairingCode(body);
    return NextResponse.json(result, { status: 201, headers: mobileTrustCorsHeaders });
  } catch (error) {
    const status = error instanceof MobileTrustError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法完成裝置配對。" },
      { status, headers: mobileTrustCorsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: mobileTrustCorsHeaders });
}
