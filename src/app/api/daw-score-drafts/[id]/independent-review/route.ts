import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyAutoScoreIndependentReview,
  autoScoreReviewProgress,
  type AutoScoreResult
} from "@/lib/auto-score";
import { formalGuitarAiContentSha256 } from "@/lib/guitar-ai-adapter";
import { prisma } from "@/lib/prisma";
import { buildOfficialScorePdfExport, buildOfficialScoreTextExport, scoreArtist } from "@/lib/score-export";
import { getScoreDraft, toScoreDraftDto } from "@/lib/score-drafts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const IndependentReviewSchema = z.object({
  reviewer: z.string().trim().min(2).max(100),
  role: z.enum(["musician", "teacher", "arranger"]),
  attestedComplete: z.literal(true),
  notes: z.string().trim().max(1000).optional()
}).strict();

const protectedScoreFields = [
  "chords",
  "beatConfirmations",
  "strummingGuide",
  "sheetArrangement",
  "sectionMap"
] as const satisfies readonly (keyof AutoScoreResult)[];

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function protectedFieldHashes(result: AutoScoreResult) {
  return Object.fromEntries(protectedScoreFields.map((field) => [field, digest(result[field])])) as Record<(typeof protectedScoreFields)[number], string>;
}

function sameProtectedFields(left: ReturnType<typeof protectedFieldHashes>, right: ReturnType<typeof protectedFieldHashes>) {
  return protectedScoreFields.every((field) => left[field] === right[field]);
}

