import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { getEffectiveStudioSettings } from "@/lib/daw-dsp";
import { clampDawInputGain, clampDawTrackGain, dawClipEnvelope, dawStereoPanMatrix } from "@/lib/daw-mix-contract";
import { dawOfflineExecutable, renderDawOfflineMix, DAW_OFFLINE_MAX_PCM_BYTES, DAW_OFFLINE_TIMEOUT_MS } from "@/lib/daw-offline-render";
import { acquireLocalOperationLock } from "@/lib/local-operation-lock";
import { assertDawRenderSupported } from "@/lib/daw-render-support";
import { constants, createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import type { Prisma } from "@prisma/client";

import { appPath, relativeToAppRoot, resolveStoredFilePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";
const ffprobePath = "/opt/homebrew/bin/ffprobe";

export const dawProjectInclude = {
  song: {
    select: {
      id: true,
      title: true,
      status: true,
      bpm: true,
      musicalKey: true,
      genre: true,
      summary: true
    }
  },
  tracks: {
    include: {
      clips: {
        include: {
          audioFile: {
            include: {
              qualityReports: { orderBy: { createdAt: "desc" }, take: 1 },
              comments: { orderBy: { timestampSeconds: "asc" }, take: 12 }
            }
          }
        },
        orderBy: [{ startSeconds: "asc" }, { createdAt: "asc" }]
      },
      takeLanes: {
        include: {
          compSegments: { orderBy: [{ sortOrder: "asc" }, { timelineStartSeconds: "asc" }] },
          recordingTake: {
            include: {
              audioFile: true,
              reports: {
                include: {
                  issues: { orderBy: { timestampSeconds: "asc" } }
                },
                orderBy: { createdAt: "desc" },
                take: 2
              }
            }
          }
        },
        orderBy: [{ laneOrder: "asc" }, { createdAt: "asc" }]
      },
      automationLanes: {
        include: { points: { orderBy: { timeSeconds: "asc" } } },
        orderBy: [{ parameter: "asc" }, { createdAt: "asc" }]
      }
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  },
  markers: { orderBy: [{ timestampSeconds: "asc" }, { createdAt: "asc" }] },
  mixSnapshots: { orderBy: { createdAt: "desc" }, take: 12 },
  latencyProfiles: { orderBy: { updatedAt: "desc" }, take: 12 },
  healthSnapshots: { orderBy: { createdAt: "desc" }, take: 40 },
  editOperations: { orderBy: { sequence: "desc" }, take: 100 },
  routes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  recoveryEntries: { orderBy: [{ createdAt: "desc" }, { sequence: "desc" }], take: 80 },
  scoreDrafts: {
    include: {
      sourceAudioFile: {
        select: { id: true, fileName: true, versionName: true, fileType: true, sha256: true }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 24
  }
} satisfies Prisma.DawProjectInclude;

export type DawProjectRecord = Prisma.DawProjectGetPayload<{ include: typeof dawProjectInclude }>;
export type DawProjectDto = ReturnType<typeof toDawProjectDto>;

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "songzu-daw"
  );
}

async function executable(path: string) {
  try {
    await stat(path);
    return path;
  } catch {
    return basename(path);
  }
}

function trackTypeFromAudioFile(fileType: string) {
  const map: Record<string, string> = {
    vocal_stem: "vocal",
    bass_stem: "bass",
    instrumental_stem: "audio",
    drum_stem: "audio",
    demo: "reference",
    mix: "reference",
    master: "reference"
  };
  return map[fileType] ?? "audio";
}

function colorForTrack(index: number, fileType?: string) {
  if (fileType === "master") return "#2563eb";
  if (fileType === "mix") return "#7c3aed";
  if (fileType === "demo") return "#d97706";
  const colors = ["#20816f", "#0f766e", "#b45309", "#be123c", "#475569", "#4338ca"];
  return colors[index % colors.length];
}

function fileAvailable(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    return existsSync(resolveStoredFilePath(filePath));
  } catch {
    return false;
  }
}

export function dawExportFolder(songId: string) {
  return appPath("exports", songId, "daw");
}

export function dawExportPath(songId: string, fileName: string) {
  return join(dawExportFolder(songId), basename(fileName));
}

export function toDawProjectDto(project: DawProjectRecord) {
  const durationSeconds = Math.max(
    0,
    ...project.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startSeconds + (clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 0))
    )
  );
  const issueCount = project.tracks.reduce(
    (total, track) =>
      total +
      track.takeLanes.reduce(
        (laneTotal, lane) =>
          laneTotal + lane.recordingTake.reports.reduce((reportTotal, report) => reportTotal + report.issues.length, 0),
        0
      ),
    0
  );

  return {
    id: project.id,
    songId: project.songId,
    title: project.title,
    bpm: project.bpm,
    musicalKey: project.musicalKey,
    sampleRate: project.sampleRate,
    bitDepth: project.bitDepth,
    timeSignature: project.timeSignature,
    status: project.status,
    engineMode: project.engineMode,
    projectMeta: parseJsonValue<Record<string, unknown>>(project.projectJson, {}),
    durationSeconds,
    issueCount,
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
    song: project.song,
    tracks: project.tracks.map((track) => ({
      id: track.id,
      projectId: track.projectId,
      name: track.name,
      trackType: track.trackType,
      sortOrder: track.sortOrder,
      muted: track.muted,
      solo: track.solo,
      armed: track.armed,
      monitoring: track.monitoring,
      volume: track.volume,
      pan: track.pan,
      color: track.color,
      inputSource: track.inputSource,
      outputTarget: track.outputTarget,
      polarityInverted: track.polarityInverted,
      stereoMode: track.stereoMode,
      effects: parseJsonValue<Array<Record<string, unknown>>>(track.effectsJson, []),
      createdAt: toIso(track.createdAt),
      updatedAt: toIso(track.updatedAt),
      clips: track.clips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        audioFileId: clip.audioFileId,
        startSeconds: clip.startSeconds,
        offsetSeconds: clip.offsetSeconds,
        durationSeconds: clip.durationSeconds,
        gain: clip.gain,
        fadeInSeconds: clip.fadeInSeconds,
        fadeOutSeconds: clip.fadeOutSeconds,
        locked: clip.locked,
        label: clip.label,
        color: clip.color,
        groupId: clip.groupId,
        zeroCrossingAdjusted: clip.zeroCrossingAdjusted,
        crossfadeGroupId: clip.crossfadeGroupId,
        createdAt: toIso(clip.createdAt),
        updatedAt: toIso(clip.updatedAt),
        audioFile: {
          id: clip.audioFile.id,
          fileName: clip.audioFile.fileName,
          filePath: clip.audioFile.filePath,
          fileAvailable: fileAvailable(clip.audioFile.filePath),
          storageProvider: clip.audioFile.storageProvider,
          fileType: clip.audioFile.fileType,
          versionName: clip.audioFile.versionName,
          fileSizeBytes: clip.audioFile.fileSizeBytes,
          sha256: clip.audioFile.sha256,
          sourceKind: clip.audioFile.sourceKind,
          qualityStatus: clip.audioFile.qualityStatus,
          isProtectedOriginal: clip.audioFile.isProtectedOriginal,
          durationSeconds: clip.audioFile.durationSeconds,
          sampleRate: clip.audioFile.sampleRate,
          bitDepth: clip.audioFile.bitDepth,
          lufs: clip.audioFile.lufs,
          truePeak: clip.audioFile.truePeak,
          archivedAt: toIso(clip.audioFile.archivedAt),
          qualityReport: clip.audioFile.qualityReports[0]
            ? {
                id: clip.audioFile.qualityReports[0].id,
                verdict: clip.audioFile.qualityReports[0].verdict,
                integratedLufs: clip.audioFile.qualityReports[0].integratedLufs,
                truePeak: clip.audioFile.qualityReports[0].truePeak,
                clippingRisk: clip.audioFile.qualityReports[0].clippingRisk,
                warnings: parseJsonValue<string[]>(clip.audioFile.qualityReports[0].warningsJson, []),
                createdAt: toIso(clip.audioFile.qualityReports[0].createdAt)
              }
            : null,
          commentCount: clip.audioFile.comments.length
        }
      })),
      takeLanes: track.takeLanes.map((lane) => ({
        id: lane.id,
        trackId: lane.trackId,
        recordingTakeId: lane.recordingTakeId,
        laneOrder: lane.laneOrder,
        compStatus: lane.compStatus,
        selectedRange: parseJsonValue<Record<string, unknown> | null>(lane.selectedRangeJson, null),
        compSegments: lane.compSegments.map((segment) => ({
          id: segment.id,
          sourceStartSeconds: segment.sourceStartSeconds,
          sourceEndSeconds: segment.sourceEndSeconds,
          timelineStartSeconds: segment.timelineStartSeconds,
          fadeInSeconds: segment.fadeInSeconds,
          fadeOutSeconds: segment.fadeOutSeconds,
          sortOrder: segment.sortOrder,
          active: segment.active,
          createdAt: toIso(segment.createdAt),
          updatedAt: toIso(segment.updatedAt)
        })),
        notes: lane.notes,
        createdAt: toIso(lane.createdAt),
        updatedAt: toIso(lane.updatedAt),
        recordingTake: {
          id: lane.recordingTake.id,
          label: lane.recordingTake.label,
          takeNumber: lane.recordingTake.takeNumber,
          status: lane.recordingTake.status,
          recordedAt: toIso(lane.recordingTake.recordedAt),
          audioFile: lane.recordingTake.audioFile
              ? {
                id: lane.recordingTake.audioFile.id,
                fileName: lane.recordingTake.audioFile.fileName,
                filePath: lane.recordingTake.audioFile.filePath,
                fileAvailable: fileAvailable(lane.recordingTake.audioFile.filePath),
                storageProvider: lane.recordingTake.audioFile.storageProvider,
                fileType: lane.recordingTake.audioFile.fileType,
                versionName: lane.recordingTake.audioFile.versionName,
                durationSeconds: lane.recordingTake.audioFile.durationSeconds,
                qualityStatus: lane.recordingTake.audioFile.qualityStatus
              }
            : null,
          reports: lane.recordingTake.reports.map((report) => ({
            id: report.id,
            overallScore: report.overallScore,
            timingScore: report.timingScore,
            pitchScore: report.pitchScore,
            levelScore: report.levelScore,
            metrics: parseJsonValue<Record<string, unknown>>(report.metricsJson, {}),
            peak: report.peak,
            rms: report.rms,
            summary: report.summary,
            createdAt: toIso(report.createdAt),
            issues: report.issues.map((issue) => ({
              id: issue.id,
              timestampSeconds: issue.timestampSeconds,
              issueType: issue.issueType,
              severity: issue.severity,
              title: issue.title,
              detail: issue.detail,
              suggestion: issue.suggestion
            }))
          }))
        }
      })),
      automationLanes: track.automationLanes.map((lane) => ({
        id: lane.id,
        parameter: lane.parameter,
        mode: lane.mode,
        enabled: lane.enabled,
        minValue: lane.minValue,
        maxValue: lane.maxValue,
        createdAt: toIso(lane.createdAt),
        updatedAt: toIso(lane.updatedAt),
        points: lane.points.map((point) => ({
          id: point.id,
          timeSeconds: point.timeSeconds,
          value: point.value,
          curve: point.curve,
          createdAt: toIso(point.createdAt),
          updatedAt: toIso(point.updatedAt)
        }))
      }))
    })),
    markers: project.markers.map((marker) => ({
      id: marker.id,
      projectId: marker.projectId,
      markerType: marker.markerType,
      label: marker.label,
      timestampSeconds: marker.timestampSeconds,
      color: marker.color,
      relatedModel: marker.relatedModel,
      relatedId: marker.relatedId,
      notes: marker.notes,
      createdAt: toIso(marker.createdAt),
      updatedAt: toIso(marker.updatedAt)
    })),
    mixSnapshots: project.mixSnapshots.map((snapshot) => ({
      id: snapshot.id,
      projectId: snapshot.projectId,
      title: snapshot.title,
      snapshot: parseJsonValue<Record<string, unknown>>(snapshot.snapshotJson, {}),
      createdAt: toIso(snapshot.createdAt)
    })),
    latencyProfiles: project.latencyProfiles.map((profile) => ({
      id: profile.id,
      inputDeviceName: profile.inputDeviceName,
      outputDeviceName: profile.outputDeviceName,
      sampleRate: profile.sampleRate,
      bufferFrames: profile.bufferFrames,
      measuredRoundTripMs: profile.measuredRoundTripMs,
      inputLatencyMs: profile.inputLatencyMs,
      outputLatencyMs: profile.outputLatencyMs,
      compensationMs: profile.compensationMs,
      method: profile.method,
      confidence: profile.confidence,
      isActive: profile.isActive,
      measurement: parseJsonValue<Record<string, unknown>>(profile.measurementJson, {}),
      createdAt: toIso(profile.createdAt),
      updatedAt: toIso(profile.updatedAt)
    })),
    healthSnapshots: project.healthSnapshots.map((snapshot) => ({
      id: snapshot.id,
      recordingId: snapshot.recordingId,
      status: snapshot.status,
      peak: snapshot.peak,
      rms: snapshot.rms,
      truePeak: snapshot.truePeak,
      clipping: snapshot.clipping,
      xrunCount: snapshot.xrunCount,
      inputOverflowCount: snapshot.inputOverflowCount,
      outputUnderflowCount: snapshot.outputUnderflowCount,
      diskWriteErrorCount: snapshot.diskWriteErrorCount,
      callbackLoad: snapshot.callbackLoad,
      freeDiskBytes: snapshot.freeDiskBytes?.toString() ?? null,
      details: parseJsonValue<Record<string, unknown>>(snapshot.detailsJson, {}),
      createdAt: toIso(snapshot.createdAt)
    })),
    editOperations: project.editOperations.map((operation) => ({
      id: operation.id,
      sequence: operation.sequence,
      groupId: operation.groupId,
      operationType: operation.operationType,
      entityType: operation.entityType,
      entityId: operation.entityId,
      label: operation.label,
      status: operation.status,
      createdAt: toIso(operation.createdAt),
      undoneAt: toIso(operation.undoneAt)
    })),
    routes: project.routes.map((route) => ({
      id: route.id,
      sourceTrackId: route.sourceTrackId,
      destinationTrackId: route.destinationTrackId,
      routeType: route.routeType,
      name: route.name,
      preFader: route.preFader,
      gain: route.gain,
      pan: route.pan,
      muted: route.muted,
      sortOrder: route.sortOrder,
      createdAt: toIso(route.createdAt),
      updatedAt: toIso(route.updatedAt)
    })),
    recoveryEntries: project.recoveryEntries.map((entry) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      sequence: entry.sequence,
      eventType: entry.eventType,
      payload: parseJsonValue<Record<string, unknown>>(entry.payloadJson, {}),
      status: entry.status,
      createdAt: toIso(entry.createdAt),
      resolvedAt: toIso(entry.resolvedAt)
    })),
    scoreDrafts: project.scoreDrafts.map((draft) => ({
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
      createdAt: toIso(draft.createdAt),
      updatedAt: toIso(draft.updatedAt)
    }))
  };
}

