import { NextResponse } from "next/server";

import { songInclude, toSongDto } from "@/lib/music";
import { buildProductionDirectorBrief, productionDirectorBriefToText } from "@/lib/production-director";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const dto = toSongDto(song);
  const brief = buildProductionDirectorBrief(dto);
  const suggestion = await prisma.aiSuggestion.create({
    data: {
      songId: id,
      suggestionType: "production_director",
      status: "pending",
      inputSnapshotJson: JSON.stringify({ songId: id, title: dto.title, generatedBy: "local_production_director" }),
      outputPayloadJson: JSON.stringify({
        summary: productionDirectorBriefToText(brief),
        brief
      })
    }
  });

  return NextResponse.json({
    brief,
    suggestion: {
      id: suggestion.id,
      status: suggestion.status,
      createdAt: suggestion.createdAt.toISOString()
    }
  });
}
