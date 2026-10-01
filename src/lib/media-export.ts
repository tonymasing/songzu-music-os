import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { SongDto } from "@/lib/music";

import { appPath } from "@/lib/paths";

const execFileAsync = promisify(execFile);
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";
const ffprobePath = "/opt/homebrew/bin/ffprobe";

export const mediaExportTargets = [
  {
    value: "youtube_video",
    label: "YouTube 橫式 MP4",
    description: "輸出 1920x1080 MP4，適合 YouTube Studio 手動上傳。"
  },
  {
    value: "instagram_reel",
    label: "IG Reels 直式 MP4",
    description: "輸出 1080x1920 MP4，適合 Instagram Reels / Shorts 類直式內容。"
  },
  {
    value: "audio_original",
    label: "音訊原檔輸出",
    description: "複製原始本機音檔到 exports，不轉檔、不壓縮。"
  }
] as const;

export type MediaExportTarget = (typeof mediaExportTargets)[number]["value"];

export type MediaExportProbe = {
  formatName: string | null;
  durationSeconds: number | null;
  bitRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  sampleRate: number | null;
  channels: number | null;
};

export type MediaExportFile = {
  target: MediaExportTarget | "unknown";
  label: string;
  fileName: string;
  fileSizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  probe: MediaExportProbe | null;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
};

type ProbeJson = {
  streams?: ProbeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
};

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "N/A") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function executable(path: string) {
  try {
    await stat(path);
    return path;
  } catch {
    return basename(path);
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "song";
}

function exportsRoot(songId: string) {
  return appPath("exports", songId);
}

function targetLabel(target: MediaExportTarget | "unknown") {
  return mediaExportTargets.find((item) => item.value === target)?.label ?? "未知輸出";
}

function inferTargetFromFileName(fileName: string): MediaExportTarget | "unknown" {
  if (fileName.includes("youtube_video")) return "youtube_video";
  if (fileName.includes("instagram_reel")) return "instagram_reel";
  if (fileName.includes("audio_original")) return "audio_original";
  return "unknown";
}

function localAudioFiles(song: SongDto) {
  return song.audioFiles.filter((file) => !file.archivedAt && file.filePath && file.storageProvider === "local_upload");
}

function selectSourceAudio(song: SongDto) {
  const candidates = localAudioFiles(song).filter((file) => ["master", "mix", "demo"].includes(file.fileType));
  const rank = { master: 0, mix: 1, demo: 2 } as Record<string, number>;
  return candidates.sort((a, b) => (rank[a.fileType] ?? 99) - (rank[b.fileType] ?? 99))[0] ?? null;
}

function selectCover(song: SongDto) {
  return localAudioFiles(song).find((file) => file.fileType === "cover" && /\.(png|jpe?g|webp)$/i.test(file.fileName)) ?? null;
}

function mimeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

export function mediaExportContentType(fileName: string) {
  return mimeFor(fileName);
}

export async function probeMedia(filePath: string): Promise<MediaExportProbe> {
  const probe = await executable(ffprobePath);
  const { stdout } = await execFileAsync(
    probe,
    ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", filePath],
    { maxBuffer: 8 * 1024 * 1024, timeout: 20_000 }
  );
  const data = JSON.parse(stdout) as ProbeJson;
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  return {
    formatName: data.format?.format_name ?? null,
    durationSeconds: asNumber(data.format?.duration) ?? asNumber(video?.duration) ?? asNumber(audio?.duration),
    bitRate: asNumber(data.format?.bit_rate) ?? asNumber(video?.bit_rate) ?? asNumber(audio?.bit_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    sampleRate: asNumber(audio?.sample_rate),
    channels: audio?.channels ?? null
  };
}

async function createWaveformVideo(inputPath: string, outputPath: string, width: number, height: number) {
  const ffmpeg = await executable(ffmpegPath);
  await execFileAsync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-filter_complex",
      `[0:a]showwaves=s=${width}x${height}:mode=line:colors=0x1f7a68,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { maxBuffer: 12 * 1024 * 1024, timeout: 10 * 60_000 }
  );
}

async function createCoverVideo(inputPath: string, coverPath: string, outputPath: string, width: number, height: number) {
  const ffmpeg = await executable(ffmpegPath);
  await execFileAsync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      coverPath,
      "-i",
      inputPath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { maxBuffer: 12 * 1024 * 1024, timeout: 10 * 60_000 }
  );
}

export async function generateMediaExport(song: SongDto, target: MediaExportTarget): Promise<MediaExportFile> {
  const source = selectSourceAudio(song);
  if (!source?.filePath) {
    throw new Error("這首歌還沒有可輸出的本機 demo / mix / master 音檔。請先上傳或從 GarageBand 匯入音檔。");
  }

  await stat(source.filePath);
  const folder = exportsRoot(song.id);
  await mkdir(folder, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const baseName = `${slugify(song.title)}-${target}-${stamp}`;
  const cover = selectCover(song);
  let outputPath = join(folder, `${baseName}.mp4`);

  if (target === "audio_original") {
    const extension = extname(source.fileName) || extname(source.filePath) || ".audio";
    outputPath = join(folder, `${baseName}${extension}`);
    await copyFile(source.filePath, outputPath);
  } else {
    const dimensions = target === "instagram_reel" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    if (cover?.filePath) {
      await createCoverVideo(source.filePath, cover.filePath, outputPath, dimensions.width, dimensions.height);
    } else {
      await createWaveformVideo(source.filePath, outputPath, dimensions.width, dimensions.height);
    }
  }

  const [fileStat, probe] = await Promise.all([stat(outputPath), probeMedia(outputPath)]);
  return {
    target,
    label: targetLabel(target),
    fileName: basename(outputPath),
    fileSizeBytes: fileStat.size,
    createdAt: fileStat.birthtime.toISOString(),
    downloadUrl: `/api/songs/${song.id}/media-export?file=${encodeURIComponent(basename(outputPath))}`,
    probe
  };
}

export async function listMediaExports(songId: string): Promise<MediaExportFile[]> {
  const folder = exportsRoot(songId);
  try {
    await stat(folder);
  } catch {
    return [];
  }

  const entries = await readdir(folder, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = join(folder, entry.name);
        const fileStat = await stat(filePath);
        let probe: MediaExportProbe | null = null;
        try {
          probe = await probeMedia(filePath);
        } catch {
          probe = null;
        }
        const target = inferTargetFromFileName(entry.name);
        return {
          target,
          label: targetLabel(target),
          fileName: entry.name,
          fileSizeBytes: fileStat.size,
          createdAt: fileStat.birthtime.toISOString(),
          downloadUrl: `/api/songs/${songId}/media-export?file=${encodeURIComponent(entry.name)}`,
          probe
        };
      })
  );

  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mediaExportPath(songId: string, fileName: string) {
  return join(exportsRoot(songId), basename(fileName));
}
