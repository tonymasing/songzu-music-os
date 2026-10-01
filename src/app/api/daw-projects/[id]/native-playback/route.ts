import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById } from "@/lib/daw";
import { nativeDawRequest } from "@/lib/native-daw";
import { relativeToAppRoot, resolveStoredFilePath } from "@/lib/paths";

export const runtime = "nodejs";
export const maxDuration = 60;
type RouteContext = { params: Promise<{ id: string }> };

type NativePlaybackStatus = {
  ok: boolean;
  mode: string;
  status: string;
  playbackId?: string | null;
  outputDeviceName?: string | null;
  scheduledClips?: number;
  skippedClips?: number;
  activeClips?: number;
  elapsedSeconds?: number;
  diskStreaming?: boolean;
  error?: string | null;
};

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    startSeconds: z.number().min(0).default(0),
    outputDeviceName: z.string().optional(),
    masterGain: z.number().min(0).max(2).default(1)
  }),
  z.object({ action: z.literal("stop"), playbackId: z.string().min(1) })
]);

export async function GET() {
  try {
    return NextResponse.json(await nativeDawRequest<NativePlaybackStatus>("/playback/status", { timeoutMs: 1_500 }));
  } catch (error) {
    return NextResponse.json({ ok: false, mode: "web_fallback", status: "unavailable", error: error instanceof Error ? error.message : "原生播放狀態失敗。" });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ActionSchema.parse(await request.json());
  if (body.action === "stop") {
    try {
      return NextResponse.json(await nativeDawRequest<NativePlaybackStatus>("/playback/stop", {
        method: "POST",
        body: JSON.stringify({ playbackId: body.playbackId }),
        timeoutMs: 3_000
      }));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "無法停止原生播放。" }, { status: 503 });
    }
  }

  const project = await getDawProjectById(id);
  if (!project) return NextResponse.json({ error: "DAW project not found" }, { status: 404 });
  const soloTracks = project.tracks.filter((track) => track.solo);
  const audibleTracks = (soloTracks.length ? soloTracks : project.tracks).filter((track) => !track.muted && track.trackType !== "bus");
  const clips = [];
  const skipped: Array<{ clipId: string; reason: string }> = [];
  for (const track of audibleTracks) {
    for (const clip of track.clips) {
      const clipDuration = clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 0;
      const clipEnd = clip.startSeconds + clipDuration;
      if (clipEnd <= body.startSeconds || clipDuration <= 0) continue;
      if (!clip.audioFile.filePath) {
        skipped.push({ clipId: clip.id, reason: "音檔沒有本機路徑，交由 Web Audio fallback。" });
        continue;
      }
      const absolutePath = resolveStoredFilePath(clip.audioFile.filePath);
      const relativePath = relativeToAppRoot(absolutePath);
      if (isAbsolute(relativePath) || relativePath.includes("..")) {
        skipped.push({ clipId: clip.id, reason: "音檔位於資料根目錄外，交由 Web Audio fallback。" });
        continue;
      }
      const consumed = Math.max(0, body.startSeconds - clip.startSeconds);
      clips.push({
        relativePath,
        delaySeconds: Math.max(0, clip.startSeconds - body.startSeconds),
        offsetSeconds: Math.max(0, clip.offsetSeconds + consumed),
        durationSeconds: Math.max(0.01, clipDuration - consumed),
        gain: Math.max(0, Math.min(2, clip.gain * track.volume))
      });
    }
  }
  if (!clips.length) return NextResponse.json({ error: "目前位置沒有可由原生引擎串流的本機片段。", skipped }, { status: 400 });

  const playbackId = `project-${id}-${randomUUID()}`;
  try {
    const result = await nativeDawRequest<NativePlaybackStatus>("/playback/start", {
      method: "POST",
      body: JSON.stringify({
        playbackId,
        outputDeviceName: body.outputDeviceName?.trim() || null,
        masterGain: body.masterGain,
        clips
      }),
      timeoutMs: 8_000
    });
    return NextResponse.json({ ...result, skipped, fallbackRecommended: skipped.length > 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "原生磁碟串流啟動失敗。", skipped }, { status: 503 });
  }
}
