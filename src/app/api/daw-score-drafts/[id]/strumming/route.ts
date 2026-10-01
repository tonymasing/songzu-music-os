import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyAutoScoreStrummingEdits,
  buildAutoScoreDeliveryCertification,
  type AutoScoreStrummingGuide
} from "@/lib/auto-score";
import { resolveStoredFilePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { getScoreDraft, parseScoreResult, toScoreDraftDto } from "@/lib/score-drafts";
import { analyzeAudioStrummingGuide } from "@/lib/strumming-analysis";

export const runtime = "nodejs";

const StrummingSubdivisionSchema = z.enum([
  "quarter",
  "eighth",
  "sixteenth",
  "quarter_triplet",
  "beat_triplet",
  "beat_sextuplet"
]);

const SaveStrummingSchema = z.object({
  subdivision: StrummingSubdivisionSchema,
  patterns: z.array(z.object({
    patternId: z.string().min(1).max(80),
    strokes: z.array(z.enum(["down", "up", "mute", "rest"])).min(1).max(32),
    accents: z.array(z.number().int().min(0).max(31)).max(32)
  })).min(1).max(12),
  updatedBy: z.string().min(1).max(80).optional()
});

type RouteContext = { params: Promise<{ id: string }> };

async function projectSongId(projectId: string) {
  return (await prisma.dawProject.findUnique({ where: { id: projectId }, select: { songId: true } }))?.songId ?? null;
}

async function updatedDraft(id: string) {
  const draft = await getScoreDraft(id);
  if (!draft) throw new Error("刷法已更新，但無法重新讀取草譜");
  return toScoreDraftDto(draft);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = SaveStrummingSchema.parse(await request.json());
  const existing = await getScoreDraft(id);
  if (!existing) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const result = parseScoreResult(existing.resultJson);
  if (result.targetInstrument !== "guitar") {
    return NextResponse.json({ error: "只有吉他譜可以儲存刷法" }, { status: 409 });
  }
  try {
    const editedResult = applyAutoScoreStrummingEdits(result, body.subdivision, body.patterns, body.updatedBy ?? "本機創作者");
    const nextResult = { ...editedResult, certification: buildAutoScoreDeliveryCertification(editedResult) };
    const songId = await projectSongId(existing.projectId);
    await prisma.$transaction(async (tx) => {
      await tx.dawScoreDraft.update({ where: { id }, data: { resultJson: JSON.stringify(nextResult) } });
      if (songId) {
        await tx.timelineEvent.create({
          data: {
            songId,
            eventType: "daw_strumming_manual_saved",
            title: `儲存 ${body.subdivision} 人工刷法`,
            description: `${body.patterns.length} 組刷法已一次保存；正式和弦譜與原音檔均未變更。`,
            relatedModel: "DawScoreDraft",
            relatedId: id,
            metadataJson: JSON.stringify({ subdivision: body.subdivision, patternCount: body.patterns.length, updatedBy: body.updatedBy ?? "本機創作者" })
          }
        });
      }
    });
    return NextResponse.json({ draft: await updatedDraft(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "刷法儲存失敗" }, { status: 400 });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const existing = await getScoreDraft(id);
  if (!existing) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const result = parseScoreResult(existing.resultJson);
  if (result.targetInstrument !== "guitar") {
    return NextResponse.json({ error: "只有吉他譜可以分析刷法" }, { status: 409 });
  }
  if (!existing.sourceAudioFileId) {
    return NextResponse.json({ error: "草譜沒有受保護來源音檔" }, { status: 409 });
  }
  const sourceAudioFile = await prisma.audioFile.findUnique({
    where: { id: existing.sourceAudioFileId },
    select: { filePath: true }
  });
  if (!sourceAudioFile?.filePath) {
    return NextResponse.json({ error: "來源音檔沒有可用的本機路徑" }, { status: 409 });
  }

  try {
    const priorDrafts = await prisma.dawScoreDraft.findMany({
      where: { targetInstrument: "guitar", id: { not: id } },
      select: { resultJson: true },
      orderBy: { updatedAt: "desc" },
      take: 40
    });
    const personalGuides = [result, ...priorDrafts.flatMap((draft) => {
      try { return [parseScoreResult(draft.resultJson)]; } catch { return []; }
    })].flatMap((candidate) => candidate.strummingGuide ? [candidate.strummingGuide as AutoScoreStrummingGuide] : []);
    const strummingGuide = await analyzeAudioStrummingGuide({
      result,
      filePath: resolveStoredFilePath(sourceAudioFile.filePath),
      personalGuides
    });
    const analyzedResult = { ...result, strummingGuide };
    const nextResult = { ...analyzedResult, certification: buildAutoScoreDeliveryCertification(analyzedResult) };
    const songId = await projectSongId(existing.projectId);
    await prisma.$transaction(async (tx) => {
      await tx.dawScoreDraft.update({ where: { id }, data: { resultJson: JSON.stringify(nextResult) } });
      if (songId) {
        await tx.timelineEvent.create({
          data: {
            songId,
            eventType: "daw_strumming_audio_analyzed",
            title: "完成本機音檔刷法分析",
            description: `${strummingGuide.analysis?.onsetCount ?? 0} 個起音、${strummingGuide.analysis?.analyzedBarCount ?? 0} 小節；推測 ${strummingGuide.analysis?.detectedSubdivision ?? "eighth"}。`,
            relatedModel: "DawScoreDraft",
            relatedId: id,
            metadataJson: JSON.stringify(strummingGuide.analysis ?? {})
          }
        });
      }
    });
    return NextResponse.json({ draft: await updatedDraft(id), analysis: strummingGuide.analysis });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "本機刷法分析失敗" }, { status: 500 });
  }
}
