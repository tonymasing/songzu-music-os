import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { getDawProjectById } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { resolveStoredFilePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

const ffmpegPath = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function decodeWindow(filePath: string, startSeconds: number, durationSeconds: number, sampleRate: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-v", "error",
      "-ss", startSeconds.toFixed(6),
      "-t", durationSeconds.toFixed(6),
      "-i", filePath,
      "-map", "0:a:0",
      "-ac", "1",
      "-ar", String(sampleRate),
      "-f", "f32le",
      "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr || `ffmpeg ${code}`)));
  });
}

export async function snapClipToZeroCrossing(clipId: string, boundary: "start" | "end", searchMs = 20) {
  const clip = await prisma.dawClip.findUnique({ where: { id: clipId }, include: { audioFile: true, track: true } });
  if (!clip) throw new Error("找不到片段。");
  if (clip.locked) throw new Error("片段已鎖定，請先解除鎖定。");
  if (!clip.audioFile.filePath) throw new Error("片段沒有本機原始音檔路徑。");
  const filePath = resolveStoredFilePath(clip.audioFile.filePath);
  if (!existsSync(filePath)) throw new Error("找不到片段原始音檔。");
  const duration = clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 0;
  if (duration <= 0.05) throw new Error("片段太短，無法做零交越校正。");
  const sourceBoundary = boundary === "start" ? clip.offsetSeconds : clip.offsetSeconds + duration;
  const radius = clamp(searchMs, 2, 50) / 1_000;
  const windowStart = Math.max(0, sourceBoundary - radius);
  const windowDuration = radius * 2;
  const sampleRate = clip.audioFile.sampleRate ?? 48_000;
  const pcm = await decodeWindow(filePath, windowStart, windowDuration, sampleRate);
  const sampleCount = Math.floor(pcm.length / 4);
  if (!sampleCount) throw new Error("音檔解碼後沒有可分析樣本。");
  let bestIndex = 0;
  let bestMagnitude = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sampleCount - 1; index += 1) {
    const value = pcm.readFloatLE(index * 4);
    const previous = pcm.readFloatLE((index - 1) * 4);
    const signCrossing = Math.sign(value) !== Math.sign(previous);
    const magnitude = Math.abs(value) + Math.abs(previous) + (signCrossing ? 0 : 0.15);
    if (magnitude < bestMagnitude) {
      bestMagnitude = magnitude;
      bestIndex = index;
    }
  }
  const snappedSource = windowStart + bestIndex / sampleRate;
  const sourceFileDuration = clip.audioFile.durationSeconds ?? Number.POSITIVE_INFINITY;
  const minimumDelta = boundary === "start" ? Math.max(-radius, -clip.offsetSeconds, -clip.startSeconds) : -radius;
  const maximumDelta = boundary === "end"
    ? Math.min(radius, Math.max(0, sourceFileDuration - clip.offsetSeconds - duration))
    : radius;
  const delta = clamp(snappedSource - sourceBoundary, minimumDelta, maximumDelta);
  const patch = boundary === "start"
    ? {
        startSeconds: Math.max(0, clip.startSeconds + delta),
        offsetSeconds: Math.max(0, clip.offsetSeconds + delta),
        durationSeconds: Math.max(0.02, duration - delta),
        zeroCrossingAdjusted: true
      }
    : {
        durationSeconds: Math.min(Math.max(0.02, duration + delta), Math.max(0.02, sourceFileDuration - clip.offsetSeconds)),
        zeroCrossingAdjusted: true
      };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.dawClip.update({ where: { id: clip.id }, data: patch });
    await recordDawEditOperation(tx, {
      projectId: clip.track.projectId,
      operationType: "precision_edit",
      entityType: "clip",
      entityId: clip.id,
      label: `${boundary === "start" ? "起點" : "終點"}吸附零交越`,
      before: clip,
      after: updated
    });
  });
  return { projectId: clip.track.projectId, deltaSeconds: delta, snappedSourceSeconds: snappedSource };
}