export async function getDawProjectById(id: string) {
  return prisma.dawProject.findUnique({
    where: { id },
    include: dawProjectInclude
  });
}

export async function getSongDawProject(songId: string) {
  return prisma.dawProject.findFirst({
    where: { songId },
    include: dawProjectInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getOrCreateDawProject(songId: string) {
  const existing = await getSongDawProject(songId);
  if (existing) return existing;

  const song = await prisma.song.findUnique({
    where: { id: songId },
    include: {
      audioFiles: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
      recordingTakes: { where: { audioFileId: { not: null } }, orderBy: { recordedAt: "asc" } }
    }
  });

  if (!song) return null;

  const project = await prisma.dawProject.create({
    data: {
      songId,
      title: `${song.title} .songzu-project`,
      bpm: song.bpm,
      musicalKey: song.musicalKey,
      sampleRate: 48000,
      bitDepth: 24,
      timeSignature: "4/4",
      status: song.audioFiles.length ? "READY_TO_EDIT" : "NEEDS_AUDIO",
      engineMode: "web_fallback",
      projectJson: JSON.stringify({
        format: "songzu-project",
        version: 2,
        protectedOriginals: true,
        destructiveEditing: false,
        crashRecovery: true,
        professionalMetering: true
      })
    }
  });

  const trackByAudioFileId = new Map<string, string>();
  for (const [index, audioFile] of song.audioFiles.entries()) {
    const track = await prisma.dawTrack.create({
      data: {
        projectId: project.id,
        name: audioFile.versionName ?? audioFile.fileName,
        trackType: trackTypeFromAudioFile(audioFile.fileType),
        sortOrder: index + 1,
        volume: audioFile.fileType === "master" ? 0.8 : 1,
        pan: 0,
        color: colorForTrack(index, audioFile.fileType)
      }
    });
    trackByAudioFileId.set(audioFile.id, track.id);

    await prisma.dawClip.create({
      data: {
        trackId: track.id,
        audioFileId: audioFile.id,
        startSeconds: 0,
        offsetSeconds: 0,
        durationSeconds: audioFile.durationSeconds,
        gain: 1,
        label: audioFile.versionName ?? audioFile.fileName,
        color: colorForTrack(index, audioFile.fileType)
      }
    });
  }

  let takeTrackId: string | null = null;
  for (const [index, take] of song.recordingTakes.entries()) {
    const trackId = take.audioFileId ? trackByAudioFileId.get(take.audioFileId) : null;
    if (!trackId && !takeTrackId) {
      const track = await prisma.dawTrack.create({
        data: {
          projectId: project.id,
          name: "錄音 Takes",
          trackType: "vocal",
          sortOrder: song.audioFiles.length + 1,
          color: "#be123c"
        }
      });
      takeTrackId = track.id;
    }

    await prisma.dawTakeLane.create({
      data: {
        trackId: trackId ?? takeTrackId!,
        recordingTakeId: take.id,
        laneOrder: index + 1,
        compStatus: "candidate"
      }
    });
  }

  await prisma.timelineEvent.create({
    data: {
      songId,
      eventType: "daw_project_created",
      title: "建立 DAW Core 專案",
      description: "從既有音檔與錄音 take 產生非破壞性 .songzu-project。",
      relatedModel: "DawProject",
      relatedId: project.id
    }
  });

  return getDawProjectById(project.id);
}

export function buildDawProjectManifest(project: DawProjectRecord) {
  return {
    format: "songzu-project",
    version: 2,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      songId: project.songId,
      songTitle: project.song.title,
      bpm: project.bpm,
      musicalKey: project.musicalKey,
      sampleRate: project.sampleRate,
      bitDepth: project.bitDepth,
      timeSignature: project.timeSignature,
      status: project.status,
      engineMode: project.engineMode
    },
    tracks: project.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      trackType: track.trackType,
      sortOrder: track.sortOrder,
      muted: track.muted,
      solo: track.solo,
      volume: track.volume,
      pan: track.pan,
      color: track.color,
      inputSource: track.inputSource,
      outputTarget: track.outputTarget,
      polarityInverted: track.polarityInverted,
      stereoMode: track.stereoMode,
      effects: parseJsonValue<Array<Record<string, unknown>>>(track.effectsJson, []),
      clips: track.clips.map((clip) => ({
        id: clip.id,
        startSeconds: clip.startSeconds,
        offsetSeconds: clip.offsetSeconds,
        durationSeconds: clip.durationSeconds,
        gain: clip.gain,
        fadeInSeconds: clip.fadeInSeconds,
        fadeOutSeconds: clip.fadeOutSeconds,
        locked: clip.locked,
        label: clip.label,
        groupId: clip.groupId,
        zeroCrossingAdjusted: clip.zeroCrossingAdjusted,
        crossfadeGroupId: clip.crossfadeGroupId,
        audio: {
          audioFileId: clip.audioFile.id,
          fileName: clip.audioFile.fileName,
          sha256: clip.audioFile.sha256,
          protectedOriginal: clip.audioFile.isProtectedOriginal,
          relativePath: clip.audioFile.filePath ? relativeToAppRoot(clip.audioFile.filePath) : null,
          storageProvider: clip.audioFile.storageProvider,
          sourceKind: clip.audioFile.sourceKind,
          qualityStatus: clip.audioFile.qualityStatus
        }
      })),
      takeLanes: track.takeLanes.map((lane) => ({
        id: lane.id,
        recordingTakeId: lane.recordingTakeId,
        laneOrder: lane.laneOrder,
        compStatus: lane.compStatus,
        selectedRange: parseJsonValue<Record<string, unknown> | null>(lane.selectedRangeJson, null),
        compSegments: lane.compSegments.map((segment) => ({
          id: segment.id,
          sourceStartSeconds: segment.sourceStartSeconds,
          sourceEndSeconds: segment.sourceEndSeconds,
          timelineStartSeconds: segment.timelineStartSeconds,
          fadeInSeconds: segment.fadeInSeconds,
          fadeOutSeconds: segment.fadeOutSeconds,
          active: segment.active
        }))
      })),
      automation: track.automationLanes.map((lane) => ({
        parameter: lane.parameter,
        mode: lane.mode,
        enabled: lane.enabled,
        minValue: lane.minValue,
        maxValue: lane.maxValue,
        points: lane.points.map((point) => ({ timeSeconds: point.timeSeconds, value: point.value, curve: point.curve }))
      }))
    })),
    routes: project.routes.map((route) => ({
      id: route.id,
      sourceTrackId: route.sourceTrackId,
      destinationTrackId: route.destinationTrackId,
      routeType: route.routeType,
      name: route.name,
      preFader: route.preFader,
      gain: route.gain,
      pan: route.pan,
      muted: route.muted
    })),
    markers: project.markers.map((marker) => ({
      id: marker.id,
      markerType: marker.markerType,
      label: marker.label,
      timestampSeconds: marker.timestampSeconds,
      relatedModel: marker.relatedModel,
      relatedId: marker.relatedId,
      notes: marker.notes
    })),
    scoreDrafts: project.scoreDrafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      targetInstrument: draft.targetInstrument,
      analyzer: draft.analyzer,
      status: draft.status,
      confidence: draft.confidence,
      bpm: draft.bpm,
      musicalKey: draft.musicalKey,
      timeSignature: draft.timeSignature,
      durationSeconds: draft.durationSeconds,
      sourceAudioFile: draft.sourceAudioFile,
      result: parseJsonValue<Record<string, unknown>>(draft.resultJson, {})
    })),
    openCoreBoundary: {
      public: ["DAW Core code", ".songzu-project format", "SDK/API contracts"],
      private: ["your database", "your audio files", "your AI rules", "your personal theory", "your sound assets"]
    }
  };
}

