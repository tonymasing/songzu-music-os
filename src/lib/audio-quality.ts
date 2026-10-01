import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { AudioQualityReport } from "@prisma/client";

import { parseJsonValue, toIso } from "@/lib/music";
import { resolveStoredFilePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

const ffprobePath = "/opt/homebrew/bin/ffprobe";
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  bits_per_sample?: number;
  bits_per_raw_sample?: string;
  bit_rate?: string;
  channels?: number;
  duration?: string;
};

type ProbeJson = {
  streams?: ProbeStream[];
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
};

export type AudioQualityReportDto = ReturnType<typeof toAudioQualityReportDto>;

export function toAudioQualityReportDto(report: AudioQualityReport) {
  return {
    id: report.id,
    audioFileId: report.audioFileId,
    sha256: report.sha256,
    fileSizeBytes: report.fileSizeBytes,
    formatName: report.formatName,
    containerFormat: report.containerFormat,
    codecName: report.codecName,
    sampleRate: report.sampleRate,
    bitDepth: report.bitDepth,
    bitRate: report.bitRate,
    channels: report.channels,
    durationSeconds: report.durationSeconds,
    peak: report.peak,
    rms: report.rms,
    integratedLufs: report.integratedLufs,
    truePeak: report.truePeak,
    clippingSampleCount: report.clippingSampleCount,
    clippingRisk: report.clippingRisk,
    lowQualityRisk: report.lowQualityRisk,
    sampleRateMismatch: report.sampleRateMismatch,
    bitDepthMismatch: report.bitDepthMismatch,
    warnings: parseJsonValue<string[]>(report.warningsJson, []),
    metrics: parseJsonValue<Record<string, unknown>>(report.metricsJson, {}),
    verdict: report.verdict,
    analyzer: report.analyzer,
    analyzerVersion: report.analyzerVersion,
    errorMessage: report.errorMessage,
    createdAt: toIso(report.createdAt)
  };
}

function mimeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

async function executable(path: string) {
  try {
    await access(path);
    return path;
  } catch {
    return basename(path);
  }
}

async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "N/A") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dbToAmplitude(value: number | null) {
  if (value === null) return null;
  return Math.pow(10, value / 20);
}

