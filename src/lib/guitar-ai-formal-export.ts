import type { AutoScoreResult } from "@/lib/auto-score";
import {
  buildFormalGuitarAiScore,
  type GuitarAiScoreRecord
} from "@/lib/guitar-ai-adapter";
import {
  buildOfficialScorePdfExport,
  buildOfficialScoreTextExport,
  scoreArtist
} from "@/lib/score-export";

export const guitarAiOwnerPrivateDeliveryScope = "owner_private_preview" as const;
export const guitarAiFormalTitleMaxLength = 180;
export const guitarAiOwnerPrivateTextMaxBytes = 2_000_000;
export const guitarAiOwnerPrivatePdfMaxBytes = 5 * 1024 * 1024;

export type GuitarAiFormalExportRecord = GuitarAiScoreRecord & {
  title: string;
  updatedAt?: Date | string;
};

export type GuitarAiOwnerPrivateFormalScoreMetadata = {
  song: {
    id: string;
    title: string;
    bpm: number | null;
    musicalKey: string | null;
    projectId: string;
  };
  targetInstrument: "guitar";
  score: {
    id: string;
    releaseId: string | null;
    releasedAt: string | null;
    hashVersion: "songzu_formal_score_v2";
    revision: number;
    hash: string;
    review: {
      status: "finalized";
      revision: number;
      finalizedAt: string;
      finalizedBy: string;
      confirmedBeatCount: number;
      totalBeatCount: number;
    };
    certification: NonNullable<AutoScoreResult["certification"]>;
  };
  delivery: {
    scope: typeof guitarAiOwnerPrivateDeliveryScope;
    audience: string;
    formats: ["txt", "pdf"];
    txt: {
      contentType: "text/plain; charset=utf-8";
      sha256: string;
      accessPath: string;
    };
    pdf: {
      contentType: "application/pdf";
      sha256: string;
      accessPath: string;
    };
  };
};

type FormalFailureReason = Extract<ReturnType<typeof buildFormalGuitarAiScore>, { ok: false }>["reason"];

export type GuitarAiOwnerPrivateFormalScoreResult =
  | {
      ok: true;
      metadata: GuitarAiOwnerPrivateFormalScoreMetadata;
      text: string;
      bytes: Uint8Array;
      pdfBytes: Uint8Array;
    }
  | {
      ok: false;
      reason:
        | FormalFailureReason
        | "invalid_official_export"
        | "release_artifact_integrity_mismatch"
        | "official_export_too_large"
        | "official_pdf_too_large";
    };

export function normalizeGuitarAiFormalTitle(value: string | null) {
  const title = String(value ?? "").normalize("NFC").trim();
  if (
    !title ||
    title.length > guitarAiFormalTitleMaxLength ||
    /[\u0000-\u001F\u007F]/u.test(title)
  ) return null;
  return title;
}

export async function buildGuitarAiOwnerPrivateFormalScore(
  record: GuitarAiFormalExportRecord
): Promise<GuitarAiOwnerPrivateFormalScoreResult> {
  const formal = buildFormalGuitarAiScore(record);
  if (!formal.ok) return formal;

  let result: AutoScoreResult;
  try {
    result = JSON.parse(record.resultJson) as AutoScoreResult;
  } catch {
    return { ok: false, reason: "invalid_official_export" };
  }

  if (result.review?.verificationMethod !== "manual") {
    return { ok: false, reason: "invalid_official_export" };
  }

  if (!formal.payload.score.certification.checks
    .filter((check) => check.requiredFor === "formal")
    .every((check) => check.passed)) {
    return { ok: false, reason: "invalid_official_export" };
  }

  try {
    const exported = buildOfficialScoreTextExport(result, record.title);
    if (exported.bytes.byteLength > guitarAiOwnerPrivateTextMaxBytes) {
      return { ok: false, reason: "official_export_too_large" };
    }
    const song = record.project?.song;
    const workingTitle = song && "workingTitle" in song && typeof song.workingTitle === "string"
      ? song.workingTitle
      : null;
    const pdf = await buildOfficialScorePdfExport(result, record.title, {
      title: song?.title,
      artist: song ? scoreArtist(workingTitle, song.title) : undefined
    });
    if (pdf.bytes.byteLength > guitarAiOwnerPrivatePdfMaxBytes) {
      return { ok: false, reason: "official_pdf_too_large" };
    }
    if (
      record.formalRelease?.textSha256 && record.formalRelease.textSha256 !== exported.sha256 ||
      record.formalRelease?.pdfSha256 && record.formalRelease.pdfSha256 !== pdf.sha256
    ) {
      return { ok: false, reason: "release_artifact_integrity_mismatch" };
    }
    const {
      bars: ignoredBars,
      chords: ignoredChords,
      measures: ignoredMeasures,
      sections: ignoredSections,
      strummingGuide: ignoredStrumming,
      bpm: ignoredBpm,
      musicalKey: ignoredKey,
      timeSignature: ignoredMeter,
      durationSeconds: ignoredDuration,
      ...safeScore
    } = formal.payload.score;
    void ignoredBars;
    void ignoredChords;
    void ignoredMeasures;
    void ignoredSections;
    void ignoredStrumming;
    void ignoredBpm;
    void ignoredKey;
    void ignoredMeter;
    void ignoredDuration;
    return {
      ok: true,
      metadata: {
        song: formal.payload.song,
        targetInstrument: "guitar",
        score: safeScore,
        delivery: {
          scope: guitarAiOwnerPrivateDeliveryScope,
          audience: safeScore.review.finalizedBy,
          formats: ["txt", "pdf"],
          txt: {
            contentType: "text/plain; charset=utf-8",
            sha256: exported.sha256,
            accessPath: `/api/integrations/guitar-ai/v1/scores/${encodeURIComponent(formal.payload.score.id)}/export?format=txt${formal.payload.score.releaseId ? `&revision=${formal.payload.score.revision}` : ""}`
          },
          pdf: {
            contentType: "application/pdf",
            sha256: pdf.sha256,
            accessPath: `/api/integrations/guitar-ai/v1/scores/${encodeURIComponent(formal.payload.score.id)}/export?format=pdf${formal.payload.score.releaseId ? `&revision=${formal.payload.score.revision}` : ""}`
          }
        }
      },
      text: exported.text,
      bytes: exported.bytes,
      pdfBytes: pdf.bytes
    };
  } catch {
    return { ok: false, reason: "invalid_official_export" };
  }
}
