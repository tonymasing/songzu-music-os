import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function getNativeDevices() {
  const port = process.env.SONGZU_DAW_CORE_PORT ?? "39241";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/devices`, {
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
    return NextResponse.json(await getNativeDevices());
  } catch {
    return NextResponse.json({
      mode: "web_fallback",
      inputDevices: [],
      outputDevices: [],
      message: "Native device enumeration 尚未啟動；瀏覽器錄音時會使用 Web Audio 權限選擇裝置。"
    });
  }
}