function lastFiniteMatch(text: string, pattern: RegExp) {
  const values = [...text.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  return values.length ? values[values.length - 1] : null;
}

async function ffprobe(filePath: string) {
  const probe = await executable(ffprobePath);
  const { stdout } = await execFileAsync(
    probe,
    ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", filePath],
    { maxBuffer: 8 * 1024 * 1024, timeout: 20_000 }
  );
  return JSON.parse(stdout) as ProbeJson;
}

async function ffmpegStats(filePath: string) {
  const ffmpeg = await executable(ffmpegPath);
  const { stderr } = await execFileAsync(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-filter_complex",
      "astats=metadata=1:reset=0,ebur128=peak=true",
      "-f",
      "null",
      "-"
    ],
    { maxBuffer: 12 * 1024 * 1024, timeout: 45_000 }
  );

  const peakDb = lastFiniteMatch(stderr, /Peak level dB:\s*(-?\d+(?:\.\d+)?)/g);
  const rmsDb = lastFiniteMatch(stderr, /RMS level dB:\s*(-?\d+(?:\.\d+)?)/g);
  const lufs = lastFiniteMatch(stderr, /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
  const truePeakDb = lastFiniteMatch(stderr, /Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g) ?? peakDb;
  const clipped = [...stderr.matchAll(/Number of clipped samples:\s*(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  return {
    peakDb,
    rmsDb,
    peak: dbToAmplitude(peakDb),
    rms: dbToAmplitude(rmsDb),
    integratedLufs: lufs,
    truePeak: truePeakDb,
    clippingSampleCount: clipped
  };
}

function deriveBitDepth(stream: ProbeStream, formatName: string | null) {
  const explicit = asNumber(stream.bits_per_sample) ?? asNumber(stream.bits_per_raw_sample);
  if (explicit) return explicit;
  const codec = stream.codec_name?.toLowerCase() ?? "";
  if (codec.includes("pcm_s24") || codec.includes("pcm_u24")) return 24;
  if (codec.includes("pcm_s32") || codec.includes("pcm_f32")) return 32;
  if (codec.includes("pcm_s16") || codec.includes("pcm_u16")) return 16;
  if (formatName?.includes("mp3") || formatName?.includes("mp4") || formatName?.includes("aac")) return null;
  return null;
}

function evaluateQuality(input: {
  fileType: string;
  formatName: string | null;
  codecName: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitRate: number | null;
  peak: number | null;
  clippingSampleCount: number;
}) {
  const warnings: string[] = [];
  const isMaster = input.fileType === "master";
  const format = input.formatName?.toLowerCase() ?? "";
  const codec = input.codecName?.toLowerCase() ?? "";
  const isLosslessContainer = ["wav", "wave", "aiff", "aif", "flac"].some((item) => format.includes(item));
  const isCompressed = ["mp3", "aac", "mp4", "m4a", "opus", "vorbis"].some((item) => format.includes(item) || codec.includes(item));
  const clippingRisk = (input.peak ?? 0) >= 0.999 || input.clippingSampleCount > 0;
  const lowQualityRisk = isCompressed || (Boolean(input.bitRate) && input.bitRate! < 256_000);
  const sampleRateMismatch = Boolean(input.sampleRate && input.sampleRate < 44_100);
  const bitDepthMismatch = Boolean(input.bitDepth && input.bitDepth < 16);

  if (isMaster && !isLosslessContainer) warnings.push("Master 建議使用 WAV / AIFF / FLAC 等無損格式。");
  if (clippingRisk) warnings.push("偵測到 clipping 或 peak 過高，請重新輸出留 headroom。");
  if (lowQualityRisk) warnings.push("檔案疑似為壓縮或低 bitrate，不建議作為發行 master。");
  if (sampleRateMismatch) warnings.push(`Sample rate ${input.sampleRate}Hz 低於 44.1kHz。`);
  if (bitDepthMismatch) warnings.push(`Bit depth ${input.bitDepth} 低於 16-bit。`);
  if (isMaster && !input.bitDepth && isLosslessContainer) warnings.push("Master bit depth 無法確認，建議人工檢查。");

  const masterFail = isMaster && (!isLosslessContainer || clippingRisk || lowQualityRisk || sampleRateMismatch || bitDepthMismatch);
  const verdict = masterFail ? "fail" : warnings.length ? "warning" : "pass";

  return {
    warnings,
    clippingRisk,
    lowQualityRisk,
    sampleRateMismatch,
    bitDepthMismatch,
    verdict
  };
}

export function qualityStatusLabel(status: string | null | undefined) {
  if (status === "pass") return "音質通過";
  if (status === "warning") return "音質警告";
  if (status === "fail") return "音質未通過";
  return "待音質分析";
}

export function canUseAsReleaseMaster(file: {
  fileType: string;
  qualityStatus?: string | null;
}) {
  return file.fileType === "master" && file.qualityStatus === "pass";
}

export async function generateAndStoreAudioQualityReport(audioFileId: string) {
  const audioFile = await prisma.audioFile.findUnique({ where: { id: audioFileId } });
  if (!audioFile) throw new Error("Audio file not found");

  const currentAudioFile = audioFile;
  const filePath = currentAudioFile.filePath ? resolveStoredFilePath(currentAudioFile.filePath) : null;
  const fileName = currentAudioFile.fileName;

  async function createFailureReport(errorMessage: string, sha256?: string | null, size?: number | null) {
    const report = await prisma.audioQualityReport.create({
      data: {
        audioFileId,
        sha256: sha256 ?? null,
        fileSizeBytes: size ?? currentAudioFile.fileSizeBytes ?? null,
        warningsJson: JSON.stringify([errorMessage]),
        metricsJson: JSON.stringify({ source: "ffmpeg", protectedOriginal: true }),
        verdict: "warning",
        errorMessage
      }
    });

    await prisma.audioFile.update({
      where: { id: audioFileId },
      data: {
        sha256: sha256 ?? currentAudioFile.sha256,
        fileSizeBytes: size ?? currentAudioFile.fileSizeBytes,
        originalFileName: currentAudioFile.originalFileName ?? fileName,
        mimeType: currentAudioFile.mimeType ?? mimeFor(fileName),
        qualityStatus: "warning",
        isProtectedOriginal: true
      }
    });

    return report;
  }

  if (!filePath) {
    return createFailureReport("沒有本機檔案路徑，無法分析音質。");
  }

  try {
    await access(filePath);
  } catch {
    return createFailureReport("檔案路徑不存在，原檔可能在外部硬碟或尚未掛載。");
  }

  const [fileStat, sha256] = await Promise.all([stat(filePath), hashFile(filePath)]);

  try {
    const [probe, stats] = await Promise.all([ffprobe(filePath), ffmpegStats(filePath)]);
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio") ?? probe.streams?.[0] ?? {};
    const formatName = probe.format?.format_name ?? null;
    const codecName = audioStream.codec_name ?? null;
    const sampleRate = asNumber(audioStream.sample_rate);
    const bitDepth = deriveBitDepth(audioStream, formatName);
    const bitRate = asNumber(audioStream.bit_rate) ?? asNumber(probe.format?.bit_rate);
    const durationSeconds = asNumber(audioStream.duration) ?? asNumber(probe.format?.duration);
    const quality = evaluateQuality({
      fileType: audioFile.fileType,
      formatName,
      codecName,
      sampleRate,
      bitDepth,
      bitRate,
      peak: stats.peak,
      clippingSampleCount: stats.clippingSampleCount
    });

    const report = await prisma.audioQualityReport.create({
      data: {
        audioFileId,
        sha256,
        fileSizeBytes: fileStat.size,
        formatName,
        containerFormat: formatName,
        codecName,
        sampleRate,
        bitDepth,
        bitRate,
        channels: audioStream.channels ?? null,
        durationSeconds,
        peak: stats.peak,
        rms: stats.rms,
        integratedLufs: stats.integratedLufs,
        truePeak: stats.truePeak,
        clippingSampleCount: stats.clippingSampleCount,
        clippingRisk: quality.clippingRisk,
        lowQualityRisk: quality.lowQualityRisk,
        sampleRateMismatch: quality.sampleRateMismatch,
        bitDepthMismatch: quality.bitDepthMismatch,
        warningsJson: JSON.stringify(quality.warnings),
        metricsJson: JSON.stringify({
          peakDb: stats.peakDb,
          rmsDb: stats.rmsDb,
          extension: extname(fileName).toLowerCase(),
          originalProtected: true
        }),
        verdict: quality.verdict,
        analyzer: "ffmpeg",
        analyzerVersion: "local ffmpeg/ffprobe"
      }
    });

    await prisma.audioFile.update({
      where: { id: audioFileId },
      data: {
        sha256,
        fileSizeBytes: fileStat.size,
        originalFileName: audioFile.originalFileName ?? fileName,
        mimeType: audioFile.mimeType ?? mimeFor(fileName),
        codecName,
        containerFormat: formatName,
        durationSeconds: durationSeconds ?? audioFile.durationSeconds,
        sampleRate: sampleRate ?? audioFile.sampleRate,
        bitDepth: bitDepth ?? audioFile.bitDepth,
        lufs: stats.integratedLufs ?? audioFile.lufs,
        truePeak: stats.truePeak ?? audioFile.truePeak,
        qualityStatus: quality.verdict,
        isProtectedOriginal: true
      }
    });

    return report;
  } catch (error) {
    return createFailureReport(
      error instanceof Error ? `ffmpeg 分析失敗：${error.message}` : "ffmpeg 分析失敗。",
      sha256,
      fileStat.size
    );
  }
}
