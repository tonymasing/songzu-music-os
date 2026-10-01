import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { autoScoreReviewableMeasures, finalizeAutoScoreResult, verifyAutoScoreResult } from "@/lib/auto-score";
import { formalGuitarAiContentSha256 } from "@/lib/guitar-ai-adapter";
import { getScoreDraft, parseScoreResult, toScoreDraftDto } from "@/lib/score-drafts";
import { prisma } from "@/lib/prisma";
import { buildOfficialScorePdfExport, buildOfficialScoreTextExport, scoreArtist } from "@/lib/score-export";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });

  const result = parseScoreResult(draft.resultJson);
  if (result.targetInstrument !== "guitar") {
    return NextResponse.json({ error: "目前正式鎖譜流程先支援吉他和弦譜" }, { status: 400 });
  }

  try {
    const verified = verifyAutoScoreResult(result);
    const finalized = finalizeAutoScoreResult(verified, process.env.SONGZU_CREATOR_NAME?.trim() || "本機創作者");
    const verificationMethod = finalized.review?.verificationMethod ?? "manual";
    const revision = finalized.review?.revision ?? 1;
    const chordSnapshot = autoScoreReviewableMeasures(finalized).flatMap((measure) =>
      measure.beats.map((beat) => ({
        measure: measure.number,
        beat: beat.beat,
        startSeconds: beat.startSeconds,
        endSeconds: beat.endSeconds,
        chord: beat.name
      }))
    );
    const chordSnapshotSha256 = createHash("sha256").update(JSON.stringify(chordSnapshot)).digest("hex");
    const project = await prisma.dawProject.findUnique({
      where: { id: draft.projectId },
      select: {
        songId: true,
        song: { select: { id: true, title: true, bpm: true, musicalKey: true, workingTitle: true } }
      }
    });
    if (!project) return NextResponse.json({ error: "找不到 DAW 專案" }, { status: 404 });
    const formalContentSha256 = formalGuitarAiContentSha256(finalized, project.song);
    if (!formalContentSha256) throw new Error("無法建立正式譜內容身分。");
    const releasedAt = new Date(finalized.review?.finalizedAt ?? Date.now());
    const textExport = buildOfficialScoreTextExport(finalized, draft.title);
    const pdfExport = await buildOfficialScorePdfExport(finalized, draft.title, {
      title: project.song.title,
      artist: scoreArtist(project.song.workingTitle, project.song.title)
    });

    await prisma.$transaction([
      prisma.dawScoreDraft.update({
        where: { id },
        data: { resultJson: JSON.stringify(finalized), status: "REVIEWED", confidence: Math.max(draft.confidence, finalized.confidence) }
      }),
      prisma.timelineEvent.create({
        data: {
          songId: project.songId,
          eventType: "daw_score_human_finalized",
          title: revision === 1 ? "第一次人工確認完成" : `吉他和弦譜人工確認 v${revision}`,
          description: `${draft.title} 已由 ${finalized.review?.finalizedBy ?? "本機創作者"} 完成 ${finalized.review?.confirmedBeatCount ?? 0}/${finalized.review?.totalBeatCount ?? 0} 拍人工確認，保存全部和弦並鎖定正式修訂版 v${revision}。交付狀態：${finalized.certification?.label ?? "人工定稿"}。`,
          relatedModel: "DawScoreDraft",
          relatedId: id,
          metadataJson: JSON.stringify({
            verificationMethod,
            revision,
            confirmedBeatCount: finalized.review?.confirmedBeatCount ?? 0,
            totalBeatCount: finalized.review?.totalBeatCount ?? 0,
            chordSnapshotSha256,
            formalContentSha256
          })
        }
      }),
      prisma.dawScoreRelease.create({
        data: {
          scoreDraftId: id,
          revision,
          formalContentSha256,
          contentHashVersion: "songzu_formal_score_v2",
          resultJson: JSON.stringify(finalized),
          textSha256: textExport.sha256,
          pdfSha256: pdfExport.sha256,
          artifactGeneratedAt: releasedAt,
          releasedAt,
          releasedBy: finalized.review?.finalizedBy ?? "本機創作者",
          confirmationEvidenceJson: JSON.stringify({
            kind: "interactive_manual_review",
            actor: finalized.review?.finalizedBy ?? "本機創作者",
            confirmedBeatCount: finalized.review?.confirmedBeatCount ?? 0,
            totalBeatCount: finalized.review?.totalBeatCount ?? 0
          })
        }
      })
    ]);

    const updated = await getScoreDraft(id);
    if (!updated) return NextResponse.json({ error: "鎖譜後無法讀取草稿" }, { status: 500 });
    return NextResponse.json({ draft: toScoreDraftDto(updated) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法鎖定正式譜" }, { status: 409 });
  }
}
