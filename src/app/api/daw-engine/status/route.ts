import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function getNativeStatus() {
  const port = process.env.SONGZU_DAW_CORE_PORT ?? "39241";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`native service ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    const native = await getNativeStatus();
    return NextResponse.json({
      ok: true,
      mode: "native_service",
      native,
      fallbackAvailable: true
    });
  } catch {
    return NextResponse.json({
      ok: true,
      mode: "web_fallback",
      native: null,
      fallbackAvailable: true,
      message: "Rust native audio service 尚未啟動；目前使用 Web Audio / ffmpeg fallback。"
    });
  }
}