function safeFilterNumber(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function renderStudioSettings(track: DawProjectRecord["tracks"][number]) {
  return getEffectiveStudioSettings(parseJsonValue<Array<Record<string, unknown>>>(track.effectsJson, []));
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

type RenderableClip = {
  track: DawProjectRecord["tracks"][number];
  clip: DawProjectRecord["tracks"][number]["clips"][number];
  filePath: string;
};

function renderableClips(project: DawProjectRecord): RenderableClip[] {
  const soloTracks = project.tracks.filter((track) => track.solo);
  const activeTracks = (soloTracks.length ? soloTracks : project.tracks).filter((track) => !track.muted);
  return activeTracks.flatMap((track) =>
    track.clips.flatMap((clip) => {
      const filePath = clip.audioFile.filePath;
      try {
        if (!filePath || clip.audioFile.archivedAt) throw new Error("unavailable source");
        const resolvedFilePath = resolveStoredFilePath(filePath);
        if (!statSync(resolvedFilePath).isFile()) throw new Error("not an audio file");
        return [{ track, clip, filePath: resolvedFilePath }];
      } catch {
        throw new Error(`音軌「${track.name}」的片段「${clip.label || clip.id}」缺少可讀取的原始音檔，已停止匯出，避免交付缺件混音。請先重新連結音檔，或確認不需要後將音軌靜音。`);
      }
    })
  );
}

type RenderSourceInfo = { channels: number; durationSeconds: number | null };

async function probeRenderSources(clips: RenderableClip[]) {
  const ffprobe = await executable(ffprobePath);
  const paths = Array.from(new Set(clips.map(item => item.filePath)));
  const sourcesByPath = new Map<string, RenderSourceInfo>();
  let nextPath = 0;
  let failure: Error | undefined;
  // Bound process concurrency and probe each distinct source once per render.
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
    while (!failure && nextPath < paths.length) {
      const filePath = paths[nextPath++]!;
      try {
        const { stdout } = await execFileAsync(ffprobe, [
          "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,duration,duration_ts,time_base", "-of", "json", filePath
        ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
        const result = JSON.parse(stdout) as { streams?: Array<{
          channels?: number; duration?: string; duration_ts?: number; time_base?: string;
        }> };
        const stream = result.streams?.[0];
        const channels = stream?.channels;
        if (!Number.isInteger(channels) || !channels || channels < 1) throw new Error("Missing audio channel count");
        const timeBase = stream?.time_base?.split("/").map(Number);
        const timestampDuration = timeBase?.length === 2 && timeBase[0]! > 0 && timeBase[1]! > 0
          ? Number(stream?.duration_ts) * timeBase[0]! / timeBase[1]!
          : Number.NaN;
        const decimalDuration = Number(stream?.duration);
        // Use this audio stream, never container duration (video may be longer).
        // Timestamp/time-base keeps PCM sample accuracy. Compressed stream
        // durations may include encoder padding and are only a metadata fallback.
        const durationSeconds = Number.isFinite(timestampDuration) && timestampDuration > 0 ? timestampDuration
          : Number.isFinite(decimalDuration) && decimalDuration > 0 ? decimalDuration : null;
        sourcesByPath.set(filePath, { channels, durationSeconds });
      } catch {
        failure ??= new Error(`無法確認音檔「${basename(filePath)}」的實際聲道數，已停止匯出，避免錯誤的單聲道增益。請先確認原始音檔可讀取且包含音訊。`);
      }
    }
  }));
  if (failure) throw failure;
  return sourcesByPath;
}

function buildFilterForClip(item: RenderableClip, inputIndex: number, sampleRate: number, sourceChannels: number, probedDuration: number | null = null) {
  const offset = Math.max(0, safeFilterNumber(item.clip.offsetSeconds, 0));
  const explicitDuration = item.clip.durationSeconds;
  if (explicitDuration != null && (!Number.isFinite(explicitDuration) || explicitDuration <= 0)) {
    throw new Error(`片段「${item.clip.label || item.clip.id}」的長度無效，已停止匯出；請修正片段長度，避免將零長片段誤匯出為整首音檔。`);
  }
  const metadataDuration = safeFilterNumber(item.clip.audioFile.durationSeconds, 0);
  const fileDuration = metadataDuration > 0 ? metadataDuration
    : probedDuration != null && Number.isFinite(probedDuration) && probedDuration > 0 ? probedDuration : null;
  const sourceDuration = explicitDuration ?? (fileDuration == null ? null : Math.max(0, fileDuration - offset));
  if (sourceDuration === 0) throw new Error(`片段「${item.clip.label || item.clip.id}」超出音檔長度，已停止匯出；請修正片段起點。`);
  if (sourceDuration == null && safeFilterNumber(item.clip.fadeOutSeconds, 0) > 0) {
    throw new Error(`無法確認片段「${item.clip.label || item.clip.id}」的音訊長度，已停止匯出，避免遺漏淡出。請先設定片段長度。`);
  }
  const duration = sourceDuration ? `:duration=${sourceDuration.toFixed(9)}` : "";
  const delaySamples = Math.max(0, Math.round(safeFilterNumber(item.clip.startSeconds, 0) * sampleRate));
  const envelope = dawClipEnvelope(item.clip, sourceDuration ?? 0, sampleRate);
  const fadeInFrames = sourceDuration ? envelope.fadeInFrames
    : Math.max(0, Math.round(safeFilterNumber(item.clip.fadeInSeconds, 0) * sampleRate));
  const filters = [
    `atrim=start=${offset.toFixed(9)}${duration}`,
    "asetpts=PTS-STARTPTS",
    `aresample=${sampleRate}`,
    // Web's channel graph duplicates mono at unity before its stereo panner.
    // FFmpeg's default mono→stereo rematrix is -3 dB; do not use it here.
    ...(sourceChannels === 1 ? ["pan=stereo|c0=c0|c1=c0"] : []),
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    `volume=${envelope.gain.toFixed(12)}`
  ];
  if (fadeInFrames > 0) filters.push(`afade=t=in:ss=0:ns=${fadeInFrames}`);
  if (envelope.fadeOutFrames > 0) filters.push(`afade=t=out:ss=${envelope.durationFrames - envelope.fadeOutFrames}:ns=${envelope.fadeOutFrames}`);
  filters.push(`adelay=delays=${delaySamples}S:all=1`);
  return `[${inputIndex}:a]${filters.join(",")}[clip${inputIndex}]`;
}

function trackMixerFilters(track: DawProjectRecord["tracks"][number]) {
  const pan = dawStereoPanMatrix(track.pan);
  return [
    `volume=${clampDawTrackGain(track.volume).toFixed(12)}`,
    `pan=stereo|c0=${pan.ll.toFixed(12)}*c0+${pan.lr.toFixed(12)}*c1|c1=${pan.rl.toFixed(12)}*c0+${pan.rr.toFixed(12)}*c1`
  ].join(",");
}

function buildTrackEffectFilters(track: DawProjectRecord["tracks"][number], inputLabel: string, outputLabel: string) {
  const settings = renderStudioSettings(track);
  if (!settings.effectsBypassed) throw new Error("Processed tracks require the shared offline audio engine");
  return [`${inputLabel}volume=${clampDawInputGain(settings.inputGain).toFixed(12)},${trackMixerFilters(track)}${outputLabel}`];
}

async function renderProcessedTracksToWav(
  project: DawProjectRecord, inputs: string[], clipFilters: string[],
  groups: Array<Array<{ item: RenderableClip; inputIndex: number }>>,
  outputPath: string, masterLimiter: boolean, sourcesByPath: Map<string, RenderSourceInfo>
) {
  await dawOfflineExecutable();
  const release = acquireLocalOperationLock("daw-processed-export");
  if (!release) throw new Error("另一份高精度效果匯出正在進行，請待完成後再試。");
  let staging: string | undefined;
  try {
    staging = await mkdtemp(join(dirname(outputPath), ".render-"));
    const ffmpeg = await executable(ffmpegPath);
    const deadline = Date.now() + 10 * 60_000;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error("效果匯出超過總時間限制，未發布音檔。");
      return ms;
    };
    const run = (args: string[]) => execFileAsync(ffmpeg, ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", ...args],
      { maxBuffer: 16 * 1024 * 1024, timeout: remaining() });
    const rawPaths = groups.map((_, i) => join(staging!, `raw-${i}.f32`));
    const filters = [...clipFilters];
    for (const [i, group] of groups.entries()) {
      const labels = group.map(item => `[clip${item.inputIndex}]`).join("");
      filters.push(`${labels}${group.length === 1 ? "anull" : `amix=inputs=${group.length}:normalize=0:dropout_transition=0`}[raw${i}]`);
    }
    await run([...inputs, "-filter_complex", filters.join(";"), ...rawPaths.flatMap((path, i) =>
      ["-map", `[raw${i}]`, "-ar", String(project.sampleRate), "-ac", "2", "-c:a", "pcm_f32le", "-f", "f32le", path])]);
    const sizes = await Promise.all(rawPaths.map(async path => (await stat(path)).size));
    const bytes = Math.max(...sizes);
    if (!bytes || sizes.some(size => size % 8) || bytes > DAW_OFFLINE_MAX_PCM_BYTES) {
      throw new Error("此音訊超過高精度離線處理範圍或 PCM 長度無效，已停止匯出；不會截短音訊。");
    }
    const frames = bytes / 8;
    const pcmInput = (path: string) => ["-f", "f32le", "-ar", String(project.sampleRate), "-ac", "2", "-i", path];
    const finalPcm = join(staging, "mix.f32");
    const tracks = groups.map((group, index) => {
      const track = group[0]!.item.track;
      const rawFrames = sizes[index]! / 8;
      const ranges = group.map(({ item }) => {
        const start = Math.max(0, Math.round(safeFilterNumber(item.clip.startSeconds, 0) * project.sampleRate));
        const metadata = safeFilterNumber(item.clip.audioFile.durationSeconds, 0);
        const duration = item.clip.durationSeconds ?? Math.max(0,
          (metadata > 0 ? metadata : sourcesByPath.get(item.filePath)?.durationSeconds ?? rawFrames / project.sampleRate)
          - Math.max(0, safeFilterNumber(item.clip.offsetSeconds, 0)));
        return { start, end: Math.min(rawFrames, start + Math.round(duration * project.sampleRate)) };
      }).filter(range => range.end > range.start);
      return { path: rawPaths[index]!, settings: renderStudioSettings(track), volume: track.volume, pan: track.pan, ranges };
    });
    // Keep all channels and the master in ONE graph, with original source
    // activity windows. Rendering padded tracks independently loses tail state.
    await renderDawOfflineMix(tracks, finalPcm, project.sampleRate, {
      frames, master: masterLimiter, rejectClipping: true, timeoutMs: Math.min(DAW_OFFLINE_TIMEOUT_MS, remaining())
    });
    const pending = join(staging, "audio.wav");
    await run([...pcmInput(finalPcm), "-c:a", project.bitDepth >= 24 ? "pcm_s24le" : "pcm_s16le", pending]);
    await rename(pending, outputPath);
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { release(); }
  }
}

