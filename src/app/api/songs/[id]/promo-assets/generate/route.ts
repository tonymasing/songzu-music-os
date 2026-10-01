import { NextResponse } from "next/server";

import { songInclude, toSongDto } from "@/lib/music";
import { generateLocalPromoAssets } from "@/lib/promo";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const current = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  if (!current) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const songDto = toSongDto(current);
  const generated = generateLocalPromoAssets(songDto);

  await prisma.$transaction(async (tx) => {
    await tx.promoAsset.deleteMany({
      where: {
        songId: id,
        assetType: { in: generated.map((asset) => asset.assetType) }
      }
    });

    await tx.promoAsset.createMany({
      data: generated.map((asset) => ({
        songId: id,
        assetType: asset.assetType,
        title: asset.title,
        content: asset.content,
        status: "DRAFT"
      }))
    });

    await tx.timelineEvent.create({
      data: {
        songId: id,
        eventType: "promo_assets_generated",
        title: "產生本機發行素材",
        description: "已用作品資料與本機規則引擎產生 7 種文案初稿。"
      }
    });
  });

  const updated = await prisma.song.findUniqueOrThrow({
    where: { id },
    include: songInclude
  });

  return NextResponse.json(toSongDto(updated), { status: 201 });
}
