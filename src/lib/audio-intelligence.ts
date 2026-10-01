import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, parse } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { AutoScoreHarmonyAnalysis, AutoScoreResult, AutoScoreRhythmCalibration, AutoScoreTarget } from "@/lib/auto-score";
import { analyzeAutoScorePcm, autoScoreReviewMeasures, buildAutoScoreFromHarmony, buildAutoScoreHumanBenchmark, updateAutoScoreBeatChord, withAutoScoreBenchmarkBaseline } from "@/lib/auto-score";
import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { getOrCreateDawProject } from "@/lib/daw";
import {
  buildHarmonyPipelineQualityGate,
  calibrateHarmonyEvidence,
  summarizeHarmonyVote,
  type HarmonyBeatQuality,
  type HarmonyEvidenceFamily
} from "@/lib/harmony-pipeline-quality";
import {
  colorCandidateForName,
  decodeStructuralHarmony,
  definingColorSupport,
  qualityDefiningIntervals,
  rankHarmonyColorRun,
  shouldSmoothTransientColor,
  shouldSmoothTransientChord,
  spellChordNameForKey,
  spellPitchForKey
} from "@/lib/harmony-postprocessing";
import {
  executeHarmonyPipelineRun,
  markHarmonyCache,
  markHarmonyEngine,
  markHarmonyPipelineFallback,
  markHarmonyQualityGate,
  markPipelineTimedOut,
  pipelineRuntimeGuard,
  runHarmonyPipelineStage,
  runHarmonyPipelineStageSync,
  skipHarmonyPipelineStage
} from "@/lib/harmony-pipeline-runtime";
import { appAssetPath, resolveStoredFilePath, storagePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { createEngineProbeCache } from "@/lib/engine-probe-cache";
import { analyzeAudioStrummingGuide } from "@/lib/strumming-analysis";

const execFileAsync = promisify(execFile);
const MAX_ANALYSIS_SECONDS = 600;
const PCM_SAMPLE_RATE = 8000;
const MADMOM_COMPATIBILITY_PROBE = [
  "import collections, collections.abc, numpy as np",
  "[setattr(collections, n, getattr(collections.abc, n)) for n in ('MutableSequence','MutableMapping','Sequence') if not hasattr(collections, n)]",
  "setattr(np, 'float', float) if not hasattr(np, 'float') else None",
  "setattr(np, 'int', int) if not hasattr(np, 'int') else None",
  "import madmom"
].join("; ");

export type EngineState = {
  id: string;
  label: string;
  available: boolean;
  mode: "built_in" | "optional";
  role: "orchestrator" | "core" | "evidence" | "separation" | "experimental" | "feature";
  stage: string;
  connected: boolean;
  path: string | null;
  purpose: string;
  note: string;
};

async function executablePath(command: string, candidates: string[] = []) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next known location.
    }
  }
  try {
    const result = await execFileAsync("/usr/bin/which", [command], { timeout: 2_000 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function pythonModuleAvailable(moduleName: string) {
  return Boolean(await pythonForModule(moduleName));
}

async function pythonForModule(moduleName: string) {
  const candidates = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
  for (const python of candidates) {
    try {
      await access(python);
      await execFileAsync(python, ["-c", `import ${moduleName}`], { timeout: 8_000 });
      return python;
    } catch {
      // Continue until a Python environment containing the module is found.
    }
  }
  const python = await executablePath("python3", ["/usr/bin/python3", "/opt/homebrew/bin/python3"]);
  if (!python) return null;
  try {
    await execFileAsync(python, ["-c", `import ${moduleName}`], { timeout: 4_000 });
    return python;
  } catch {
    return null;
  }
}

async function btcRepositoryPath() {
  const candidates = [
    process.env.SONGZU_BTC_REPO?.trim() || "",
    storagePath("cache", "vendor", "BTC-ISMIR19"),
    join(process.cwd(), ".cache", "vendor", "BTC-ISMIR19")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "test", "btc_model_large_voca.pt"));
      return candidate;
    } catch {
      // Continue to the next external cache location.
    }
  }
  return null;
}

async function harmonyEnginePythonPath() {
  const candidates = [
    process.env.SONGZU_HARMONY_NEURAL_PYTHON?.trim() || "",
    join(homedir(), "Library", "Application Support", "頌祖音樂 OS", "harmony-engine", "venv", "bin", "python"),
    storagePath("cache", "harmony-engine", "venv", "bin", "python")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      await execFileAsync(candidate, ["-c", MADMOM_COMPATIBILITY_PROBE], { timeout: 8_000 });
      return candidate;
    } catch {
      // Continue to another managed harmony environment.
    }
  }
  return null;
}

const cachedEngineProbe = createEngineProbeCache<EngineState[]>();

export async function getAudioEngineRegistry(): Promise<EngineState[]> {
  const key = JSON.stringify([
    storagePath("cache"),
    process.env.PATH,
    Object.entries(process.env).filter(([name]) => name.startsWith("SONGZU_")).sort(([a], [b]) => a.localeCompare(b))
  ]);
  return cachedEngineProbe(key, probeAudioEngineRegistry);
}

async function probeAudioEngineRegistry(): Promise<EngineState[]> {
  const [ffmpeg, ffprobe, basicPitchCli, basicPitchPython, btcRepo, demucsCli, demucsPython, essentia, librosa, harmonyPython] = await Promise.all([
    executablePath("ffmpeg", [process.env.SONGZU_FFMPEG_PATH || "", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter(Boolean)),
    executablePath("ffprobe", [process.env.SONGZU_FFPROBE_PATH || "", "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"].filter(Boolean)),
    executablePath("basic-pitch", [process.env.SONGZU_BASIC_PITCH_PATH || ""].filter(Boolean)),
    pythonForModule("basic_pitch"),
    btcRepositoryPath(),
    executablePath("demucs", [process.env.SONGZU_DEMUCS_PATH || ""].filter(Boolean)),
    pythonForModule("demucs"),
    pythonModuleAvailable("essentia"),
    pythonModuleAvailable("librosa"),
    harmonyEnginePythonPath()
  ]);
  const basicPitch = basicPitchCli || basicPitchPython;
  const demucs = demucsCli || demucsPython;
  return [
    {
      id: "songzu_harmony_v12",
      label: "高精細採譜主管線 v12",
      available: Boolean(ffmpeg && ffprobe && librosa),
      mode: "built_in",
      role: "orchestrator",
      stage: "主管線",
      connected: true,
      path: "internal:songzu_harmony_v12",
      purpose: "拍點對齊、Bass 根音、和弦性質、正式譜骨架、短暫邊界、調性拼法與品質閘門",
      note: ffmpeg && ffprobe && librosa
        ? "主管線已就緒；細節音高保留於診斷層，正式譜每拍只輸出一個經樂句脈絡驗證的結構和弦。"
        : "主管線缺少必要的解碼或 CQT 元件，只能建立明確標示的低可信草稿。"
    },
    {
      id: "songzu_local_dsp_v2",
      label: "頌祖本機 DSP v2",
      available: Boolean(ffmpeg && ffprobe),
      mode: "built_in",
      role: "core",
      stage: "輸入與量測",
      connected: true,
      path: ffmpeg,
      purpose: "原檔解碼、波形、能量、音質與快速分析",
      note: ffmpeg ? "原檔唯讀解碼，分析後只儲存結果。" : "找不到 ffmpeg，音檔仍會保留但無法深度分析。"
    },
    {
      id: "songzu_harmony_v2",
      label: "頌祖高精細 CQT v8",
      available: Boolean(librosa),
      mode: "built_in",
      role: "core",
      stage: "和聲分析",
      connected: true,
      path: librosa ? "python:librosa" : null,
      purpose: "調性脈絡、多尺度 CQT、Bass 根音與半拍邊界",
      note: librosa ? "完整混音只產生可校對和聲草稿，不把一致度當作正確率。" : "缺少本機和聲模組，系統只會產生低可信快速草稿。"
    },
    {
      id: "madmom_rnn_beat_grid_v1",
      label: "神經拍點與小節引擎",
      available: Boolean(harmonyPython),
      mode: "built_in",
      role: "core",
      stage: "拍點與 Downbeat",
      connected: true,
      path: harmonyPython,
      purpose: "RNN 拍點、Downbeat、小節線與速度圖",
      note: harmonyPython ? "正式接入拍點階段；拍點可信不足時，主管線禁止輸出高可信和弦。" : "缺少受管控的 madmom 環境，拍點階段會降級。"
    },
    {
      id: "madmom_cnn_crf",
      label: "神經和聲 CRF 引擎",
      available: Boolean(harmonyPython),
      mode: "optional",
      role: "evidence",
      stage: "和聲第二意見",
      connected: true,
      path: harmonyPython,
      purpose: "跨時間和弦邊界與和聲序列第二意見",
      note: harmonyPython ? "與 CQT 分屬不同證據家族，只有跨家族同意才提高可信度。" : "選配神經和聲不可用，主管線會降低獨立來源數。"
    },
    {
      id: "basic_pitch",
      label: "Basic Pitch 轉譜引擎",
      available: Boolean(basicPitch),
      mode: "optional",
      role: "evidence",
      stage: "音符證據",
      connected: true,
      path: basicPitch,
      purpose: "逐拍單音與複音 Audio-to-MIDI 證據",
      note: basicPitch ? "已接入主管線，用來驗證和弦音覆蓋與 N.C.，不會單獨決定答案。" : "選配音符層未就緒，主管線會明確降低證據完整度。"
    },
    {
      id: "btc_ismir19",
      label: "BTC 長距離和聲模型",
      available: Boolean(btcRepo),
      mode: "optional",
      role: "evidence",
      stage: "長距離語境",
      connected: true,
      path: btcRepo,
      purpose: "約 10 秒雙向上下文和弦辨識",
      note: btcRepo ? "官方模型位於外部快取，不進入 App 安裝包。" : "外部模型快取尚未建立，其他九層仍可運作。"
    },
    {
      id: "demucs",
      label: "Demucs 錄音室分軌引擎",
      available: Boolean(demucs),
      mode: "optional",
      role: "separation",
      stage: "來源分離",
      connected: true,
      path: demucs,
      purpose: "人聲、鼓、Bass、其他樂器分軌",
      note: demucs ? "已偵測到，使用 fine-tuned 模型、低記憶體多次位移取樣與 24-bit WAV 本機分軌。" : "模型未安裝，不會假裝分軌成功，也不會上傳音檔。"
    },
    {
      id: "essentia",
      label: "Essentia 特徵引擎",
      available: essentia,
      mode: "optional",
      role: "experimental",
      stage: "實驗功能",
      connected: false,
      path: essentia ? "python:essentia" : null,
      purpose: "進階節奏、音色與音樂描述特徵",
      note: essentia ? "只在實驗區顯示；尚未接入正式主管線，也不列入採譜投票。" : "實驗模組尚未安裝，正式主管線不受影響。"
    }
  ];
}

async function runProcess(command: string, args: string[], options?: { maxBytes?: number; cwd?: string; timeoutMs?: number }) {
  // Check the shared deadline before spawning; an expired run must not leave
  // an untracked process behind or receive a fresh timeout for every stage.
  const guard = pipelineRuntimeGuard();
  const maxBytes = Math.min(options?.maxBytes ?? Number.POSITIVE_INFINITY, guard?.maxCapturedOutputBytes ?? 64 * 1024 * 1024);
  const timeoutMs = Math.max(1, Math.min(options?.timeoutMs ?? Number.POSITIVE_INFINITY, guard?.remainingRuntimeMs ?? 20 * 60 * 1000));
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let capturedByteCount = 0;
    let timedOut = false;
    let outputLimited = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 3_000);
      }
    };
    const capture = (chunk: Buffer, target: Buffer[]) => {
      if (outputLimited) return;
      capturedByteCount += chunk.length;
      if (capturedByteCount > maxBytes) {
        outputLimited = true;
        terminate();
        return;
      }
      target.push(chunk);
    };

    timer = setTimeout(() => {
      timedOut = true;
      markPipelineTimedOut();
      terminate();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, chunks));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, errors));
    child.on("error", (error) => rejectOnce(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const stderr = Buffer.concat(errors).toString("utf8");
      if (timedOut) reject(new Error(`本機引擎超過安全執行時間 ${Math.round(timeoutMs / 1000)} 秒，已停止並保留原檔`));
      else if (outputLimited) reject(new Error("本機分析輸出超過安全上限，已停止並保留原檔"));
      else if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr });
      else reject(new Error(stderr.trim() || `${basename(command)} 結束碼 ${code}`));
    });
  });
}

