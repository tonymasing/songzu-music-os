import { NextResponse } from "next/server";
import { PlayerBeatQueueFull, playerBeatGrid, resolvePlayerAudio } from "@/lib/player-beat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url), src = url.searchParams.get("src");
  if (!src || src.length > 2048) return NextResponse.json({ error: "缺少音檔來源。" }, { status: 400 });
  try {
    const source = await resolvePlayerAudio(src, url.origin);
    const grid = await playerBeatGrid(source);
    return NextResponse.json(grid, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PlayerBeatQueueFull) return NextResponse.json({ error: "其他歌曲正在分析，播放器會自動接續。" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "10" } });
    // Do not expose local paths or subprocess stderr through the player.
    return NextResponse.json({ error: "這首歌暫時無法自動對拍，可用「跟拍」校正，稍後再試。" }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}