export async function createAutomaticCrossfade(clipId: string, requestedSeconds = 0.012) {
  const clip = await prisma.dawClip.findUnique({
    where: { id: clipId },
    include: { audioFile: true, track: { include: { clips: { include: { audioFile: true } } } } }
  });
  if (!clip) throw new Error("找不到片段。");
  const duration = clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 0;
  const clipEnd = clip.startSeconds + duration;
  const next = clip.track.clips
    .filter((candidate) => candidate.id !== clip.id && candidate.startSeconds >= clip.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds)[0];
  if (!next) throw new Error("右側沒有可建立交叉淡化的片段。");
  if (next.locked || clip.locked) throw new Error("片段已鎖定，請先解除鎖定。");
  const gap = next.startSeconds - clipEnd;
  if (gap > 0.25) throw new Error("兩個片段距離超過 250 ms，請先移近再建立交叉淡化。");
  const crossfadeSeconds = clamp(requestedSeconds, 0.005, 0.2);
  const groupId = randomUUID();
  const nextDuration = next.durationSeconds ?? Math.max(0.02, (next.audioFile.durationSeconds ?? 0.1) - next.offsetSeconds);
  const requestedHeadExtension = gap > 0 ? gap + crossfadeSeconds : 0;
  if (requestedHeadExtension > next.offsetSeconds + 0.0001) {
    throw new Error("右側片段前方沒有足夠原始素材可跨越空隙；請先移近片段再建立交叉淡化。");
  }
  const nextPatch = gap > 0
    ? {
        startSeconds: Math.max(0, next.startSeconds - requestedHeadExtension),
        offsetSeconds: Math.max(0, next.offsetSeconds - requestedHeadExtension),
        durationSeconds: nextDuration + requestedHeadExtension,
        fadeInSeconds: crossfadeSeconds,
        crossfadeGroupId: groupId
      }
    : { fadeInSeconds: Math.min(crossfadeSeconds, Math.max(0.005, -gap)), crossfadeGroupId: groupId };
  await prisma.$transaction(async (tx) => {
    const updatedClip = await tx.dawClip.update({ where: { id: clip.id }, data: { fadeOutSeconds: crossfadeSeconds, crossfadeGroupId: groupId } });
    const updatedNext = await tx.dawClip.update({ where: { id: next.id }, data: nextPatch });
    await recordDawEditOperation(tx, {
      projectId: clip.track.projectId,
      groupId,
      operationType: "crossfade",
      entityType: "clip",
      entityId: clip.id,
      label: "建立自動交叉淡化",
      before: clip,
      after: updatedClip
    });
    await recordDawEditOperation(tx, {
      projectId: clip.track.projectId,
      groupId,
      operationType: "crossfade",
      entityType: "clip",
      entityId: next.id,
      label: "建立自動交叉淡化",
      before: next,
      after: updatedNext
    });
  });
  return { projectId: clip.track.projectId, groupId, crossfadeSeconds };
}

export async function groupDawClips(projectId: string, clipIds: string[]) {
  const clips = await prisma.dawClip.findMany({ where: { id: { in: clipIds }, track: { projectId } } });
  if (clips.length !== clipIds.length || clips.length < 2) throw new Error("請至少選擇兩個屬於同一專案的片段。");
  const groupId = randomUUID();
  await prisma.$transaction(async (tx) => {
    for (const clip of clips) {
      const updated = await tx.dawClip.update({ where: { id: clip.id }, data: { groupId } });
      await recordDawEditOperation(tx, {
        projectId,
        groupId,
        operationType: "group",
        entityType: "clip",
        entityId: clip.id,
        label: `群組 ${clips.length} 個片段`,
        before: clip,
        after: updated
      });
    }
  });
  return { groupId, project: await getDawProjectById(projectId) };
}
