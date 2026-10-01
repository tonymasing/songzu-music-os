import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { previewAdminInclude, previewStatuses, toSongPreviewDto } from "@/lib/storefront";

type RouteContext = { params: Promise<{ id: string }> };

const UpdatePreviewSchema = z.object({
  status: z.enum(previewStatuses).optional(),
  title: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(1200).optional().nullable(),
  releaseUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  contactInfo: z.string().trim().max(300).optional().nullable(),
  paymentInstructions: z.string().trim().max(600).optional().nullable(),
  allowClaims: z.boolean().optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdatePreviewSchema.parse(await request.json());
  const current = await prisma.songPreview.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到試聽頁。" }, { status: 404 });
  if (body.status === "PUBLISHED" && !current.previewFileName) {
    return NextResponse.json({ error: "請先產生 30 秒試聽檔再公開。" }, { status: 409 });
  }
  const preview = await prisma.songPreview.update({
    where: { id },
    data: {
      ...(body.status !== undefined
        ? { status: body.status, publishedAt: body.status === "PUBLISHED" ? current.publishedAt || new Date() : current.publishedAt }
        : {}),
      ...(body.title !== undefined ? { title: body.title || null } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.releaseUrl !== undefined ? { releaseUrl: body.releaseUrl || null } : {}),
      ...(body.contactInfo !== undefined ? { contactInfo: body.contactInfo || null } : {}),
      ...(body.paymentInstructions !== undefined ? { paymentInstructions: body.paymentInstructions || null } : {}),
      ...(body.allowClaims !== undefined ? { allowClaims: body.allowClaims } : {})
    },
    include: previewAdminInclude
  });
  return NextResponse.json(toSongPreviewDto(preview));
}
