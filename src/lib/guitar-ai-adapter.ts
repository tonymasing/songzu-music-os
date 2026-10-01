import { createHash, timingSafeEqual } from "node:crypto";

import {
  autoScoreReviewProgress,
  autoScoreReviewableMeasures,
  autoScoreSheetSections,
  buildAutoScoreDeliveryCertification,
  type AutoScoreDeliveryCertification,
  type AutoScoreResult
} from "@/lib/auto-score";

export const guitarAiAdapterTokenEnv = "SONGZU_GUITAR_AI_ADAPTER_TOKEN";
export const guitarAiPracticeClipMaxDurationSeconds = 30.5;

export type GuitarAiAdapterAuthorization =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 503;
      code: "GUITAR_AI_ADAPTER_NOT_CONFIGURED" | "GUITAR_AI_ADAPTER_UNAUTHORIZED";
      error: string;
    };

export type GuitarAiSongMetadata = {
  id: string;
  title: string;
  bpm: number | null;
  musicalKey: string | null;
  projectId: string;
};

export type GuitarAiScoreRecord = {
  id: string;
  projectId: string;
  targetInstrument: string;
  status: string;
  resultJson: string;
  project: {
    id: string;
    song: {
      id: string;
      title: string;
      bpm: number | null;
      musicalKey: string | null;
      workingTitle?: string | null;
    };
  } | null;
  formalRelease?: {
    id: string;
    revision: number;
    formalContentSha256: string;
    contentHashVersion?: string;
    textSha256?: string | null;
    pdfSha256?: string | null;
    releasedAt: Date | string;
  } | null;
};

type GuitarAiScoreBar = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  chords: string[];
};

type GuitarAiScoreChord = {
  startSeconds: number;
  durationSeconds: number;
  name: string;
  root: string;
  quality: string;
  bass: string | null;
  guitarFrets: number[] | null;
};

type GuitarAiScoreReview = {
  status: "finalized";
  revision: number;
  finalizedAt: string;
  finalizedBy: string;
  confirmedBeatCount: number;
  totalBeatCount: number;
};

type GuitarAiFormalBeat = {
  id: string;
  beat: number;
  name: string;
  sourceMeasure: number | null;
  insertionId: string | null;
  notationOnly: boolean;
  startSeconds: number | null;
  endSeconds: number | null;
};

type GuitarAiFormalMeasure = {
  number: number;
  sourceMeasure: number | null;
  insertionId: string | null;
  notationOnly: boolean;
  startSeconds: number | null;
  endSeconds: number | null;
  beats: GuitarAiFormalBeat[];
};

type GuitarAiFormalSection = {
  label: string;
  firstMeasure: number;
  lastMeasure: number;
};

export type GuitarAiFormalScorePayload = {
  song: GuitarAiSongMetadata;
  score: {
    id: string;
    releaseId: string | null;
    releasedAt: string | null;
    hashVersion: "songzu_formal_score_v2";
    revision: number;
    hash: string;
    bpm: number;
    musicalKey: string;
    timeSignature: string;
    durationSeconds: number;
    bars: GuitarAiScoreBar[];
    chords: GuitarAiScoreChord[];
    measures: GuitarAiFormalMeasure[];
    sections: GuitarAiFormalSection[];
    strummingGuide: AutoScoreResult["strummingGuide"] | null;
    review: GuitarAiScoreReview;
    certification: AutoScoreDeliveryCertification;
  };
};

export type GuitarAiFormalScoreResult =
  | { ok: true; payload: GuitarAiFormalScorePayload }
  | {
      ok: false;
      reason:
        | "missing_project_relation"
        | "not_formal_guitar_score"
        | "invalid_score_format"
        | "invalid_review"
        | "beat_confirmation_mismatch"
        | "release_integrity_mismatch"
        | "invalid_score_content";
    };

export type GuitarAiPracticeAudioRecord = {
  id: string;
  songId: string;
  status: string;
  previewFileName: string | null;
  previewDurationSeconds: number;
  previewSha256: string | null;
  publishedAt: Date | string | null;
  sourceAudioFile: {
    id: string;
    fileType: string;
    qualityStatus: string;
    isProtectedOriginal: boolean;
    archivedAt: Date | string | null;
  } | null;
  song: {
    id: string;
    title: string;
    bpm: number | null;
    musicalKey: string | null;
    rightsProfile: {
      oneStopClearance: boolean;
      masterControlled: boolean;
      publishingControlled: boolean;
    } | null;
  } | null;
};

