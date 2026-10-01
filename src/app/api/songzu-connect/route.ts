import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest } from "@/lib/local-request";
import { getSongzuConnectOverview, updateSongzuConnect } from "@/lib/songzu-connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateSchema = z.object({
  enabled: z.boolean(),
  relayUrl: z.string().trim().url().max(500).optional()
});

function hostOnly(request: Request) {
  if (isLoopbackRequest(request)) return null;
  return NextResponse.json({ error: "頌祖 Connect 的主機密鑰與連線設定只能在 Mac 桌面 App 操作。" }, { status: 403 });
}

export async function GET(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  return NextResponse.json(await getSongzuConnectOverview(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  try {
    const input = UpdateSchema.parse(await request.json());
    return NextResponse.json(await updateSongzuConnect(input));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法更新頌祖 Connect。" }, { status: 400 });
  }
}
