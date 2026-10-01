import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureSongPreview,
  generateSongPreview,
  listSongPreviews,
  toSongPreviewDto
} from "@/lib/storefront";

export const runtime = "nodejs";

const CreatePreviewSchema = z.object({
  songId: z.string().min(1),
  releaseId: z.string().optional().nullable(),
  title: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(1200).optional().nullable(),
  releaseUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  contactInfo: z.string().trim().max(300).optional().nullable(),
  paymentInstructions: z.string().trim().max(600).optional().nullable(),
  allowClaims: z.boolean().optional(),
  startSeconds: z.number().min(0).optional(),
  generate: z.boolean().default(true),
  publish: z.boolean().default(false)
});

export async function GET() {
  return NextResponse.json(await listSongPreviews());
}

export async function POST(request: Request) {
  const body = CreatePreviewSchema.parse(await request.json());
  try {
    const preview = await ensureSongPreview(body.songId, {
      releaseId: body.releaseId,
      title: body.title,
      description: body.description,
      releaseUrl: body.releaseUrl || null,
      contactInfo: body.contactInfo,
      paymentInstructions: body.paymentInstructions,
      allowClaims: body.allowClaims,
      publish: body.publish && !body.generate
    });
    const result = body.generate
      ? await generateSongPreview(preview.id, body.startSeconds, body.publish)
      : preview;
    return NextResponse.json(toSongPreviewDto(result), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "建立試聽頁失敗。" },
      { status: 400 }
    );
  }
}
