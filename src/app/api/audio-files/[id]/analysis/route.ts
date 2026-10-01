import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonArray, parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const AnalysisSchema = z.object({
  durationSeconds: z.number().positive().optional().nullable(),
  peak: z.number().min(0).optional().nullable(),
  rms: z.number().min(0).optional().nullable(),
  energy: z.array(z.number()).optional().default([]),
  waveform: z.array(z.number()).optional().default([]),
  suggestedBpm: z.number().positive().optional().nullable(),
  suggestedMood: z.array(z.string()).optional().default([]),
  suggestedUseCase: z.array(z.string()).optional().default([])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function toAnalysisDto(analysis: {
  id: string;
  audioFileId: string;
  durationSeconds: number | null;
  peak: number | null;
  rms: number | null;
  energyJson: string | null;
  waveformJson: string | null;
  suggestedBpm: number | null;
  suggestedMoodJson: string | null;
  suggestedUseCaseJson: string | null;
  createdAt: Date;
}) {
  return {
    id: analysis.id,
    audioFileId: analysis.audioFileId,
    durationSeconds: analysis.durationSeconds,
    peak: analysis.peak,
    rms: analysis.rms,
    energy: parseJsonValue<number[]>(analysis.energyJson, []),
    waveform: parseJsonValue<number[]>(analysis.waveformJson, []),
    suggestedBpm: analysis.suggestedBpm,
    suggestedMood: parseJsonArray(analysis.suggestedMoodJson),
    suggestedUseCase: parseJsonArray(analysis.suggestedUseCaseJson),
    createdAt: toIso(analysis.createdAt)
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const analyses = await prisma.audioAnalysis.findMany({
    where: { audioFileId: id },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return NextResponse.json(analyses.map(toAnalysisDto));
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = AnalysisSchema.parse(await request.json());
  const audioFile = await prisma.audioFile.findUnique({ where: { id } });

  if (!audioFile) {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  const analysis = await prisma.$transaction(async (tx) => {
    const created = await tx.audioAnalysis.create({
      data: {
        audioFileId: id,
        durationSeconds: body.durationSeconds ?? null,
        peak: body.peak ?? null,
        rms: body.rms ?? null,
        energyJson: JSON.stringify(body.energy),
        waveformJson: JSON.stringify(body.waveform),
        suggestedBpm: body.suggestedBpm ?? null,
        suggestedMoodJson: JSON.stringify(body.suggestedMood),
        suggestedUseCaseJson: JSON.stringify(body.suggestedUseCase)
      }
    });

    await tx.audioFile.update({
      where: { id },
      data: {
        durationSeconds: body.durationSeconds ?? audioFile.durationSeconds
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId: audioFile.songId,
        eventType: "audio_analysis",
        title: "完成本機音訊分析",
        description: `${audioFile.fileName} 已產生 waveform、能量與本機建議。`,
        relatedModel: "AudioAnalysis",
        relatedId: created.id
      }
    });

    return created;
  });

  return NextResponse.json(toAnalysisDto(analysis), { status: 201 });
}
