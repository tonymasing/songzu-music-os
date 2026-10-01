import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest, localHostRequiredMessage } from "@/lib/local-request";
import { uploadYoutubePublishJob } from "@/lib/youtube-publishing";

export const runtime = "nodejs";
export const maxDuration = 3600;

const UploadSchema = z.object({ confirm: z.literal(true) });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isLoopbackRequest(request)) return NextResponse.json({ error: localHostRequiredMessage() }, { status: 403 });
  const { id } = await context.params;
  try {
    const body = UploadSchema.parse(await request.json());
    return NextResponse.json(await uploadYoutubePublishJob(id, body.confirm));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "YouTube 上傳失敗。" }, { status: 400 });
  }
}
