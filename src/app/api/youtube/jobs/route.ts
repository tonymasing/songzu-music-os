import { NextResponse } from "next/server";
import { z } from "zod";

import { createYoutubePublishJob, listYoutubePublishJobs } from "@/lib/youtube-publishing";

export const runtime = "nodejs";

const CreateJobSchema = z.object({
  songId: z.string().min(1),
  exportFileName: z.string().min(1),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  privacyStatus: z.enum(["private", "unlisted", "public"]).default("private"),
  scheduledAt: z.string().datetime().optional().nullable(),
  madeForKids: z.boolean().default(false)
});

export async function GET() {
  return NextResponse.json(await listYoutubePublishJobs());
}

export async function POST(request: Request) {
  try {
    const body = CreateJobSchema.parse(await request.json());
    const job = await createYoutubePublishJob({
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null
    });
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "建立 YouTube 發布工作失敗。" }, { status: 400 });
  }
}
