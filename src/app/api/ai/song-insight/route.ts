import { NextResponse } from "next/server";
import { z } from "zod";

import { getSongInsight } from "@/lib/ai";
import { getSong } from "@/lib/data";
import { prisma } from "@/lib/prisma";

const InsightRequestSchema = z.object({
  songId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = InsightRequestSchema.parse(await request.json());
  const song = await getSong(body.songId);

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const insight = await getSongInsight(song);
  await prisma.aiSuggestion.create({
    data: {
      songId: song.id,
      suggestionType: "song_insight",
      status: "pending",
      inputSnapshotJson: JSON.stringify({ songId: song.id, updatedAt: song.updatedAt }),
      outputPayloadJson: JSON.stringify(insight)
    }
  });

  return NextResponse.json(insight);
}
