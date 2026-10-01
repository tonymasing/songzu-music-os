import { NextResponse } from "next/server";

import { syncYoutubePublishJob } from "@/lib/youtube-publishing";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json(await syncYoutubePublishJob(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步 YouTube 狀態失敗。" }, { status: 400 });
  }
}