export async function POST(request: Request, context: RouteContext) {
  const parsed = IndependentReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "請完整填寫第二位複核者，並確認已逐拍核對全曲。" }, { status: 400 });
  }

  const { id } = await context.params;
  const draft = await prisma.dawScoreDraft.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      resultJson: true,
      confidence: true,
      sourceAudioFile: {
        select: { id: true, sha256: true, isProtectedOriginal: true, qualityStatus: true }
      },
      project: {
        select: {
          songId: true,
          song: { select: { id: true, title: true, bpm: true, musicalKey: true, workingTitle: true } }
        }
      },
      formalReleases: {
        orderBy: { revision: "desc" },
        take: 1,
        select: {
          id: true,
          revision: true,
          formalContentSha256: true,
          resultJson: true,
          releasedAt: true
        }
      }
    }
  });
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  if (!draft.project?.song) return NextResponse.json({ error: "找不到正式譜歌曲資料" }, { status: 409 });
  const latestRelease = draft.formalReleases[0];
  if (!latestRelease) return NextResponse.json({ error: "必須先建立不可變正式譜，才能登記獨立複核。" }, { status: 409 });

  try {
    const releasedResult = JSON.parse(latestRelease.resultJson) as AutoScoreResult;
    const currentResult = JSON.parse(draft.resultJson) as AutoScoreResult;
    const storedReleaseHash = formalGuitarAiContentSha256(releasedResult, draft.project.song);
    if (!storedReleaseHash || storedReleaseHash !== latestRelease.formalContentSha256) {
      return NextResponse.json({ error: "上一版正式譜完整性驗證失敗，已停止登記複核。" }, { status: 409 });
    }
    if (
      currentResult.review?.status !== "finalized" ||
      currentResult.review.revision !== latestRelease.revision
    ) {
      return NextResponse.json({ error: "目前草稿不是最新正式譜，請先完成修訂版鎖定。" }, { status: 409 });
    }
    if (
      !draft.sourceAudioFile?.isProtectedOriginal ||
      !["pass", "warning"].includes(draft.sourceAudioFile.qualityStatus) ||
      !/^[a-f0-9]{64}$/iu.test(draft.sourceAudioFile.sha256 ?? "")
    ) {
      return NextResponse.json({ error: "找不到可追溯的受保護原曲，已停止登記複核。" }, { status: 409 });
    }

    const currentProgress = autoScoreReviewProgress(currentResult);
    if (currentResult.independentReview?.confirmedBeatCount === currentProgress.total) {
      const currentDraft = await getScoreDraft(id);
      if (!currentDraft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
      return NextResponse.json({
        draft: toScoreDraftDto(currentDraft),
        release: { id: latestRelease.id, revision: latestRelease.revision },
        noOp: true
      });
    }

    const beforeHashes = protectedFieldHashes(currentResult);
    const revision = latestRelease.revision + 1;
    const reviewedAt = new Date().toISOString();
    const reviewed = applyAutoScoreIndependentReview(
      {
        ...currentResult,
        review: currentResult.review ? { ...currentResult.review, revision } : currentResult.review
      },
      {
        reviewer: parsed.data.reviewer,
        role: parsed.data.role,
        confirmedBeatCount: currentProgress.total,
        totalBeatCount: currentProgress.total,
        reviewedAt,
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {})
      }
    );
    const afterHashes = protectedFieldHashes(reviewed);
    if (!sameProtectedFields(beforeHashes, afterHashes)) {
      return NextResponse.json({ error: "複核登記意外碰觸譜面內容，已拒絕建立新版本。" }, { status: 409 });
    }

    const formalContentSha256 = formalGuitarAiContentSha256(reviewed, draft.project.song);
    if (!formalContentSha256) throw new Error("無法建立正式譜內容身分。");
    const textExport = buildOfficialScoreTextExport(reviewed, draft.title);
    const pdfExport = await buildOfficialScorePdfExport(reviewed, draft.title, {
      title: draft.project.song.title,
      artist: scoreArtist(draft.project.song.workingTitle, draft.project.song.title)
    });
    const evidence = {
      kind: "independent_musician_full_score_review",
      reviewer: reviewed.independentReview?.reviewer,
      role: reviewed.independentReview?.role,
      confirmedBeatCount: currentProgress.total,
      totalBeatCount: currentProgress.total,
      reviewedAt,
      sourceReleaseId: latestRelease.id,
      sourceRevision: latestRelease.revision,
      protectedAudioFileId: draft.sourceAudioFile.id,
      protectedAudioSha256: draft.sourceAudioFile.sha256,
      protectedFieldHashes: beforeHashes
    };

    const [, release] = await prisma.$transaction([
      prisma.dawScoreDraft.update({
        where: { id },
        data: {
          resultJson: JSON.stringify(reviewed),
          status: draft.status,
          confidence: Math.max(draft.confidence, reviewed.confidence)
        }
      }),
      prisma.dawScoreRelease.create({
        data: {
          scoreDraftId: id,
          revision,
          formalContentSha256,
          contentHashVersion: "songzu_formal_score_v2",
          resultJson: JSON.stringify(reviewed),
          textSha256: textExport.sha256,
          pdfSha256: pdfExport.sha256,
          artifactGeneratedAt: new Date(reviewedAt),
          releasedAt: new Date(reviewedAt),
          releasedBy: reviewed.review?.finalizedBy || "本機創作者",
          confirmationEvidenceJson: JSON.stringify(evidence)
        }
      }),
      prisma.timelineEvent.create({
        data: {
          songId: draft.project.songId,
          eventType: "daw_score_independent_review_completed",
          title: `吉他譜獨立複核完成 v${revision}`,
          description: `${reviewed.independentReview?.reviewer} 已完成 ${currentProgress.total}/${currentProgress.total} 拍獨立複核；和弦、拍點、刷法、編排與段落內容未變更。`,
          relatedModel: "DawScoreDraft",
          relatedId: id,
          metadataJson: JSON.stringify({ revision, formalContentSha256, evidence })
        }
      })
    ]);
    const updatedDraft = await getScoreDraft(id);
    if (!updatedDraft) return NextResponse.json({ error: "複核完成後無法讀取正式譜" }, { status: 500 });

    return NextResponse.json({
      draft: toScoreDraftDto(updatedDraft),
      release: { id: release.id, revision: release.revision, formalContentSha256 },
      protectedFieldHashes: afterHashes,
      noOp: false
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法登記獨立複核" }, { status: 409 });
  }
}
