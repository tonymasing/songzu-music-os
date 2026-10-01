import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelYoutubePublishJob, updateYoutubePublishJob } from "@/lib/youtube-publishing";

export const runtime = "nodejs";

const UpdateJobSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  privacyStatus: z.enum(["private", "unlisted", "public"]).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  madeForKids: z.boolean().optional()
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = UpdateJobSchema.parse(await request.json());
    return NextResponse.json(
      await updateYoutubePublishJob(id, {
        ...body,
        scheduledAt: body.scheduledAt === undefined ? undefined : body.scheduledAt ? new Date(body.scheduledAt) : null
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新發布工作失敗。" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json(await cancelYoutubePublishJob(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "取消發布工作失敗。" }, { status: 400 });
  }
}
