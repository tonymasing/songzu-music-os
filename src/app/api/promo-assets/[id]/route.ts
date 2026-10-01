import { NextResponse } from "next/server";
import { z } from "zod";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const PatchPromoAssetSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  status: z.string().min(1).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchPromoAssetSchema.parse(await request.json());
  const asset = await prisma.promoAsset.update({
    where: { id },
    data: body
  });

  return NextResponse.json({
    id: asset.id,
    assetType: asset.assetType,
    title: asset.title,
    content: asset.content,
    status: asset.status,
    createdAt: toIso(asset.createdAt),
    updatedAt: toIso(asset.updatedAt)
  });
}
