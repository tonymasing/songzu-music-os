import { NextResponse } from "next/server";

import { appName, appVersion } from "@/lib/app-info";
import { authenticateMobileRequest, mobileTrustCorsHeaders } from "@/lib/mobile-trust";

export const dynamic = "force-dynamic";

const corsHeaders = mobileTrustCorsHeaders;

export async function GET(request: Request) {
  const device = await authenticateMobileRequest(request);
  return NextResponse.json(
    {
      ok: true,
      service: "songzu-music-os",
      appName,
      version: appVersion,
      mobileMode: "web-and-connect-companion",
      pairingRequired: true,
      trusted: Boolean(device),
      trustedDevice: device,
      capabilities: ["catalog", "audio_upload", "audio_playback", "ai_agent", "daw_control", "publishing_control", "songzu_connect_e2ee"],
      checkedAt: new Date().toISOString()
    },
    { headers: corsHeaders }
  );
}

export async function HEAD() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