async function decodePcm(filePath: string) {
  const ffmpeg = await executablePath("ffmpeg", [process.env.SONGZU_FFMPEG_PATH || "", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter(Boolean));
  if (!ffmpeg) throw new Error("找不到本機 ffmpeg");
  const { stdout } = await runProcess(
    ffmpeg,
    ["-v", "error", "-i", filePath, "-t", String(MAX_ANALYSIS_SECONDS), "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-f", "f32le", "pipe:1"],
    { maxBytes: 36 * 1024 * 1024 }
  );
  const aligned = stdout.subarray(0, stdout.length - (stdout.length % 4));
  const copied = aligned.buffer.slice(aligned.byteOffset, aligned.byteOffset + aligned.byteLength);
  const samples = new Float32Array(copied);
  if (!samples.length) throw new Error("音檔沒有可分析的 PCM 內容");
  return { samples, sampleRate: PCM_SAMPLE_RATE, durationSeconds: samples.length / PCM_SAMPLE_RATE };
}

type HarmonyAnalyzerOutput = {
  engine: "songzu_harmony_v2";
  bpm: number;
  musicalKey: string;
  durationSeconds: number;
  confidence: number;
  sourceProfile: "mixed_audio" | "single_instrument";
  events: Array<{
    startSeconds: number;
    durationSeconds: number;
    name: string;
    root: string;
    quality: string;
    bass?: string | null;
    isolatedBassEvidence?: boolean;
    bassPitch?: string | null;
    bassPitchConfidence?: number | null;
    bassPitchStability?: number | null;
    bassPitchCandidates?: Array<{ name: string; energy: number }>;
    bassPitchTracker?: string | null;
    bassPitchTrackerConfidence?: number | null;
    bassPitchTrackerStability?: number | null;
    bassPitchTrackerAgreement?: boolean | null;
    beatSubdivision?: number;
    confidence: number;
    reviewStatus?: "likely" | "review";
    alternateNames?: string[];
    theoryDegree?: string;
    rootSearchRank?: number;
    qualitySearchRank?: number;
    relativeKeyContext?: string;
    rawTonalCenter?: string;
    localKeyConfidence?: number;
    candidateAlternatives?: Array<{ name: string; degree: string; score: number }>;
    harmonicActivity?: number;
    tonalConcentration?: number;
    percussiveRatio?: number;
    noChordProbability?: number;
    boundaryStrength?: number;
  }>;
  diagnostics?: Record<string, unknown>;
};

type NeuralHarmonyOutput = {
  engine: "madmom_cnn_crf";
  events: Array<{
    startSeconds: number;
    durationSeconds: number;
    name: string;
    root: string;
    quality: string;
  }>;
};

type NeuralRhythmOutput = AutoScoreRhythmCalibration & {
  diagnostics?: Record<string, unknown>;
};

type BasicPitchOutput = {
  engine: "basic_pitch_coreml_v1";
  durationSeconds: number;
  noteCount: number;
  beatCount: number;
  events: Array<{
    startSeconds: number;
    durationSeconds: number;
    pitchClasses: number[];
    lowestPitchClass?: number | null;
    activity: number;
    relativeActivity: number;
    concentration: number;
    noteCount: number;
    tonal: boolean;
    noChordProbability: number;
    stableMidis?: Array<{
      midi: number;
      pitchClass: number;
      weight: number;
    }>;
  }>;
  diagnostics?: Record<string, unknown>;
};

type BtcHarmonyOutput = {
  engine: "btc_ismir19_large_vocabulary";
  durationSeconds: number;
  events: Array<{
    startSeconds: number;
    durationSeconds: number;
    name: string;
    root: string;
    quality: string;
    confidence: number;
    margin: number;
  }>;
  diagnostics?: Record<string, unknown>;
};

type PersonalHarmonyProfile = {
  baselineSongCount: number;
  degreeQualityCounts: Record<string, number>;
  transitionCounts: Record<string, number>;
  maxDegreeQualityCount: number;
  maxTransitionCount: number;
  sourceReliability: Record<string, number>;
};

function parseHarmonyAnalyzerOutput(value: string): HarmonyAnalyzerOutput {
  const result = JSON.parse(value) as Partial<HarmonyAnalyzerOutput>;
  if (
    result.engine !== "songzu_harmony_v2" ||
    !Number.isFinite(result.bpm) ||
    !Number.isFinite(result.durationSeconds) ||
    !Number.isFinite(result.confidence) ||
    typeof result.musicalKey !== "string" ||
    !Array.isArray(result.events)
  ) {
    throw new Error("本機和聲分析器回傳格式不完整");
  }
  return result as HarmonyAnalyzerOutput;
}

function parseNeuralHarmonyOutput(value: string): NeuralHarmonyOutput {
  const result = JSON.parse(value) as Partial<NeuralHarmonyOutput>;
  if (result.engine !== "madmom_cnn_crf" || !Array.isArray(result.events)) {
    throw new Error("本機神經和聲分析器回傳格式不完整");
  }
  return result as NeuralHarmonyOutput;
}

function parseNeuralRhythmOutput(value: string): NeuralRhythmOutput {
  const result = JSON.parse(value) as Partial<NeuralRhythmOutput>;
  if (
    result.engine !== "madmom_rnn_beat_grid_v1" ||
    !Number.isFinite(result.bpm) ||
    !Number.isFinite(result.displayBpm) ||
    !Number.isFinite(result.confidence) ||
    !Array.isArray(result.beatTimesSeconds) ||
    !Array.isArray(result.beatNumbers) ||
    result.beatTimesSeconds.length !== result.beatNumbers.length
  ) {
    throw new Error("本機神經節拍分析器回傳格式不完整");
  }
  return result as NeuralRhythmOutput;
}

function parseBasicPitchOutput(value: string): BasicPitchOutput {
  const result = JSON.parse(value) as Partial<BasicPitchOutput>;
  if (result.engine !== "basic_pitch_coreml_v1" || !Array.isArray(result.events)) {
    throw new Error("Basic Pitch 回傳格式不完整");
  }
  return result as BasicPitchOutput;
}

function parseBtcHarmonyOutput(value: string): BtcHarmonyOutput {
  const result = JSON.parse(value) as Partial<BtcHarmonyOutput>;
  if (result.engine !== "btc_ismir19_large_vocabulary" || !Array.isArray(result.events)) {
    throw new Error("BTC 長距離和聲模型回傳格式不完整");
  }
  return result as BtcHarmonyOutput;
}

function chordIdentity(name: string) {
  const flatToSharp: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/.exec(name);
  if (!match) return name;
  const quality = /^(m|m6|m7|m9|mMaj7|m7b5)$/.test(match[2] ?? "")
    ? "m"
    : /^(dim|dim7)$/.test(match[2] ?? "")
      ? "dim"
      : match[2] === "aug"
        ? "aug"
        : "";
  return `${flatToSharp[match[1]] ?? match[1]}${quality}`;
}

function chordDisplayIdentity(name: string) {
  const flatToSharp: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/.exec(name);
  if (!match) return name;
  const bass = match[3] ? `/${flatToSharp[match[3]] ?? match[3]}` : "";
  return `${flatToSharp[match[1]] ?? match[1]}${match[2] ?? ""}${bass}`;
}

function pitchClass(name: string) {
  const names: Record<string, number> = {
    C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
    "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11
  };
  return names[name];
}

function chordPitchClasses(name: string) {
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/[A-G](?:#|b)?)?$/.exec(name);
  if (!match) return null;
  const root = pitchClass(match[1]);
  if (!Number.isFinite(root)) return null;
  const intervals: Record<string, number[]> = {
    "": [0, 4, 7],
    m: [0, 3, 7],
    "7": [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    maj9: [0, 2, 4, 7, 11],
    m7: [0, 3, 7, 10],
    m9: [0, 2, 3, 7, 10],
    mMaj7: [0, 3, 7, 11],
    m7b5: [0, 3, 6, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    "7sus4": [0, 5, 7, 10],
    add9: [0, 2, 4, 7],
    "6": [0, 4, 7, 9],
    m6: [0, 3, 7, 9],
    "6/9": [0, 2, 4, 7, 9],
    "9": [0, 2, 4, 7, 10],
    dim: [0, 3, 6],
    dim7: [0, 3, 6, 9],
    aug: [0, 4, 8]
  };
  return {
    root,
    tones: new Set((intervals[match[2] ?? ""] ?? intervals[""]).map((interval) => (root + interval) % 12))
  };
}

type BeatBassDecision = {
  name: string;
  confidence: number;
  stability: number;
  halfAgreement: boolean;
  observations: number;
  candidateMargin: number;
  trackerAgreement: boolean | null;
};

type SubBeatHarmonyDecision = {
  event: HarmonyEvent;
  agreement: number;
  changeConfidence: number;
};

function subBeatHarmonyDecisionForBeat(
  events: HarmonyEvent[],
  previousStartSeconds: number | null,
  startSeconds: number,
  endSeconds: number
): SubBeatHarmonyDecision | null {
  if (!events.length) return null;
  const middleSeconds = startSeconds + (endSeconds - startSeconds) / 2;
  const first = strongestEventForWindow(events, startSeconds, middleSeconds)?.event ?? null;
  const second = strongestEventForWindow(events, middleSeconds, endSeconds)?.event ?? null;
  if (!first && !second) return null;
  const firstEvent = first ?? second!;
  const secondEvent = second ?? firstEvent;
  const firstIdentity = chordIdentity(firstEvent.name);
  const secondIdentity = chordIdentity(secondEvent.name);
  const sameHarmony = firstIdentity === secondIdentity;
  const previousTail = previousStartSeconds !== null
    ? strongestEventForWindow(events, previousStartSeconds, startSeconds)?.event ?? null
    : null;
  const changedAtBeat = Boolean(previousTail && chordIdentity(previousTail.name) !== firstIdentity);
  const confidenceFloor = Math.min(firstEvent.confidence ?? 45, previousTail?.confidence ?? firstEvent.confidence ?? 45) / 100;
  const boundaryEvidence = Math.max(firstEvent.boundaryStrength ?? 0, previousTail?.boundaryStrength ?? 0);
  const changeConfidence = changedAtBeat
    ? Math.min(1, confidenceFloor * 0.72 + Math.min(1, boundaryEvidence) * 0.28)
    : 0;
  const selected = !sameHarmony && (secondEvent.confidence ?? 0) > (firstEvent.confidence ?? 0) + 14
    ? secondEvent
    : firstEvent;
  return {
    event: {
      ...selected,
      confidence: sameHarmony
        ? (firstEvent.confidence + secondEvent.confidence) / 2
        : Math.min(62, selected.confidence),
      boundaryStrength: Math.max(firstEvent.boundaryStrength ?? 0, secondEvent.boundaryStrength ?? 0)
    },
    agreement: sameHarmony ? 1 : chordRoot(firstEvent.name) === chordRoot(secondEvent.name) ? 0.5 : 0,
    changeConfidence
  };
}

function bassDecisionForBeat(events: HarmonyEvent[], startSeconds: number, endSeconds: number): BeatBassDecision | null {
  if (!events.length) return null;
  const middleSeconds = startSeconds + (endSeconds - startSeconds) / 2;
  const halves = [
    strongestEventForWindow(events, startSeconds, middleSeconds)?.event ?? null,
    strongestEventForWindow(events, middleSeconds, endSeconds)?.event ?? null
  ];
  const observations = halves
    .filter((event): event is HarmonyEvent => Boolean(
      event?.bassPitch &&
      (event.bassPitchConfidence ?? 0) >= 55 &&
      event.bassPitchTrackerAgreement !== false
    ))
    .filter((event, index, values) => values.findIndex((candidate) =>
      candidate.startSeconds === event.startSeconds && candidate.bassPitch === event.bassPitch
    ) === index);
  if (!observations.length) return null;

  const grouped = new Map<string, {
    score: number;
    confidence: number;
    stability: number;
    observations: number;
    candidateMargin: number;
  }>();
  for (const event of observations) {
    const name = chordRoot(event.bassPitch!);
    if (!name) continue;
    const confidence = event.bassPitchConfidence ?? 0;
    const stability = event.bassPitchStability ?? 0.58;
    const candidates = [...(event.bassPitchCandidates ?? [])].sort((left, right) => right.energy - left.energy);
    const namedCandidate = candidates.find((candidate) => chordRoot(candidate.name) === name);
    const runnerUp = candidates.find((candidate) => chordRoot(candidate.name) !== name);
    const candidateMargin = Math.max(0, (namedCandidate?.energy ?? 0.5) - (runnerUp?.energy ?? 0));
    const current = grouped.get(name) ?? {
      score: 0,
      confidence: 0,
      stability: 0,
      observations: 0,
      candidateMargin: 0
    };
    current.score += confidence / 100 * Math.max(0.48, stability) * (0.82 + Math.min(0.3, candidateMargin));
    current.confidence = Math.max(current.confidence, confidence);
    current.stability += stability;
    current.observations += 1;
    current.candidateMargin += candidateMargin;
    grouped.set(name, current);
  }
  const winner = [...grouped.entries()].sort((left, right) =>
    right[1].score - left[1].score || right[1].confidence - left[1].confidence
  )[0];
  if (!winner) return null;
  const halfNames = halves.map((event) => event?.bassPitch ? chordRoot(event.bassPitch) : null);
  const halfAgreement = Boolean(halfNames[0] && halfNames[0] === halfNames[1]);
  const trackerStates = observations
    .map((event) => event.bassPitchTrackerAgreement)
    .filter((value): value is boolean => typeof value === "boolean");
  return {
    name: winner[0],
    confidence: winner[1].confidence,
    stability: Math.min(1, winner[1].stability / Math.max(1, winner[1].observations)),
    halfAgreement,
    observations: winner[1].observations,
    candidateMargin: winner[1].candidateMargin / Math.max(1, winner[1].observations),
    trackerAgreement: trackerStates.length ? trackerStates.every(Boolean) : null
  };
}

function hasStableInversionEvidence(bassDecision: BeatBassDecision | null) {
  if (!bassDecision || bassDecision.trackerAgreement === false) return false;
  return (
    bassDecision.halfAgreement &&
    bassDecision.confidence >= 60 &&
    bassDecision.stability >= 0.64 &&
    bassDecision.candidateMargin >= 0.04
  ) || (
    bassDecision.stability >= 0.84 &&
    bassDecision.confidence >= 74 &&
    bassDecision.candidateMargin >= 0.08
  );
}

function applyIndependentBassInversion(selected: HarmonyEvent, bassDecision: BeatBassDecision | null) {
  if (selected.name.includes("/")) return selected;
  const chord = chordPitchClasses(selected.name);
  if (!chord || !bassDecision) return selected;
  if (!hasStableInversionEvidence(bassDecision)) return selected;
  const bassPc = pitchClass(bassDecision.name);
  if (!Number.isFinite(bassPc) || bassPc === chord.root || !chord.tones.has(bassPc)) return selected;
  return {
    ...selected,
    name: `${selected.name}/${bassDecision.name}`,
    bass: bassDecision.name,
    isolatedBassEvidence: true
  };
}

function resolveMajorSixthRelativeMinor(
  selected: HarmonyEvent,
  bassDecision: BeatBassDecision | null,
  evidence: WeightedHarmonyEvidence[],
  noteEvent: BasicPitchOutput["events"][number] | null,
  preBassName: string
) {
  const selectedParts = chordColorParts(selected.name);
  const preBassParts = chordColorParts(preBassName);
  const evidenceMajorSixthParts = selectedParts?.family === "minor"
    ? evidence.map((source) => chordColorParts(source.event.name)).find((sourceParts) => {
        if (!sourceParts || !["6", "6/9"].includes(sourceParts.quality)) return false;
        const sourceRootPc = pitchClass(sourceParts.root);
        const selectedRootPc = pitchClass(selectedParts.root);
        return Number.isFinite(sourceRootPc) &&
          Number.isFinite(selectedRootPc) &&
          (sourceRootPc + 9) % 12 === selectedRootPc;
      }) ?? null
    : null;
  const parts = selectedParts && ["6", "6/9"].includes(selectedParts.quality)
    ? selectedParts
    : preBassParts && ["6", "6/9"].includes(preBassParts.quality)
      ? preBassParts
      : evidenceMajorSixthParts;
  if (!parts) return selected;
  const rootPc = pitchClass(parts.root);
  if (!Number.isFinite(rootPc)) return selected;
  if (bassDecision?.name === parts.root && hasStableInversionEvidence(bassDecision)) return selected;
  const relativeMinorPc = (rootPc + 9) % 12;

  // Major-sixth and relative-minor chords overlap heavily. Find the actual
  // relative-minor spelling in harmonic evidence first, then let the shared
  // quality ranker compare note coverage and defining-color support.
  let relativeRootName: string | null = null;
  for (const source of evidence) {
    const options = [
      { name: source.event.name, confidence: Math.max(0.35, Math.min(1, (source.event.confidence ?? 55) / 100)), exact: true },
      ...(source.event.candidateAlternatives ?? []).slice(0, 4).map((candidate) => ({
        name: candidate.name,
        confidence: Math.max(0.25, Math.min(1, candidate.score)),
        exact: false
      }))
    ];
    for (const option of options) {
      const optionParts = chordColorParts(option.name);
      if (
        !optionParts ||
        pitchClass(optionParts.root) !== relativeMinorPc ||
        optionParts.family !== "minor"
      ) continue;
      relativeRootName = optionParts.root;
      break;
    }
    if (relativeRootName) break;
  }
  if (!relativeRootName) return selected;

  const relativeCandidates = harmonicInstrumentQualityCandidatesForRoot(relativeRootName, evidence, noteEvent);
  const winner = relativeCandidates[0];
  const selectedCandidate = harmonicInstrumentQualityCandidatesForRoot(parts.root, evidence, noteEvent)[0];
  const stableBassIsRelativeRoot = Boolean(
    bassDecision?.name === relativeRootName && hasStableInversionEvidence(bassDecision)
  );
  const relativeRootNoteSupport = noteEvent?.pitchClasses[relativeMinorPc] ?? 0;
  const combinedFamilies = new Set([
    ...winner?.families ?? [],
    ...selectedCandidate?.families ?? []
  ]);
  const combinedSources = new Set([
    ...winner?.sources ?? [],
    ...selectedCandidate?.sources ?? []
  ]);
  const equivalentMinorSeventh = `${relativeRootName}m7`;
  const equivalentMinorSeventhSupport = basicPitchChordSupport(equivalentMinorSeventh, noteEvent);
  const equivalentMinorSeventhDefiningSupport = definingColorSupport(
    equivalentMinorSeventh,
    noteEvent?.pitchClasses
  );
  const majorSixthEvidenceFamilies = new Set(evidence.flatMap((source) => {
    const sourceParts = chordColorParts(source.event.name);
    return sourceParts &&
      pitchClass(sourceParts.root) === rootPc &&
      ["6", "6/9"].includes(sourceParts.quality)
      ? [source.family]
      : [];
  }));
  const relativeMinorEvidenceFamilies = new Set(evidence.flatMap((source) => {
    const sourceParts = chordColorParts(source.event.name);
    return sourceParts &&
      pitchClass(sourceParts.root) === relativeMinorPc &&
      sourceParts.family === "minor"
      ? [source.family]
      : [];
  }));
  const crossNamedFamilyCount = new Set([
    ...majorSixthEvidenceFamilies,
    ...relativeMinorEvidenceFamilies
  ]).size;
  const strongEquivalentMinorSeventh =
    majorSixthEvidenceFamilies.size >= 1 &&
    relativeMinorEvidenceFamilies.size >= 1 &&
    crossNamedFamilyCount >= 2 &&
    relativeRootNoteSupport >= 0.04 &&
    equivalentMinorSeventhSupport >= 0.62 &&
    equivalentMinorSeventhDefiningSupport >= 0.4;
  if (
    !winner ||
    (!strongEquivalentMinorSeventh && combinedFamilies.size < 2) ||
    (!strongEquivalentMinorSeventh && combinedSources.size < 2) ||
    (!strongEquivalentMinorSeventh && Math.max(winner.noteSupport, equivalentMinorSeventhSupport) < 0.48) ||
    (!strongEquivalentMinorSeventh && !stableBassIsRelativeRoot && relativeRootNoteSupport < 0.04)
  ) return selected;
  // Eb6 and Cm7 contain the same four pitch classes. Once the root evidence
  // prefers C, retain Cm7 when Bb is a sustained chord tone; only collapse to
  // Cm when the apparent sixth came from a weak or missing Bb observation.
  const winnerRepresentative =
    strongEquivalentMinorSeventh || (
      chordColorParts(winner.representative)?.quality === "m" &&
      equivalentMinorSeventhSupport >= 0.62 &&
      equivalentMinorSeventhDefiningSupport >= 0.4
    )
      ? equivalentMinorSeventh
      : winner.representative;
  const winnerParts = chordColorParts(winnerRepresentative);
  if (!winnerParts) return selected;
  const winnerChord = chordPitchClasses(winnerRepresentative);
  const stableBass = bassDecision && hasStableInversionEvidence(bassDecision) ? bassDecision.name : null;
  const stableBassPc = stableBass ? pitchClass(stableBass) : Number.NaN;
  const slash = stableBass && Number.isFinite(stableBassPc) && winnerChord?.tones.has(stableBassPc) && stableBassPc !== winnerChord.root
    ? `/${stableBass}`
    : "";
  const winnerName = `${winnerRepresentative.replace(/\/[A-G](?:#|b)?$/, "")}${slash}`;
  return {
    ...selected,
    name: winnerName,
    root: winnerParts.root,
    quality: winnerParts.quality,
    bass: slash ? stableBass : null,
    isolatedBassEvidence: Boolean(slash),
    confidence: Math.min(76, selected.confidence),
    reviewStatus: "review" as const,
    alternateNames: [...new Set([selected.name, preBassName, ...(selected.alternateNames ?? [])])]
  };
}

function overlapSeconds(
  left: { startSeconds: number; durationSeconds: number },
  right: { startSeconds: number; durationSeconds: number }
) {
  return Math.max(
    0,
    Math.min(left.startSeconds + left.durationSeconds, right.startSeconds + right.durationSeconds) -
      Math.max(left.startSeconds, right.startSeconds)
  );
}

type HarmonyEvent = HarmonyAnalyzerOutput["events"][number] & {
  initialHarmonyName?: string;
  alternateNames?: string[];
  evidence?: Array<{
    source: string;
    name: string;
    confidence: number;
    weight: number;
    support: "supports" | "alternate" | "neutral";
    detail?: string;
  }>;
  boundaryConfidence?: number;
  harmonicChangeConfidence?: number;
  subBeatAgreement?: number;
  notePitchClasses?: number[];
  noteMidiWeights?: Array<{ midi: number; pitchClass: number; weight: number }>;
  repeatedSectionSupport?: number;
  personalPriorSupport?: number;
  rootConfidence?: number;
  qualityConfidence?: number;
  independentSourceCount?: number;
  evidenceConflict?: boolean;
  acousticDetailName?: string;
  structuralDecision?: "unchanged" | "simplified_color" | "context_consensus";
  structuralConfidence?: number;
};

function compactHarmonyEvidence(items: NonNullable<HarmonyEvent["evidence"]>) {
  const compact = new Map<string, NonNullable<HarmonyEvent["evidence"]>[number]>();
  for (const item of items) {
    const key = `${item.source}|${item.name}|${item.support}|${item.detail ?? ""}`;
    const previous = compact.get(key);
    if (!previous || item.confidence > previous.confidence) compact.set(key, item);
  }
  return [...compact.values()]
    .sort((left, right) =>
      (left.support === "supports" ? -1 : left.support === "neutral" ? 0 : 1) -
        (right.support === "supports" ? -1 : right.support === "neutral" ? 0 : 1) ||
      right.weight - left.weight ||
      right.confidence - left.confidence
    )
    .slice(0, 32);
}

function requireConsensusForInversion(
  selected: HarmonyEvent,
  bassDecision: BeatBassDecision | null
) {
  if (!selected.name.includes("/")) return selected;
  const selectedBass = /\/([A-G](?:#|b)?)$/.exec(selected.name)?.[1];
  const stableEnough = hasStableInversionEvidence(bassDecision);
  if (stableEnough && selectedBass && chordRoot(selectedBass) === bassDecision?.name) return selected;

  return {
    ...selected,
    name: selected.name.replace(/\/[A-G](?:#|b)?$/, ""),
    bass: null,
    isolatedBassEvidence: false,
    confidence: Math.min(64, selected.confidence),
    reviewStatus: "review" as const,
    alternateNames: [...new Set([...(selected.alternateNames ?? []), selected.name])]
  };
}

function strongestEventForWindow<T extends { startSeconds: number; durationSeconds: number }>(
  events: T[],
  startSeconds: number,
  endSeconds: number
) {
  const windowDuration = Math.max(0.001, endSeconds - startSeconds);
  return events
    .map((event) => ({ event, overlap: overlapSeconds(event, { startSeconds, durationSeconds: endSeconds - startSeconds }) }))
    .filter((item) => item.overlap >= Math.min(0.16, windowDuration * 0.18))
    .sort((left, right) => right.overlap - left.overlap)[0] ?? null;
}

function neuralEventForBeat<T extends { startSeconds: number; durationSeconds: number }>(
  events: T[],
  startSeconds: number,
  endSeconds: number
) {
  const strongest = strongestEventForWindow(events, startSeconds, endSeconds);
  const durationSeconds = Math.max(0.001, endSeconds - startSeconds);
  const snapTolerance = Math.min(0.38, durationSeconds * 0.72);
  const upcoming = events
    .filter((event) =>
      event.startSeconds >= startSeconds &&
      event.startSeconds - startSeconds <= snapTolerance &&
      event.durationSeconds >= durationSeconds * 0.82
    )
    .sort((left, right) => left.startSeconds - right.startSeconds)[0];
  if (!upcoming || strongest?.event === upcoming) return strongest;
  return {
    event: upcoming,
    overlap: overlapSeconds(upcoming, { startSeconds, durationSeconds })
  };
}

function chordRoot(name: string) {
  const match = /^([A-G](?:#|b)?)/.exec(name);
  if (!match) return null;
  const flatToSharp: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  return flatToSharp[match[1]] ?? match[1];
}

function chordColorParts(name: string) {
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/.exec(name);
  if (!match) return null;
  const quality = match[2] ?? "";
  const family = quality === "7" || quality === "9" || quality === "7sus4"
    ? "dominant"
    : quality === "sus2" || quality === "sus4"
      ? "suspended"
      : quality === "dim" || quality === "dim7"
        ? "diminished"
        : quality === "aug"
          ? "augmented"
          : quality.startsWith("m") && !quality.startsWith("maj")
            ? "minor"
            : "major";
  const complexity = quality === "" || quality === "m"
    ? 0
    : quality === "maj9" || quality === "m9" || quality === "6/9"
      ? 0.3
      : 0.14;
  return {
    root: chordRoot(match[1]) ?? match[1],
    quality,
    bass: match[3] ? chordRoot(match[3]) ?? match[3] : null,
    family,
    complexity
  };
}

type WeightedHarmonyEvidence = {
  event: HarmonyEvent;
  weight: number;
  baseWeight: number;
  source: string;
  family: HarmonyEvidenceFamily;
  reliability: number;
  familyConflict: number;
};

const HARMONIC_INSTRUMENT_SOURCES = new Set([
  "cqt_harmony_stem",
  "cqt_half_beat_detail",
  "cqt_two_beat",
  "cqt_full_measure",
  "madmom_crf_harmony_stem"
]);

function isHarmonicInstrumentEvidence(source: WeightedHarmonyEvidence) {
  return HARMONIC_INSTRUMENT_SOURCES.has(source.source);
}

function harmonyEvidenceFamilyLabel(family: HarmonyEvidenceFamily) {
  const labels: Record<HarmonyEvidenceFamily, string> = {
    harmonic_cqt: "和聲 CQT 家族",
    protected_reference: "受保護原曲",
    neural_harmony: "神經和聲家族",
    long_context: "長距離語境",
    note_events: "音符事件",
    bass_root: "Bass 根音",
    other: "其他證據"
  };
  return labels[family];
}

function harmonyEvidenceEngineId(source: string) {
  if (source.startsWith("cqt_")) return "songzu_harmony_v2";
  if (source.startsWith("madmom_crf_")) return "madmom_cnn_crf";
  if (source === "btc_long_context") return "btc_ismir19";
  if (source === "basic_pitch_notes") return "basic_pitch";
  if (source === "bass_root_anchor") return "bass_root_anchor";
  return source;
}

const TONY_ROOT_SEARCH_OFFSETS = [0, 9, 5, 7, 4, 2, 11, 10, 8, 6, 3, 1] as const;
const TONY_ROOT_SEARCH_LABELS = ["1", "6", "4", "5", "3", "2", "7", "b7", "b6", "b5", "b3", "b2"] as const;
const TONY_QUALITY_SEARCH_ORDER = [
  "", "maj7", "maj9", "m", "m7", "m9", "dim", "dim7", "7", "9",
  "mMaj7", "m7b5", "aug", "sus2", "sus4", "add9", "6", "m6", "6/9", "7sus4"
] as const;

function qualityIdentity(name: string) {
  if (name === "N.C.") return "none";
  return chordColorParts(name)?.quality ?? "";
}

function degreeForChord(name: string, localKey: string | undefined) {
  const rootName = chordRoot(name);
  const tonicName = localKey?.replace(/m$/, "");
  if (!rootName || !tonicName) return null;
  const root = pitchClass(rootName);
  const tonic = pitchClass(tonicName);
  if (!Number.isFinite(root) || !Number.isFinite(tonic)) return null;
  const offset = (root - tonic + 12) % 12;
  const index = TONY_ROOT_SEARCH_OFFSETS.indexOf(offset as (typeof TONY_ROOT_SEARCH_OFFSETS)[number]);
  return index >= 0 ? TONY_ROOT_SEARCH_LABELS[index] : null;
}

function personalPriorForChord(
  name: string,
  localKey: string | undefined,
  previousName: string | undefined,
  profile: PersonalHarmonyProfile | undefined
) {
  if (!profile?.baselineSongCount || name === "N.C.") return 0;
  const degree = degreeForChord(name, localKey);
  if (!degree) return 0;
  const quality = qualityIdentity(name);
  const degreeSupport = (profile.degreeQualityCounts[`${degree}:${quality}`] ?? 0) / Math.max(1, profile.maxDegreeQualityCount);
  let transitionSupport = 0;
  if (previousName) {
    const previousDegree = degreeForChord(previousName, localKey);
    if (previousDegree) {
      transitionSupport = (profile.transitionCounts[`${previousDegree}>${degree}:${quality}`] ?? 0) / Math.max(1, profile.maxTransitionCount);
    }
  }
  return Math.min(1, degreeSupport * 0.62 + transitionSupport * 0.38);
}

function basicPitchChordSupport(name: string, noteEvent: BasicPitchOutput["events"][number] | null) {
  if (!noteEvent) return 0;
  if (name === "N.C.") return noteEvent.noChordProbability;
  const chord = chordPitchClasses(name);
  if (!chord || noteEvent.pitchClasses.length !== 12) return 0;
  let included = 0;
  let outside = 0;
  for (let pitch = 0; pitch < 12; pitch += 1) {
    const value = noteEvent.pitchClasses[pitch] ?? 0;
    if (chord.tones.has(pitch)) included += value;
    else outside += value;
  }
  const rootSupport = noteEvent.pitchClasses[chord.root] ?? 0;
  return Math.max(0, Math.min(1, included * 0.78 + rootSupport * 0.3 - outside * 0.22));
}

function basicPitchEventForBeat(
  events: BasicPitchOutput["events"],
  startSeconds: number,
  endSeconds: number
) {
  return strongestEventForWindow(events, startSeconds, endSeconds)?.event ?? null;
}

function refreshHarmonySearchMetadata(selected: HarmonyEvent) {
  const selectedRoot = chordRoot(selected.name);
  const tonic = selected.relativeKeyContext ? pitchClass(selected.relativeKeyContext.replace(/m$/, "")) : Number.NaN;
  const root = selectedRoot ? pitchClass(selectedRoot) : Number.NaN;
  const degreeOffset = Number.isFinite(tonic) && Number.isFinite(root) ? (root - tonic + 12) % 12 : -1;
  const degreeIndex = TONY_ROOT_SEARCH_OFFSETS.indexOf(degreeOffset as (typeof TONY_ROOT_SEARCH_OFFSETS)[number]);
  const parts = chordColorParts(selected.name);
  const qualityIndex = parts
    ? TONY_QUALITY_SEARCH_ORDER.indexOf(parts.quality as (typeof TONY_QUALITY_SEARCH_ORDER)[number])
    : -1;

  return {
    ...selected,
    theoryDegree: degreeIndex >= 0 ? TONY_ROOT_SEARCH_LABELS[degreeIndex] : selected.theoryDegree,
    rootSearchRank: degreeIndex >= 0 ? degreeIndex + 1 : selected.rootSearchRank,
    qualitySearchRank: qualityIndex >= 0 ? qualityIndex + 1 : selected.qualitySearchRank
  };
}

function attachHarmonyTheoryContext(selected: HarmonyEvent, evidence: WeightedHarmonyEvidence[]) {
  const selectedRoot = chordRoot(selected.name);
  const ranked = [...evidence].sort((left, right) => right.weight - left.weight);
  const matchingRoot = ranked.find(({ event }) =>
    event.relativeKeyContext && chordRoot(event.name) === selectedRoot
  )?.event;
  const localContext = matchingRoot ?? ranked.find(({ event }) => event.relativeKeyContext)?.event;
  return refreshHarmonySearchMetadata({
    ...selected,
    relativeKeyContext: selected.relativeKeyContext ?? localContext?.relativeKeyContext,
    rawTonalCenter: selected.rawTonalCenter ?? localContext?.rawTonalCenter,
    localKeyConfidence: selected.localKeyConfidence ?? localContext?.localKeyConfidence,
    candidateAlternatives: selected.candidateAlternatives?.length
      ? selected.candidateAlternatives
      : matchingRoot?.candidateAlternatives
  });
}

function spellHarmonyEventForKey(event: HarmonyEvent, musicalKey: string) {
  const spellingKey = musicalKey || event.relativeKeyContext;
  const name = spellChordNameForKey(event.name, spellingKey);
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/.exec(name);
  const spellKeyContext = (value: string | undefined) => {
    if (!value) return value;
    const keyMatch = /^([A-G](?:#|b)?)(m)?$/.exec(value);
    return keyMatch ? `${spellPitchForKey(keyMatch[1], spellingKey)}${keyMatch[2] ?? ""}` : value;
  };
  return {
    ...event,
    name,
    root: name === "N.C." ? "N.C." : match?.[1] ?? event.root,
    quality: name === "N.C." ? "none" : match?.[2] ?? event.quality,
    bass: name === "N.C." ? null : match?.[3] ?? null,
    bassPitch: event.bassPitch ? spellPitchForKey(event.bassPitch, spellingKey) : event.bassPitch,
    bassPitchTracker: event.bassPitchTracker ? spellPitchForKey(event.bassPitchTracker, spellingKey) : event.bassPitchTracker,
    bassPitchCandidates: event.bassPitchCandidates?.map((candidate) => ({
      ...candidate,
      name: spellPitchForKey(candidate.name, spellingKey)
    })),
    alternateNames: event.alternateNames?.map((candidate) => spellChordNameForKey(candidate, spellingKey)),
    candidateAlternatives: event.candidateAlternatives?.map((candidate) => ({
      ...candidate,
      name: spellChordNameForKey(candidate.name, spellingKey)
    })),
    evidence: event.evidence?.map((evidence) => ({
      ...evidence,
      name: spellChordNameForKey(evidence.name, spellingKey)
    })),
    relativeKeyContext: spellKeyContext(event.relativeKeyContext),
    rawTonalCenter: spellKeyContext(event.rawTonalCenter)
  };
}

function refineSelectedColorForRoot(
  selected: HarmonyEvent,
  evidence: WeightedHarmonyEvidence[],
  noteEvent: BasicPitchOutput["events"][number] | null
) {
  const selectedIdentity = chordIdentity(selected.name);
  const selectedRoot = chordRoot(selected.name);
  if (!selectedRoot) return selected;

  const votes = new Map<string, {
    representative: string;
    support: number;
    exactWeight: number;
    scoreTotal: number;
    scoreWeight: number;
    sources: number;
    complexity: number;
    families: Set<HarmonyEvidenceFamily>;
    exactFamilies: Set<HarmonyEvidenceFamily>;
  }>();
  for (const source of evidence) {
    const options = new Map<string, { name: string; score: number; exact: boolean }>();
    const addOption = (name: string, score: number, exact: boolean) => {
      if (chordRoot(name) !== selectedRoot || chordIdentity(name) !== selectedIdentity) return;
      const display = chordDisplayIdentity(name.replace(/\/[A-G](?:#|b)?$/, ""));
      const current = options.get(display);
      if (!current || exact || score > current.score) options.set(display, { name: name.replace(/\/[A-G](?:#|b)?$/, ""), score, exact });
    };
    addOption(source.event.name, Math.max(0.35, Math.min(0.95, (source.event.confidence ?? 50) / 100)), true);
    for (const alternative of source.event.candidateAlternatives ?? []) {
      addOption(alternative.name, Math.max(0.25, Math.min(0.95, alternative.score)), false);
    }
    for (const option of options.values()) {
      const parts = chordColorParts(option.name);
      if (!parts) continue;
      const display = chordDisplayIdentity(option.name);
      const current = votes.get(display) ?? {
        representative: option.name,
        support: 0,
        exactWeight: 0,
        scoreTotal: 0,
        scoreWeight: 0,
        sources: 0,
        complexity: parts.complexity,
        families: new Set<HarmonyEvidenceFamily>(),
        exactFamilies: new Set<HarmonyEvidenceFamily>()
      };
      const optionWeight = source.weight * (option.exact ? 1 : 0.48);
      current.support += optionWeight;
      current.exactWeight += option.exact ? source.weight : 0;
      current.scoreTotal += option.score * optionWeight;
      current.scoreWeight += optionWeight;
      current.sources += 1;
      current.families.add(source.family);
      if (option.exact) current.exactFamilies.add(source.family);
      votes.set(display, current);
    }
  }

  const ranked = [...votes.values()].map((candidate) => ({
    ...candidate,
    noteSupport: basicPitchChordSupport(candidate.representative, noteEvent),
    definingSupport: definingColorSupport(candidate.representative, noteEvent?.pitchClasses),
    hasDefiningColor: qualityDefiningIntervals(candidate.representative).length > 0
  })).sort((left, right) => {
    const leftAverage = left.scoreTotal / Math.max(0.001, left.scoreWeight);
    const rightAverage = right.scoreTotal / Math.max(0.001, right.scoreWeight);
    const leftPenalty = left.complexity * (left.hasDefiningColor && left.definingSupport >= 0.4 ? 0.05 : 0.28);
    const rightPenalty = right.complexity * (right.hasDefiningColor && right.definingSupport >= 0.4 ? 0.05 : 0.28);
    const leftRank = left.support + left.exactWeight * 0.45 + leftAverage * 0.35 + left.noteSupport * 0.22 + left.definingSupport * 0.48 - leftPenalty;
    const rightRank = right.support + right.exactWeight * 0.45 + rightAverage * 0.35 + right.noteSupport * 0.22 + right.definingSupport * 0.48 - rightPenalty;
    return rightRank - leftRank;
  });
  const best = ranked[0];
  const current = votes.get(chordDisplayIdentity(selected.name.replace(/\/[A-G](?:#|b)?$/, "")));
  if (
    !best ||
    chordDisplayIdentity(best.representative) === chordDisplayIdentity(selected.name.replace(/\/[A-G](?:#|b)?$/, "")) ||
    best.sources < 2 ||
    (best.hasDefiningColor && (
      best.definingSupport < 0.38 ||
      (best.families.size + (best.definingSupport >= 0.4 ? 1 : 0) < 2 && best.exactFamilies.size < 1)
    )) ||
    best.scoreTotal / Math.max(0.001, best.scoreWeight) < 0.58 ||
    (current && best.support < current.support + 0.3 && best.exactWeight <= current.exactWeight + 0.45)
  ) {
    return selected;
  }

  const parts = chordColorParts(best.representative);
  const rootMatch = /^([A-G](?:#|b)?)/.exec(best.representative);
  if (!parts || !rootMatch) return selected;
  return {
    ...selected,
    name: best.representative,
    root: rootMatch[1],
    quality: parts.quality,
    bass: null,
    isolatedBassEvidence: false,
    confidence: Math.min(selected.confidence, 72),
    reviewStatus: "review" as const,
    alternateNames: [...new Set([selected.name, ...(selected.alternateNames ?? [])])]
  };
}

type HarmonicInstrumentQualityCandidate = {
  representative: string;
  rank: number;
  support: number;
  exactWeight: number;
  averageConfidence: number;
  sourceCount: number;
  exactSourceCount: number;
  familyCount: number;
  exactFamilyCount: number;
  noteSupport: number;
  definingSupport: number;
  sources: Set<string>;
  families: Set<HarmonyEvidenceFamily>;
};

function harmonicInstrumentQualityCandidatesForRoot(
  root: string,
  evidence: WeightedHarmonyEvidence[],
  noteEvent: BasicPitchOutput["events"][number] | null
) {
  const candidates = new Map<string, {
    representative: string;
    support: number;
    exactWeight: number;
    scoreTotal: number;
    scoreWeight: number;
    sources: Set<string>;
    exactSources: Set<string>;
    families: Set<HarmonyEvidenceFamily>;
    exactFamilies: Set<HarmonyEvidenceFamily>;
    complexity: number;
  }>();

  for (const source of evidence.filter(isHarmonicInstrumentEvidence)) {
    const options = new Map<string, { name: string; score: number; exact: boolean }>();
    const addOption = (name: string, score: number, exact: boolean) => {
      const withoutBass = name.replace(/\/[A-G](?:#|b)?$/, "");
      if (chordRoot(withoutBass) !== root) return;
      const display = chordDisplayIdentity(withoutBass);
      const current = options.get(display);
      if (!current || exact || score > current.score) {
        options.set(display, { name: withoutBass, score, exact });
      }
    };
    addOption(source.event.name, Math.max(0.35, Math.min(0.98, (source.event.confidence ?? 55) / 100)), true);
    for (const alternative of (source.event.candidateAlternatives ?? []).slice(0, 8)) {
      addOption(alternative.name, Math.max(0.2, Math.min(0.95, alternative.score)), false);
    }

    for (const option of options.values()) {
      const parts = chordColorParts(option.name);
      if (!parts) continue;
      const display = chordDisplayIdentity(option.name);
      const current = candidates.get(display) ?? {
        representative: option.name,
        support: 0,
        exactWeight: 0,
        scoreTotal: 0,
        scoreWeight: 0,
        sources: new Set<string>(),
        exactSources: new Set<string>(),
        families: new Set<HarmonyEvidenceFamily>(),
        exactFamilies: new Set<HarmonyEvidenceFamily>(),
        complexity: parts.complexity
      };
      const optionWeight = source.weight * (option.exact ? 1 : 0.46);
      current.support += optionWeight;
      current.exactWeight += option.exact ? source.weight : 0;
      current.scoreTotal += option.score * optionWeight;
      current.scoreWeight += optionWeight;
      current.sources.add(source.source);
      current.families.add(source.family);
      if (option.exact) {
        current.exactSources.add(source.source);
        current.exactFamilies.add(source.family);
      }
      candidates.set(display, current);
    }
  }

  return [...candidates.values()]
    .map((candidate): HarmonicInstrumentQualityCandidate => {
      const averageConfidence = candidate.scoreTotal / Math.max(0.001, candidate.scoreWeight);
      const noteSupport = basicPitchChordSupport(candidate.representative, noteEvent);
      const definingSupport = definingColorSupport(candidate.representative, noteEvent?.pitchClasses);
      const hasDefiningColor = qualityDefiningIntervals(candidate.representative).length > 0;
      const extensionPenalty = candidate.complexity * (hasDefiningColor && definingSupport >= 0.4 ? 0.04 : 0.24);
      return {
        representative: candidate.representative,
        rank: candidate.support + candidate.exactWeight * 0.42 + averageConfidence * 0.35 + noteSupport * 0.38 + definingSupport * 0.5 - extensionPenalty,
        support: candidate.support,
        exactWeight: candidate.exactWeight,
        averageConfidence,
        sourceCount: candidate.sources.size,
        exactSourceCount: candidate.exactSources.size,
        familyCount: candidate.families.size,
        exactFamilyCount: candidate.exactFamilies.size,
        noteSupport,
        definingSupport,
        sources: candidate.sources,
        families: candidate.families
      };
    })
    .sort((left, right) =>
      right.rank - left.rank ||
      right.sourceCount - left.sourceCount ||
      right.averageConfidence - left.averageConfidence
    );
}

function applyBassRootFirstHarmony(
  selected: HarmonyEvent,
  bassDecision: BeatBassDecision | null,
  evidence: WeightedHarmonyEvidence[],
  noteEvent: BasicPitchOutput["events"][number] | null
) {
  if (selected.name === "N.C." || !bassDecision || !hasStableInversionEvidence(bassDecision)) return selected;
  const selectedParts = chordColorParts(selected.name);
  if (!selectedParts) return selected;

  const bassRootCandidates = harmonicInstrumentQualityCandidatesForRoot(bassDecision.name, evidence, noteEvent);
  const bassRootCandidate = bassRootCandidates[0];
  const selectedRootCandidate = harmonicInstrumentQualityCandidatesForRoot(selectedParts.root, evidence, noteEvent)[0];
  const selectedChord = chordPitchClasses(selected.name);
  const bassPc = pitchClass(bassDecision.name);
  const bassIsChordTone = Boolean(
    selectedChord &&
    Number.isFinite(bassPc) &&
    selectedChord.tones.has(bassPc)
  );
  const bassRootHasDefiningColor = Boolean(
    bassRootCandidate && qualityDefiningIntervals(bassRootCandidate.representative).length
  );
  const bassRootColorSupported = Boolean(
    bassRootCandidate && (
      !bassRootHasDefiningColor ||
      (
        bassRootCandidate.definingSupport >= 0.38 &&
        (bassRootCandidate.familyCount >= 2 || bassRootCandidate.exactFamilyCount >= 1)
      )
    )
  );
  const bassRootSupported = Boolean(
    bassRootCandidate &&
    bassRootColorSupported &&
    bassRootCandidate.sourceCount >= 2 &&
    bassRootCandidate.averageConfidence >= 0.48 &&
    (
      bassRootCandidate.exactSourceCount >= 1 ||
      bassRootCandidate.noteSupport >= 0.45
    )
  );

  // A stable isolated Bass proposes the root first. Harmonic instruments then
  // select the chord quality for that root. When those instruments strongly
  // support another chord that contains the Bass note, the Bass is an
  // inversion/slash note instead of a reason to relabel the whole chord.
  const strongerInversionReading = Boolean(
    selectedParts.root !== bassDecision.name &&
    bassIsChordTone &&
    selectedRootCandidate &&
    bassRootCandidate &&
    selectedRootCandidate.sourceCount >= 2 &&
    selectedRootCandidate.rank >= bassRootCandidate.rank + 0.3
  );
  if (strongerInversionReading) {
    return applyIndependentBassInversion(selected, bassDecision);
  }

  if (bassRootSupported && bassRootCandidate) {
    const parts = chordColorParts(bassRootCandidate.representative);
    if (!parts) return selected;
    const changed = chordDisplayIdentity(selected.name) !== chordDisplayIdentity(bassRootCandidate.representative);
    return {
      ...selected,
      name: bassRootCandidate.representative,
      root: parts.root,
      quality: parts.quality,
      bass: null,
      isolatedBassEvidence: true,
      confidence: changed ? Math.min(76, selected.confidence) : selected.confidence,
      reviewStatus: changed ? "review" as const : selected.reviewStatus,
      alternateNames: changed
        ? [...new Set([selected.name, ...(selected.alternateNames ?? [])])].slice(0, 3)
        : selected.alternateNames
    };
  }

  if (selectedParts.root !== bassDecision.name && bassIsChordTone) {
    return applyIndependentBassInversion(selected, bassDecision);
  }
  return selected;
}

function applyChordDecisionToLocalContext(current: HarmonyEvent, decision: HarmonyEvent) {
  return refreshHarmonySearchMetadata({
    ...current,
    name: decision.name,
    root: decision.root,
    quality: decision.quality,
    bass: decision.bass,
    isolatedBassEvidence: decision.isolatedBassEvidence
  });
}

function stabilizeHarmonyColorRuns(events: HarmonyEvent[], beatDuration: number) {
  const isolatedRootCleaned = events.map((event) => ({ ...event }));
  for (let index = 1; index < isolatedRootCleaned.length - 1; index += 1) {
    const previous = isolatedRootCleaned[index - 1];
    const current = isolatedRootCleaned[index];
    const next = isolatedRootCleaned[index + 1];
    if (shouldSmoothTransientChord(previous, current, next, beatDuration)) {
      isolatedRootCleaned[index] = {
        ...applyChordDecisionToLocalContext(current, previous),
        startSeconds: current.startSeconds,
        durationSeconds: current.durationSeconds,
        confidence: Math.min(previous.confidence, current.confidence, 68),
        reviewStatus: "review",
        alternateNames: [...new Set([current.name, ...(current.alternateNames ?? [])])].slice(0, 3)
      };
    }
  }

  for (let index = 1; index < isolatedRootCleaned.length - 1; index += 1) {
    const previous = isolatedRootCleaned[index - 1];
    const current = isolatedRootCleaned[index];
    const next = isolatedRootCleaned[index + 1];
    if (shouldSmoothTransientColor(previous, current, next, beatDuration)) {
      isolatedRootCleaned[index] = {
        ...applyChordDecisionToLocalContext(current, previous),
        startSeconds: current.startSeconds,
        durationSeconds: current.durationSeconds,
        confidence: Math.min(previous.confidence, current.confidence, 68),
        reviewStatus: "review",
        alternateNames: [...new Set([current.name, ...(current.alternateNames ?? [])])].slice(0, 3)
      };
    }
  }

  const stabilized = isolatedRootCleaned.map((event) => ({ ...event }));
  const runFamily = (event: HarmonyEvent) => {
    const parts = chordColorParts(event.name);
    if (!parts) return null;
    if (["", "7", "9", "maj7", "maj9", "add9", "6", "6/9"].includes(parts.quality)) return "major";
    if (["m", "m7", "m9", "mMaj7", "m6"].includes(parts.quality)) return "minor";
    return parts.quality;
  };
  let runStart = 0;
  while (runStart < stabilized.length) {
    const firstParts = chordColorParts(stabilized[runStart].name);
    const firstFamily = runFamily(stabilized[runStart]);
    if (!firstParts || !firstFamily) {
      runStart += 1;
      continue;
    }
    const runKey = `${firstParts.root}|${firstFamily}|${firstParts.bass ?? ""}`;
    let runEnd = runStart + 1;
    while (runEnd < stabilized.length) {
      const parts = chordColorParts(stabilized[runEnd].name);
      const family = runFamily(stabilized[runEnd]);
      if (!parts || !family || `${parts.root}|${family}|${parts.bass ?? ""}` !== runKey) break;
      runEnd += 1;
    }
    if (runEnd - runStart >= 2 && ["major", "minor"].includes(firstFamily)) {
      const runEvents = stabilized.slice(runStart, runEnd);
      const decision = rankHarmonyColorRun(runEvents, beatDuration);
      const canonical = decision.winner;
      const decisionMargin = canonical ? canonical.score - (decision.runnerUp?.score ?? 0) : 0;
      if (canonical && decisionMargin >= beatDuration * 0.035) {
        for (let index = runStart; index < runEnd; index += 1) {
          const current = stabilized[index];
          if (chordDisplayIdentity(current.name) === chordDisplayIdentity(canonical.name)) continue;
          const localDecision = rankHarmonyColorRun([current], beatDuration);
          const localCurrent = colorCandidateForName(localDecision, current.name);
          const localCanonical = colorCandidateForName(localDecision, canonical.name);
          const currentHasDefiningColor = qualityDefiningIntervals(current.name).length > 0;
          const canonicalHasDefiningColor = qualityDefiningIntervals(canonical.name).length > 0;
          if (canonicalHasDefiningColor && !localCanonical?.qualifiedExtension) continue;
          if (currentHasDefiningColor && localCurrent?.qualifiedExtension && !canonicalHasDefiningColor) continue;
          if (
            currentHasDefiningColor &&
            canonicalHasDefiningColor &&
            localCurrent?.qualifiedExtension &&
            (localCurrent.score >= (localCanonical?.score ?? 0) - beatDuration * 0.04)
          ) continue;
          stabilized[index] = {
            ...applyChordDecisionToLocalContext(current, {
              ...current,
              name: canonical.name,
              root: chordColorParts(canonical.name)?.root ?? current.root,
              quality: chordColorParts(canonical.name)?.quality ?? current.quality,
              bass: chordColorParts(canonical.name)?.bass ?? current.bass
            }),
            startSeconds: current.startSeconds,
            durationSeconds: current.durationSeconds,
            confidence: Math.min(current.confidence, 72),
            reviewStatus: current.reviewStatus,
            alternateNames: [...new Set([current.name, ...(current.alternateNames ?? [])])].slice(0, 3),
            evidence: [
              ...(current.evidence ?? []),
              {
                source: "quality_color_consensus",
                name: canonical.name,
                confidence: round(clamp(decisionMargin / Math.max(beatDuration, 0.001), 0, 1) * 100, 1),
                weight: 0.5,
                support: "supports" as const,
                detail: `${canonical.independentQualityFamilies} 組性質證據 · 定義延伸音 ${Math.round(canonical.definingSupport * 100)}%`
              }
            ]
          };
        }
      }
    }
    runStart = runEnd;
  }

  // Run consensus can expose a new A-B-A color flicker after neighboring
  // beats are unified. Finish with a bounded in-place convergence pass so
  // those secondary weak transients do not survive into the merged score.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (let index = 1; index < stabilized.length - 1; index += 1) {
      const previous = stabilized[index - 1];
      const current = stabilized[index];
      const next = stabilized[index + 1];
      if (!shouldSmoothTransientColor(previous, current, next, beatDuration)) continue;
      stabilized[index] = {
        ...applyChordDecisionToLocalContext(current, previous),
        startSeconds: current.startSeconds,
        durationSeconds: current.durationSeconds,
        confidence: Math.min(previous.confidence, current.confidence, 68),
        reviewStatus: "review",
        alternateNames: [...new Set([current.name, ...(current.alternateNames ?? [])])].slice(0, 3)
      };
      changed = true;
    }
    if (!changed) break;
  }
  return stabilized;
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / Math.max(1e-9, Math.sqrt(leftNorm * rightNorm));
}

function applyRepeatedHarmonyConsensus(
  inputEvents: HarmonyEvent[],
  basicPitch: BasicPitchOutput | undefined,
  beatsPerBar: number
) {
  const events = inputEvents.map((event) => ({ ...event, evidence: event.evidence ? [...event.evidence] : [] }));
  if (!basicPitch || beatsPerBar < 2 || events.length < beatsPerBar * 8) return { events, groupCount: 0 };
  const measureCount = Math.floor(events.length / beatsPerBar);
  const features: number[][] = [];
  for (let measure = 0; measure < measureCount; measure += 1) {
    const feature: number[] = [];
    for (let beat = 0; beat < beatsPerBar; beat += 1) {
      const event = events[measure * beatsPerBar + beat];
      const noteEvent = basicPitchEventForBeat(
        basicPitch.events,
        event.startSeconds,
        event.startSeconds + event.durationSeconds
      );
      feature.push(...(noteEvent?.pitchClasses.length === 12 ? noteEvent.pitchClasses : new Array(12).fill(0)));
    }
    features.push(feature);
  }
  const parent = Array.from({ length: measureCount }, (_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < measureCount; left += 1) {
    for (let right = left + 4; right < measureCount; right += 1) {
      const similarity = cosineSimilarity(features[left], features[right]);
      if (similarity < 0.9) continue;
      let compatibleBeats = 0;
      for (let beat = 0; beat < beatsPerBar; beat += 1) {
        const leftEvent = events[left * beatsPerBar + beat];
        const rightEvent = events[right * beatsPerBar + beat];
        const leftIdentity = chordIdentity(leftEvent.name);
        const rightIdentity = chordIdentity(rightEvent.name);
        if (
          leftIdentity === rightIdentity ||
          (leftEvent.alternateNames ?? []).some((name) => chordIdentity(name) === rightIdentity) ||
          (rightEvent.alternateNames ?? []).some((name) => chordIdentity(name) === leftIdentity)
        ) compatibleBeats += 1;
      }
      if (compatibleBeats >= Math.ceil(beatsPerBar * 0.5)) unite(left, right);
    }
  }
  const groups = new Map<number, number[]>();
  for (let measure = 0; measure < measureCount; measure += 1) {
    const root = find(measure);
    groups.set(root, [...(groups.get(root) ?? []), measure]);
  }
  const repeatedGroups = [...groups.values()].filter((group) => group.length >= 2);
  for (const group of repeatedGroups) {
    for (let beat = 0; beat < beatsPerBar; beat += 1) {
      const groupEvents = group.map((measure) => events[measure * beatsPerBar + beat]);
      const support = new Map<string, { count: number; confidence: number; representative: HarmonyEvent }>();
      for (const event of groupEvents) {
        const identity = chordIdentity(event.name);
        const current = support.get(identity) ?? { count: 0, confidence: 0, representative: event };
        current.count += event.confidence >= 62 ? 1 : 0.5;
        current.confidence += event.confidence;
        support.set(identity, current);
      }
      const winner = [...support.entries()].sort((left, right) =>
        right[1].count - left[1].count || right[1].confidence - left[1].confidence
      )[0];
      if (!winner || winner[1].count < 2) continue;
      for (const measure of group) {
        const eventIndex = measure * beatsPerBar + beat;
        const event = events[eventIndex];
        const currentIdentity = chordIdentity(event.name);
        const alternateSupportsWinner = (event.alternateNames ?? []).some((name) => chordIdentity(name) === winner[0]);
        const noteEvent = basicPitchEventForBeat(
          basicPitch.events,
          event.startSeconds,
          event.startSeconds + event.durationSeconds
        );
        const winnerNoteSupport = basicPitchChordSupport(winner[1].representative.name, noteEvent);
        const currentNoteSupport = basicPitchChordSupport(event.name, noteEvent);
        const mayCorrect =
          currentIdentity !== winner[0] &&
          event.confidence <= 64 &&
          (alternateSupportsWinner || winnerNoteSupport >= currentNoteSupport + 0.14);
        const repeatedEvidence = {
          source: "repeated_section_consensus",
          name: winner[1].representative.name,
          confidence: round(Math.min(100, winner[1].count / group.length * 100), 1),
          weight: 0.42,
          support: currentIdentity === winner[0] || mayCorrect ? "supports" as const : "alternate" as const,
          detail: `${group.length} 個重複小節位置交叉比對`
        };
        if (mayCorrect) {
          events[eventIndex] = {
            ...applyChordDecisionToLocalContext(event, winner[1].representative),
            startSeconds: event.startSeconds,
            durationSeconds: event.durationSeconds,
            confidence: Math.min(68, Math.max(event.confidence, winner[1].confidence / group.length)),
            reviewStatus: "review",
            alternateNames: [...new Set([event.name, ...(event.alternateNames ?? [])])].slice(0, 3),
            evidence: [...(event.evidence ?? []), repeatedEvidence],
            repeatedSectionSupport: round(winner[1].count / group.length, 4)
          };
        } else {
          event.evidence = [...(event.evidence ?? []), repeatedEvidence];
          event.repeatedSectionSupport = round(winner[1].count / group.length, 4);
        }
      }
    }
  }
  return { events, groupCount: repeatedGroups.length };
}

function beatAlignedHarmonyConsensus(input: {
  cqtEvents: HarmonyEvent[];
  subBeatEvents?: HarmonyEvent[];
  originalEvents?: HarmonyEvent[];
  coarseEvents?: HarmonyEvent[];
  phraseEvents?: HarmonyEvent[];
  neuralEvents: NeuralHarmonyOutput["events"];
  originalNeuralEvents?: NeuralHarmonyOutput["events"];
  btcEvents?: BtcHarmonyOutput["events"];
  basicPitch?: BasicPitchOutput;
  personalProfile?: PersonalHarmonyProfile;
  rhythm: NeuralRhythmOutput;
  musicalKey: string;
  durationSeconds: number;
  sourceSuitability?: "good" | "limited" | "unknown";
  bassStemReliability?: number;
  harmonyStemReliability?: number;
}) {
  const beats = input.rhythm.beatTimesSeconds.filter(
    (time, index, values) => Number.isFinite(time) && time >= 0 && time < input.durationSeconds && (index === 0 || time > values[index - 1])
  );
  if (beats.length < 4) return null;
  const finalBoundary = Math.min(
    input.durationSeconds,
    beats.at(-1)! + 60 / Math.max(1, input.rhythm.bpm)
  );
  const boundaries = [...beats, finalBoundary];
  const raw: HarmonyEvent[] = [];
  const beatQuality: HarmonyBeatQuality[] = [];
  let agreedDuration = 0;
  let comparedDuration = 0;
  const bassStemReliability = clamp(input.bassStemReliability ?? 1, 0, 1);
  const harmonyStemReliability = clamp(input.harmonyStemReliability ?? 1, 0, 1);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startSeconds = boundaries[index];
    const endSeconds = boundaries[index + 1];
    const durationSeconds = endSeconds - startSeconds;
    if (durationSeconds < 0.12) continue;
    const subBeat = input.subBeatEvents?.length
      ? subBeatHarmonyDecisionForBeat(input.subBeatEvents, index > 0 ? boundaries[index - 1] : null, startSeconds, endSeconds)
      : null;
    const rawBassDecision = input.subBeatEvents?.length
      ? bassDecisionForBeat(input.subBeatEvents, startSeconds, endSeconds)
      : null;
    const bassDecision = rawBassDecision ? {
      ...rawBassDecision,
      confidence: rawBassDecision.confidence * bassStemReliability,
      stability: rawBassDecision.stability * (0.72 + bassStemReliability * 0.28)
    } : null;
    const cqt = strongestEventForWindow(input.cqtEvents, startSeconds, endSeconds);
    const original = input.originalEvents?.length
      ? strongestEventForWindow(input.originalEvents, startSeconds, endSeconds)
      : null;
    const coarse = input.coarseEvents?.length
      ? strongestEventForWindow(input.coarseEvents, startSeconds, endSeconds)
      : null;
    const phrase = input.phraseEvents?.length
      ? strongestEventForWindow(input.phraseEvents, startSeconds, endSeconds)
      : null;
    const neural = neuralEventForBeat(input.neuralEvents, startSeconds, endSeconds);
    const originalNeural = input.originalNeuralEvents?.length
      ? neuralEventForBeat(input.originalNeuralEvents, startSeconds, endSeconds)
      : null;
    const btcSource = input.btcEvents?.length
      ? strongestEventForWindow(input.btcEvents, startSeconds, endSeconds)
      : null;
    const btc = btcSource?.event
      ? {
          event: {
            ...btcSource.event,
            reviewStatus: btcSource.event.confidence >= 72 ? "likely" as const : "review" as const,
            alternateNames: []
          } satisfies HarmonyEvent,
          overlap: btcSource.overlap
        }
      : null;
    const noteEvent = input.basicPitch
      ? basicPitchEventForBeat(input.basicPitch.events, startSeconds, endSeconds)
      : null;
    const nextEndSeconds = boundaries[index + 2];
    const nextNeural = nextEndSeconds
      ? neuralEventForBeat(input.neuralEvents, endSeconds, nextEndSeconds)
      : null;
    const nextOriginalNeural = nextEndSeconds && input.originalNeuralEvents?.length
      ? neuralEventForBeat(input.originalNeuralEvents, endSeconds, nextEndSeconds)
      : null;
    if (!cqt && !subBeat && !original && !coarse && !phrase && !neural && !originalNeural && !btc) continue;
    const evidenceCandidates = [
      cqt?.event ? { event: cqt.event, baseWeight: 1.2 * harmonyStemReliability, source: "cqt_harmony_stem", overlapRatio: cqt.overlap / durationSeconds } : null,
      subBeat?.event ? {
        event: subBeat.event,
        baseWeight: (subBeat.agreement >= 0.75 ? 0.7 : 0.38) * harmonyStemReliability,
        source: "cqt_half_beat_detail",
        overlapRatio: 1
      } : null,
      original?.event ? { event: original.event, baseWeight: 0.28, source: "cqt_protected_mix", overlapRatio: original.overlap / durationSeconds } : null,
      coarse?.event ? { event: coarse.event, baseWeight: 0.55 * harmonyStemReliability, source: "cqt_two_beat", overlapRatio: coarse.overlap / durationSeconds } : null,
      phrase?.event ? { event: phrase.event, baseWeight: 0.42 * harmonyStemReliability, source: "cqt_full_measure", overlapRatio: phrase.overlap / durationSeconds } : null,
      neural?.event ? { event: neural.event, baseWeight: 0.8 * harmonyStemReliability, source: "madmom_crf_harmony_stem", overlapRatio: neural.overlap / durationSeconds } : null,
      originalNeural?.event ? { event: originalNeural.event, baseWeight: 0.24, source: "madmom_crf_protected_mix", overlapRatio: originalNeural.overlap / durationSeconds } : null,
      btc?.event ? { event: btc.event, baseWeight: 0.35, source: "btc_long_context", overlapRatio: btc.overlap / durationSeconds } : null
    ].filter(Boolean) as Array<{
      event: HarmonyEvent;
      baseWeight: number;
      source: string;
      overlapRatio: number;
    }>;
    const calibratedEvidence = calibrateHarmonyEvidence(evidenceCandidates.map((candidate) => ({
      source: candidate.source,
      identity: chordIdentity(candidate.event.name),
      baseWeight: candidate.baseWeight,
      confidence: candidate.event.confidence ?? 55,
      overlapRatio: candidate.overlapRatio,
      tonalConcentration: candidate.event.tonalConcentration,
      reliabilityMultiplier: input.personalProfile?.sourceReliability[harmonyEvidenceEngineId(candidate.source)] ?? 1
    })));
    const weightedEvidence: WeightedHarmonyEvidence[] = evidenceCandidates.map((candidate, candidateIndex) => ({
      event: candidate.event,
      source: candidate.source,
      baseWeight: candidate.baseWeight,
      weight: calibratedEvidence[candidateIndex].effectiveWeight,
      family: calibratedEvidence[candidateIndex].family,
      reliability: calibratedEvidence[candidateIndex].reliability,
      familyConflict: calibratedEvidence[candidateIndex].familyConflict
    }));
    const evidence = weightedEvidence.map((item) => item.event);
    const votes = new Map<string, { score: number; sources: number; families: Set<HarmonyEvidenceFamily>; representative: string }>();
    for (const source of weightedEvidence) {
      const identity = chordIdentity(source.event.name);
      const current = votes.get(identity) ?? { score: 0, sources: 0, families: new Set<HarmonyEvidenceFamily>(), representative: source.event.name };
      current.score += source.weight;
      current.sources += 1;
      current.families.add(source.family);
      votes.set(identity, current);
      if (isHarmonicInstrumentEvidence(source)) {
        const seenAlternatives = new Set<string>([identity]);
        for (const alternative of (source.event.candidateAlternatives ?? []).slice(0, 8)) {
          const alternativeIdentity = chordIdentity(alternative.name);
          if (alternativeIdentity === "N.C." || seenAlternatives.has(alternativeIdentity)) continue;
          seenAlternatives.add(alternativeIdentity);
          const alternativeVote = votes.get(alternativeIdentity) ?? {
            score: 0,
            sources: 0,
            families: new Set<HarmonyEvidenceFamily>(),
            representative: alternative.name
          };
          alternativeVote.score += source.weight * Math.max(0.2, alternative.score) * 0.34;
          alternativeVote.sources += 1;
          alternativeVote.families.add(source.family);
          votes.set(alternativeIdentity, alternativeVote);
        }
      }
    }
    for (const [identity, vote] of votes) {
      const noteSupport = basicPitchChordSupport(vote.representative, noteEvent);
      const priorSupport = personalPriorForChord(
        vote.representative,
        cqt?.event.relativeKeyContext ?? original?.event.relativeKeyContext ?? input.musicalKey,
        raw.at(-1)?.name,
        input.personalProfile
      );
      vote.score += noteSupport * 0.72 * harmonyStemReliability * (input.personalProfile?.sourceReliability.basic_pitch ?? 1) + priorSupport * 0.16;
    }
    const rootVotes = new Map<string, { score: number; sources: number; families: Set<HarmonyEvidenceFamily> }>();
    const addRootVote = (
      root: string | null,
      score: number,
      family: HarmonyEvidenceFamily,
      sourceUnits = 1
    ) => {
      if (!root || root === "N.C." || score <= 0) return;
      const current = rootVotes.get(root) ?? { score: 0, sources: 0, families: new Set<HarmonyEvidenceFamily>() };
      current.score += score;
      current.sources += sourceUnits;
      current.families.add(family);
      rootVotes.set(root, current);
    };
    for (const source of weightedEvidence) {
      addRootVote(
        chordRoot(source.event.name),
        source.weight,
        source.family
      );
      const alternatives = (source.event.candidateAlternatives ?? []).slice(0, 4);
      for (const alternative of alternatives) {
        addRootVote(chordRoot(alternative.name), source.weight * Math.max(0, alternative.score) * 0.12, source.family);
      }
    }
    const bassRootQualityCandidate = bassDecision && hasStableInversionEvidence(bassDecision)
      ? harmonicInstrumentQualityCandidatesForRoot(bassDecision.name, weightedEvidence, noteEvent)[0]
      : null;
    // Stable isolated Bass is the primary root anchor, but it must still have
    // a playable chord quality in the guitar/keys/other-instrument evidence.
    // This prevents passing Bass notes from becoming invented chord roots.
    if (bassDecision && bassRootQualityCandidate && bassRootQualityCandidate.sourceCount >= 2) {
      addRootVote(
        bassDecision.name,
        1.2 * (bassDecision.confidence / 100) * Math.max(0.64, bassDecision.stability) +
          Math.min(0.5, bassRootQualityCandidate.rank * 0.12),
        "bass_root",
        2
      );
    }
    if (noteEvent?.pitchClasses.length === 12) {
      for (let pitch = 0; pitch < 12; pitch += 1) {
        const name = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][pitch];
        addRootVote(name, (noteEvent.pitchClasses[pitch] ?? 0) * 0.28, "note_events");
      }
    }
    const rankedRoots = [...rootVotes.entries()].sort((left, right) => right[1].score - left[1].score);
    const rootWinner = rankedRoots[0] ?? null;
    const rootMargin = rootWinner ? rootWinner[1].score - (rankedRoots[1]?.[1].score ?? 0) : 0;
    const rootTotal = rankedRoots.reduce((sum, [, vote]) => sum + vote.score, 0);
    const rootShare = rootWinner ? rootWinner[1].score / Math.max(0.001, rootTotal) : 0;
    const rankedVotesAll = [...votes.entries()].sort((left, right) => right[1].score - left[1].score);
    const rootFilteredVotes = rootWinner
      ? rankedVotesAll.filter(([identity]) => chordRoot(identity) === rootWinner[0])
      : [];
    const useRootFirstWinner = Boolean(rootWinner && (
      rootWinner[1].families.size >= 3 ||
      (rootWinner[1].families.size >= 2 && rootMargin >= 0.12) ||
      (bassDecision?.name === rootWinner[0] && bassRootQualityCandidate && rootWinner[1].families.size >= 2 && rootShare >= 0.22)
    ));
    const rankedVotes = useRootFirstWinner && rootFilteredVotes.length ? rootFilteredVotes : rankedVotesAll;
    const majority = rankedVotes[0] ?? null;
    const majorityMargin = majority ? majority[1].score - (rankedVotes[1]?.[1].score ?? 0) : 0;
    const neuralPairIdentity = neural && originalNeural && chordIdentity(neural.event.name) === chordIdentity(originalNeural.event.name)
      ? chordIdentity(neural.event.name)
      : null;
    const nextNeuralPairIdentity = nextNeural && nextOriginalNeural && chordIdentity(nextNeural.event.name) === chordIdentity(nextOriginalNeural.event.name)
      ? chordIdentity(nextNeural.event.name)
      : null;
    const cqtPairIdentity = cqt && original && chordIdentity(cqt.event.name) === chordIdentity(original.event.name)
      ? chordIdentity(cqt.event.name)
      : null;
    const totalVoteScore = rankedVotes.reduce((sum, [, vote]) => sum + vote.score, 0);
    const majorityShare = majority ? majority[1].score / Math.max(0.001, totalVoteScore) : 0;
    const participatingFamilies = new Set(weightedEvidence.map((source) => source.family));
    if (noteEvent) participatingFamilies.add("note_events");
    if (bassDecision) participatingFamilies.add("bass_root");
    const rootVoteQuality = summarizeHarmonyVote({
      winnerScore: rootWinner?.[1].score ?? 0,
      runnerUpScore: rankedRoots[1]?.[1].score ?? 0,
      totalScore: rootTotal,
      supportingFamilyCount: rootWinner?.[1].families.size ?? 0
    });
    const chordVoteQuality = summarizeHarmonyVote({
      winnerScore: majority?.[1].score ?? 0,
      runnerUpScore: rankedVotes[1]?.[1].score ?? 0,
      totalScore: totalVoteScore,
      supportingFamilyCount: majority?.[1].families.size ?? 0
    });
    const cqtPairPreferred = Boolean(cqtPairIdentity && majority?.[0] === cqtPairIdentity);
    const stableCqtPreferred = Boolean(
      cqt &&
      Math.abs(cqt.event.startSeconds - startSeconds) <= 0.12 &&
      cqt.event.durationSeconds >= durationSeconds * 2.5
    );
    const neuralPairPreferred = Boolean(neuralPairIdentity && majority?.[0] === neuralPairIdentity);
    const anticipatedPairPreferred = Boolean(
      nextNeuralPairIdentity &&
      majority?.[0] === nextNeuralPairIdentity &&
      bassDecision?.name === chordRoot(nextNeuralPairIdentity) &&
      (bassDecision.halfAgreement || bassDecision.stability >= 0.78)
    );
    const requiredFamilies = participatingFamilies.size >= 3 ? 2 : Math.min(2, participatingFamilies.size);
    const pairSupportsWinner = cqtPairPreferred || neuralPairPreferred || anticipatedPairPreferred;
    const agreed = Boolean(majority && (
      (
        majority[1].families.size >= requiredFamilies &&
        majorityShare >= 0.42 &&
        majorityMargin >= 0.14
      ) || (
        pairSupportsWinner &&
        majority[1].families.size >= 2 &&
        majorityShare >= 0.55 &&
        majorityMargin >= 0.18
      )
    ));
    if (evidence.length >= 2) comparedDuration += durationSeconds;
    if (agreed) agreedDuration += durationSeconds;

    let selected: HarmonyEvent;
    let alternateName: string | null = null;
    if ((agreed || stableCqtPreferred) && (majority || cqtPairIdentity || neuralPairIdentity || anticipatedPairPreferred || stableCqtPreferred)) {
      // Dual neural agreement is snapped to the real beat grid first. When
      // the neural pair disagrees at a boundary, independent CQT agreement or
      // a stable multi-beat stem chord supplies the conservative fallback.
      // The evidence layers are a real weighted vote. Earlier versions let the two
      // neural views win immediately when they agreed with each other, even
      // when original/stem CQT and note evidence disagreed. Majority score is
      // now authoritative; pair agreement only fills a genuinely empty vote.
      const identity = majority?.[0]
        ?? (cqtPairPreferred ? cqtPairIdentity! : null)
        ?? (neuralPairPreferred ? neuralPairIdentity! : null)
        ?? (anticipatedPairPreferred ? nextNeuralPairIdentity! : null)
        ?? chordIdentity(cqt!.event.name);
      const matchingCqt = cqt && chordIdentity(cqt.event.name) === identity ? cqt.event : null;
      const matchingOriginal = original && chordIdentity(original.event.name) === identity ? original.event : null;
      const matchingCoarse = coarse && chordIdentity(coarse.event.name) === identity ? coarse.event : null;
      const matchingPhrase = phrase && chordIdentity(phrase.event.name) === identity ? phrase.event : null;
      const matchingNeural = neural && chordIdentity(neural.event.name) === identity ? neural.event : null;
      const matchingOriginalNeural = originalNeural && chordIdentity(originalNeural.event.name) === identity ? originalNeural.event : null;
      const matchingBtc = btc && chordIdentity(btc.event.name) === identity ? btc.event : null;
      const matchingNextNeural = nextNeural && chordIdentity(nextNeural.event.name) === identity ? nextNeural.event : null;
      const matchingNextOriginalNeural = nextOriginalNeural && chordIdentity(nextOriginalNeural.event.name) === identity ? nextOriginalNeural.event : null;
      const alternativeSource = weightedEvidence.find((source) =>
        isHarmonicInstrumentEvidence(source) &&
        (source.event.candidateAlternatives ?? []).some((candidate) => chordIdentity(candidate.name) === identity)
      );
      const alternativeName = majority?.[1].representative;
      const alternativeParts = alternativeName ? chordColorParts(alternativeName) : null;
      const synthesizedAlternative = alternativeSource && alternativeName && alternativeParts
        ? {
            ...alternativeSource.event,
            name: alternativeName.replace(/\/[A-G](?:#|b)?$/, ""),
            root: alternativeParts.root,
            quality: alternativeParts.quality,
            bass: null,
            isolatedBassEvidence: false,
            confidence: Math.min(58, alternativeSource.event.confidence),
            reviewStatus: "review" as const
          }
        : null;
      const safeFallback = cqt?.event ?? subBeat?.event ?? original?.event ?? coarse?.event ?? phrase?.event ?? neural?.event ?? originalNeural?.event ?? btc?.event;
      selected = matchingCqt
        ? { ...matchingCqt }
        : matchingOriginal
          ? { ...matchingOriginal }
        : matchingCoarse
          ? { ...matchingCoarse }
          : matchingPhrase
            ? { ...matchingPhrase }
          : matchingNeural
            ? { ...matchingNeural, confidence: 58, reviewStatus: "review" }
            : matchingOriginalNeural
              ? { ...matchingOriginalNeural, confidence: 58, reviewStatus: "review" }
              : matchingBtc
                ? { ...matchingBtc, confidence: Math.min(72, matchingBtc.confidence), reviewStatus: "review" }
              : matchingNextNeural
                ? { ...matchingNextNeural, confidence: 58, reviewStatus: "review" }
                : matchingNextOriginalNeural
                  ? { ...matchingNextOriginalNeural, confidence: 58, reviewStatus: "review" }
                  : synthesizedAlternative
                    ? synthesizedAlternative
                    : { ...safeFallback!, confidence: 42, reviewStatus: "review" };
      alternateName = evidence.find((event) => chordIdentity(event.name) !== identity)?.name ?? null;
    } else if (cqt && neural) {
      const previousName = raw.at(-1)?.name;
      const neuralCoverage = neural.overlap / Math.max(0.001, durationSeconds);
      if (coarse && previousName && chordIdentity(previousName) === chordIdentity(coarse.event.name)) {
        selected = { ...coarse.event, confidence: Math.min(62, coarse.event.confidence), reviewStatus: "review" };
      } else if (
        previousName &&
        chordIdentity(previousName) === chordIdentity(neural.event.name) &&
        chordIdentity(previousName) !== chordIdentity(cqt.event.name) &&
        cqt.event.confidence < 54
      ) {
        selected = { ...neural.event, confidence: 44, reviewStatus: "review" };
      } else if (neuralCoverage >= 0.52) {
        // CQT windows are already snapped to beats, so a boundary error can
        // leak the next chord into the previous beat. The neural event keeps
        // its natural boundary; when it owns most of this beat, trust its
        // simple root/quality and retain CQT only as the alternate opinion.
        selected = { ...neural.event, confidence: 44, reviewStatus: "review" };
      } else {
        // A very short neural fragment is usually a passing tone or boundary
        // uncertainty. Keep the beat-wide CQT decision in that case.
        selected = { ...cqt.event };
      }
      alternateName = chordIdentity(selected.name) === chordIdentity(cqt.event.name)
        ? neural.event.name
        : cqt.event.name;
    } else if (cqt) {
      selected = { ...cqt.event };
    } else if (original) {
      selected = { ...original.event };
    } else if (coarse) {
      selected = { ...coarse.event };
    } else if (phrase) {
      selected = { ...phrase.event };
    } else if (btc) {
      selected = { ...btc.event, confidence: Math.min(68, btc.event.confidence), reviewStatus: "review" };
    } else {
      selected = { ...neural!.event, confidence: 42, reviewStatus: "review" };
    }

    const noChordEvidence = [
      cqt?.event.noChordProbability,
      original?.event.noChordProbability,
      coarse?.event.noChordProbability,
      phrase?.event.noChordProbability,
      noteEvent?.noChordProbability,
      btc?.event.name === "N.C." ? Math.max(0.65, btc.event.confidence / 100) : undefined
    ].filter((value): value is number => Number.isFinite(value));
    const strongNoChordVotes = noChordEvidence.filter((value) => value >= 0.72).length;
    const noChordProbability = noChordEvidence.length
      ? noChordEvidence.reduce((sum, value) => sum + value, 0) / noChordEvidence.length
      : 0;
    if (strongNoChordVotes >= 2 || noChordProbability >= 0.86) {
      alternateName = selected.name;
      selected = {
        ...selected,
        name: "N.C.",
        root: "N.C.",
        quality: "none",
        bass: null,
        confidence: Math.max(selected.confidence, noChordProbability * 100),
        reviewStatus: strongNoChordVotes >= 2 ? "likely" : "review"
      };
    }

    const harmonicInstrumentEvidence = weightedEvidence.filter(isHarmonicInstrumentEvidence);
    const initiallySelectedName = selected.name;
    selected = refineSelectedColorForRoot(selected, harmonicInstrumentEvidence, noteEvent);
    const colorRefinedName = selected.name;
    const beforeBassRootDecision = selected.name;
    selected = applyBassRootFirstHarmony(selected, bassDecision, harmonicInstrumentEvidence, noteEvent);
    const bassRootResolvedName = selected.name;
    if (selected.name !== beforeBassRootDecision) alternateName = beforeBassRootDecision;
    const inversionCandidate = selected.name;
    selected = requireConsensusForInversion(selected, bassDecision);
    if (selected.name !== inversionCandidate) alternateName = inversionCandidate;
    selected = applyIndependentBassInversion(selected, bassDecision);
    const inversionResolvedName = selected.name;
    selected = resolveMajorSixthRelativeMinor(
      selected,
      bassDecision,
      harmonicInstrumentEvidence,
      noteEvent,
      beforeBassRootDecision
    );
    const relativeMinorResolvedName = selected.name;
    selected = attachHarmonyTheoryContext(selected, weightedEvidence);

    const selectedIdentity = chordIdentity(selected.name);
    const localKey = selected.relativeKeyContext ?? cqt?.event.relativeKeyContext ?? original?.event.relativeKeyContext ?? input.musicalKey;
    const personalSupport = personalPriorForChord(selected.name, localKey, raw.at(-1)?.name, input.personalProfile);
    const noteSupport = basicPitchChordSupport(selected.name, noteEvent);
    const boundaryConfidence = clamp(Math.max(
      0,
      ...evidence.map((event) => event.boundaryStrength ?? 0),
      subBeat?.changeConfidence ?? 0
    ), 0, 1);
    const selectedQualityIdentity = chordDisplayIdentity(selected.name.replace(/\/[A-G](?:#|b)?$/, ""));
    const selectedQualityFamilies = new Set(weightedEvidence
      .filter((source) =>
        chordDisplayIdentity(source.event.name.replace(/\/[A-G](?:#|b)?$/, "")) === selectedQualityIdentity ||
        (source.event.candidateAlternatives ?? []).some((candidate) =>
          chordDisplayIdentity(candidate.name.replace(/\/[A-G](?:#|b)?$/, "")) === selectedQualityIdentity
        )
      )
      .map((source) => source.family));
    const selectedQualityCandidates = selected.name === "N.C." || !chordRoot(selected.name)
      ? []
      : harmonicInstrumentQualityCandidatesForRoot(chordRoot(selected.name)!, harmonicInstrumentEvidence, noteEvent);
    const selectedQualityCandidate = selectedQualityCandidates.find((candidate) =>
      chordDisplayIdentity(candidate.representative) === selectedQualityIdentity
    );
    const selectedQualityRunner = selectedQualityCandidates.find((candidate) =>
      chordDisplayIdentity(candidate.representative) !== selectedQualityIdentity
    );
    const selectedQualityVote = selectedQualityCandidate
      ? summarizeHarmonyVote({
          winnerScore: Math.max(0, selectedQualityCandidate.rank),
          runnerUpScore: Math.max(0, selectedQualityRunner?.rank ?? 0),
          totalScore: selectedQualityCandidates.reduce((sum, candidate) => sum + Math.max(0, candidate.rank), 0),
          supportingFamilyCount: selectedQualityCandidate.familyCount + (selectedQualityCandidate.definingSupport >= 0.4 ? 1 : 0)
        })
      : null;
    const selectedHasDefiningColor = qualityDefiningIntervals(selected.name).length > 0;
    const selectedDefiningSupport = definingColorSupport(selected.name, noteEvent?.pitchClasses);
    const selectedRootConfidence = selected.name === "N.C."
      ? clamp(noChordProbability, 0, 1)
      : rootWinner && chordRoot(selected.name) === rootWinner[0]
        ? rootVoteQuality.confidence
        : rootVoteQuality.confidence * 0.52;
    const selectedQualityConfidence = selected.name === "N.C."
      ? clamp(noChordProbability, 0, 1)
      : clamp(
          (selectedQualityVote?.confidence ?? chordVoteQuality.confidence * 0.52) * 0.5 +
          noteSupport * 0.18 +
          Math.min(1, selectedQualityFamilies.size / 2) * 0.2 +
          (selectedHasDefiningColor ? selectedDefiningSupport : 0.72) * 0.12,
          0,
          1
        );
    const strongestFamilyConflict = Math.max(0, ...weightedEvidence.map((source) => source.familyConflict));
    const evidenceConflict = selected.name === "N.C."
      ? strongNoChordVotes < 2 && noChordProbability < 0.86
      : Boolean(
          strongestFamilyConflict >= 0.34 ||
          selectedRootConfidence < 0.44 ||
          selectedQualityConfidence < 0.38 ||
          (!agreed && alternateName)
        );
    const calibratedDecisionConfidence = clamp(
      selectedRootConfidence * 0.44 +
      selectedQualityConfidence * 0.4 +
      noteSupport * 0.08 +
      Math.min(1, participatingFamilies.size / 3) * 0.08,
      0,
      1
    ) * 100;
    const likelyDecision = Boolean(
      agreed &&
      !evidenceConflict &&
      selectedRootConfidence >= 0.58 &&
      selectedQualityConfidence >= 0.5 &&
      selectedQualityFamilies.size + (selectedDefiningSupport >= 0.4 ? 1 : 0) >= 2
    );
    const evidenceAudit: NonNullable<HarmonyEvent["evidence"]> = weightedEvidence.map((source) => ({
      source: source.source,
      name: source.event.name,
      confidence: round(source.event.confidence ?? 0, 1),
      weight: source.weight,
      support: chordDisplayIdentity(source.event.name.replace(/\/[A-G](?:#|b)?$/, "")) === selectedQualityIdentity
        ? "supports"
        : chordIdentity(source.event.name) === selectedIdentity
          ? "neutral"
          : "alternate",
      detail: source.event.bassPitch
        ? `Bass ${source.event.bassPitch} · ${Math.round(source.event.bassPitchConfidence ?? 0)}% · ${harmonyEvidenceFamilyLabel(source.family)}可靠度 ${Math.round(source.reliability * 100)}%`
        : `${harmonyEvidenceFamilyLabel(source.family)} · 有效權重 ${round(source.weight, 3)} / 原始 ${round(source.baseWeight, 3)} · 可靠度 ${Math.round(source.reliability * 100)}%`
    }));
    evidenceAudit.push({
      source: "harmony_decision_trace",
      name: selected.name,
      confidence: round(calibratedDecisionConfidence, 1),
      weight: 0,
      support: "neutral",
      detail: `初選 ${initiallySelectedName} · 色彩 ${colorRefinedName} · Bass ${bassRootResolvedName} · 轉位 ${inversionResolvedName} · 相對小調 ${relativeMinorResolvedName}`
    });
    if (rootWinner) {
      evidenceAudit.push({
        source: "tony_root_first_consensus",
        name: rootWinner[0],
        confidence: round(rootShare * 100, 1),
        weight: 1,
        support: chordRoot(selected.name) === rootWinner[0] ? "supports" : "alternate",
        detail: `${rootWinner[1].families.size} 組獨立根音家族（${rootWinner[1].sources} 個觀測）· 勝差 ${round(rootMargin, 3)}`
      });
    }
    if (bassDecision) {
      evidenceAudit.push({
        source: "bass_root_anchor",
        name: bassDecision.name,
        confidence: round(bassDecision.confidence, 1),
        weight: 1.2,
        support: chordRoot(selected.name) === bassDecision.name || (selected.bass && chordRoot(selected.bass) === bassDecision.name) ? "supports" : "neutral",
        detail: `${bassDecision.observations} 個半拍低音觀測 · 穩定 ${Math.round(bassDecision.stability * 100)}% · CQT/pYIN ${bassDecision.trackerAgreement === true ? "同意" : bassDecision.trackerAgreement === false ? "衝突" : "未提供"} · 根音優先，轉位例外`
      });
    }
    if (noteEvent) {
      evidenceAudit.push({
        source: "basic_pitch_notes",
        name: selected.name,
        confidence: round(noteSupport * 100, 1),
        weight: round(0.72 * harmonyStemReliability * (input.personalProfile?.sourceReliability.basic_pitch ?? 1), 3),
        support: noteSupport >= 0.48 ? "supports" : noteSupport >= 0.25 ? "neutral" : "alternate",
        detail: `${noteEvent.noteCount} notes · tonal ${Math.round(noteEvent.concentration * 100)}%`
      });
    }
    if (input.personalProfile?.baselineSongCount) {
      evidenceAudit.push({
        source: "tony_confirmed_prior",
        name: selected.name,
        confidence: round(personalSupport * 100, 1),
        weight: 0.16,
        support: personalSupport >= 0.2 ? "supports" : "neutral",
        detail: `${input.personalProfile.baselineSongCount} 首人工確認基準譜`
      });
    }

    beatQuality.push({
      rootConfidence: selectedRootConfidence,
      qualityConfidence: selectedQualityConfidence,
      independentFamilyCount: participatingFamilies.size,
      boundaryConfidence,
      conflict: evidenceConflict
    });
    raw.push({
      ...selected,
      startSeconds: round(startSeconds, 3),
      durationSeconds: round(durationSeconds, 3),
      confidence: selected.name === "N.C."
        ? Math.max(58, Math.min(92, selected.confidence ?? noChordProbability * 100))
        : likelyDecision
          ? Math.max(68, Math.min(90, (selected.confidence ?? 72) * 0.45 + calibratedDecisionConfidence * 0.55))
          : Math.min(64, Math.max(34, calibratedDecisionConfidence)),
      reviewStatus: selected.name === "N.C." && strongNoChordVotes >= 2 ? "likely" : likelyDecision ? "likely" : "review",
      alternateNames: alternateName && chordIdentity(alternateName) !== chordIdentity(selected.name) ? [alternateName] : [],
      evidence: evidenceAudit,
      boundaryConfidence: round(boundaryConfidence, 4),
      harmonicChangeConfidence: round(subBeat?.changeConfidence ?? 0, 4),
      subBeatAgreement: round(subBeat?.agreement ?? 0, 4),
      bassPitch: bassDecision?.name ?? selected.bassPitch,
      bassPitchConfidence: bassDecision?.confidence ?? selected.bassPitchConfidence,
      bassPitchStability: bassDecision?.stability ?? selected.bassPitchStability,
      noChordProbability: round(noChordProbability, 4),
      notePitchClasses: noteEvent?.pitchClasses,
      noteMidiWeights: noteEvent?.stableMidis,
      initialHarmonyName: initiallySelectedName,
      personalPriorSupport: round(personalSupport, 4),
      rootConfidence: round(selectedRootConfidence, 4),
      qualityConfidence: round(selectedQualityConfidence, 4),
      independentSourceCount: participatingFamilies.size,
      evidenceConflict
    });
  }

  for (let index = 1; index < raw.length - 1; index += 1) {
    const previous = raw[index - 1];
    const current = raw[index];
    const next = raw[index + 1];
    if (
      (current.noChordProbability ?? 0) < 0.72 &&
      shouldSmoothTransientChord(previous, current, next, 60 / Math.max(1, input.rhythm.bpm))
    ) {
      raw[index] = {
        ...applyChordDecisionToLocalContext(current, previous),
        startSeconds: current.startSeconds,
        durationSeconds: current.durationSeconds,
        confidence: Math.min(58, current.confidence),
        reviewStatus: "review",
        alternateNames: [...new Set([current.name, ...(current.alternateNames ?? [])])].slice(0, 3)
      };
    }
  }

  const repeated = applyRepeatedHarmonyConsensus(raw, input.basicPitch, input.rhythm.beatsPerBar);
  const events: HarmonyEvent[] = [];
  const beatDuration = 60 / Math.max(1, input.rhythm.bpm);
  const spelled = stabilizeHarmonyColorRuns(repeated.events, beatDuration)
    .map((event) => spellHarmonyEventForKey(event, input.musicalKey));
  const structural = decodeStructuralHarmony(spelled, beatDuration);
  const stabilizedRaw = structural.events;
  for (const event of stabilizedRaw) {
    const previous = events.at(-1);
    if (previous && chordDisplayIdentity(previous.name) === chordDisplayIdentity(event.name) && Math.abs(previous.startSeconds + previous.durationSeconds - event.startSeconds) < 0.08) {
      const totalDuration = previous.durationSeconds + event.durationSeconds;
      previous.confidence = round(
        (previous.confidence * previous.durationSeconds + event.confidence * event.durationSeconds) / Math.max(0.001, totalDuration),
        1
      );
      previous.durationSeconds = round(totalDuration, 3);
      previous.reviewStatus = previous.reviewStatus === "likely" && event.reviewStatus === "likely" ? "likely" : "review";
      previous.alternateNames = [...new Set([...(previous.alternateNames ?? []), ...(event.alternateNames ?? [])])]
        .filter((name) => chordIdentity(name) !== chordIdentity(previous.name));
      previous.evidence = compactHarmonyEvidence([...(previous.evidence ?? []), ...(event.evidence ?? [])]);
      previous.boundaryConfidence = Math.max(previous.boundaryConfidence ?? 0, event.boundaryConfidence ?? 0);
      previous.harmonicChangeConfidence = Math.max(previous.harmonicChangeConfidence ?? 0, event.harmonicChangeConfidence ?? 0);
      previous.subBeatAgreement = Math.max(previous.subBeatAgreement ?? 0, event.subBeatAgreement ?? 0);
      previous.noChordProbability = Math.max(previous.noChordProbability ?? 0, event.noChordProbability ?? 0);
      previous.repeatedSectionSupport = Math.max(previous.repeatedSectionSupport ?? 0, event.repeatedSectionSupport ?? 0);
      previous.personalPriorSupport = Math.max(previous.personalPriorSupport ?? 0, event.personalPriorSupport ?? 0);
      previous.structuralConfidence = Math.max(previous.structuralConfidence ?? 0, event.structuralConfidence ?? 0);
      previous.structuralDecision = previous.structuralDecision === "unchanged" && event.structuralDecision === "unchanged"
        ? "unchanged"
        : previous.structuralDecision === "context_consensus" || event.structuralDecision === "context_consensus"
          ? "context_consensus"
          : "simplified_color";
      previous.acousticDetailName = previous.acousticDetailName ?? event.acousticDetailName;
    } else {
      events.push({ ...event });
    }
  }

  return {
    events,
    agreementRatio: agreedDuration / Math.max(0.001, comparedDuration),
    repeatedGroupCount: repeated.groupCount,
    structuralSimplifiedBeatCount: structural.simplifiedBeatCount,
    structuralChordChangeCount: structural.structuralChordChangeCount,
    qualityGate: buildHarmonyPipelineQualityGate(beatQuality, {
      beatGridConfidence: clamp(input.rhythm.confidence / 100, 0, 1),
      sourceSuitability: input.sourceSuitability,
      bassStemReliability: input.bassStemReliability,
      harmonyStemReliability: input.harmonyStemReliability
    })
  };
}

async function optionalNeuralHarmony(filePath: string, musicalKey?: string | null) {
  const candidates = [
    process.env.SONGZU_HARMONY_NEURAL_PYTHON?.trim() || "",
    join(homedir(), "Library", "Application Support", "頌祖音樂 OS", "harmony-engine", "venv", "bin", "python"),
    storagePath("cache", "harmony-engine", "venv", "bin", "python")
  ].filter(Boolean);
  const python = await executablePath("python", candidates);
  if (!python || !candidates.includes(python)) return null;
  const script = appAssetPath("scripts", "analyze-harmony-neural.py");
  await access(script);
  const sourceInfo = await stat(filePath);
  const cacheKey = createHash("sha256")
    .update(`harmony-neural-v1:${filePath}:${sourceInfo.size}:${sourceInfo.mtimeMs}:${musicalKey ?? ""}`)
    .digest("hex")
    .slice(0, 24);
  const cacheRoot = storagePath("cache", "harmony-neural");
  const cachePath = join(cacheRoot, `${cacheKey}.json`);
  try {
    const result = parseNeuralHarmonyOutput(await readFile(cachePath, "utf8"));
    markHarmonyCache("madmom_cnn_crf", true);
    markHarmonyEngine({ engineId: "madmom_cnn_crf", qualityPassed: true, detail: "神經和聲快取通過格式驗證" });
    return result;
  } catch {
    markHarmonyCache("madmom_cnn_crf", false);
    // Missing or stale cache falls through to the local model.
  }
  const startedAt = performance.now();
  const args = [script, "--input", filePath];
  if (musicalKey) args.push("--key", musicalKey);
  const { stdout } = await runProcess(python, args, { maxBytes: 4 * 1024 * 1024 });
  const serialized = stdout.toString("utf8");
  const result = parseNeuralHarmonyOutput(serialized);
  markHarmonyEngine({ engineId: "madmom_cnn_crf", qualityPassed: true, durationMs: performance.now() - startedAt, detail: "CNN/CRF 和聲序列通過格式驗證" });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath, serialized, "utf8");
  return result;
}

async function optionalBasicPitch(
  filePath: string,
  beatTimesSeconds: number[]
) {
  if (beatTimesSeconds.length < 2) return null;
  const python = await pythonForModule("basic_pitch");
  if (!python) return null;
  const script = appAssetPath("scripts", "analyze-notes-basic-pitch.py");
  await access(script);
  const sourceInfo = await stat(filePath);
  const beatHash = createHash("sha256").update(JSON.stringify(beatTimesSeconds)).digest("hex").slice(0, 12);
  const cacheKey = createHash("sha256")
    .update(`basic-pitch-v1:${filePath}:${sourceInfo.size}:${sourceInfo.mtimeMs}:${beatHash}`)
    .digest("hex")
    .slice(0, 24);
  const cacheRoot = storagePath("cache", "basic-pitch");
  const cachePath = join(cacheRoot, `${cacheKey}.json`);
  try {
    const result = parseBasicPitchOutput(await readFile(cachePath, "utf8"));
    markHarmonyCache("basic_pitch", true);
    markHarmonyEngine({ engineId: "basic_pitch", qualityPassed: true, detail: `${result.noteCount} 個音符事件（快取）` });
    return result;
  } catch {
    markHarmonyCache("basic_pitch", false);
    // Missing or stale cache falls through to the local CoreML model.
  }
  const startedAt = performance.now();
  const { stdout } = await runProcess(python, [
    script,
    "--input", filePath,
    "--beat-times-json", JSON.stringify(beatTimesSeconds)
  ], { maxBytes: 12 * 1024 * 1024 });
  const serialized = stdout.toString("utf8");
  const result = parseBasicPitchOutput(serialized);
  markHarmonyEngine({ engineId: "basic_pitch", qualityPassed: true, durationMs: performance.now() - startedAt, detail: `${result.noteCount} 個音符事件` });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath, serialized, "utf8");
  return result;
}

async function optionalBtcHarmony(filePath: string) {
  const python = await pythonForModule("torch");
  if (!python) return null;
  const script = appAssetPath("scripts", "analyze-harmony-btc.py");
  await access(script);
  const repoCandidates = [
    process.env.SONGZU_BTC_REPO?.trim() || "",
    storagePath("cache", "vendor", "BTC-ISMIR19"),
    join(process.cwd(), ".cache", "vendor", "BTC-ISMIR19")
  ].filter(Boolean);
  let repo: string | null = null;
  for (const candidate of repoCandidates) {
    try {
      await access(join(candidate, "test", "btc_model_large_voca.pt"));
      repo = candidate;
      break;
    } catch {
      // Continue to the next external cache location.
    }
  }
  if (!repo) return null;
  const sourceInfo = await stat(filePath);
  const modelInfo = await stat(join(repo, "test", "btc_model_large_voca.pt"));
  const cacheKey = createHash("sha256")
    .update(`btc-ismir19-v1:${filePath}:${sourceInfo.size}:${sourceInfo.mtimeMs}:${modelInfo.size}:${modelInfo.mtimeMs}`)
    .digest("hex")
    .slice(0, 24);
  const cacheRoot = storagePath("cache", "harmony-btc");
  const cachePath = join(cacheRoot, `${cacheKey}.json`);
  try {
    const result = parseBtcHarmonyOutput(await readFile(cachePath, "utf8"));
    markHarmonyCache("btc_ismir19", true);
    markHarmonyEngine({ engineId: "btc_ismir19", qualityPassed: true, detail: `${result.events.length} 個長距離和聲事件（快取）` });
    return result;
  } catch {
    markHarmonyCache("btc_ismir19", false);
    // Missing or stale cache falls through to the external reference model.
  }
  const startedAt = performance.now();
  const { stdout } = await runProcess(python, [script, "--input", filePath, "--repo", repo], {
    maxBytes: 8 * 1024 * 1024
  });
  const serialized = stdout.toString("utf8");
  const result = parseBtcHarmonyOutput(serialized);
  markHarmonyEngine({ engineId: "btc_ismir19", qualityPassed: true, durationMs: performance.now() - startedAt, detail: `${result.events.length} 個長距離和聲事件` });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath, serialized, "utf8");
  return result;
}

async function buildPersonalHarmonyProfile(excludeSongId: string): Promise<PersonalHarmonyProfile> {
  const drafts = await prisma.dawScoreDraft.findMany({
    where: { targetInstrument: "guitar" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      resultJson: true,
      project: { select: { songId: true } }
    }
  });
  const degreeQualityCounts: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  const sourceReliabilityTotals: Record<string, { weightedAccuracy: number; samples: number }> = {};
  const includedSongs = new Set<string>();
  for (const draft of drafts) {
    if (draft.project.songId === excludeSongId || includedSongs.has(draft.project.songId)) continue;
    try {
      const score = JSON.parse(draft.resultJson) as AutoScoreResult;
      const humanConfirmed = (score.review?.status === "finalized" && score.review.verificationMethod === "manual") || score.verification?.humanConfirmed === true;
      if (score.format !== "songzu-auto-score" || !humanConfirmed) continue;
      const benchmark = score.humanBenchmark ?? buildAutoScoreHumanBenchmark(score);
      for (const engine of benchmark?.engines ?? []) {
        const rootAccuracy = engine.root.accuracy ?? 0.5;
        const qualityAccuracy = engine.quality.accuracy ?? 0.5;
        const combined = rootAccuracy * 0.58 + qualityAccuracy * 0.42;
        const current = sourceReliabilityTotals[engine.engineId] ?? { weightedAccuracy: 0, samples: 0 };
        current.weightedAccuracy += combined * engine.sampleCount;
        current.samples += engine.sampleCount;
        sourceReliabilityTotals[engine.engineId] = current;
      }
      const beats = autoScoreReviewMeasures(score).flatMap((measure) => measure.beats);
      let previousDegree: string | null = null;
      for (const beat of beats) {
        if (beat.name === "N.C.") {
          previousDegree = null;
          continue;
        }
        const degree = degreeForChord(beat.name, score.musicalKey);
        if (!degree) continue;
        const quality = qualityIdentity(beat.name);
        degreeQualityCounts[`${degree}:${quality}`] = (degreeQualityCounts[`${degree}:${quality}`] ?? 0) + 1;
        if (previousDegree) {
          const key = `${previousDegree}>${degree}:${quality}`;
          transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;
        }
        previousDegree = degree;
      }
      includedSongs.add(draft.project.songId);
    } catch {
      // Historical drafts that predate the score schema are ignored.
    }
  }
  return {
    baselineSongCount: includedSongs.size,
    degreeQualityCounts,
    transitionCounts,
    maxDegreeQualityCount: Math.max(1, ...Object.values(degreeQualityCounts)),
    maxTransitionCount: Math.max(1, ...Object.values(transitionCounts)),
    sourceReliability: Object.fromEntries(Object.entries(sourceReliabilityTotals).map(([engineId, value]) => {
      if (value.samples < 24) return [engineId, 1];
      const accuracy = value.weightedAccuracy / value.samples;
      return [engineId, round(Math.min(1.18, Math.max(0.78, 0.72 + accuracy * 0.46)), 3)];
    }))
  };
}

async function confirmedRhythmForSong(
  songId: string,
  durationSeconds?: number | null
): Promise<{ rhythm: NeuralRhythmOutput; draftId: string } | null> {
  const drafts = await prisma.dawScoreDraft.findMany({
    where: {
      targetInstrument: "guitar",
      project: { songId }
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, resultJson: true }
  });
  for (const draft of drafts) {
    try {
      const score = JSON.parse(draft.resultJson) as AutoScoreResult;
      const humanConfirmed = (score.review?.status === "finalized" && score.review.verificationMethod === "manual") || score.verification?.humanConfirmed === true;
      const rhythm = score.rhythm as NeuralRhythmOutput | undefined;
      if (
        score.format !== "songzu-auto-score" ||
        !humanConfirmed ||
        !rhythm?.beatTimesSeconds?.length ||
        rhythm.beatTimesSeconds.length !== rhythm.beatNumbers?.length ||
        !rhythm.downbeatTimesSeconds?.length
      ) continue;
      if (durationSeconds && score.durationSeconds) {
        const tolerance = Math.max(1.5, durationSeconds * 0.012);
        if (Math.abs(score.durationSeconds - durationSeconds) > tolerance) continue;
      }
      return {
        draftId: draft.id,
        rhythm: {
          ...rhythm,
          warnings: [
            ...(rhythm.warnings ?? []),
            "本次只沿用 本機創作者 已確認的拍點與小節位置；該正式譜的和弦答案沒有加入本曲重新判定。"
          ],
          diagnostics: {
            ...(rhythm.diagnostics ?? {}),
            confirmedRhythmReference: { draftId: draft.id, chordDataUsed: false }
          }
        }
      };
    } catch {
      // Ignore malformed historical score data and continue to a fresh beat analysis.
    }
  }
  return null;
}

async function optionalNeuralRhythm(filePath: string, timeSignature: string) {
  const candidates = [
    process.env.SONGZU_HARMONY_NEURAL_PYTHON?.trim() || "",
    join(homedir(), "Library", "Application Support", "頌祖音樂 OS", "harmony-engine", "venv", "bin", "python"),
    storagePath("cache", "harmony-engine", "venv", "bin", "python")
  ].filter(Boolean);
  const python = await executablePath("python", candidates);
  if (!python || !candidates.includes(python)) return null;
  const script = appAssetPath("scripts", "analyze-rhythm-neural.py");
  await access(script);
  const beatsPerBar = Math.max(2, Math.min(12, Number.parseInt(timeSignature.split("/")[0] || "4", 10) || 4));
  const startedAt = performance.now();
  const { stdout } = await runProcess(
    python,
    [script, "--input", filePath, "--beats-per-bar", String(beatsPerBar)],
    { maxBytes: 4 * 1024 * 1024 }
  );
  const result = parseNeuralRhythmOutput(stdout.toString("utf8"));
  markHarmonyEngine({
    engineId: "madmom_rnn_beat_grid_v1",
    qualityPassed: result.confidence >= 55,
    durationMs: performance.now() - startedAt,
    detail: `${result.beatTimesSeconds.length} 拍 · 可信 ${Math.round(result.confidence)}%`
  });
  return result;
}

function normalizeRhythmToMarkedTempo(
  rhythm: NeuralRhythmOutput,
  markedBpm: number,
  timeSignature: string
): NeuralRhythmOutput {
  if (!Number.isFinite(markedBpm) || markedBpm < 35) return rhythm;
  const ratio = rhythm.bpm / markedBpm;
  const globalDoublePulse = Math.abs(ratio - 2) <= 0.12;
  const mixedDoublePulse = rhythm.tempoMap.some((entry) => entry.bpm >= markedBpm * 1.55) &&
    rhythm.tempoMap.some((entry) => entry.bpm >= markedBpm * 0.72 && entry.bpm <= markedBpm * 1.28);
  if (!globalDoublePulse && !mixedDoublePulse) return rhythm;
  const beatsPerBar = Math.max(2, Math.min(12, Number.parseInt(timeSignature.split("/")[0] || "4", 10) || 4));
  const stableTempoEntries = rhythm.tempoMap
    .map((entry) => entry.bpm)
    .filter((bpm) => bpm >= markedBpm * 0.72 && bpm <= markedBpm * 1.28)
    .sort((left, right) => left - right);
  const stableTempo = stableTempoEntries.length
    ? stableTempoEntries[Math.floor(stableTempoEntries.length / 2)]
    : markedBpm;
  const normalizedBpm = globalDoublePulse ? markedBpm : stableTempo;
  const targetInterval = 60 / normalizedBpm;
  const candidates = rhythm.beatTimesSeconds
    .map((time, originalIndex) => ({ time, originalIndex }))
    .filter((item, index, values) => Number.isFinite(item.time) && item.time >= 0 && (index === 0 || item.time > values[index - 1].time));
  const anchorTime = rhythm.firstDownbeatSeconds;
  const nearestAnchor = candidates
    .map((item, index) => ({ index, distance: Math.abs(item.time - anchorTime) }))
    .sort((left, right) => left.distance - right.distance)[0]?.index ?? 0;
  const anchor = candidates[nearestAnchor];
  if (!anchor) return rhythm;

  const forward: typeof candidates = [];
  let previous = anchor;
  for (let cursor = nearestAnchor + 1; cursor < candidates.length;) {
    const expected = previous.time + targetInterval;
    const minimum = previous.time + targetInterval * 0.52;
    const maximum = previous.time + targetInterval * 1.48;
    while (cursor < candidates.length && candidates[cursor].time < minimum) cursor += 1;
    const options: typeof candidates = [];
    for (let probe = cursor; probe < candidates.length && candidates[probe].time <= maximum; probe += 1) {
      options.push(candidates[probe]);
    }
    const selected = options.sort((left, right) => Math.abs(left.time - expected) - Math.abs(right.time - expected))[0];
    if (!selected) {
      if (cursor < candidates.length && candidates[cursor].time - previous.time <= targetInterval * 1.9) {
        previous = candidates[cursor];
        forward.push(previous);
        cursor += 1;
        continue;
      }
      break;
    }
    forward.push(selected);
    previous = selected;
    cursor = selected.originalIndex + 1;
  }

  const backward: typeof candidates = [];
  let following = anchor;
  for (let cursor = nearestAnchor - 1; cursor >= 0;) {
    const expected = following.time - targetInterval;
    const minimum = following.time - targetInterval * 1.48;
    const maximum = following.time - targetInterval * 0.52;
    while (cursor >= 0 && candidates[cursor].time > maximum) cursor -= 1;
    const options: typeof candidates = [];
    for (let probe = cursor; probe >= 0 && candidates[probe].time >= minimum; probe -= 1) {
      options.push(candidates[probe]);
    }
    const selected = options.sort((left, right) => Math.abs(left.time - expected) - Math.abs(right.time - expected))[0];
    if (!selected) break;
    backward.push(selected);
    following = selected;
    cursor = selected.originalIndex - 1;
  }
  const selected = [...backward.reverse(), anchor, ...forward];
  if (selected.length < beatsPerBar * 2) return rhythm;
  const anchorSelectedIndex = Math.max(0, selected.findIndex((item) => item.originalIndex === anchor.originalIndex));
  const beatNumbers = selected.map((_item, index) => {
    const relative = ((index - anchorSelectedIndex) % beatsPerBar + beatsPerBar) % beatsPerBar;
    return relative + 1;
  });
  const beatTimesSeconds = selected.map((item) => item.time);
  const downbeatTimesSeconds = beatTimesSeconds.filter((_time, index) => beatNumbers[index] === 1);
  const residuals = selected.slice(1).map((item, index) => Math.abs((item.time - selected[index].time) - targetInterval));
  const meanResidualMs = residuals.length
    ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length * 1000
    : 0;
  const correctionLabel = mixedDoublePulse && !globalDoublePulse
    ? `後段局部雙倍脈衝`
    : `全曲雙倍脈衝`;
  return {
    ...rhythm,
    bpm: normalizedBpm,
    displayBpm: normalizedBpm,
    beatsPerBar,
    firstBeatSeconds: beatTimesSeconds[0],
    firstDownbeatSeconds: downbeatTimesSeconds[0] ?? beatTimesSeconds[anchorSelectedIndex],
    beatTimesSeconds,
    beatNumbers,
    downbeatTimesSeconds,
    tempoMap: rhythm.tempoMap.map((entry) => ({
      ...entry,
      bpm: round(entry.bpm > normalizedBpm * 1.55 ? entry.bpm / 2 : entry.bpm, 3)
    })),
    warnings: [
      ...rhythm.warnings,
      `神經引擎偵測到${correctionLabel}；已依 ${normalizedBpm.toFixed(3)} BPM 的穩定脈衝逐拍追蹤最近候選，不讓後半段突然變成兩倍小節。`
    ],
    diagnostics: {
      ...(rhythm.diagnostics ?? {}),
      markedTempoNormalization: {
        sourceBpm: rhythm.bpm,
        markedBpm,
        normalizedBpm,
        mode: mixedDoublePulse && !globalDoublePulse
          ? "adaptive_mixed_double_pulse_tracking"
          : "adaptive_double_pulse_tracking",
        selectedBeatCount: selected.length,
        sourceBeatCount: candidates.length,
        meanIntervalResidualMs: round(meanResidualMs, 2)
      }
    }
  };
}

async function analyzeHarmonyFile(input: {
  songId: string;
  filePath: string;
  harmonyFocusFilePath?: string | null;
  bassEvidenceFilePath?: string | null;
  bassStemReliability?: number;
  harmonyStemReliability?: number;
  sourceSuitability?: "good" | "limited" | "unknown";
  target: Exclude<AutoScoreTarget, "drums">;
  bpm: number;
  musicalKey?: string | null;
  timeSignature: string;
  isolatedStem: boolean;
  durationSeconds?: number | null;
}) {
  const python = await executablePath("python3", ["/usr/bin/python3", "/opt/homebrew/bin/python3"]);
  if (!python) throw new Error("找不到本機 Python 和聲分析環境");
  const script = appAssetPath("scripts", "analyze-harmony.py");
  await access(script);
  const warnings: string[] = [];
  let rhythm: NeuralRhythmOutput | null = null;
  try {
    rhythm = await runHarmonyPipelineStage("beat_grid", async () => {
      const confirmedRhythm = await confirmedRhythmForSong(input.songId, input.durationSeconds);
      if (confirmedRhythm) {
        markHarmonyEngine({ engineId: "madmom_rnn_beat_grid_v1", participated: true, qualityPassed: true, detail: "沿用本曲已人工確認拍點" });
        warnings.push(`沿用本曲已人工鎖定的節拍網格（${confirmedRhythm.draftId}），只重新分析和弦證據。`);
        return confirmedRhythm.rhythm;
      }
      const detected = await optionalNeuralRhythm(input.filePath, input.timeSignature);
      return detected ? normalizeRhythmToMarkedTempo(detected, input.bpm, input.timeSignature) : null;
    }, {
      detail: "RNN 拍點、Downbeat 與標記速度校正",
      outcome: (value) => !value ? "review" : value.confidence >= 55 ? "passed" : "degraded"
    });
    if (rhythm) {
      warnings.push(
        `本機神經節拍格：${rhythm.bpm.toFixed(2)} BPM，首個可信強拍 ${rhythm.firstDownbeatSeconds.toFixed(2)} 秒。`
      );
      warnings.push(...rhythm.warnings);
    }
  } catch (error) {
    warnings.push(`神經節拍格暫時不可用：${error instanceof Error ? error.message : "分析器錯誤"}`);
    markHarmonyPipelineFallback("神經拍點失敗，已禁止逐拍高可信輸出");
  }
  const analysisBpm = rhythm?.bpm ?? input.bpm;
  const args = [
    script,
    "--input",
    input.filePath,
    "--bpm",
    String(analysisBpm),
    "--time-signature",
    input.timeSignature,
    "--max-seconds",
    String(MAX_ANALYSIS_SECONDS)
  ];
  if (input.musicalKey) args.push("--key", input.musicalKey);
  const runCqtAnalysis = async (filePath: string, windowBeats = 1, subdivisionsPerBeat = 1) => {
    const focusArgs = [
      ...args,
      "--window-beats",
      String(windowBeats),
      "--subdivisions-per-beat",
      String(subdivisionsPerBeat)
    ];
    focusArgs[focusArgs.indexOf(input.filePath)] = filePath;
    if (input.bassEvidenceFilePath) focusArgs.push("--bass-input", input.bassEvidenceFilePath);
    if (rhythm?.beatTimesSeconds.length) {
      focusArgs.push("--beat-times-json", JSON.stringify(rhythm.beatTimesSeconds));
    }
    const [sourceInfo, bassInfo, scriptInfo] = await Promise.all([
      stat(filePath),
      input.bassEvidenceFilePath ? stat(input.bassEvidenceFilePath) : Promise.resolve(null),
      stat(script)
    ]);
    const beatHash = createHash("sha256")
      .update(JSON.stringify(rhythm?.beatTimesSeconds ?? []))
      .digest("hex")
      .slice(0, 12);
    const cacheKey = createHash("sha256")
      .update([
        "harmony-cqt-v8",
        filePath,
        sourceInfo.size,
        sourceInfo.mtimeMs,
        input.bassEvidenceFilePath ?? "",
        bassInfo?.size ?? 0,
        bassInfo?.mtimeMs ?? 0,
        scriptInfo.size,
        scriptInfo.mtimeMs,
        windowBeats,
        subdivisionsPerBeat,
        analysisBpm,
        input.musicalKey ?? "",
        beatHash
      ].join(":"))
      .digest("hex")
      .slice(0, 24);
    const cacheRoot = storagePath("cache", "harmony-cqt-v8");
    const cachePath = join(cacheRoot, `${cacheKey}.json`);
    try {
      const result = parseHarmonyAnalyzerOutput(await readFile(cachePath, "utf8"));
      markHarmonyCache("songzu_harmony_v2", true);
      markHarmonyEngine({ engineId: "songzu_harmony_v2", qualityPassed: result.events.length > 0, detail: `${result.events.length} 個 CQT 事件（快取）` });
      return result;
    } catch {
      markHarmonyCache("songzu_harmony_v2", false);
      // Missing or stale cache falls through to the local CQT analyzer.
    }
    const startedAt = performance.now();
    const { stdout } = await runProcess(python, focusArgs, { maxBytes: 8 * 1024 * 1024 });
    const serialized = stdout.toString("utf8");
    const result = parseHarmonyAnalyzerOutput(serialized);
    markHarmonyEngine({ engineId: "songzu_harmony_v2", qualityPassed: result.events.length > 0, durationMs: performance.now() - startedAt, detail: `${result.events.length} 個 CQT 事件` });
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(cachePath, serialized, "utf8");
    return result;
  };
  const originalAnalysis = await runHarmonyPipelineStage(
    "chord_quality",
    () => runCqtAnalysis(input.filePath),
    { detail: "和聲樂器 CQT、調音校正與多尺度和弦性質" }
  );
  let focusAnalysis: HarmonyAnalyzerOutput | null = null;
  if (input.harmonyFocusFilePath && input.harmonyFocusFilePath !== input.filePath) {
    try {
      focusAnalysis = await runCqtAnalysis(input.harmonyFocusFilePath);
      warnings.push("已使用本機 Bass 根音 + 吉他／鍵盤／其他和聲樂器雙路分析；Bass 先提出穩定根音，和聲分軌決定和弦性質，人聲與鼓聲不參與主要命名。");
    } catch (error) {
      warnings.push(`分軌和聲焦點暫時不可用：${error instanceof Error ? error.message : "分析器錯誤"}`);
    }
  }
  if (input.bassEvidenceFilePath && focusAnalysis) {
    runHarmonyPipelineStageSync("bass_root", () => true, { detail: "Bass pYIN + 低頻 CQT 根音與轉位驗證" });
  } else {
    skipHarmonyPipelineStage("bass_root", "沒有可用的獨立 Bass Stem；根音只使用完整混音的低頻證據");
  }
  const analysis = focusAnalysis ?? originalAnalysis;
  if (!analysis.events.length) throw new Error("本機和聲分析器沒有找到穩定和弦段落");
  let subBeatAnalysis: HarmonyAnalyzerOutput | null = null;
  try {
    subBeatAnalysis = await runCqtAnalysis(input.harmonyFocusFilePath ?? input.filePath, 1, 2);
    warnings.push("已加入每拍前後兩個半拍的細節層，專門辨識換和弦位置與穩定低音轉位；正式譜仍維持每拍一格。");
  } catch (error) {
    warnings.push(`半拍細節分析暫時不可用：${error instanceof Error ? error.message : "分析器錯誤"}`);
  }
  let coarseAnalysis: HarmonyAnalyzerOutput | null = null;
  try {
    coarseAnalysis = await runCqtAnalysis(input.harmonyFocusFilePath ?? input.filePath, 2);
    warnings.push("已加入兩拍長視窗和聲證據，降低 Bass 經過音與旋律音造成的單拍誤判。");
  } catch (error) {
    warnings.push(`長視窗和聲分析暫時不可用：${error instanceof Error ? error.message : "分析器錯誤"}`);
  }
  let phraseAnalysis: HarmonyAnalyzerOutput | null = null;
  try {
    phraseAnalysis = await runCqtAnalysis(input.harmonyFocusFilePath ?? input.filePath, 4);
    warnings.push("已加入整小節和聲穩定性證據，減少旋律經過音形成的短暫錯誤和弦。");
  } catch (error) {
    warnings.push(`整小節和聲分析暫時不可用：${error instanceof Error ? error.message : "分析器錯誤"}`);
  }
  let events = analysis.events;
  let confidence = analysis.confidence;
  let analysisMode: AutoScoreResult["analysisMode"] = "cqt";
  let repeatedGroupCount = 0;
  let basicPitch: BasicPitchOutput | null = null;
  let btcHarmony: BtcHarmonyOutput | null = null;
  let personalProfile: PersonalHarmonyProfile = {
    baselineSongCount: 0,
    degreeQualityCounts: {},
    transitionCounts: {},
    maxDegreeQualityCount: 1,
    maxTransitionCount: 1,
    sourceReliability: {}
  };
  let focusNeural: NeuralHarmonyOutput | null = null;
  let sourceNeural: NeuralHarmonyOutput | null = null;
  warnings.push("已標記的歌曲調性作為主錨點；持續足夠久的局部音訊證據仍可建立轉調，單一屬和弦或借用和弦不會改寫全曲主調。");
  if (rhythm?.beatTimesSeconds.length) {
    warnings.push("所有 CQT 視窗共用同一份神經拍點，每個和弦決策均先對齊實際歌曲拍點再融合。");
  }
  const neuralSource = input.harmonyFocusFilePath ?? input.filePath;
  const [focusNeuralResult, originalNeuralResult, basicPitchResult, btcResult, profileResult] = await Promise.allSettled([
    optionalNeuralHarmony(neuralSource, analysis.musicalKey),
    neuralSource !== input.filePath
      ? optionalNeuralHarmony(input.filePath, analysis.musicalKey)
      : Promise.resolve(null),
    rhythm?.beatTimesSeconds.length
      ? optionalBasicPitch(neuralSource, rhythm.beatTimesSeconds)
      : Promise.resolve(null),
    optionalBtcHarmony(input.filePath),
    buildPersonalHarmonyProfile(input.songId)
  ]);
  focusNeural = focusNeuralResult.status === "fulfilled" ? focusNeuralResult.value : null;
  sourceNeural = originalNeuralResult.status === "fulfilled" ? originalNeuralResult.value : null;
  basicPitch = basicPitchResult.status === "fulfilled" ? basicPitchResult.value : null;
  btcHarmony = btcResult.status === "fulfilled" ? btcResult.value : null;
  personalProfile = profileResult.status === "fulfilled" ? profileResult.value : personalProfile;
  if (focusNeural && sourceNeural) {
    warnings.push("神經和聲同時讀取和聲分軌與受保護原曲；兩份訊號一致時才提高邊界判斷權重。");
  } else if (focusNeuralResult.status === "rejected" || originalNeuralResult.status === "rejected") {
    const reason = focusNeuralResult.status === "rejected" ? focusNeuralResult.reason : originalNeuralResult.status === "rejected" ? originalNeuralResult.reason : null;
    warnings.push(`神經和聲第二意見部分不可用：${reason instanceof Error ? reason.message : "分析器錯誤"}`);
  }
  if (basicPitch) {
    warnings.push(`Basic Pitch 已逐拍提供 ${basicPitch.noteCount} 個本機音符事件，僅作和弦音覆蓋與 N.C. 證據，不單獨決定答案。`);
  } else {
    const reason = basicPitchResult.status === "rejected" ? basicPitchResult.reason : null;
    warnings.push(`Basic Pitch 音符層暫時不可用：${reason instanceof Error ? reason.message : "本機引擎未安裝"}`);
  }
  if (btcHarmony?.events.length) {
    warnings.push("官方 BTC 長距離模型已加入約 10 秒雙向上下文；它是第二意見，不會覆蓋強烈的原曲與 Bass 證據。");
  } else {
    const reason = btcResult.status === "rejected" ? btcResult.reason : null;
    warnings.push(`BTC 長距離模型暫時不可用：${reason instanceof Error ? reason.message : "外部模型快取未找到"}`);
  }
  warnings.push(
    personalProfile.baselineSongCount
      ? `已使用 ${personalProfile.baselineSongCount} 首 本機創作者 人工確認譜建立個人和聲先驗；只在音訊近似平手時加微量權重。`
      : "目前沒有可排除本曲後使用的 本機創作者 人工確認基準譜；個人先驗層保持中立。"
  );

  let agreementRatio = 0;
  const neural = focusNeural ?? sourceNeural;
  const originalNeural = focusNeural && sourceNeural ? sourceNeural : null;
  const aligned = rhythm
    ? runHarmonyPipelineStageSync("family_consensus", () => beatAlignedHarmonyConsensus({
        cqtEvents: analysis.events,
        subBeatEvents: subBeatAnalysis?.events,
        originalEvents: focusAnalysis ? originalAnalysis.events : undefined,
        coarseEvents: coarseAnalysis?.events,
        phraseEvents: phraseAnalysis?.events,
        neuralEvents: neural?.events ?? [],
        originalNeuralEvents: originalNeural?.events,
        btcEvents: btcHarmony?.events,
        basicPitch: basicPitch ?? undefined,
        personalProfile,
        rhythm,
        musicalKey: analysis.musicalKey,
        durationSeconds: analysis.durationSeconds,
        sourceSuitability: input.sourceSuitability,
        bassStemReliability: input.bassStemReliability,
        harmonyStemReliability: input.harmonyStemReliability
      }), {
        detail: "相關 CQT 限權後，融合神經和聲、BTC、音符與 Bass 獨立家族",
        outcome: (value) => !value || value.qualityGate.status === "degraded" ? "degraded" : value.qualityGate.status === "review" ? "review" : "passed"
      })
    : null;
  if (aligned) {
    runHarmonyPipelineStageSync("quality_gate", () => aligned.qualityGate, {
      detail: aligned.qualityGate.reasons.join("；"),
      outcome: (gate) => gate.status === "degraded" ? "degraded" : gate.status === "review" ? "review" : "passed"
    });
    markHarmonyQualityGate(aligned.qualityGate);
  } else {
    skipHarmonyPipelineStage("family_consensus", "沒有可對齊的神經拍點，無法執行逐拍跨家族共識");
    skipHarmonyPipelineStage("quality_gate", "沒有跨家族逐拍結果，輸出維持低可信草稿");
  }
  if (aligned?.events.length) {
    events = aligned.events;
    agreementRatio = aligned.agreementRatio;
    repeatedGroupCount = aligned.repeatedGroupCount;
    const calibratedQuality = (aligned.qualityGate.rootConfidence + aligned.qualityGate.qualityConfidence) / 2;
    confidence = Math.min(84, Math.max(36, 36 + agreementRatio * 24 + calibratedQuality * 24));
    analysisMode = "consensus";
    warnings.push(
      `高精細主管線的跨家族證據一致度 ${Math.round(agreementRatio * 100)}%；根音 ${Math.round(aligned.qualityGate.rootConfidence * 100)}%、和弦性質 ${Math.round(aligned.qualityGate.qualityConfidence * 100)}%，數字只代表音訊證據強度，不冒充人工正確率。`
    );
    warnings.push(
      `正式譜骨架層已把 ${aligned.structuralSimplifiedBeatCount} 拍的旋律／內聲部短暫色彩留在診斷資料中；畫面每拍只顯示一個結構和弦，真實根音、穩定轉位與有雙側邊界的短和弦不會被省略。`
    );
    if (aligned.qualityGate.status !== "pass") {
      warnings.push(`和聲品質閘門：${aligned.qualityGate.status === "degraded" ? "降級" : "需複核"}；${aligned.qualityGate.reasons.join("；")}。`);
    }
  } else if (neural?.events.length) {
    events = neural.events.map((event) => {
      const closest = analysis.events
        .map((candidate) => ({ candidate, overlap: overlapSeconds(event, candidate) }))
        .sort((left, right) => right.overlap - left.overlap)[0];
      const agreed = Boolean(closest?.overlap && chordIdentity(closest.candidate.name) === chordIdentity(event.name));
      return {
        ...event,
        confidence: agreed ? Math.max(68, Math.min(86, closest?.candidate.confidence ?? 72)) : 44,
        reviewStatus: agreed ? "likely" as const : "review" as const,
        alternateNames: !agreed && closest?.candidate.name ? [closest.candidate.name] : []
      };
    });
  }

  const boundaryCandidates = Array.isArray(analysis.diagnostics?.chordBoundaryCandidates)
    ? analysis.diagnostics.chordBoundaryCandidates.length
    : 0;
  const explicitNoChordBeatCount = events.reduce((count, event) =>
    count + (event.name === "N.C." ? Math.max(1, Math.round(event.durationSeconds / (60 / Math.max(1, analysis.bpm)))) : 0), 0
  );
  const method = (id: string, label: string, available: boolean, participated: boolean, note: string) => ({
    id, label, available, participated, note
  });
  const harmonyAnalysis: AutoScoreHarmonyAnalysis = {
    pipeline: "songzu_harmony_v12",
    methods: [
      method("legacy_audio_evidence", "原有音訊證據", true, true, "保留既有 DSP/CQT 和聲辨識主幹"),
      method("tony_root_quality_search", "本機創作者 根音與性質順序", true, true, "根音路徑只以三和弦骨架、sus、dim、aug 與 Bass 鎖定；7／maj7／m7／9 等色彩在根音確定後才競爭"),
      method("bass_root_anchor", "Bass 根音錨定", Boolean(input.bassEvidenceFilePath), Boolean(focusAnalysis && input.bassEvidenceFilePath), "穩定 Bass 以 pYIN + 低頻 CQT 先提出根音；經過音與不穩定低音不強制改名"),
      method("harmonic_instrument_quality", "吉他／鍵盤和聲性質", Boolean(input.harmonyFocusFilePath), Boolean(focusAnalysis), "Other stem 的吉他、鋼琴、電吉他與其他和聲樂器決定大、小、七、sus、add9 等性質"),
      method("defining_color_validation", "七和弦定義音驗證", Boolean(basicPitch), Boolean(basicPitch?.events.length), "三和弦與 7／maj7／m7 成對比較；定義第七音與至少兩組獨立性質證據成立才升級"),
      method("bass_pitch_tracker", "Bass 基頻與 CQT 轉位驗證", Boolean(input.bassEvidenceFilePath), Boolean(focusAnalysis && input.bassEvidenceFilePath), "若和聲樂器明確支持另一根音且 Bass 是和弦內音，才輸出斜線轉位"),
      method("equivalent_chord_disambiguation", "等音和弦語境消歧", true, true, "以穩定 Bass 與長距離模型區分 A6/F#、F#m7 等同音集合，優先輸出自然可讀的功能和弦"),
      method("basic_pitch_notes", "Basic Pitch 音符證據", Boolean(basicPitch), Boolean(basicPitch?.events.length), "實際音符覆蓋只作證據，不單獨定和弦"),
      method("beat_downbeat_boundaries", "拍點、半拍與換和弦邊界", Boolean(rhythm && subBeatAnalysis), Boolean(rhythm && subBeatAnalysis && boundaryCandidates >= 0), `${boundaryCandidates} 個 CQT novelty 邊界候選；每拍 2 個內部觀測`),
      method("transient_boundary_validation", "短暫和弦雙側邊界", Boolean(rhythm && subBeatAnalysis), Boolean(rhythm && subBeatAnalysis), "一拍和弦同時檢查進入與離開邊界；穩定 Bass 或跨來源共識可保留真正短和弦"),
      method("key_aware_enharmonics", "依調性重拼等音名稱", true, true, `輸出以 ${analysis.musicalKey} 調性拼寫根音與 slash bass，分析內部仍以 pitch class 比對`),
      method("structural_harmony_decoder", "正式譜和聲骨架", true, true, `${aligned?.structuralSimplifiedBeatCount ?? 0} 拍的單音色彩留在診斷層；同根音中的單拍 6／m6 不會只靠重複裝飾升格，正式譜保留 ${aligned?.structuralChordChangeCount ?? 0} 個經脈絡驗證的換和弦點`),
      method("tuning_cqt_multiscale", "調音校正與多尺度 CQT", true, true, "逐拍、兩拍、整小節視窗共用 tuning 校正"),
      method("btc_long_context", "BTC 長距離上下文", Boolean(btcHarmony), Boolean(btcHarmony?.events.length), "官方 BTC-ISMIR19 外部快取模型"),
      method("repeated_section_consensus", "重複段落交叉驗證", Boolean(basicPitch), Boolean(basicPitch), `${repeatedGroupCount} 組重複小節位置參與低可信修正`),
      method("explicit_no_chord", "N.C. 顯式偵測", true, true, `${explicitNoChordBeatCount} 拍判定無穩定和聲`),
      method("tony_confirmed_prior", "本機創作者 人工確認先驗", personalProfile.baselineSongCount > 0, personalProfile.baselineSongCount > 0, `${personalProfile.baselineSongCount} 首基準譜，僅作平手裁決`),
      method("independent_family_consensus", "獨立來源家族限權", true, true, "多尺度 CQT 視為同一家族並設總權重上限；跨家族同意才提高可信度")
    ],
    personalBaselineSongCount: personalProfile.baselineSongCount,
    repeatedGroupCount,
    boundaryCandidateCount: boundaryCandidates,
    explicitNoChordBeatCount,
    structuralSimplifiedBeatCount: aligned?.structuralSimplifiedBeatCount ?? 0,
    structuralChordChangeCount: aligned?.structuralChordChangeCount ?? 0,
    qualityGate: aligned ? {
      ...aligned.qualityGate,
      rootConfidence: round(aligned.qualityGate.rootConfidence, 4),
      qualityConfidence: round(aligned.qualityGate.qualityConfidence, 4),
      boundaryConfidence: round(aligned.qualityGate.boundaryConfidence, 4),
      independentFamilyAverage: round(aligned.qualityGate.independentFamilyAverage, 3)
    } : undefined,
    generatedAt: new Date().toISOString()
  };
  return buildAutoScoreFromHarmony({
    targetInstrument: input.target,
    bpm: analysis.bpm,
    musicalKey: analysis.musicalKey,
    timeSignature: input.timeSignature,
    durationSeconds: analysis.durationSeconds,
    confidence,
    sourceProfile: input.harmonyFocusFilePath ? "mixed_audio" : input.isolatedStem ? "single_instrument" : analysis.sourceProfile,
    analysisMode,
    analyzer: rhythm && aligned ? "songzu_harmony_v12" : rhythm ? "songzu_harmony_v4" : "songzu_harmony_v2",
    harmonyAnalysis: rhythm && aligned ? harmonyAnalysis : undefined,
    rhythm: rhythm ?? undefined,
    events,
    warnings
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function analyzeAmplitude(samples: Float32Array, sampleRate: number) {
  let peak = 0;
  let squareSum = 0;
  let silent = 0;
  const sectionCount = 24;
  const sectionSize = Math.max(1, Math.floor(samples.length / sectionCount));
  const energy = Array.from({ length: sectionCount }, () => 0);
  for (let index = 0; index < samples.length; index += 1) {
    const absolute = Math.abs(samples[index]);
    peak = Math.max(peak, absolute);
    squareSum += samples[index] * samples[index];
    if (absolute < 0.004) silent += 1;
    const section = Math.min(sectionCount - 1, Math.floor(index / sectionSize));
    energy[section] += samples[index] * samples[index];
  }
  const rms = Math.sqrt(squareSum / samples.length);
  return {
    peak: round(peak),
    peakDb: round(20 * Math.log10(Math.max(peak, 1e-9)), 2),
    rms: round(rms),
    rmsDb: round(20 * Math.log10(Math.max(rms, 1e-9)), 2),
    silenceRatio: round(silent / samples.length, 4),
    energy: energy.map((value, index) => ({
      index,
      startSeconds: round((index * sectionSize) / sampleRate, 2),
      rms: round(Math.sqrt(value / Math.max(1, Math.min(sectionSize, samples.length - index * sectionSize))))
    }))
  };
}

function estimateTempo(samples: Float32Array, sampleRate: number) {
  const hop = Math.max(1, Math.floor(sampleRate / 100));
  const envelope: number[] = [];
  let previous = 0;
  for (let start = 0; start < samples.length; start += hop) {
    let energy = 0;
    const end = Math.min(samples.length, start + hop);
    for (let index = start; index < end; index += 1) energy += Math.abs(samples[index]);
    energy /= Math.max(1, end - start);
    envelope.push(Math.max(0, energy - previous * 0.82));
    previous = energy;
  }
  const mean = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, envelope.length);
  const centered = envelope.map((value) => value - mean);
  const variance = centered.reduce((sum, value) => sum + value * value, 0) / Math.max(1, centered.length);
  const candidates: Array<{ bpm: number; score: number; correlation: number }> = [];
  for (let bpm = 45; bpm <= 210; bpm += 1) {
    const lag = Math.round(6000 / bpm);
    let score = 0;
    for (let index = lag; index < centered.length; index += 1) score += centered[index] * centered[index - lag];
    score /= Math.max(1, centered.length - lag);
    candidates.push({ bpm, score, correlation: score / Math.max(1e-12, variance) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const rawBest = candidates[0] ?? { bpm: 120, score: 0, correlation: 0 };
  let selected = rawBest;

  // Finished mixes often emphasize every second beat. Prefer the matching
  // double-time grid when it still has meaningful periodic support.
  if (rawBest.bpm < 70) {
    const doubled = candidates.find((candidate) => Math.abs(candidate.bpm - rawBest.bpm * 2) <= 1);
    if (doubled && doubled.correlation >= rawBest.correlation * 0.42) selected = doubled;
  } else if (rawBest.bpm > 180) {
    const halved = candidates.find((candidate) => Math.abs(candidate.bpm - rawBest.bpm / 2) <= 1);
    if (halved && halved.correlation >= rawBest.correlation * 0.5) selected = halved;
  }

  const harmonicSupport = Math.max(0, rawBest.correlation);
  const confidence = clamp(Math.max(0, selected.correlation) * 100 + harmonicSupport * 70, 8, 92);
  return {
    bpm: selected.bpm,
    rawBpm: rawBest.bpm,
    confidence: round(confidence, 1),
    alternatives: candidates
      .filter((candidate) => candidate.bpm !== selected.bpm)
      .slice(0, 3)
      .map((candidate) => ({ bpm: candidate.bpm, confidence: round(clamp(Math.max(0, candidate.correlation) * 100, 0, 92), 1) }))
  };
}

function targetLabel(target: AutoScoreTarget) {
  return target === "guitar" ? "吉他" : target === "piano" ? "鋼琴" : "鼓手";
}

async function saveScoreDraft(
  songId: string,
  audioFileId: string,
  target: AutoScoreTarget,
  result: AutoScoreResult,
  options: {
    inheritPriorEditorialData?: boolean;
    preserveExistingDrafts?: boolean;
    updateProjectCalibration?: boolean;
    titleSuffix?: string;
  } = {}
) {
  const project = await getOrCreateDawProject(songId);
  if (!project) throw new Error("找不到歌曲，無法建立 DAW 草譜");
  return prisma.$transaction(async (tx) => {
    const previousDraft = options.inheritPriorEditorialData === false ? null : await tx.dawScoreDraft.findFirst({
      where: { projectId: project.id, targetInstrument: target, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      select: { resultJson: true }
    });
    let resultToSave = withAutoScoreBenchmarkBaseline(result);
    if (target === "guitar" && previousDraft?.resultJson) {
      try {
        const previousResult = JSON.parse(previousDraft.resultJson) as AutoScoreResult;
        if (previousResult.format === "songzu-auto-score" && previousResult.beatConfirmations?.length) {
          const nextBeats = autoScoreReviewMeasures(resultToSave).flatMap((measure) => measure.beats);
          for (const confirmation of previousResult.beatConfirmations) {
            const beat = nextBeats.find((candidate) =>
              Math.abs(candidate.startSeconds - confirmation.startSeconds) <= 0.16 &&
              Math.abs(candidate.endSeconds - confirmation.endSeconds) <= 0.18
            );
            if (beat) {
              resultToSave = updateAutoScoreBeatChord(
                resultToSave,
                beat.startSeconds,
                beat.endSeconds,
                confirmation.name
              );
            }
          }
        }
        if (previousResult.format === "songzu-auto-score") {
          if (previousResult.sectionMap?.length) resultToSave.sectionMap = previousResult.sectionMap;
          if (previousResult.rhythmChanges?.length) resultToSave.rhythmChanges = previousResult.rhythmChanges;
          if (previousResult.sheetArrangement) resultToSave.sheetArrangement = previousResult.sheetArrangement;

          const previousPatterns = previousResult.strummingGuide?.patterns ?? [];
          if (resultToSave.strummingGuide && previousPatterns.length) {
            resultToSave.strummingGuide = {
              ...resultToSave.strummingGuide,
              patterns: resultToSave.strummingGuide.patterns.map((pattern) => {
                const previousPattern = previousPatterns.find((candidate) => candidate.id === pattern.id);
                if (!previousPattern?.variants) return pattern;
                const manualVariants = Object.fromEntries(
                  Object.entries(previousPattern.variants).filter(([, variant]) => variant?.source === "manual")
                );
                if (!Object.keys(manualVariants).length) return pattern;
                return {
                  ...pattern,
                  variants: { ...(pattern.variants ?? {}), ...manualVariants }
                };
              })
            };
          }
        }
      } catch {
        // A damaged historical draft must never block a fresh local analysis.
      }
    }
    if (!options.preserveExistingDrafts) {
      await tx.dawScoreDraft.updateMany({
        where: {
          projectId: project.id,
          targetInstrument: target,
          status: "DRAFT"
        },
        data: { status: "ARCHIVED" }
      });
    }
    if (resultToSave.rhythm && options.updateProjectCalibration !== false) {
      let projectMeta: Record<string, unknown> = {};
      try {
        const parsed = project.projectJson ? JSON.parse(project.projectJson) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) projectMeta = parsed as Record<string, unknown>;
      } catch {
        projectMeta = {};
      }
      const detectedBpm = resultToSave.rhythm.displayBpm;
      const currentBpm = project.bpm;
      const tempoLooksUnconfirmed =
        !currentBpm ||
        Math.abs(currentBpm - detectedBpm) <= 2;
      if (tempoLooksUnconfirmed) {
        const appliedAt = new Date().toISOString();
        const currentSmartMetronome = projectMeta.smartMetronome &&
          typeof projectMeta.smartMetronome === "object" &&
          !Array.isArray(projectMeta.smartMetronome)
          ? projectMeta.smartMetronome as Record<string, unknown>
          : {};
        const recommendedRate = 1;
        const smartMetronome = currentSmartMetronome.userSelected === true
          ? currentSmartMetronome
          : {
              ...currentSmartMetronome,
              rate: recommendedRate,
              offsetSeconds: typeof currentSmartMetronome.offsetSeconds === "number"
                ? currentSmartMetronome.offsetSeconds
                : 0,
              source: "song_beat_grid",
              userSelected: false,
              appliedAt
            };
        await tx.dawProject.update({
          where: { id: project.id },
          data: {
            bpm: detectedBpm,
            musicalKey: project.musicalKey || resultToSave.musicalKey,
            projectJson: JSON.stringify({
              ...projectMeta,
              rhythmCalibration: {
                ...resultToSave.rhythm,
                sourceAudioFileId: audioFileId,
                sourceScoreTarget: target,
                appliedAt
              },
              smartMetronome,
              tempoMap: resultToSave.rhythm.tempoMap.map((entry) => ({
                ...entry,
                confidence: resultToSave.rhythm?.confidence,
                source: resultToSave.rhythm?.engine,
                appliedAt
              }))
            })
          }
        });
        const songBpm = project.song.bpm;
        const songTempoLooksUnconfirmed =
          !songBpm ||
          Math.abs(songBpm - detectedBpm) <= 2;
        if (songTempoLooksUnconfirmed) {
          await tx.song.update({
            where: { id: songId },
            data: {
              bpm: detectedBpm,
              // Existing song metadata is a user-owned anchor. Analysis may
              // suggest a key inside its draft, but never silently replace a
              // marked key while synchronizing tempo.
              musicalKey: project.song.musicalKey || resultToSave.musicalKey
            }
          });
        }
      }
    }
    return tx.dawScoreDraft.create({
      data: {
        projectId: project.id,
        sourceAudioFileId: audioFileId,
        title: `${resultToSave.analyzer === "songzu_harmony_v12"
          ? `${targetLabel(target)}結構和聲草稿 v12`
          : resultToSave.analyzer === "songzu_harmony_v10"
          ? `${targetLabel(target)}高精細和聲草稿 v10`
          : resultToSave.analyzer === "songzu_harmony_v9"
          ? `${targetLabel(target)}十三層 Bass 根音和聲草稿 v9`
          : resultToSave.analyzer === "songzu_harmony_v8"
          ? `${targetLabel(target)}十二層轉位和聲草稿 v8`
          : resultToSave.analyzer === "songzu_harmony_v7"
          ? `${targetLabel(target)}十一層深度和聲草稿 v7`
          : resultToSave.analyzer === "songzu_harmony_v6"
          ? `${targetLabel(target)}十層深度和聲草稿 v6`
          : resultToSave.analyzer === "songzu_harmony_v5"
          ? `${targetLabel(target)}十層融合和聲草稿 v5`
          : resultToSave.analyzer === "songzu_harmony_v4"
            ? `${targetLabel(target)}多尺度和聲草稿 v4`
          : resultToSave.analyzer === "songzu_harmony_v3"
            ? `${targetLabel(target)}逐拍和聲草稿 v3`
            : resultToSave.analyzer === "songzu_harmony_v2"
              ? `${targetLabel(target)}和聲草稿 v2`
              : `${targetLabel(target)}自動草譜`}${options.titleSuffix ?? ""}`,
        targetInstrument: target,
        analyzer: resultToSave.analyzer,
        status: "DRAFT",
        confidence: resultToSave.confidence,
        bpm: resultToSave.bpm,
        musicalKey: resultToSave.musicalKey,
        timeSignature: resultToSave.timeSignature,
        durationSeconds: resultToSave.durationSeconds,
        resultJson: JSON.stringify(resultToSave)
      }
    });
  });
}

type ScoreSourceFile = {
  id: string;
  songId: string;
  filePath: string;
  fileName: string;
  fileType: string;
  durationSeconds?: number | null;
};

type AudioPipelinePreflight = NonNullable<AutoScoreHarmonyAnalysis["sourceQuality"]>;

function parseQualityWarnings(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function ensureAudioPipelinePreflight(audioFileId: string): Promise<AudioPipelinePreflight> {
  try {
    const source = await prisma.audioFile.findUnique({
      where: { id: audioFileId },
      select: { sha256: true }
    });
    const cached = await prisma.audioQualityReport.findFirst({
      where: source?.sha256 ? { audioFileId, sha256: source.sha256 } : { audioFileId },
      orderBy: { createdAt: "desc" }
    });
    const report = cached ?? await generateAndStoreAudioQualityReport(audioFileId);
    const analysisSuitability = report.errorMessage
      ? "unknown" as const
      : report.clippingRisk || report.sampleRateMismatch || report.bitDepthMismatch || report.lowQualityRisk
        ? "limited" as const
        : "good" as const;
    return {
      verdict: report.verdict,
      analysisSuitability,
      codecName: report.codecName,
      sampleRate: report.sampleRate,
      bitDepth: report.bitDepth,
      bitRate: report.bitRate,
      clippingRisk: report.clippingRisk,
      lowQualityRisk: report.lowQualityRisk,
      warnings: parseQualityWarnings(report.warningsJson),
      checkedAt: report.createdAt.toISOString()
    };
  } catch (error) {
    return {
      verdict: "unknown",
      analysisSuitability: "unknown",
      codecName: null,
      sampleRate: null,
      bitDepth: null,
      bitRate: null,
      clippingRisk: false,
      lowQualityRisk: false,
      warnings: [error instanceof Error ? error.message : "來源音質預檢失敗"],
      checkedAt: new Date().toISOString()
    };
  }
}

function attachAudioPipelinePreflight(score: AutoScoreResult, preflight: AudioPipelinePreflight) {
  const sourceWarning = preflight.analysisSuitability === "good"
    ? null
    : preflight.analysisSuitability === "limited"
      ? `來源音質預檢為受限：${preflight.warnings.join("；") || "壓縮、取樣或峰值條件可能降低細節辨識"}`
      : `來源音質預檢無法完整確認：${preflight.warnings.join("；") || "缺少可驗證規格"}`;
  return {
    ...score,
    harmonyAnalysis: score.harmonyAnalysis
      ? { ...score.harmonyAnalysis, sourceQuality: preflight }
      : score.harmonyAnalysis,
    warnings: sourceWarning && !score.warnings.includes(sourceWarning)
      ? [...score.warnings, sourceWarning]
      : score.warnings
  } satisfies AutoScoreResult;
}

function scoreSourceProfile(fileType: string) {
  return fileType.endsWith("_stem") ? "isolated_stem" as const : undefined;
}

async function reusableHarmonyScore(audioFileId: string, target: Exclude<AutoScoreTarget, "drums">) {
  const draft = await prisma.dawScoreDraft.findFirst({
    where: {
      sourceAudioFileId: audioFileId,
      analyzer: "songzu_harmony_v12",
      status: "DRAFT",
      targetInstrument: { not: target }
    },
    orderBy: { updatedAt: "desc" }
  });
  if (!draft?.resultJson) return null;
  try {
    const score = JSON.parse(draft.resultJson) as AutoScoreResult;
    if (
      score.format !== "songzu-auto-score" ||
      !score.rhythm?.beatTimesSeconds.length ||
      !score.chords.length ||
      !score.warnings.some((warning) => warning.includes("Bass 根音 + 吉他／鍵盤／其他和聲樂器"))
    ) return null;
    return buildAutoScoreFromHarmony({
      targetInstrument: target,
      bpm: score.bpm,
      musicalKey: score.musicalKey,
      timeSignature: score.timeSignature,
      durationSeconds: score.durationSeconds,
      confidence: score.confidence,
      sourceProfile: score.sourceProfile,
      analysisMode: score.analysisMode,
      analyzer: score.analyzer,
      harmonyAnalysis: score.harmonyAnalysis,
      rhythm: score.rhythm,
      events: score.chords.map(({ pitches: _pitches, guitarFrets: _guitarFrets, ...event }) => event),
      warnings: [
        ...score.warnings.filter((warning) =>
          !warning.startsWith("這是完整混音") &&
          !warning.startsWith("系統會保守辨識") &&
          !warning.startsWith("畫面百分比")
        ),
        "吉他與鋼琴共用同一份已驗證和聲證據，只重新建立本樂器的指法與音符。"
      ]
    });
  } catch {
    return null;
  }
}

type HarmonyFocusFiles = {
  harmonyFocusFilePath: string;
  bassEvidenceFilePath: string;
  harmonyStemReliability: number;
  bassStemReliability: number;
};

function stemEvidenceReliability(report: {
  verdict: string;
  clippingRisk: boolean;
  lowQualityRisk: boolean;
  sampleRateMismatch: boolean;
  bitDepthMismatch: boolean;
} | undefined) {
  if (!report) return 0.62;
  if (report.verdict === "fail") return 0.32;
  let reliability = report.verdict === "pass" ? 1 : 0.74;
  if (report.clippingRisk) reliability -= 0.2;
  if (report.lowQualityRisk) reliability -= 0.16;
  if (report.sampleRateMismatch) reliability -= 0.08;
  if (report.bitDepthMismatch) reliability -= 0.06;
  return round(clamp(reliability, 0.25, 1), 3);
}

async function prepareHarmonyFocusFile(audioFile: ScoreSourceFile): Promise<HarmonyFocusFiles | null> {
  if (scoreSourceProfile(audioFile.fileType) === "isolated_stem" && !["instrumental_stem", "bass_stem"].includes(audioFile.fileType)) return null;
  const [bassStem, otherStem] = await Promise.all([
    prisma.audioFile.findFirst({
      where: { songId: audioFile.songId, fileType: "bass_stem", archivedAt: null, filePath: { not: null } },
      include: { qualityReports: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.audioFile.findFirst({
      where: { songId: audioFile.songId, fileType: "instrumental_stem", archivedAt: null, filePath: { not: null } },
      include: { qualityReports: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" }
    })
  ]);
  if (!bassStem?.filePath || !otherStem?.filePath) return null;
  const bassPath = resolveStoredFilePath(bassStem.filePath);
  const otherPath = resolveStoredFilePath(otherStem.filePath);
  await Promise.all([access(bassPath), access(otherPath)]);
  // Keep the three jobs independent: stable Bass proposes the root, the Other
  // stem (guitars/keys/harmonic instruments) selects chord quality, and the
  // protected full mix is reference-only. The streams meet only in consensus,
  // so a passing Bass note cannot color the harmonic-instrument detector.
  return {
    harmonyFocusFilePath: otherPath,
    bassEvidenceFilePath: bassPath,
    harmonyStemReliability: stemEvidenceReliability(otherStem.qualityReports[0]),
    bassStemReliability: stemEvidenceReliability(bassStem.qualityReports[0])
  };
}

async function analyzeScore(input: {
  audioFile: ScoreSourceFile;
  pcm?: Awaited<ReturnType<typeof decodePcm>> | null;
  target: AutoScoreTarget;
  bpm: number;
  musicalKey?: string | null;
  timeSignature: string;
  sourceQuality?: AudioPipelinePreflight;
  forceReanalysis?: boolean;
}) {
  if (input.target !== "drums") {
    try {
      const reusable = input.forceReanalysis
        ? null
        : await reusableHarmonyScore(input.audioFile.id, input.target);
      if (reusable) {
        markHarmonyCache("songzu_harmony_v12", true);
        markHarmonyEngine({ engineId: "songzu_harmony_v12", participated: true, qualityPassed: reusable.harmonyAnalysis?.qualityGate?.status === "pass", detail: "沿用同來源已驗證和聲快取" });
        skipHarmonyPipelineStage("stem_separation", "沿用同來源既有和聲結果，本次未重新分軌");
        skipHarmonyPipelineStage("beat_grid", "沿用同來源既有拍點結果");
        skipHarmonyPipelineStage("bass_root", "沿用同來源既有根音結果");
        skipHarmonyPipelineStage("chord_quality", "沿用同來源既有和弦性質結果");
        skipHarmonyPipelineStage("family_consensus", "沿用同來源既有跨家族共識");
        if (reusable.harmonyAnalysis?.qualityGate) {
          const gate = reusable.harmonyAnalysis.qualityGate;
          runHarmonyPipelineStageSync("quality_gate", () => gate, {
            detail: `快取結果 · ${gate.reasons.join("；")}`,
            outcome: () => gate.status === "degraded" ? "degraded" : gate.status === "review" ? "review" : "passed"
          });
          markHarmonyQualityGate(gate);
        } else {
          skipHarmonyPipelineStage("quality_gate", "舊快取沒有品質閘門資料");
        }
        return reusable;
      }
      const harmonyFocusFiles = await prepareHarmonyFocusFile(input.audioFile);
      if (harmonyFocusFiles) {
        runHarmonyPipelineStageSync("stem_separation", () => true, { detail: "使用已驗證的 Bass / Other Stem 作獨立證據" });
        markHarmonyEngine({ engineId: "demucs", participated: true, qualityPassed: true, detail: "Bass / Other Stem 已讀入主管線" });
      } else {
        skipHarmonyPipelineStage("stem_separation", "本次沒有可用的 Bass / Other Stem，保留原曲參考分析");
      }
      return await analyzeHarmonyFile({
        songId: input.audioFile.songId,
        filePath: input.audioFile.filePath,
        harmonyFocusFilePath: harmonyFocusFiles?.harmonyFocusFilePath,
        bassEvidenceFilePath: harmonyFocusFiles?.bassEvidenceFilePath,
        bassStemReliability: harmonyFocusFiles?.bassStemReliability ?? (input.audioFile.fileType === "bass_stem" ? 0.78 : 0.6),
        harmonyStemReliability: harmonyFocusFiles?.harmonyStemReliability ?? (input.audioFile.fileType === "instrumental_stem" ? 0.78 : 0.6),
        sourceSuitability: input.sourceQuality?.analysisSuitability,
        target: input.target,
        bpm: input.bpm,
        musicalKey: input.musicalKey,
        timeSignature: input.timeSignature,
        isolatedStem: scoreSourceProfile(input.audioFile.fileType) === "isolated_stem",
        durationSeconds: input.audioFile.durationSeconds ?? input.pcm?.durationSeconds
      });
    } catch (error) {
      const fallbackPcm = input.pcm ?? await decodePcm(input.audioFile.filePath);
      const fallback = await analyzeAutoScorePcm(fallbackPcm, {
        targetInstrument: input.target,
        bpm: input.bpm,
        musicalKey: input.musicalKey,
        timeSignature: input.timeSignature,
        sourceProfileHint: scoreSourceProfile(input.audioFile.fileType)
      });
      fallback.confidence = Math.min(34, fallback.confidence);
      fallback.warnings.unshift(
        `進階和聲分析未完成，已改用低可信快速草稿：${error instanceof Error ? error.message : "分析器錯誤"}`
      );
      markHarmonyPipelineFallback("進階和聲分析已安全降級為低可信快速草稿");
      return fallback;
    }
  }
  const drumPcm = input.pcm ?? await decodePcm(input.audioFile.filePath);
  return analyzeAutoScorePcm(drumPcm, {
    targetInstrument: input.target,
    bpm: input.bpm,
    musicalKey: input.musicalKey,
    timeSignature: input.timeSignature,
    sourceProfileHint: scoreSourceProfile(input.audioFile.fileType)
  });
}

async function deepAnalyze(
  jobId: string,
  audioFile: ScoreSourceFile,
  target: AutoScoreTarget,
  options: { forceReanalysis?: boolean } = {}
) {
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { status: "RUNNING", progress: 6, startedAt: new Date() } });
  const sourceQuality = await runHarmonyPipelineStage("source_preflight", () => ensureAudioPipelinePreflight(audioFile.id), {
    detail: "編碼、取樣、位元深度、削波與低品質風險",
    outcome: (value) => value.analysisSuitability === "good" ? "passed" : value.analysisSuitability === "limited" ? "degraded" : "review"
  });
  markHarmonyEngine({ engineId: "songzu_local_dsp_v2", participated: true, qualityPassed: sourceQuality.analysisSuitability === "good", detail: `${sourceQuality.codecName || "未知編碼"} · ${sourceQuality.analysisSuitability}` });
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 14 } });
  const pcm = await decodePcm(audioFile.filePath);
  const amplitude = analyzeAmplitude(pcm.samples, pcm.sampleRate);
  const tempo = estimateTempo(pcm.samples, pcm.sampleRate);
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 48 } });
  const song = await prisma.song.findUnique({ where: { id: audioFile.songId }, select: { bpm: true, musicalKey: true } });
  const score = attachAudioPipelinePreflight(await analyzeScore({
    audioFile,
    pcm,
    target,
    bpm: song?.bpm || tempo.bpm,
    musicalKey: song?.musicalKey,
    timeSignature: "4/4",
    sourceQuality,
    forceReanalysis: options.forceReanalysis
  }), sourceQuality);
  await prisma.audioAnalysis.create({
    data: {
      audioFileId: audioFile.id,
      durationSeconds: pcm.durationSeconds,
      peak: amplitude.peak,
      rms: amplitude.rms,
      energyJson: JSON.stringify(amplitude.energy),
      waveformJson: JSON.stringify(amplitude.energy.map((item) => item.rms)),
      suggestedBpm: tempo.bpm,
      suggestedMoodJson: JSON.stringify([]),
      suggestedUseCaseJson: JSON.stringify([])
    }
  });
  const result = {
    analyzedSeconds: round(pcm.durationSeconds, 2),
    limitedToSeconds: MAX_ANALYSIS_SECONDS,
    amplitude,
    tempo,
    tonal: { musicalKey: score.musicalKey, confidence: score.confidence },
    transcriptionSummary: {
      target,
      notes: score.notes.length,
      chords: score.chords.length,
      drumHits: score.drumHits.length,
      sourceProfile: score.sourceProfile
    },
    sourceQuality,
    harmonyQualityGate: score.harmonyAnalysis?.qualityGate ?? null,
    privacy: "音訊僅由本機 ffmpeg 與頌祖 DSP 讀取，未上傳外部服務。"
  };
  await prisma.audioIntelligenceJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", progress: 100, resultJson: JSON.stringify(result), warningsJson: JSON.stringify(score.warnings), completedAt: new Date() }
  });
  return result;
}

async function transcribe(
  jobId: string,
  audioFile: ScoreSourceFile,
  target: AutoScoreTarget,
  options: { forceReanalysis?: boolean; comparisonMode?: boolean } = {}
) {
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { status: "RUNNING", progress: 6, startedAt: new Date() } });
  const sourceQuality = await runHarmonyPipelineStage("source_preflight", () => ensureAudioPipelinePreflight(audioFile.id), {
    detail: "編碼、取樣、位元深度、削波與低品質風險",
    outcome: (value) => value.analysisSuitability === "good" ? "passed" : value.analysisSuitability === "limited" ? "degraded" : "review"
  });
  markHarmonyEngine({ engineId: "songzu_local_dsp_v2", participated: true, qualityPassed: sourceQuality.analysisSuitability === "good", detail: `${sourceQuality.codecName || "未知編碼"} · ${sourceQuality.analysisSuitability}` });
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 14 } });
  const song = await prisma.song.findUnique({ where: { id: audioFile.songId }, select: { bpm: true, musicalKey: true } });
  let pcm: Awaited<ReturnType<typeof decodePcm>> | null = null;
  let bpm = song?.bpm ?? null;
  if (!bpm || target === "drums") {
    pcm = await decodePcm(audioFile.filePath);
    if (!bpm) bpm = estimateTempo(pcm.samples, pcm.sampleRate).bpm;
  }
  let score = attachAudioPipelinePreflight(await analyzeScore({
    audioFile,
    pcm,
    target,
    bpm: bpm ?? 120,
    musicalKey: song?.musicalKey,
    timeSignature: "4/4",
    sourceQuality,
    forceReanalysis: options.forceReanalysis || options.comparisonMode
  }), sourceQuality);
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 84 } });
  if (target === "guitar") {
    try {
      const personalGuides = (await prisma.dawScoreDraft.findMany({
        where: { targetInstrument: "guitar" },
        select: { resultJson: true },
        orderBy: { updatedAt: "desc" },
        take: 40
      })).flatMap((draft) => {
        try {
          const previous = JSON.parse(draft.resultJson) as AutoScoreResult;
          return previous.strummingGuide ? [previous.strummingGuide] : [];
        } catch {
          return [];
        }
      });
      const strummingGuide = await analyzeAudioStrummingGuide({
        result: score,
        filePath: resolveStoredFilePath(audioFile.filePath),
        personalGuides
      });
      score = { ...score, strummingGuide };
    } catch (strummingError) {
      score = {
        ...score,
        warnings: [...score.warnings, `刷法音檔分析未完成：${strummingError instanceof Error ? strummingError.message : "未知錯誤"}。和弦草譜仍已安全保存，可稍後在刷法區重新分析。`]
      };
    }
  }
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 94 } });
  const draft = await saveScoreDraft(audioFile.songId, audioFile.id, target, score, {
    inheritPriorEditorialData: !options.comparisonMode,
    preserveExistingDrafts: options.comparisonMode,
    updateProjectCalibration: !options.comparisonMode,
    titleSuffix: options.comparisonMode ? "（盲抓比較）" : ""
  });
  await prisma.timelineEvent.create({
    data: {
      songId: audioFile.songId,
      eventType: "audio_intelligence_transcription",
      title: `建立${targetLabel(target)}自動草譜${options.comparisonMode ? "（盲抓比較）" : ""}`,
      description: `${audioFile.fileName}，本機和聲證據一致度 ${Math.round(score.confidence)}%；仍需逐段聽感確認。`,
      relatedModel: "DawScoreDraft",
      relatedId: draft.id
    }
  });
  const result = {
    draftId: draft.id,
    projectId: draft.projectId,
    target,
    confidence: score.confidence,
    bpm: score.bpm,
    musicalKey: score.musicalKey,
    comparisonMode: options.comparisonMode === true,
    sourceQuality,
    harmonyQualityGate: score.harmonyAnalysis?.qualityGate ?? null
  };
  await prisma.audioIntelligenceJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", progress: 100, engine: score.analyzer, resultJson: JSON.stringify(result), warningsJson: JSON.stringify(score.warnings), completedAt: new Date() }
  });
  return result;
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function measureStemReconstruction(originalPath: string, stemPaths: string[]) {
  const ffmpeg = await executablePath("ffmpeg", [
    process.env.SONGZU_FFMPEG_PATH || "",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg"
  ].filter(Boolean));
  if (!ffmpeg || stemPaths.length !== 4) return null;
  const inputArgs = [originalPath, ...stemPaths].flatMap((path) => ["-i", path]);
  const mixInputs = stemPaths.map((_, index) => `[${index + 1}:a]`).join("");
  const { stderr } = await runProcess(ffmpeg, [
    "-hide_banner", "-nostats",
    ...inputArgs,
    "-filter_complex",
    `${mixInputs}amix=inputs=${stemPaths.length}:normalize=0:dropout_transition=0[sum];[0:a][sum]apsnr`,
    "-f", "null", "-"
  ], { maxBytes: 2 * 1024 * 1024 });
  const channelPsnrDb = [...stderr.matchAll(/PSNR ch\d+:\s*(inf|\d+(?:\.\d+)?)\s*dB/gi)]
    .map((match) => match[1].toLowerCase() === "inf" ? 300 : Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (!channelPsnrDb.length) return null;
  return {
    channelPsnrDb: channelPsnrDb.map((value) => round(value, 2)),
    minimumPsnrDb: round(Math.min(...channelPsnrDb), 2),
    complete: Math.min(...channelPsnrDb) >= 60
  };
}

async function separateStems(jobId: string, audioFile: { id: string; songId: string; filePath: string; fileName: string }) {
  const demucsCli = await executablePath("demucs", [process.env.SONGZU_DEMUCS_PATH || ""].filter(Boolean));
  const demucsPython = demucsCli ? null : await pythonForModule("demucs");
  const demucs = demucsCli || demucsPython;
  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { status: "RUNNING", progress: 4, startedAt: new Date() } });
  const sourceQuality = await runHarmonyPipelineStage("source_preflight", () => ensureAudioPipelinePreflight(audioFile.id), {
    detail: "分軌前來源音質預檢",
    outcome: (value) => value.analysisSuitability === "good" ? "passed" : value.analysisSuitability === "limited" ? "degraded" : "review"
  });
  markHarmonyEngine({ engineId: "songzu_local_dsp_v2", participated: true, qualityPassed: sourceQuality.analysisSuitability === "good", detail: `${sourceQuality.codecName || "未知編碼"} · ${sourceQuality.analysisSuitability}` });
  if (!demucs) {
    runHarmonyPipelineStageSync("stem_separation", () => false, {
      detail: "Demucs 未安裝，沒有產生任何假分軌",
      outcome: () => "degraded"
    });
    markHarmonyEngine({ engineId: "demucs", participated: false, qualityPassed: false, error: "本機尚未安裝 Demucs" });
    const result = {
      requiredEngine: "demucs",
      installState: "missing",
      originalProtected: true,
      message: "本機尚未安裝 Stem 模型。原檔未變更，工作已保留，安裝後可重新執行。"
    };
    await prisma.audioIntelligenceJob.update({
      where: { id: jobId },
      data: { status: "NEEDS_ENGINE", progress: 0, resultJson: JSON.stringify(result), warningsJson: JSON.stringify([result.message]), completedAt: new Date() }
    });
    return result;
  }

  await prisma.audioIntelligenceJob.update({ where: { id: jobId }, data: { progress: 8 } });
  const outputRoot = storagePath("cache", "stems", jobId);
  await mkdir(outputRoot, { recursive: true });
  const separationModel = process.env.SONGZU_DEMUCS_MODEL?.trim() || "htdemucs_ft";
  const requestedShifts = Number.parseInt(process.env.SONGZU_DEMUCS_SHIFTS || "2", 10);
  const separationShifts = Math.max(1, Math.min(10, Number.isFinite(requestedShifts) ? requestedShifts : 2));
  const separationDevice = process.env.SONGZU_DEMUCS_DEVICE?.trim() || (process.platform === "darwin" ? "cpu" : "");
  const demucsArgs = [
    ...(demucsCli ? [] : ["-m", "demucs"]),
    "-n", separationModel,
    "--shifts", String(separationShifts),
    "--overlap", "0.5",
    "--segment", "4",
    "--int24",
    "--clip-mode", "rescale",
    ...(separationDevice ? ["-d", separationDevice] : []),
    "-o", outputRoot,
    audioFile.filePath
  ];
  const separationStartedAt = performance.now();
  await runHarmonyPipelineStage(
    "stem_separation",
    () => runProcess(demucs, demucsArgs, { maxBytes: 8 * 1024 * 1024 }),
    { detail: `${separationModel} · ${separationShifts} shifts · 24-bit WAV` }
  );
  const generated = (await walkFiles(outputRoot)).filter((path) => /\.(wav|aiff?)$/i.test(path));
  const expectedStemNames = ["bass", "drums", "other", "vocals"];
  const missingStemNames = expectedStemNames.filter((expected) =>
    !generated.some((path) => parse(path).name.toLocaleLowerCase() === expected)
  );
  if (missingStemNames.length) {
    throw new Error(`Stem 引擎輸出不完整，缺少：${missingStemNames.join("、")}`);
  }
  const orderedGenerated = expectedStemNames.map((expected) =>
    generated.find((path) => parse(path).name.toLocaleLowerCase() === expected)!
  );
  const reconstruction = await measureStemReconstruction(audioFile.filePath, orderedGenerated);
  if (reconstruction && !reconstruction.complete) {
    throw new Error(`Stem 重建一致性未通過（最低 ${reconstruction.minimumPsnrDb} dB），輸出不會套用到 DAW`);
  }
  markHarmonyEngine({
    engineId: "demucs",
    participated: true,
    qualityPassed: reconstruction?.complete ?? true,
    durationMs: performance.now() - separationStartedAt,
    detail: reconstruction ? `Stem 重建最低 ${reconstruction.minimumPsnrDb} dB` : "4 軌規格與完整性通過"
  });
  const uploadRoot = storagePath("uploads", audioFile.songId);
  await mkdir(uploadRoot, { recursive: true });
  const createdIds: string[] = [];
  const qualityReports: Array<{
    audioFileId: string;
    stemName: string;
    verdict: string;
    sampleRate: number | null;
    bitDepth: number | null;
    durationSeconds: number | null;
  }> = [];
  for (const sourcePath of orderedGenerated) {
    const stemName = parse(sourcePath).name.toLocaleLowerCase();
    const fileType = stemName.includes("vocal") ? "vocal_stem" : stemName.includes("drum") ? "drum_stem" : stemName.includes("bass") ? "bass_stem" : "instrumental_stem";
    const destination = join(uploadRoot, `${Date.now()}-${stemName}.wav`);
    await copyFile(sourcePath, destination);
    const info = await stat(destination);
    const created = await prisma.audioFile.create({
      data: {
        songId: audioFile.songId,
        fileName: basename(destination),
        originalFileName: basename(sourcePath),
        filePath: destination,
        storageProvider: "local_upload",
        fileType,
        versionName: `studio_${separationModel}_${stemName}`,
        fileSizeBytes: info.size,
        sha256: await sha256(destination),
        mimeType: "audio/wav",
        sourceKind: "derived_stem",
        parentAudioFileId: audioFile.id,
        qualityStatus: "pending",
        isProtectedOriginal: true,
        notes: `由本機 Demucs ${separationModel}（${separationShifts} 次位移取樣、4 秒低記憶體切片、50% overlap、24-bit WAV）從 ${audioFile.fileName} 產生；來源原檔未變更。`
      }
    });
    const qualityReport = await generateAndStoreAudioQualityReport(created.id);
    createdIds.push(created.id);
    qualityReports.push({
      audioFileId: created.id,
      stemName,
      verdict: qualityReport.verdict,
      sampleRate: qualityReport.sampleRate,
      bitDepth: qualityReport.bitDepth,
      durationSeconds: qualityReport.durationSeconds
    });
  }
  const durations = qualityReports.map((report) => report.durationSeconds).filter((value): value is number => Number.isFinite(value));
  const durationSpread = durations.length ? Math.max(...durations) - Math.min(...durations) : Number.POSITIVE_INFINITY;
  if (
    qualityReports.some((report) =>
      report.verdict === "fail" || !report.sampleRate || !report.bitDepth || !report.durationSeconds
    ) || durationSpread > 0.12
  ) {
    await prisma.audioFile.updateMany({ where: { id: { in: createdIds } }, data: { archivedAt: new Date() } });
    throw new Error("Stem 音訊規格或時長不一致，已保留輸出但不會自動套用到 DAW");
  }
  const result = {
    outputCount: createdIds.length,
    audioFileIds: createdIds,
    originalProtected: true,
    sourceQuality,
    cachePath: outputRoot,
    reconstruction,
    qualityReports,
    separationProfile: {
      model: separationModel,
      shifts: separationShifts,
      segmentSeconds: 4,
      device: separationDevice || "auto",
      overlap: 0.5,
      bitDepth: 24,
      clipMode: "rescale",
      limitation: "分軌品質受原始混音與來源編碼限制；原曲永遠保留為聽感與相位基準。"
    }
  };
  await prisma.audioIntelligenceJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", progress: 100, resultJson: JSON.stringify(result), outputAudioFileIdsJson: JSON.stringify(createdIds), completedAt: new Date() }
  });
  return result;
}

export async function runAudioIntelligenceJob(input: {
  audioFileId: string;
  jobType: "DEEP_ANALYSIS" | "TRANSCRIPTION" | "STEM_SEPARATION";
  target?: AutoScoreTarget;
  forceReanalysis?: boolean;
  comparisonMode?: boolean;
}) {
  const audioFile = await prisma.audioFile.findUnique({ where: { id: input.audioFileId } });
  if (!audioFile || audioFile.archivedAt) throw new Error("找不到可分析的音檔");
  if (!audioFile.filePath) throw new Error("音檔沒有本機路徑，請先匯入或重新上傳");
  const resolvedAudioFile = { ...audioFile, filePath: resolveStoredFilePath(audioFile.filePath) };
  await access(resolvedAudioFile.filePath);
  const song = await prisma.song.findUnique({ where: { id: audioFile.songId }, select: { title: true } });
  const job = await prisma.audioIntelligenceJob.create({
    data: {
      songId: audioFile.songId,
      audioFileId: audioFile.id,
      jobType: input.jobType,
      target: input.target ?? null,
      engine: input.jobType === "STEM_SEPARATION" ? "demucs_local" : "songzu_local_dsp_v2",
      status: "QUEUED",
      progress: 0
    }
  });
  const outcome = await executeHarmonyPipelineRun({
    runId: job.id,
    songId: audioFile.songId,
    songTitle: song?.title || "未命名作品",
    audioFileId: audioFile.id,
    audioFileName: audioFile.fileName,
    jobType: input.jobType,
    target: input.target ?? "piano"
  }, async () => {
    const target = input.target ?? "piano";
    if (input.jobType === "STEM_SEPARATION") {
      const result = await separateStems(job.id, resolvedAudioFile);
      skipHarmonyPipelineStage("beat_grid", "這是獨立分軌工作");
      skipHarmonyPipelineStage("bass_root", "這是獨立分軌工作");
      skipHarmonyPipelineStage("chord_quality", "這是獨立分軌工作");
      skipHarmonyPipelineStage("family_consensus", "這是獨立分軌工作");
      skipHarmonyPipelineStage("quality_gate", "這是獨立分軌工作");
      return result;
    }
    if (target === "drums") {
      skipHarmonyPipelineStage("bass_root", "鼓譜工作不執行和弦根音");
      skipHarmonyPipelineStage("chord_quality", "鼓譜工作不執行和弦性質");
      skipHarmonyPipelineStage("family_consensus", "鼓譜工作不執行和弦共識");
      skipHarmonyPipelineStage("quality_gate", "鼓譜工作使用鼓譜專用檢查");
    }
    return input.jobType === "TRANSCRIPTION"
      ? transcribe(job.id, resolvedAudioFile, target, {
          forceReanalysis: input.forceReanalysis,
          comparisonMode: input.comparisonMode
        })
      : deepAnalyze(job.id, resolvedAudioFile, target, { forceReanalysis: input.forceReanalysis });
  });
  const stored = await prisma.audioIntelligenceJob.findUnique({ where: { id: job.id }, select: { resultJson: true } });
  let storedResult: Record<string, unknown> = {};
  try {
    const parsed = stored?.resultJson ? JSON.parse(stored.resultJson) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) storedResult = parsed as Record<string, unknown>;
  } catch {
    storedResult = {};
  }
  if (outcome.error) {
    await prisma.audioIntelligenceJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: outcome.error instanceof Error ? outcome.error.message : "本機分析失敗",
        resultJson: JSON.stringify({ ...storedResult, pipelineRun: outcome.telemetry }),
        completedAt: new Date()
      }
    });
    throw outcome.error;
  }
  await prisma.audioIntelligenceJob.update({
    where: { id: job.id },
    data: { resultJson: JSON.stringify({ ...storedResult, pipelineRun: outcome.telemetry }) }
  });
  return prisma.audioIntelligenceJob.findUnique({ where: { id: job.id }, include: { audioFile: { select: { id: true, fileName: true, fileType: true } }, song: { select: { id: true, title: true } } } });
}

export async function listAudioIntelligenceJobs() {
  return prisma.audioIntelligenceJob.findMany({
    include: { audioFile: { select: { id: true, fileName: true, fileType: true } }, song: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 40
  });
}
