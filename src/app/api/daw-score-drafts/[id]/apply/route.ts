import { NextResponse } from "next/server";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { getScoreDraft, parseScoreResult } from "@/lib/score-drafts";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const project = await prisma.dawProject.findUnique({ where: { id: draft.projectId }, select: { songId: true } });
  if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });
  const result = parseScoreResult(draft.resultJson);
  if (result.targetInstrument === "guitar" && (result.review?.status !== "finalized" || result.review.verificationMethod !== "manual")) {
    return NextResponse.json({ error: "請先完成全部逐拍人工確認並鎖定正式吉他和弦譜，再加入 DAW" }, { status: 409 });
  }
  const markers = result.targetInstrument === "drums"
    ? result.bars.map((bar) => ({ timestampSeconds: bar.startSeconds, label: `鼓譜 · 小節 ${bar.index}` }))
    : result.chords.map((chord) => ({ timestampSeconds: chord.startSeconds, label: chord.name }));

  await prisma.$transaction(async (tx) => {
    await tx.dawMarker.deleteMany({ where: { projectId: draft.projectId, relatedModel: "DawScoreDraft", relatedId: draft.id } });
    for (const marker of markers.slice(0, 512)) {
      await tx.dawMarker.create({
        data: {
          projectId: draft.projectId,
          markerType: "score",
          label: marker.label,
          timestampSeconds: marker.timestampSeconds,
          color: result.targetInstrument === "drums" ? "#c2410c" : result.targetInstrument === "guitar" ? "#0f766e" : "#6d28d9",
          relatedModel: "DawScoreDraft",
          relatedId: draft.id,
          notes: `${draft.title} · 可信度 ${Math.round(draft.confidence)}%`
        }
      });
    }
    await tx.dawScoreDraft.update({ where: { id: draft.id }, data: { status: "APPLIED" } });
    await tx.timelineEvent.create({
      data: {
        songId: project.songId,
        eventType: "daw_score_applied",
        title: result.review?.status === "finalized" ? "正式採譜已加入 DAW" : "採譜草稿已加入 DAW",
        description: `${draft.title} 已建立 ${Math.min(512, markers.length)} 個時間軸標記。${result.review?.verificationMethod === "manual" ? "譜面已完成逐拍人工確認。" : ""}`,
        relatedModel: "DawScoreDraft",
        relatedId: draft.id
      }
    });
  });

  const updated = await getDawProjectById(draft.projectId);
  return NextResponse.json({ project: updated ? toDawProjectDto(updated) : null, markerCount: Math.min(512, markers.length) });
}
