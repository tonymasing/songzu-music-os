import { NextResponse } from "next/server";

import { songInclude, toSongDto } from "@/lib/music";
import { buildCatalogStrategy } from "@/lib/production-director";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const songs = await prisma.song.findMany({
    include: songInclude,
    orderBy: { updatedAt: "desc" }
  });
  const strategy = buildCatalogStrategy(songs.map(toSongDto));
  const suggestion = await prisma.aiSuggestion.create({
    data: {
      songId: null,
      suggestionType: "catalog_strategy",
      status: "pending",
      inputSnapshotJson: JSON.stringify({ songCount: songs.length, generatedBy: "local_catalog_strategy" }),
      outputPayloadJson: JSON.stringify(strategy)
    }
  });

  return NextResponse.json({
    strategy,
    suggestion: {
      id: suggestion.id,
      status: suggestion.status,
      createdAt: suggestion.createdAt.toISOString()
    }
  });
}
