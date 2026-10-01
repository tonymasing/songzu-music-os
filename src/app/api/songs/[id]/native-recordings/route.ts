import { randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { isLoopbackRequest } from "@/lib/local-request";
import { songInclude, toSongDto } from "@/lib/music";
import { nativeDawRequest } from "@/lib/native-daw";
import { appPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const StartSchema = z.object({
  action: z.literal("start"),
  dawTrackId: z.string().min(1),
  inputDeviceName: z.string().trim().min(1).nullable().optional(),
  outputDeviceName: z.string().trim().min(1).nullable().optional(),
  sampleRate: z.number().int().min(8_000).max(192_000),
  channels: z.union([z.literal(1), z.literal(2)]),
  inputChannelStart: z.number().int().min(0).max(63).default(0),
  bitDepth: z.literal(24).default(24),
  bufferFrames: z.number().int().min(32).max(4_096).default(256),
  monitorRoute: z.enum(["off", "native", "hardware"]).default("off"),
  monitorLevel: z.number().min(0).max(1.5).default(0.8),
  latencyCompensationMs: z.number().min(0).max(500).default(0)
});

const StopSchema = z.object({
  action: z.literal("stop"),
  recordingId: z.string().uuid(),
  dawTrackId: z.string().min(1),
  targetInstrument: z.enum(["vocal", "guitar", "piano", "bass", "drums", "other"]),
  detectionMode: z.string().min(1),
  targetBpm: z.number().int().min(20).max(300).nullable().optional(),
  targetKey: z.string().nullable().optional(),
  metronomeEnabled: z.boolean().default(true),
  inputDeviceName: z.string().default("CoreAudio Input"),
  outputDeviceName: z.string().nullable().optional(),
  channelMode: z.enum(["mono", "stereo"]),
  countInBars: z.number().int().min(0).max(4),
  recordMode: z.enum(["full", "punch"]),
  punchInSeconds: z.number().min(0).nullable().optional(),
  punchOutSeconds: z.number().min(0).nullable().optional(),
  timelineStartSeconds: z.number().min(0).default(0),
  monitorRoute: z.enum(["off", "native", "hardware"]),
  bufferFrames: z.number().int().min(32).max(4_096),
  latencyCompensationMs: z.number().min(0).max(500),
  applyLatencyCompensation: z.boolean().default(true),
  cueCompensationSeconds: z.number().min(0).max(5).default(0)
});

type NativeStartResult = {
  recordingId: string;
  inputDeviceName?: string;
  outputDeviceName?: string | null;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  monitorEnabled?: boolean;
  bufferFrames?: number;
};

type NativeStopResult = {
  recordingId: string;
  relativePath: string;
  inputDeviceName: string;
  outputDeviceName?: string | null;
  sampleRate: number;
  channels: number;
  inputChannelStart: number;
  bitDepth: number;
  bufferFrames: number;
  monitorEnabled: boolean;
  latencyCompensationMs: number;
  durationSeconds: number;
  fileSizeBytes: number;
  peak: number;
  rms: number;
  clipping: boolean;
};

const instrumentFileTypes: Record<string, string> = {
  vocal: "vocal_stem",
  guitar: "instrumental_stem",
  piano: "instrumental_stem",
  bass: "bass_stem",
  drums: "drum_stem",
  other: "demo"
};

const instrumentLabels: Record<string, string> = {
  vocal: "Vocal",
  guitar: "吉他",
  piano: "鋼琴",
  bass: "Bass",
  drums: "節奏",
  other: "錄音"
};

function localRecordingRequired() {
  return NextResponse.json({ error: "原生 WAV 錄音只能在執行頌祖音樂 OS 的 Mac 或桌面 App 上操作。" }, { status: 403 });
}

async function trackForSong(trackId: string, songId: string) {
  return prisma.dawTrack.findFirst({
    where: { id: trackId, project: { songId } },
    include: { project: true }
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isLoopbackRequest(request)) return localRecordingRequired();
  const { id: songId } = await context.params;

  try {
    const raw = await request.json();
    if (raw?.action === "start") {
      const body = StartSchema.parse(raw);
      const track = await trackForSong(body.dawTrackId, songId);
      if (!track) return NextResponse.json({ error: "找不到這首歌的錄音軌。" }, { status: 404 });

      const status = await nativeDawRequest<{ capabilities?: string[] }>("/status");
      if (!status.capabilities?.includes("discrete_input_routing") || !status.capabilities.includes("live_recording_monitor_gate")) {
        return NextResponse.json({ error: "原生引擎尚未支援獨立輸入聲道；請更新引擎後錄音，避免混入其他輸入。" }, { status: 409 });
      }

      const recordingId = randomUUID();
      const relativePath = `uploads/${songId}/recordings/native-${Date.now()}-${recordingId}.wav`;
      const native = await nativeDawRequest<NativeStartResult>("/recordings/start", {
        method: "POST",
        body: JSON.stringify({
          recordingId,
          relativePath,
          inputDeviceName: body.inputDeviceName,
          outputDeviceName: body.outputDeviceName,
          sampleRate: body.sampleRate,
          channels: body.channels,
          inputChannelStart: body.inputChannelStart,
          bitDepth: body.bitDepth,
          bufferFrames: body.bufferFrames,
          monitorEnabled: body.monitorRoute === "native",
          monitorLevel: body.monitorLevel,
          latencyCompensationMs: body.latencyCompensationMs
        }),
        timeoutMs: 5_000
      });
      return NextResponse.json({ ...native, recordingId, relativePath, dawTrackId: track.id }, { status: 201 });
    }

    const body = StopSchema.parse(raw);
    const track = await trackForSong(body.dawTrackId, songId);
    if (!track) return NextResponse.json({ error: "找不到這首歌的錄音軌。" }, { status: 404 });
    const native = await nativeDawRequest<NativeStopResult>("/recordings/stop", {
      method: "POST",
      body: JSON.stringify({ recordingId: body.recordingId }),
      timeoutMs: 10_000
    });

    const expectedPrefix = `uploads/${songId}/recordings/`;
    if (!native.relativePath.startsWith(expectedPrefix) || !native.relativePath.endsWith(".wav") || native.relativePath.includes("..")) {
      throw new Error("原生引擎回傳了不安全的錄音路徑，檔案未入庫。");
    }
    const absolutePath = appPath(...native.relativePath.split("/"));
    await access(absolutePath);
    const fileStat = await stat(absolutePath);
    const takeNumber = (await prisma.recordingTake.count({ where: { songId } })) + 1;
    const label = `${instrumentLabels[body.targetInstrument] ?? "錄音"} native take ${takeNumber}`;
    const latencyOffsetSeconds = body.applyLatencyCompensation
      ? Math.min(body.latencyCompensationMs / 1_000, Math.max(0, native.durationSeconds - 0.05))
      : 0;
    const cueOffsetSeconds = Math.min(body.cueCompensationSeconds, Math.max(0, native.durationSeconds - latencyOffsetSeconds - 0.05));
    const sourceOffsetSeconds = latencyOffsetSeconds + cueOffsetSeconds;
    const clipDurationSeconds = Math.max(0.05, native.durationSeconds - sourceOffsetSeconds);
    const routingLabel =
      body.monitorRoute === "native" ? "App 軟體耳機監聽" : body.monitorRoute === "hardware" ? "錄音介面 Direct Monitor" : "監聽關閉";
    const sessionNotes = [
      `DAW 錄音軌：${track.name}`,
      `原生輸入：${native.inputDeviceName || body.inputDeviceName}`,
      `聲道：${body.channelMode === "stereo" ? "立體聲" : "單聲道"}`,
      `獨立輸入：Input ${native.inputChannelStart + 1}${native.channels === 2 ? `-${native.inputChannelStart + 2}` : ""}`,
      `監聽路由：${routingLabel}`,
      native.outputDeviceName || body.outputDeviceName ? `耳機輸出：${native.outputDeviceName || body.outputDeviceName}` : null,
      `Buffer：${native.bufferFrames} frames`,
      `延遲補償：${body.applyLatencyCompensation ? body.latencyCompensationMs.toFixed(2) : "0.00"} ms`,
      `伴奏啟動補償：${(cueOffsetSeconds * 1_000).toFixed(1)} ms`,
      `倒數：${body.countInBars} 小節`,
      body.recordMode === "punch" && body.punchInSeconds != null && body.punchOutSeconds != null
        ? `定點區間：${body.punchInSeconds?.toFixed(1)}-${body.punchOutSeconds?.toFixed(1)} 秒`
        : "錄音模式：完整 take"
    ]
      .filter(Boolean)
      .join("\n");

    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.recordingSession.create({
        data: {
          songId,
          targetInstrument: body.targetInstrument,
          detectionMode: body.detectionMode,
          targetBpm: body.targetBpm ?? null,
          targetKey: body.targetKey || null,
          metronomeEnabled: body.metronomeEnabled,
          notes: sessionNotes,
          status: "COMPLETED"
        }
      });
      const audioFile = await tx.audioFile.create({
        data: {
          songId,
          fileName: native.relativePath.split("/").at(-1) ?? `${body.recordingId}.wav`,
          originalFileName: native.relativePath.split("/").at(-1) ?? `${body.recordingId}.wav`,
          filePath: absolutePath,
          storageProvider: "local_native",
          sourceKind: "native_recording",
          mimeType: "audio/wav",
          codecName: "pcm_s24le",
          containerFormat: "wav",
          fileType: instrumentFileTypes[body.targetInstrument] ?? "demo",
          versionName: label,
          fileSizeBytes: fileStat.size,
          qualityStatus: "pending",
          isProtectedOriginal: true,
          isPrimary: false,
          durationSeconds: native.durationSeconds,
          sampleRate: native.sampleRate,
          bitDepth: native.bitDepth,
          notes: sessionNotes
        }
      });
      const take = await tx.recordingTake.create({
        data: { sessionId: session.id, songId, audioFileId: audioFile.id, takeNumber, label, status: "RECORDED" }
      });
      const laneCount = await tx.dawTakeLane.count({ where: { trackId: track.id } });
      await tx.dawTakeLane.create({
        data: {
          trackId: track.id,
          recordingTakeId: take.id,
          laneOrder: laneCount + 1,
          compStatus: "candidate",
          selectedRangeJson: JSON.stringify({
            sourceStartSeconds: sourceOffsetSeconds,
            sourceEndSeconds: native.durationSeconds,
            timelineStartSeconds: body.timelineStartSeconds,
            latencyCompensationMs: body.applyLatencyCompensation ? body.latencyCompensationMs : 0,
            cueCompensationMs: cueOffsetSeconds * 1_000
          }),
          notes: `原生 WAV · ${routingLabel}`
        }
      });
      const clip = await tx.dawClip.create({
        data: {
          trackId: track.id,
          audioFileId: audioFile.id,
          startSeconds: body.timelineStartSeconds,
          offsetSeconds: sourceOffsetSeconds,
          durationSeconds: clipDurationSeconds,
          gain: 1,
          label,
          color: track.color
        }
      });
      await tx.timelineEvent.create({
        data: {
          songId,
          eventType: "native_recording_take",
          title: "新增原生 WAV 錄音",
          description: `${label} 已保存為 24-bit WAV；總對齊補償 ${(sourceOffsetSeconds * 1_000).toFixed(1)} ms。`,
          relatedModel: "RecordingTake",
          relatedId: take.id,
          metadataJson: JSON.stringify({
            recordingId: body.recordingId,
            audioFileId: audioFile.id,
            dawTrackId: track.id,
            dawClipId: clip.id,
            native,
            monitorRoute: body.monitorRoute,
            latencyOffsetSeconds,
            cueOffsetSeconds,
            sourceOffsetSeconds
          })
        }
      });
      return { audioFile, take, clip };
    });

    await generateAndStoreAudioQualityReport(created.audioFile.id);
    const [song, project] = await Promise.all([
      prisma.song.findUniqueOrThrow({ where: { id: songId }, include: songInclude }),
      getDawProjectById(track.projectId)
    ]);
    return NextResponse.json({
      song: toSongDto(song),
      project: project ? toDawProjectDto(project) : null,
      takeId: created.take.id,
      audioFileId: created.audioFile.id,
      clipId: created.clip.id,
      native
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "原生 WAV 錄音失敗。" }, { status: 400 });
  }
}