export type GuitarAiPracticeAudioPayload = {
  song: Omit<GuitarAiSongMetadata, "projectId">;
  asset: {
    id: string;
    kind: "authorized_practice_clip";
    durationSeconds: number;
    sha256: string;
    contentType: "audio/mp4";
    accessPath: string;
    downloadAllowed: false;
    rights: {
      basis: "one_stop_controlled_preview";
      masterControlled: true;
      publishingControlled: true;
      oneStopClearance: true;
    };
  };
};

export type GuitarAiPracticeAudioResult =
  | { ok: true; payload: GuitarAiPracticeAudioPayload }
  | {
      ok: false;
      reason:
        | "missing_song_relation"
        | "not_published"
        | "preview_not_ready"
        | "invalid_preview"
        | "rights_not_cleared"
        | "source_not_eligible";
    };

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export function authorizeGuitarAiAdapter(request: Request): GuitarAiAdapterAuthorization {
  const expected = process.env[guitarAiAdapterTokenEnv] ?? "";
  if (expected.length < 32) {
    return {
      ok: false,
      status: 503,
      code: "GUITAR_AI_ADAPTER_NOT_CONFIGURED",
      error: "吉他 AI adapter 尚未完成安全設定。"
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  const supplied = bearer?.[1]?.trim() ?? "";
  const matches = timingSafeEqual(sha256(supplied), sha256(expected));
  if (!bearer || !matches) {
    return {
      ok: false,
      status: 401,
      code: "GUITAR_AI_ADAPTER_UNAUTHORIZED",
      error: "吉他 AI adapter 授權無效。"
    };
  }

  return { ok: true };
}

export function guitarAiAdapterJson(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function guitarAiAdapterAuthorizationError(authorization: Exclude<GuitarAiAdapterAuthorization, { ok: true }>) {
  return guitarAiAdapterJson(
    {
      error: authorization.error,
      code: authorization.code
    },
    authorization.status
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined && !/(?:At)$/u.test(key))
      .map((key) => [key, canonicalize(value[key])])
  );
}

function formalScoreHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function formalScoreMeasures(result: AutoScoreResult): GuitarAiFormalMeasure[] {
  return autoScoreReviewableMeasures(result).map((measure) => ({
    number: measure.number,
    sourceMeasure: measure.sourceMeasure,
    insertionId: measure.insertionId ?? null,
    notationOnly: Boolean(measure.notationOnly),
    startSeconds: measure.notationOnly ? null : measure.startSeconds,
    endSeconds: measure.notationOnly ? null : measure.endSeconds,
    beats: measure.beats.map((beat) => ({
      id: beat.id,
      beat: beat.beat,
      name: beat.name,
      sourceMeasure: beat.sourceMeasure,
      insertionId: beat.insertionId ?? null,
      notationOnly: Boolean(beat.notationOnly),
      startSeconds: beat.notationOnly ? null : beat.startSeconds,
      endSeconds: beat.notationOnly ? null : beat.endSeconds
    }))
  }));
}

export function buildFormalGuitarAiCanonicalContent(
  result: AutoScoreResult,
  song: Pick<GuitarAiSongMetadata, "id" | "title" | "bpm" | "musicalKey">
) {
  const review = result.review;
  if (
    review?.status !== "finalized" ||
    (typeof review.finalizedBy !== "string" || !review.finalizedBy.trim()) ||
    !review.finalizedAt ||
    !positiveInteger(review.revision) ||
    !positiveInteger(review.confirmedBeatCount) ||
    !positiveInteger(review.totalBeatCount)
  ) return null;
  const formalReview: GuitarAiScoreReview = {
    status: "finalized",
    revision: review.revision,
    finalizedAt: new Date(review.finalizedAt).toISOString(),
    finalizedBy: review.finalizedBy,
    confirmedBeatCount: review.confirmedBeatCount,
    totalBeatCount: review.totalBeatCount
  };
  return {
    song: {
      id: song.id,
      title: song.title,
      bpm: song.bpm,
      musicalKey: song.musicalKey
    },
    score: {
      bpm: result.bpm,
      musicalKey: result.musicalKey,
      timeSignature: result.timeSignature,
      durationSeconds: result.durationSeconds,
      bars: sanitizeBars(result.bars),
      chords: sanitizeChords(result.chords),
      measures: formalScoreMeasures(result),
      sections: autoScoreSheetSections(result).map((section) => ({
        label: section.label,
        firstMeasure: section.firstMeasure,
        lastMeasure: section.lastMeasure
      })),
      strummingGuide: result.strummingGuide ?? null,
      review: formalReview
    }
  };
}

export function formalGuitarAiContentSha256(
  result: AutoScoreResult,
  song: Pick<GuitarAiSongMetadata, "id" | "title" | "bpm" | "musicalKey">
) {
  const canonical = buildFormalGuitarAiCanonicalContent(result, song);
  return canonical ? formalScoreHash(canonical) : null;
}

function validPublishedAt(value: Date | string | null) {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000;
}

/**
 * Produces the only audio metadata shape the Guitar AI integration may see.
 * Source names, paths, preview tokens and original durations are deliberately
 * excluded. A playable asset requires both a generated short preview and
 * affirmative one-stop control of master and publishing rights.
 */
export function buildGuitarAiPracticeAudioAsset(record: GuitarAiPracticeAudioRecord): GuitarAiPracticeAudioResult {
  if (!record.song || record.song.id !== record.songId) return { ok: false, reason: "missing_song_relation" };
  if (record.status !== "PUBLISHED" || !validPublishedAt(record.publishedAt)) {
    return { ok: false, reason: "not_published" };
  }
  if (!record.previewFileName || !record.previewSha256) return { ok: false, reason: "preview_not_ready" };

  const sha256 = record.previewSha256.toLowerCase();
  if (
    !record.previewFileName.endsWith("-preview-30s.m4a") ||
    record.previewFileName.includes("/") ||
    record.previewFileName.includes("\\") ||
    !finiteNumber(record.previewDurationSeconds) ||
    record.previewDurationSeconds < 29.5 ||
    record.previewDurationSeconds > guitarAiPracticeClipMaxDurationSeconds ||
    !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    return { ok: false, reason: "invalid_preview" };
  }

  const rights = record.song.rightsProfile;
  if (!rights?.oneStopClearance || !rights.masterControlled || !rights.publishingControlled) {
    return { ok: false, reason: "rights_not_cleared" };
  }

  const source = record.sourceAudioFile;
  if (
    !source ||
    source.archivedAt !== null ||
    !source.isProtectedOriginal ||
    !["master", "mix", "demo"].includes(source.fileType) ||
    !["pass", "warning"].includes(source.qualityStatus)
  ) {
    return { ok: false, reason: "source_not_eligible" };
  }

  return {
    ok: true,
    payload: {
      song: {
        id: record.song.id,
        title: record.song.title,
        bpm: record.song.bpm,
        musicalKey: record.song.musicalKey
      },
      asset: {
        id: record.id,
        kind: "authorized_practice_clip",
        durationSeconds: record.previewDurationSeconds,
        sha256,
        contentType: "audio/mp4",
        accessPath: `/api/integrations/guitar-ai/v1/audio-assets/${encodeURIComponent(record.id)}/clip`,
        downloadAllowed: false,
        rights: {
          basis: "one_stop_controlled_preview",
          masterControlled: true,
          publishingControlled: true,
          oneStopClearance: true
        }
      }
    }
  };
}

function sanitizeBars(value: unknown): GuitarAiScoreBar[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const bars: GuitarAiScoreBar[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !Number.isInteger(item.index) ||
      !finiteNumber(item.startSeconds) ||
      !finiteNumber(item.endSeconds) ||
      item.endSeconds <= item.startSeconds ||
      !Array.isArray(item.chords) ||
      !item.chords.every((chord) => typeof chord === "string")
    ) {
      return null;
    }
    bars.push({
      index: item.index as number,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      chords: [...item.chords]
    });
  }
  return bars;
}

function sanitizeChords(value: unknown): GuitarAiScoreChord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const chords: GuitarAiScoreChord[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !finiteNumber(item.startSeconds) ||
      !finiteNumber(item.durationSeconds) ||
      item.durationSeconds <= 0 ||
      typeof item.name !== "string" ||
      typeof item.root !== "string" ||
      typeof item.quality !== "string" ||
      !(item.bass === null || item.bass === undefined || typeof item.bass === "string") ||
      !(
        item.guitarFrets === undefined ||
        (Array.isArray(item.guitarFrets) && item.guitarFrets.every((fret) => Number.isInteger(fret)))
      )
    ) {
      return null;
    }
    chords.push({
      startSeconds: item.startSeconds,
      durationSeconds: item.durationSeconds,
      name: item.name,
      root: item.root,
      quality: item.quality,
      bass: typeof item.bass === "string" ? item.bass : null,
      guitarFrets: Array.isArray(item.guitarFrets) ? [...item.guitarFrets] as number[] : null
    });
  }
  return chords;
}

