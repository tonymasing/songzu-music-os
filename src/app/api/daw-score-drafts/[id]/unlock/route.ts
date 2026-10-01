import { NextResponse } from "next/server";

import { unlockAutoScoreResult } from "@/lib/auto-score";
import { getScoreDraft, parseScoreResult, toScoreDraftDto } from "@/lib/score-drafts";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });

  const result = parseScoreResult(draft.resultJson);
  if (result.review?.status !== "finalized") return NextResponse.json({ draft: toScoreDraftDto(draft) });
  const project = await prisma.dawProject.findUnique({ where: { id: draft.projectId }, select: { songId: true } });
  if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });
  const unlocked = unlockAutoScoreResult(result);

  await prisma.$transaction([
    prisma.dawMarker.deleteMany({ where: { projectId: draft.projectId, relatedModel: "DawScoreDraft", relatedId: id } }),
    prisma.dawScoreDraft.update({ where: { id }, data: { resultJson: JSON.stringify(unlocked), status: "DRAFT" } }),
    prisma.timelineEvent.create({
      data: {
        songId: project.songId,
        eventType: "daw_score_revision_started",
        title: "吉他和弦譜開始修訂",
        description: `${draft.title} 已解除鎖定，進入修訂版 v${unlocked.review?.revision ?? 1}。舊 DAW 標記已移除，避免使用過期和弦。`,
        relatedModel: "DawScoreDraft",
        relatedId: id
      }
    })
  ]);

  const updated = await getScoreDraft(id);
  if (!updated) return NextResponse.json({ error: "解除鎖定後無法讀取草稿" }, { status: 500 });
  return NextResponse.json({ draft: toScoreDraftDto(updated) });
}
