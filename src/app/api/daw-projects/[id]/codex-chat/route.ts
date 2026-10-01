import { NextResponse } from "next/server";
import { z } from "zod";

import { submitAiAgentMessage } from "@/lib/ai-agent";
import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { dawAdjustmentRevision } from "@/lib/daw-adjustment";
import { dawRecordingEvidence, RECORDING_ENGINEER_RULES } from "@/lib/daw-recording-evidence";
import { DawEngineerBusyError, withDawEngineerRequest } from "@/lib/daw-engineer-request";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MessageSchema = z.object({
  conversationId: z.string().optional().nullable(),
  message: z.string().trim().min(1).max(4_000),
  trackId: z.string().min(1),
  selectedClipId: z.string().optional().nullable(),
  playheadSeconds: z.number().min(0).max(86_400).default(0)
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = MessageSchema.parse(await request.json());
    const record = await getDawProjectById(id);
    if (!record) return NextResponse.json({ error: "找不到 DAW 專案。" }, { status: 404 });

    const project = toDawProjectDto(record);
    const track = project.tracks.find((item) => item.id === body.trackId);
    if (!track) return NextResponse.json({ error: "找不到目前選取的音軌。" }, { status: 404 });
    const evidence = dawRecordingEvidence(track, body.selectedClipId ?? "", body.playheadSeconds);
    const selectedClip = evidence.clip;
    const latestLane = evidence.lane;
    const latestReport = evidence.report;
    const currentChannel = track.effects.find(
      (effect) => effect.kind === "songzu_recording_channel" || effect.type === "songzu_recording_channel"
    ) ?? null;

    const verifiedContext = {
      song: project.song,
      project: {
        id: project.id,
        songId: project.songId,
        title: project.title,
        bpm: project.bpm,
        musicalKey: project.musicalKey,
        timeSignature: project.timeSignature,
        sampleRate: project.sampleRate,
        bitDepth: project.bitDepth,
        durationSeconds: project.durationSeconds
      },
      playheadSeconds: body.playheadSeconds,
      selectedTrack: {
        id: track.id,
        name: track.name,
        trackType: track.trackType,
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        armed: track.armed,
        monitoring: track.monitoring,
        recordingChannel: currentChannel,
        effects: track.effects,
        automation: track.automationLanes.filter(lane => lane.enabled && lane.mode !== "off").map(lane => ({ parameter: lane.parameter, mode: lane.mode, pointCount: lane.points.length })),
        clips: (selectedClip ? [selectedClip] : track.clips.slice(0, 8)).map((clip) => ({
          id: clip.id,
          label: clip.label,
          startSeconds: clip.startSeconds,
          offsetSeconds: clip.offsetSeconds,
          durationSeconds: clip.durationSeconds ?? clip.audioFile.durationSeconds,
          gain: clip.gain,
          audioFile: {
            id: clip.audioFile.id,
            fileName: clip.audioFile.fileName,
            fileType: clip.audioFile.fileType,
            qualityStatus: clip.audioFile.qualityStatus,
            lufs: clip.audioFile.lufs,
            truePeak: clip.audioFile.truePeak,
            protectedOriginal: clip.audioFile.isProtectedOriginal,
            warnings: clip.audioFile.qualityReport?.warnings ?? []
          }
        })),
        selectedTake: latestLane
          ? {
              id: latestLane.recordingTake.id,
              label: latestLane.recordingTake.label,
              audioFileId: latestLane.recordingTake.audioFile?.id ?? null,
              qualityStatus: latestLane.recordingTake.audioFile?.qualityStatus ?? null,
              report: latestReport ? {
                id: latestReport.id,
                scope: "疑點限定目前片段；峰值與 RMS 為整個 Take 的技術量測，不是演奏正確率",
                peak: latestReport.peak, rms: latestReport.rms,
                analyzer: latestReport.metrics.analyzer ?? "legacy_unknown",
                assessment: "technical_screening_not_performance_grade",
                missingNotesAssessed: false, wrongNotesAssessed: false,
                timingBasis: latestReport.metrics.timingBasis ?? "unknown",
                pitchBasis: latestReport.metrics.pitchBasis ?? "unknown",
                issues: evidence.issues.slice(0, 12)
              } : null
            }
          : null
      },
      selectedClip: selectedClip
        ? {
            id: selectedClip.id,
            label: selectedClip.label,
            startSeconds: selectedClip.startSeconds,
            offsetSeconds: selectedClip.offsetSeconds,
            durationSeconds: selectedClip.durationSeconds ?? selectedClip.audioFile.durationSeconds,
            audioFileId: selectedClip.audioFileId
          }
        : null,
      nearbyMarkers: project.markers
        .filter((marker) => Math.abs(marker.timestampSeconds - body.playheadSeconds) <= 30)
        .slice(0, 12)
    };

    const promptContext = [
      RECORDING_ENGINEER_RULES,
      "你正在 DAW 的『Codex 控制室』擔任對話式錄音師。你只能操作下方經伺服器驗證的歌曲、專案與 selectedTrack。",
      "使用者要求調整聲音時，提出一個且只提出一個 adjust_daw_track 動作，projectId、trackId、songId 必須原樣使用。settings 必須填完整，不可只填差異。",
      "使用者只問建議時可以不產生動作。使用者要求播放或比較時，說明可使用介面的『播放目前混音』『試聽原音』『試聽方案』，不得聲稱已經自行播放。",
      "你沒有直接聽到原始 PCM；只能依 Audio QA、錄音分析、效果參數與使用者描述判斷。資訊不足時要清楚說明，不得假裝聽過。",
      "音準、拍子與演奏錯誤要建議重錄，不可用 EQ、壓縮或殘響假裝修好。硬體增益、麥克風擺位與耳機路由只能提供建議，不可自動變更。",
      "調整必須溫和、可回復，並保留足夠 headroom。",
      JSON.stringify(verifiedContext)
    ].join("\n\n");

    return NextResponse.json(
      await withDawEngineerRequest(project.id, request.signal, () => submitAiAgentMessage({
        conversationId: body.conversationId,
        content: body.message,
        promptContext,
        requireCodex: true,
        signal: request.signal,
        dawScope: { songId: project.songId, projectId: project.id, trackId: track.id, baseRevision: dawAdjustmentRevision(track) }
      })),
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex 錄音師無法處理這次對話。" },
      { status: error instanceof DawEngineerBusyError ? 409 : 400 }
    );
  }
}
