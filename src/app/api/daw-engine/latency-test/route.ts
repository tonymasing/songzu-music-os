import { NextResponse } from "next/server";

import { nativeDawRequest } from "@/lib/native-daw";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(
      await nativeDawRequest("/latency-test", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 1_500
      })
    );
  } catch {
    return NextResponse.json({
      mode: "web_fallback",
      estimatedRoundTripMs: null,
      status: "unavailable",
      message: "Native latency probe 尚未啟動；正式低延遲錄音需 Electron + Rust service。"
    });
  }
}
