import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest, localHostRequiredMessage } from "@/lib/local-request";
import {
  configureYoutubeConnection,
  disconnectYoutube,
  ensureYoutubeConnection,
  toYoutubeConnectionDto,
  verifyYoutubeConnection
} from "@/lib/youtube-publishing";

export const runtime = "nodejs";

const ConfigureSchema = z.object({
  clientId: z.string().trim().min(10)
});

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "YouTube 連線操作失敗。" }, { status });
}

export async function GET() {
  try {
    return NextResponse.json(toYoutubeConnectionDto(await ensureYoutubeConnection()));
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  if (!isLoopbackRequest(request)) return NextResponse.json({ error: localHostRequiredMessage() }, { status: 403 });
  try {
    const body = ConfigureSchema.parse(await request.json());
    return NextResponse.json(toYoutubeConnectionDto(await configureYoutubeConnection(body.clientId)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isLoopbackRequest(request)) return NextResponse.json({ error: localHostRequiredMessage() }, { status: 403 });
  try {
    return NextResponse.json(toYoutubeConnectionDto(await verifyYoutubeConnection()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!isLoopbackRequest(request)) return NextResponse.json({ error: localHostRequiredMessage() }, { status: 403 });
  try {
    return NextResponse.json(toYoutubeConnectionDto(await disconnectYoutube()));
  } catch (error) {
    return errorResponse(error);
  }
}
