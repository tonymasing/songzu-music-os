import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest } from "@/lib/local-request";
import { getSongzuQuickTunnelOverview, updateSongzuQuickTunnel } from "@/lib/songzu-connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateSchema = z.object({ enabled: z.boolean() });

function hostOnly(request: Request) {
  if (isLoopbackRequest(request)) return null;
  return NextResponse.json({ error: "臨時外出通路只能由 Mac 桌面 App 啟停。" }, { status: 403 });
}

export async function GET(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  return NextResponse.json(await getSongzuQuickTunnelOverview(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  try {
    const input = UpdateSchema.parse(await request.json());
    return NextResponse.json(await updateSongzuQuickTunnel(input.enabled));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法切換臨時外出通路。" }, { status: 400 });
  }
}
