import { NextResponse } from "next/server";

import { nativeDawRequest } from "@/lib/native-daw";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await nativeDawRequest("/recordings/status", { timeoutMs: 900 }));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "web_fallback",
        status: "unavailable",
        error: error instanceof Error ? error.message : "原生錄音狀態無法讀取。"
      },
      { status: 503 }
    );
  }
}