export function buildFormalGuitarAiScore(record: GuitarAiScoreRecord): GuitarAiFormalScoreResult {
  if (!record.project || record.project.id !== record.projectId || !record.project.song) {
    return { ok: false, reason: "missing_project_relation" };
  }
  if (record.targetInstrument !== "guitar" || !["REVIEWED", "APPLIED"].includes(record.status)) {
    return { ok: false, reason: "not_formal_guitar_score" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(record.resultJson) as unknown;
  } catch {
    return { ok: false, reason: "invalid_score_format" };
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== "songzu-auto-score" ||
    parsed.version !== 1 ||
    parsed.targetInstrument !== "guitar" ||
    typeof parsed.timeSignature !== "string" ||
    !finiteNumber(parsed.durationSeconds) ||
    !Array.isArray(parsed.beatConfirmations) ||
    !isRecord(parsed.review)
  ) {
    return { ok: false, reason: "invalid_score_format" };
  }

  const review = parsed.review;
  const finalizedAtMs = typeof review.finalizedAt === "string" ? Date.parse(review.finalizedAt) : Number.NaN;
  if (
    review.status !== "finalized" ||
    (typeof review.finalizedBy !== "string" || !review.finalizedBy.trim()) ||
    !positiveInteger(review.revision) ||
    !positiveInteger(review.confirmedBeatCount) ||
    !positiveInteger(review.totalBeatCount) ||
    review.confirmedBeatCount !== review.totalBeatCount ||
    !Number.isFinite(finalizedAtMs) ||
    finalizedAtMs > Date.now() + 5 * 60 * 1000
  ) {
    return { ok: false, reason: "invalid_review" };
  }

  let progress: { total: number; confirmed: number };
  try {
    progress = autoScoreReviewProgress(parsed as unknown as AutoScoreResult);
  } catch {
    return { ok: false, reason: "invalid_score_content" };
  }
  if (
    progress.total <= 0 ||
    progress.total !== review.totalBeatCount ||
    progress.confirmed !== review.confirmedBeatCount ||
    progress.confirmed !== progress.total
  ) {
    return { ok: false, reason: "beat_confirmation_mismatch" };
  }

  const bars = sanitizeBars(parsed.bars);
  const chords = sanitizeChords(parsed.chords);
  if (!bars || !chords) return { ok: false, reason: "invalid_score_content" };

  const formalReview: GuitarAiScoreReview = {
    status: "finalized",
    revision: review.revision,
    finalizedAt: new Date(finalizedAtMs).toISOString(),
    finalizedBy: review.finalizedBy,
    confirmedBeatCount: review.confirmedBeatCount,
    totalBeatCount: review.totalBeatCount
  };
  const parsedResult = parsed as unknown as AutoScoreResult;
  const certification = buildAutoScoreDeliveryCertification(parsedResult);
  const canonicalContent = buildFormalGuitarAiCanonicalContent(parsedResult, {
    id: record.project.song.id,
    title: record.project.song.title,
    bpm: record.project.song.bpm,
    musicalKey: record.project.song.musicalKey
  });
  if (!canonicalContent || !canonicalContent.score.bars || !canonicalContent.score.chords) {
    return { ok: false, reason: "invalid_score_content" };
  }
  const hash = formalScoreHash(canonicalContent);
  if (record.formalRelease && (
    record.formalRelease.contentHashVersion && record.formalRelease.contentHashVersion !== "songzu_formal_score_v2" ||
    record.formalRelease.revision !== formalReview.revision ||
    record.formalRelease.formalContentSha256 !== hash
  )) {
    return { ok: false, reason: "release_integrity_mismatch" };
  }
  const releasedAtMs = record.formalRelease
    ? record.formalRelease.releasedAt instanceof Date
      ? record.formalRelease.releasedAt.getTime()
      : Date.parse(record.formalRelease.releasedAt)
    : Number.NaN;

  return {
    ok: true,
    payload: {
      song: {
        id: record.project.song.id,
        title: record.project.song.title,
        bpm: record.project.song.bpm,
        musicalKey: record.project.song.musicalKey,
        projectId: record.project.id
      },
      score: {
        id: record.id,
        releaseId: record.formalRelease?.id ?? null,
        releasedAt: Number.isFinite(releasedAtMs) ? new Date(releasedAtMs).toISOString() : null,
        hashVersion: "songzu_formal_score_v2",
        revision: formalReview.revision,
        hash,
        ...canonicalContent.score,
        bars,
        chords,
        certification
      }
    }
  };
}