async function renderClipsToWav(
  project: DawProjectRecord,
  clips: RenderableClip[],
  outputPath: string,
  options: { masterLimiter?: boolean } = {}
) {
  const ffmpeg = await executable(ffmpegPath);
  const inputs = clips.flatMap((item) => ["-i", item.filePath]);
  const sourcesByPath = await probeRenderSources(clips);
  const filters = clips.map((item, index) => {
    const source = sourcesByPath.get(item.filePath)!;
    return buildFilterForClip(item, index, project.sampleRate, source.channels, source.durationSeconds);
  });
  const groupedTracks = new Map<string, Array<{ item: RenderableClip; inputIndex: number }>>();
  clips.forEach((item, inputIndex) => {
    const current = groupedTracks.get(item.track.id) ?? [];
    current.push({ item, inputIndex });
    groupedTracks.set(item.track.id, current);
  });
  if (Array.from(groupedTracks.values()).some(items => !renderStudioSettings(items[0]!.item.track).effectsBypassed)) {
    return renderProcessedTracksToWav(project, inputs, filters, Array.from(groupedTracks.values()), outputPath, options.masterLimiter !== false, sourcesByPath);
  }
  const trackLabels: string[] = [];
  Array.from(groupedTracks.values()).forEach((items, trackIndex) => {
    const rawLabel = `trackRaw${trackIndex}`;
    if (items.length === 1) {
      filters.push(`[clip${items[0]!.inputIndex}]anull[${rawLabel}]`);
    } else {
      filters.push(
        `${items.map(({ inputIndex }) => `[clip${inputIndex}]`).join("")}amix=inputs=${items.length}:normalize=0:dropout_transition=0[${rawLabel}]`
      );
    }
    const outputLabel = `track${trackIndex}`;
    filters.push(...buildTrackEffectFilters(items[0]!.item.track, `[${rawLabel}]`, `[${outputLabel}]`));
    trackLabels.push(outputLabel);
  });
  const preMasterLabel = "preMaster";
  if (trackLabels.length === 1) {
    filters.push(`[${trackLabels[0]}]anull[${preMasterLabel}]`);
  } else {
    filters.push(`${trackLabels.map((label) => `[${label}]`).join("")}amix=inputs=${trackLabels.length}:normalize=0:dropout_transition=0[${preMasterLabel}]`);
  }
  const mapLabel = `[${preMasterLabel}]`;
  const filterComplex = filters.join(";");

  const staging = await mkdtemp(join(dirname(outputPath), ".render-"));
  const pendingPath = join(staging, "audio.wav");
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-y", "-hide_banner", "-loglevel", "error", ...inputs,
        "-filter_complex", filterComplex, "-map", mapLabel,
        "-ar", String(project.sampleRate), "-ac", "2",
        "-c:a", project.bitDepth >= 24 ? "pcm_s24le" : "pcm_s16le", pendingPath
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }
    );
    await rename(pendingPath, outputPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function writeDawProjectManifest(projectId: string) {
  const project = await getDawProjectById(projectId);
  if (!project) {
    throw new Error("DAW project not found");
  }

  const folder = dawExportFolder(project.songId);
  await mkdir(folder, { recursive: true });
  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomUUID().slice(0, 8)}`;
  const fileName = `${slugify(project.song.title)}-${stamp}.songzu-project`;
  const filePath = join(folder, fileName);
  const manifest = buildDawProjectManifest(project);
  await writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
  const fileStat = await stat(filePath);

  await prisma.timelineEvent.create({
    data: {
      songId: project.songId,
      eventType: "daw_project_manifest_exported",
      title: "輸出 .songzu-project manifest",
      description: "已輸出 DAW Core JSON manifest，可用於備份、交接或未來 open-core SDK。",
      relatedModel: "DawProject",
      relatedId: project.id,
      metadataJson: JSON.stringify({ filePath, fileSizeBytes: fileStat.size })
    }
  });

  return {
    fileName,
    filePath,
    fileSizeBytes: fileStat.size,
    downloadUrl: `/api/daw-projects/${project.id}/project-file?file=${encodeURIComponent(fileName)}`
  };
}

export async function exportDawStemsZip(projectId: string) {
  const project = await getDawProjectById(projectId);
  if (!project) {
    throw new Error("DAW project not found");
  }
  assertDawRenderSupported(project);

  const stemTracks = project.tracks.filter(track => !track.muted && track.trackType !== "bus");
  // Validate every requested source before rendering the first stem.
  const clipsByTrack = new Map(stemTracks.map(track => [track.id, renderableClips({ ...project, tracks: [track] })]));
  if (stemTracks.some(track => clipsByTrack.get(track.id)!.length && !renderStudioSettings(track).effectsBypassed)) await dawOfflineExecutable();
  const folder = dawExportFolder(project.songId);
  const stemFolder = join(folder, "stems");
  await mkdir(stemFolder, { recursive: true });
  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomUUID().slice(0, 8)}`;
  const trackOutputs: Array<{
    trackId: string;
    trackName: string;
    fileName: string;
    filePath: string;
    fileSizeBytes: number;
    sha256: string;
    clipCount: number;
  }> = [];

  const generatedPaths: string[] = [];
  try {
    for (const track of stemTracks) {
      const clips = clipsByTrack.get(track.id)!;
      if (!clips.length) continue;

      const fileName = `${String(track.sortOrder).padStart(2, "0")}-${slugify(track.name)}-${slugify(track.id)}-${stamp}.wav`;
      const filePath = join(stemFolder, fileName);
      if (existsSync(filePath)) throw new Error("分軌輸出名稱已存在，已停止以保留舊檔。");
      await renderClipsToWav(project, clips, filePath, { masterLimiter: false });
      generatedPaths.push(filePath);
      const [fileStat, digest] = await Promise.all([stat(filePath), sha256(filePath)]);
      trackOutputs.push({
        trackId: track.id,
        trackName: track.name,
        fileName,
        filePath,
        fileSizeBytes: fileStat.size,
        sha256: digest,
        clipCount: clips.length
      });
    }
  } catch (error) {
    const leftovers: string[] = [];
    for (const path of generatedPaths) {
      try { await rm(path); }
      catch (cleanupError) { if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") leftovers.push(path); }
    }
    if (leftovers.length) throw new Error(`${error instanceof Error ? error.message : String(error)}；未交付分軌清理失敗，殘留：${leftovers.join("、")}`, { cause: error });
    throw error;
  }

  if (!trackOutputs.length) {
    throw new Error("沒有可輸出的 track stems。請先上傳或修復本機音檔。");
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    kind: "songzu-daw-stems",
    project: buildDawProjectManifest(project),
    stems: trackOutputs.map((output) => ({
      trackId: output.trackId,
      trackName: output.trackName,
      fileName: output.fileName,
      fileSizeBytes: output.fileSizeBytes,
      sha256: output.sha256,
      clipCount: output.clipCount
    }))
  };

  const zipFileName = `${slugify(project.song.title)}-daw-stems-${stamp}.zip`;
  const zipPath = join(folder, zipFileName);
  const staging = await mkdtemp(join(folder, ".stems-"));
  try {
    await mkdir(join(staging, "stems"));
    await writeFile(join(staging, "manifest.songzu-project.json"), JSON.stringify(manifest.project, null, 2));
    await writeFile(join(staging, "stems-manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(join(staging, "README.md"), "# Songzu DAW Stems\n\nThese stems were rendered from non-destructive DAW Core metadata. Original audio files were read only and were not overwritten.\n");
    // Stream from disk, with a copy fallback for volumes without hard links.
    for (const output of trackOutputs) {
      const target = join(staging, "stems", output.fileName);
      try { await link(output.filePath, target); }
      catch (error) {
        if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await copyFile(output.filePath, target, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      }
    }
    const pendingZip = join(staging, "archive.zip");
    await execFileAsync("/usr/bin/zip", ["-q", "-0", "-r", pendingZip, "manifest.songzu-project.json", "stems-manifest.json", "README.md", "stems", "-x", "*/._*"], { cwd: staging, timeout: 30 * 60_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
    await execFileAsync("/usr/bin/unzip", ["-tqq", pendingZip], { timeout: 30 * 60_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
    await rename(pendingZip, zipPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const zipStat = await stat(zipPath);

  await prisma.timelineEvent.create({
    data: {
      songId: project.songId,
      eventType: "daw_stems_exported",
      title: "DAW Core 輸出 stems zip",
      description: `${project.title} 已輸出 ${trackOutputs.length} 個 track stem；原始音檔未被覆蓋。`,
      relatedModel: "DawProject",
      relatedId: project.id,
      metadataJson: JSON.stringify({
        zipPath,
        fileSizeBytes: zipStat.size,
        stemCount: trackOutputs.length,
        stems: manifest.stems
      })
    }
  });

  return {
    fileName: zipFileName,
    filePath: zipPath,
    fileSizeBytes: zipStat.size,
    stemCount: trackOutputs.length,
    downloadUrl: `/api/daw-projects/${project.id}/stems?file=${encodeURIComponent(zipFileName)}`,
    stems: manifest.stems
  };
}

export async function renderDawProject(projectId: string) {
  const project = await getDawProjectById(projectId);
  if (!project) {
    throw new Error("DAW project not found");
  }
  assertDawRenderSupported(project);

  const clips = renderableClips(project);
  if (!clips.length) {
    throw new Error("沒有可渲染的本機音檔。請先上傳、匯入或修復音檔路徑。");
  }

  const folder = dawExportFolder(project.songId);
  await mkdir(folder, { recursive: true });

  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomUUID().slice(0, 8)}`;
  const baseName = `${slugify(project.song.title)}-daw-mixdown-${stamp}`;
  const outputPath = join(folder, `${baseName}.wav`);
  const manifestPath = join(folder, `${baseName}.songzu-project.json`);
  const manifest = buildDawProjectManifest(project);
  await renderClipsToWav(project, clips, outputPath);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const [outputStat, digest] = await Promise.all([stat(outputPath), sha256(outputPath)]);

  await prisma.timelineEvent.create({
    data: {
      songId: project.songId,
      eventType: "daw_mixdown_rendered",
      title: "DAW Core 輸出 mixdown",
      description: `${project.title} 已輸出 WAV mixdown，原始音檔未被覆蓋。`,
      relatedModel: "DawProject",
      relatedId: project.id,
      metadataJson: JSON.stringify({
        outputPath,
        manifestPath,
        fileSizeBytes: outputStat.size,
        sha256: digest,
        renderedClipCount: clips.length
      })
    }
  });

  await prisma.dawMixSnapshot.create({
    data: {
      projectId: project.id,
      title: `Render ${stamp}`,
      snapshotJson: JSON.stringify({
        outputPath,
        manifestPath,
        sha256: digest,
        renderedClipCount: clips.length,
        renderedAt: new Date().toISOString()
      })
    }
  });

  return {
    fileName: basename(outputPath),
    filePath: outputPath,
    fileSizeBytes: outputStat.size,
    sha256: digest,
    manifestFileName: basename(manifestPath),
    manifestPath,
    downloadUrl: `/api/daw-projects/${project.id}/render?file=${encodeURIComponent(basename(outputPath))}`,
    manifestDownloadUrl: `/api/daw-projects/${project.id}/render?file=${encodeURIComponent(basename(manifestPath))}`
  };
}
