import { NextResponse } from "next/server";
import { z } from "zod";

import { withAutoScoreBenchmarkBaseline } from "@/lib/auto-score";
import {
  latestScoreDraftsByTarget,
  listScoreDrafts,
  parseScoreResult,
  toScoreDraftDto,
  toScoreTimelineDraftDto
} from "@/lib/score-drafts";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateScoreDraftSchema = z.object({
  sourceAudioFileId: z.string().min(1),
  title: z.string().min(1).max(160),
  targetInstrument: z.enum(["guitar", "piano", "drums"]),
  confidence: z.number().min(0).max(100),
  bpm: z.number().int().min(20).max(300),
  musicalKey: z.string().min(1).max(24),
  timeSignature: z.string().min(3).max(12),
  durationSeconds: z.number().positive().max(7200),
  result: z.record(z.string(), z.unknown())
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const drafts = await listScoreDrafts(id);
  if (new URL(request.url).searchParams.get("view") === "timeline") {
    return NextResponse.json({
      drafts: latestScoreDraftsByTarget(drafts).map(toScoreTimelineDraftDto)
    });
  }
  return NextResponse.json({ drafts: drafts.map(toScoreDraftDto) });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateScoreDraftSchema.parse(await request.json());
  const project = await prisma.dawProject.findUnique({ where: { id }, select: { songId: true } });
  if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });

  const audioFile = await prisma.audioFile.findFirst({
    where: { id: body.sourceAudioFileId, songId: project.songId, archivedAt: null },
    select: { id: true }
  });
  if (!audioFile) return NextResponse.json({ error: "來源音檔不屬於這首作品或已封存" }, { status: 400 });
  if (body.result.format !== "songzu-auto-score" || body.result.targetInstrument !== body.targetInstrument) {
    return NextResponse.json({ error: "採譜資料格式不正確" }, { status: 400 });
  }
  const resultToSave = withAutoScoreBenchmarkBaseline(parseScoreResult(JSON.stringify(body.result)));

  const draft = await prisma.$transaction(async (tx) => {
    const created = await tx.dawScoreDraft.create({
      data: {
        projectId: id,
        sourceAudioFileId: body.sourceAudioFileId,
        title: body.title,
        targetInstrument: body.targetInstrument,
        analyzer: resultToSave.analyzer === "songzu_harmony_v12"
          ? "songzu_harmony_v12"
          : resultToSave.analyzer === "songzu_harmony_v11"
          ? "songzu_harmony_v11"
          : resultToSave.analyzer === "songzu_harmony_v10"
          ? "songzu_harmony_v10"
          : resultToSave.analyzer === "songzu_harmony_v9"
          ? "songzu_harmony_v9"
          : resultToSave.analyzer === "songzu_harmony_v8"
          ? "songzu_harmony_v8"
          : resultToSave.analyzer === "songzu_harmony_v7"
          ? "songzu_harmony_v7"
          : resultToSave.analyzer === "songzu_harmony_v6"
          ? "songzu_harmony_v6"
          : resultToSave.analyzer === "songzu_harmony_v5"
          ? "songzu_harmony_v5"
          : resultToSave.analyzer === "songzu_harmony_v4"
            ? "songzu_harmony_v4"
          : resultToSave.analyzer === "songzu_harmony_v3"
            ? "songzu_harmony_v3"
            : resultToSave.analyzer === "songzu_harmony_v2"
              ? "songzu_harmony_v2"
              : "songzu_local_dsp_v1",
        status: "DRAFT",
        confidence: body.confidence,
        bpm: body.bpm,
        musicalKey: body.musicalKey,
        timeSignature: body.timeSignature,
        durationSeconds: body.durationSeconds,
        resultJson: JSON.stringify(resultToSave)
      },
      include: { sourceAudioFile: true }
    });
    await tx.timelineEvent.create({
      data: {
        songId: project.songId,
        eventType: "daw_score_generated",
        title: `產生${body.targetInstrument === "guitar" ? "吉他" : body.targetInstrument === "piano" ? "鋼琴" : "鼓手"}草譜`,
        description: `${body.title}，本機分析可信度 ${Math.round(body.confidence)}%。`,
        relatedModel: "DawScoreDraft",
        relatedId: created.id
      }
    });
    return created;
  });

  return NextResponse.json({ draft: toScoreDraftDto(draft) }, { status: 201 });
}
