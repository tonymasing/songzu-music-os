import { NextResponse } from "next/server";
import { z } from "zod";

import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const RecordingSessionSchema = z.object({
  targetInstrument: z.string().min(1),
  detectionMode: z.string().min(1).default("timing_pitch"),
  targetBpm: z.number().int().min(20).max(300).optional().nullable(),
  targetKey: z.string().optional().nullable(),
  metronomeEnabled: z.boolean().optional().default(true),
  referenceAudioFileId: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = RecordingSessionSchema.parse(await request.json());

  const session = await prisma.recordingSession.create({
    data: {
      songId: id,
      targetInstrument: body.targetInstrument,
      detectionMode: body.detectionMode,
      targetBpm: body.targetBpm ?? null,
      targetKey: body.targetKey || null,
      metronomeEnabled: body.metronomeEnabled,
      referenceAudioFileId: body.referenceAudioFileId || null,
      notes: body.notes || null,
      status: "PLANNED"
    }
  });

  await prisma.timelineEvent.create({
    data: {
      songId: id,
      eventType: "recording_setup",
      title: "建立錄音偵測設定",
      description: `${body.targetInstrument} / ${body.targetBpm ?? "--"} BPM / ${body.detectionMode}`,
      relatedModel: "RecordingSession",
      relatedId: session.id,
      metadataJson: JSON.stringify(body)
    }
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
