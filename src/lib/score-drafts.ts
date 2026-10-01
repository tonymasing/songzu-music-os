import type { Prisma } from "@prisma/client";

import type { AutoScoreResult } from "@/lib/auto-score";
import { prisma } from "@/lib/prisma";

export const scoreDraftInclude = {
  sourceAudioFile: {
    select: {
      id: true,
      fileName: true,
      versionName: true,
      fileType: true,
      durationSeconds: true,
      qualityStatus: true,
      isProtectedOriginal: true
    }
  }
} satisfies Prisma.DawScoreDraftInclude;

export type ScoreDraftRecord = Prisma.DawScoreDraftGetPayload<{ include: typeof scoreDraftInclude }>;

export function parseScoreResult(value: string): AutoScoreResult {
  return JSON.parse(value) as AutoScoreResult;
}

export function toScoreDraftDto(draft: ScoreDraftRecord) {
  return {
    id: draft.id,
    projectId: draft.projectId,
    sourceAudioFileId: draft.sourceAudioFileId,
    title: draft.title,
    targetInstrument: draft.targetInstrument,
    analyzer: draft.analyzer,
    status: draft.status,
    confidence: draft.confidence,
    bpm: draft.bpm,
    musicalKey: draft.musicalKey,
    timeSignature: draft.timeSignature,
    durationSeconds: draft.durationSeconds,
    result: parseScoreResult(draft.resultJson),
    sourceAudioFile: draft.sourceAudioFile,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString()
  };
}

function sampleTimelineItems<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  const stride = Math.ceil(items.length / limit);
  return items.filter((_, index) => index % stride === 0).slice(0, limit);
}

export function toScoreTimelineDraftDto(draft: ScoreDraftRecord) {
  const result = parseScoreResult(draft.resultJson);
  return {
    id: draft.id,
    title: draft.title,
    targetInstrument: draft.targetInstrument,
    status: draft.status,
    confidence: draft.confidence,
    bpm: draft.bpm,
    musicalKey: draft.musicalKey,
    timeSignature: draft.timeSignature,
    durationSeconds: draft.durationSeconds,
    sourceAudioFile: draft.sourceAudioFile,
    result: {
      notes: sampleTimelineItems(result.notes, 220).map((note) => ({
        startSeconds: note.startSeconds,
        durationSeconds: note.durationSeconds,
        midi: note.midi,
        noteName: note.noteName,
        confidence: note.confidence
      })),
      chords: sampleTimelineItems(result.chords, 180).map((chord) => ({
        startSeconds: chord.startSeconds,
        durationSeconds: chord.durationSeconds,
        name: chord.name,
        confidence: chord.confidence
      })),
      drumHits: sampleTimelineItems(result.drumHits, 480).map((hit) => ({
        startSeconds: hit.startSeconds,
        kind: hit.kind,
        confidence: hit.confidence
      }))
    },
    updatedAt: draft.updatedAt.toISOString()
  };
}

export function latestScoreDraftsByTarget(drafts: ScoreDraftRecord[]) {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    if (seen.has(draft.targetInstrument)) return false;
    seen.add(draft.targetInstrument);
    return true;
  });
}

export async function listScoreDrafts(projectId: string) {
  return prisma.dawScoreDraft.findMany({
    where: { projectId, status: { not: "ARCHIVED" } },
    include: scoreDraftInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getScoreDraft(id: string) {
  return prisma.dawScoreDraft.findUnique({ where: { id }, include: scoreDraftInclude });
}
