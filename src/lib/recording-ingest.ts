import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { songInclude, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

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

export type StoredRecordingInput = {
  songId: string;
  diskPath: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sourceKind?: string;
  targetInstrument: string;
  detectionMode: string;
  targetBpm: number | null;
  targetKey: string;
  metronomeEnabled: boolean;
  notes: string;
  sessionId?: string;
  dawTrackId?: string;
  inputDeviceLabel: string;
  channelMode: "mono" | "stereo";
  countInBars: number;
  recordMode: "full" | "punch";
  punchInSeconds: number | null;
  punchOutSeconds: number | null;
  timelineStartSeconds: number;
  requestedSampleRate: number | null;
  captureLeadSeconds: number;
  overdubCueEnabled: boolean;
  deviceSha256?: string | null;
};

export async function ingestStoredRecording(input: StoredRecordingInput) {
  const recordingContextNotes = [
    input.notes || null,
    `輸入設備：${input.inputDeviceLabel}`,
    `聲道：${input.channelMode === "stereo" ? "立體聲" : "單聲道"}`,
    `錄音模式：${input.recordMode === "punch" ? "定點重錄" : "完整 take"}`,
    `倒數：${input.countInBars} 小節`,
    input.requestedSampleRate ? `取樣率：${input.requestedSampleRate} Hz` : null,
    input.overdubCueEnabled
      ? `疊錄伴奏：已同步（啟動補償 ${(input.captureLeadSeconds * 1_000).toFixed(1)} ms）`
      : "疊錄伴奏：未使用",
    input.recordMode === "punch" && input.punchInSeconds !== null && input.punchOutSeconds !== null
      ? `定點區間：${input.punchInSeconds.toFixed(1)}-${input.punchOutSeconds.toFixed(1)} 秒`
      : null,
    input.deviceSha256 ? `裝置端 SHA-256：${input.deviceSha256}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const result = await prisma.$transaction(async (tx) => {
    const session = input.sessionId
      ? await tx.recordingSession.update({
          where: { id: input.sessionId },
          data: {
            targetInstrument: input.targetInstrument,
            detectionMode: input.detectionMode,
            targetBpm: input.targetBpm,
            targetKey: input.targetKey || null,
            metronomeEnabled: input.metronomeEnabled,
            notes: recordingContextNotes || null,
            status: "ACTIVE"
          }
        })
      : await tx.recordingSession.create({
          data: {
            songId: input.songId,
            targetInstrument: input.targetInstrument,
            detectionMode: input.detectionMode,
            targetBpm: input.targetBpm,
            targetKey: input.targetKey || null,
            metronomeEnabled: input.metronomeEnabled,
            notes: recordingContextNotes || null,
            status: "ACTIVE"
          }
        });

    const takeCount = await tx.recordingTake.count({ where: { sessionId: session.id } });
    const takeNumber = takeCount + 1;
    const label = `${instrumentLabels[input.targetInstrument] ?? "錄音"} take ${takeNumber}`;
    const audioFile = await tx.audioFile.create({
      data: {
        songId: input.songId,
        fileName: input.fileName,
        originalFileName: input.originalFileName,
        filePath: input.diskPath,
        storageProvider: "local_upload",
        sourceKind: input.sourceKind ?? "upload",
        mimeType: input.mimeType,
        fileType: instrumentFileTypes[input.targetInstrument] ?? "demo",
        versionName: label,
        fileSizeBytes: input.fileSizeBytes,
        sha256: input.deviceSha256 || null,
        qualityStatus: "pending",
        isProtectedOriginal: true,
        isPrimary: false,
        notes: [
          `錄音偵測：${instrumentLabels[input.targetInstrument] ?? input.targetInstrument}`,
          input.targetBpm ? `目標 BPM：${input.targetBpm}` : null,
          input.targetKey ? `目標調性：${input.targetKey}` : null,
          recordingContextNotes || null
        ]
          .filter(Boolean)
          .join("\n")
      }
    });

    const take = await tx.recordingTake.create({
      data: {
        sessionId: session.id,
        songId: input.songId,
        audioFileId: audioFile.id,
        takeNumber,
        label,
        status: "RECORDED"
      }
    });

    const dawTrack = input.dawTrackId
      ? await tx.dawTrack.findFirst({
          where: {
            id: input.dawTrackId,
            project: { songId: input.songId }
          },
          select: { id: true }
        })
      : null;

    let clipId: string | null = null;
    if (dawTrack) {
      const laneCount = await tx.dawTakeLane.count({ where: { trackId: dawTrack.id } });
      await tx.dawTakeLane.create({
        data: {
          trackId: dawTrack.id,
          recordingTakeId: take.id,
          laneOrder: laneCount + 1,
          compStatus: "candidate",
          selectedRangeJson: JSON.stringify({
            sourceStartSeconds: input.captureLeadSeconds,
            sourceEndSeconds: null,
            timelineStartSeconds: input.timelineStartSeconds,
            cueCompensationMs: input.captureLeadSeconds * 1_000
          }),
          notes: input.overdubCueEnabled ? "DAW 疊錄 · 伴奏已同步" : "DAW 錄音介面建立"
        }
      });
      const clip = await tx.dawClip.create({
        data: {
          trackId: dawTrack.id,
          audioFileId: audioFile.id,
          startSeconds: input.timelineStartSeconds,
          offsetSeconds: input.captureLeadSeconds,
          durationSeconds: null,
          label,
          color: null
        }
      });
      clipId = clip.id;
    }

    await tx.timelineEvent.create({
      data: {
        songId: input.songId,
        eventType: "recording_take",
        title: input.sourceKind === "mobile_native_recording" ? "新增手機原生錄音 take" : "新增錄音 take",
        description: `${label} 已保存為原始錄音檔，等待準確度分析。`,
        relatedModel: "RecordingTake",
        relatedId: take.id,
        metadataJson: JSON.stringify({
          audioFileId: audioFile.id,
          targetInstrument: input.targetInstrument,
          detectionMode: input.detectionMode,
          targetBpm: input.targetBpm,
          targetKey: input.targetKey || null,
          dawTrackId: dawTrack?.id ?? null,
          inputDeviceLabel: input.inputDeviceLabel,
          channelMode: input.channelMode,
          countInBars: input.countInBars,
          recordMode: input.recordMode,
          punchInSeconds: input.punchInSeconds,
          punchOutSeconds: input.punchOutSeconds,
          timelineStartSeconds: input.timelineStartSeconds,
          requestedSampleRate: input.requestedSampleRate,
          overdubCueEnabled: input.overdubCueEnabled,
          captureLeadSeconds: input.captureLeadSeconds,
          sourceKind: input.sourceKind ?? "upload",
          deviceSha256: input.deviceSha256 ?? null
        })
      }
    });

    return { audioFile, take, dawTrackId: dawTrack?.id ?? null, clipId };
  });

  await generateAndStoreAudioQualityReport(result.audioFile.id);
  const song = await prisma.song.findUniqueOrThrow({ where: { id: input.songId }, include: songInclude });
  return {
    song: toSongDto(song),
    takeId: result.take.id,
    audioFileId: result.audioFile.id,
    dawTrackId: result.dawTrackId,
    clipId: result.clipId
  };
}
