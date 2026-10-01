import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest } from "@/lib/local-request";
import { createMobilePairingCode, getMobileTrustStatus, revokeTrustedMobileDevice } from "@/lib/mobile-trust";

export const dynamic = "force-dynamic";

const RevokeSchema = z.object({ deviceId: z.string().uuid() });

function hostOnly(request: Request) {
  if (isLoopbackRequest(request)) return null;
  return NextResponse.json({ error: "配對碼與裝置撤銷只能在執行頌祖音樂 OS 的 Mac 操作。" }, { status: 403 });
}

export async function GET(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  return NextResponse.json(await getMobileTrustStatus());
}

export async function POST(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  return NextResponse.json(await createMobilePairingCode(), { status: 201 });
}

export async function DELETE(request: Request) {
  const rejected = hostOnly(request);
  if (rejected) return rejected;
  try {
    const { deviceId } = RevokeSchema.parse(await request.json());
    return NextResponse.json(await revokeTrustedMobileDevice(deviceId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法撤銷裝置。" }, { status: 400 });
  }
}
