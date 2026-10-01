import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  autoScoreReviewMeasures,
  unlockAutoScoreResult,
  type AutoScoreSheetDeletion,
  type AutoScoreSheetInsertion
} from "@/lib/auto-score";
import { prisma } from "@/lib/prisma";
import { getScoreDraft, parseScoreResult, toScoreDraftDto } from "@/lib/score-drafts";

export const runtime = "nodejs";

const InsertSheetMeasureSchema = z.object({
  beforeSourceMeasure: z.number().int().positive(),
  sectionLabel: z.string().trim().min(1).max(80),
  beats: z.array(z.string().trim().min(1).max(24)).min(1).max(12),
  insertedBy: z.string().trim().min(1).max(80).default("本機創作者"),
  note: z.string().trim().max(300).optional()
});

const DeleteSheetMeasureSchema = z.object({
  sourceMeasure: z.number().int().positive(),
  deletedBy: z.string().trim().min(1).max(80).default("本機創作者"),
  note: z.string().trim().max(300).optional()
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = InsertSheetMeasureSchema.parse(await request.json());
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const result = parseScoreResult(draft.resultJson);
  if (result.targetInstrument !== "guitar") return NextResponse.json({ error: "譜面編排目前只支援吉他和弦譜" }, { status: 400 });
  const canArrange = Boolean(
    result.review?.status === "finalized" && result.review.verificationMethod === "manual" ||
    result.review?.status === "in_progress" && result.review.revision > 1
  );
  if (!canArrange) {
    return NextResponse.json({ error: "請先完成逐拍人工確認，再建立正式譜編排小節" }, { status: 409 });
  }

  const beatCount = Math.max(1, Number(result.timeSignature.split("/")[0]) || 4);
  if (body.beats.length !== beatCount) {
    return NextResponse.json({ error: `${result.timeSignature} 每小節需要 ${beatCount} 拍` }, { status: 400 });
  }
  const sourceMeasures = autoScoreReviewMeasures(result);
  if (!sourceMeasures.some((measure) => measure.number === body.beforeSourceMeasure)) {
    return NextResponse.json({ error: "找不到要插入位置的來源小節" }, { status: 400 });
  }
  const section = result.sectionMap?.find((item) => item.label === body.sectionLabel);
  if (!section || body.beforeSourceMeasure < section.firstMeasure || body.beforeSourceMeasure > section.lastMeasure) {
    return NextResponse.json({ error: "插入位置不在指定段落內" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existingInsertions = result.sheetArrangement?.insertions ?? [];
  const semanticMatch = existingInsertions.find((item) =>
    item.beforeSourceMeasure === body.beforeSourceMeasure && item.sectionLabel === body.sectionLabel
  );
  const insertion: AutoScoreSheetInsertion = {
    id: semanticMatch?.id ?? randomUUID(),
    type: "insert_measure",
    beforeSourceMeasure: body.beforeSourceMeasure,
    sectionLabel: body.sectionLabel,
    beats: body.beats,
    insertedBy: body.insertedBy,
    insertedAt: semanticMatch?.insertedAt ?? now,
    ...(body.note ? { note: body.note } : {})
  };
  const insertions = semanticMatch
    ? existingInsertions.map((item) => item.id === semanticMatch.id ? insertion : item)
    : [...existingInsertions, insertion];
  const arrangedResult = {
    ...result,
    sheetArrangement: {
      version: 1 as const,
      updatedAt: now,
      updatedBy: body.insertedBy,
      insertions,
      deletions: result.sheetArrangement?.deletions ?? []
    }
  };
  const nextResult = result.review?.status === "finalized"
    ? unlockAutoScoreResult(arrangedResult)
    : arrangedResult;
  const project = await prisma.dawProject.findUnique({ where: { id: draft.projectId }, select: { songId: true } });
  if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });

  await prisma.$transaction([
    prisma.dawScoreDraft.update({ where: { id }, data: { resultJson: JSON.stringify(nextResult), status: "DRAFT" } }),
    prisma.timelineEvent.create({
      data: {
        songId: project.songId,
        eventType: "daw_score_sheet_arranged",
        title: "正式吉他譜新增編排小節",
        description: `${body.sectionLabel} 在來源第 ${body.beforeSourceMeasure} 小節前新增 | ${body.beats.join(" ")} |，正式譜自動進入 v${nextResult.review?.revision ?? 1} 修訂，不改動音訊時間軸與原始採譜。`,
        relatedModel: "DawScoreDraft",
        relatedId: id,
        metadataJson: JSON.stringify({ insertionId: insertion.id, ...body })
      }
    })
  ]);

  const updated = await getScoreDraft(id);
  if (!updated) return NextResponse.json({ error: "更新譜面後無法讀取資料" }, { status: 500 });
  return NextResponse.json({ draft: toScoreDraftDto(updated), insertion });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = DeleteSheetMeasureSchema.parse(await request.json());
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const result = parseScoreResult(draft.resultJson);
  if (result.targetInstrument !== "guitar") return NextResponse.json({ error: "譜面編排目前只支援吉他和弦譜" }, { status: 400 });
  const canArrange = Boolean(
    result.review?.status === "finalized" && result.review.verificationMethod === "manual" ||
    result.review?.status === "in_progress" && result.review.revision > 1
  );
  if (!canArrange) {
    return NextResponse.json({ error: "請先完成逐拍人工確認，再刪除正式譜小節" }, { status: 409 });
  }

  const sourceMeasures = autoScoreReviewMeasures(result);
  if (!sourceMeasures.some((measure) => measure.number === body.sourceMeasure)) {
    return NextResponse.json({ error: "找不到要刪除的來源小節" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existingDeletions = result.sheetArrangement?.deletions ?? [];
  const semanticMatch = existingDeletions.find((item) => item.sourceMeasure === body.sourceMeasure);
  const deletion: AutoScoreSheetDeletion = {
    id: semanticMatch?.id ?? randomUUID(),
    type: "delete_measure",
    sourceMeasure: body.sourceMeasure,
    deletedBy: body.deletedBy,
    deletedAt: semanticMatch?.deletedAt ?? now,
    ...(body.note ? { note: body.note } : {})
  };
  const deletions = semanticMatch
    ? existingDeletions.map((item) => item.id === semanticMatch.id ? deletion : item)
    : [...existingDeletions, deletion];
  const arrangedResult = {
    ...result,
    sheetArrangement: {
      version: 1 as const,
      updatedAt: now,
      updatedBy: body.deletedBy,
      insertions: result.sheetArrangement?.insertions ?? [],
      deletions
    }
  };
  const nextResult = result.review?.status === "finalized"
    ? unlockAutoScoreResult(arrangedResult)
    : arrangedResult;
  const project = await prisma.dawProject.findUnique({ where: { id: draft.projectId }, select: { songId: true } });
  if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });

  await prisma.$transaction([
    prisma.dawScoreDraft.update({ where: { id }, data: { resultJson: JSON.stringify(nextResult), status: "DRAFT" } }),
    prisma.timelineEvent.create({
      data: {
        songId: project.songId,
        eventType: "daw_score_sheet_arranged",
        title: "正式吉他譜刪除編排小節",
        description: `正式譜刪除來源第 ${body.sourceMeasure} 小節並自動進入 v${nextResult.review?.revision ?? 1} 修訂，不裁切音檔、不改動時間軸與其他人工確認內容。`,
        relatedModel: "DawScoreDraft",
        relatedId: id,
        metadataJson: JSON.stringify({ deletionId: deletion.id, ...body })
      }
    })
  ]);

  const updated = await getScoreDraft(id);
  if (!updated) return NextResponse.json({ error: "更新譜面後無法讀取資料" }, { status: 500 });
  return NextResponse.json({ draft: toScoreDraftDto(updated), deletion });
}
