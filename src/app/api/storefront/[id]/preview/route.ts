import { NextResponse } from "next/server";
import { z } from "zod";

import { generateSongPreview, toSongPreviewDto } from "@/lib/storefront";

type RouteContext = { params: Promise<{ id: string }> };

const GenerateSchema = z.object({
  startSeconds: z.number().min(0).optional(),
  publish: z.boolean().default(false)
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = GenerateSchema.parse(await request.json());
  try {
    return NextResponse.json(toSongPreviewDto(await generateSongPreview(id, body.startSeconds, body.publish)), {
      status: 201
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "試聽檔輸出失敗。" },
      { status: 400 }
    );
  }
}
