import type { AutoScoreBenchmarkMetric, AutoScoreHumanBenchmark, AutoScoreResult } from "@/lib/auto-score";
import { buildAutoScoreHumanBenchmark } from "@/lib/auto-score";
import type { EngineState } from "@/lib/audio-intelligence";
import {
  getHarmonyHostResourceSnapshot,
  HARMONY_PARAMETER_PROFILE,
  HARMONY_PIPELINE_PARAMETER_HASH,
  HARMONY_PIPELINE_PARAMETERS,
  HARMONY_PIPELINE_VERSION,
  type HarmonyPipelineRunTelemetry,
  type HarmonyPipelineStageRun
} from "@/lib/harmony-pipeline-runtime";
import { prisma } from "@/lib/prisma";

type ControlPlaneJob = {
  id: string;
  songId: string | null;
  audioFileId: string | null;
  jobType: string;
  target: string | null;
  engine: string;
  status: string;
  resultJson: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  song: { id: string; title: string } | null;
  audioFile: { id: string; fileName: string; fileType: string } | null;
};

type MetricAccumulator = { correct: number; total: number };

const engineVersions: Record<string, string> = {
  songzu_local_dsp_v2: "2.0",
  songzu_harmony_v2: "CQT v8",
  madmom_rnn_beat_grid_v1: "RNN v1",
  madmom_cnn_crf: "CNN/CRF v1",
  basic_pitch: "CoreML 0.4",
  btc_ismir19: "ISMIR 2019 large-voca",
  demucs: "htdemucs_ft",
  essentia: "experimental",
  songzu_harmony_v12: "12.0"
};

const engineParameters: Record<string, string[]> = {
  songzu_local_dsp_v2: ["8 kHz analysis PCM", "600 秒安全上限", "來源唯讀"],
  songzu_harmony_v2: ["逐拍 / 半拍 / 兩拍 / 全小節", "CQT 家族權重上限 1.65", "調音校正"],
  madmom_rnn_beat_grid_v1: ["RNN 拍點", "Downbeat 對齊", "最低可信 55%"],
  madmom_cnn_crf: ["和聲 Stem + 原曲雙視角", "CRF 時序平滑"],
  basic_pitch: ["Audio-to-MIDI", "和弦音覆蓋與 N.C. 證據"],
  btc_ismir19: ["約 10 秒雙向語境", "只作第二意見"],
  demucs: ["htdemucs_ft", "2 shifts", "50% overlap", "24-bit WAV"],
  essentia: ["尚未進入正式投票", "只保留實驗候選"],
  songzu_harmony_v12: [HARMONY_PARAMETER_PROFILE, HARMONY_PIPELINE_PARAMETER_HASH.slice(0, 12)]
};

const stageFallback: HarmonyPipelineStageRun[] = [
  { id: "source_preflight", label: "來源預檢", status: "pending", durationMs: null, detail: null, error: null },
  { id: "stem_separation", label: "分軌", status: "pending", durationMs: null, detail: null, error: null },
  { id: "beat_grid", label: "拍點", status: "pending", durationMs: null, detail: null, error: null },
  { id: "bass_root", label: "Bass 根音", status: "pending", durationMs: null, detail: null, error: null },
  { id: "chord_quality", label: "和弦性質", status: "pending", durationMs: null, detail: null, error: null },
  { id: "family_consensus", label: "跨家族共識", status: "pending", durationMs: null, detail: null, error: null },
  { id: "quality_gate", label: "品質閘門", status: "pending", durationMs: null, detail: null, error: null }
];

function safeObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isPipelineRun(value: unknown): value is HarmonyPipelineRunTelemetry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && record.pipelineVersion === HARMONY_PIPELINE_VERSION && Array.isArray(record.stages) && Array.isArray(record.engines);
}

function parseScore(value: string): AutoScoreResult | null {
  try {
    const parsed = JSON.parse(value) as Partial<AutoScoreResult>;
    return parsed.format === "songzu-auto-score" && Array.isArray(parsed.chords) ? parsed as AutoScoreResult : null;
  } catch {
    return null;
  }
}

function metric(accumulator: MetricAccumulator): AutoScoreBenchmarkMetric {
  return {
    ...accumulator,
    accuracy: accumulator.total ? Math.round(accumulator.correct / accumulator.total * 10_000) / 10_000 : null
  };
}

function addMetric(target: MetricAccumulator, source: AutoScoreBenchmarkMetric) {
  target.correct += source.correct;
  target.total += source.total;
}

function emptyMetrics() {
  return {
    exactChord: { correct: 0, total: 0 },
    root: { correct: 0, total: 0 },
    quality: { correct: 0, total: 0 },
    inversion: { correct: 0, total: 0 },
    noChord: { correct: 0, total: 0 },
    boundary: { correct: 0, total: 0 }
  };
}

function finalizeMetrics(value: ReturnType<typeof emptyMetrics>) {
  return {
    exactChord: metric(value.exactChord),
    root: metric(value.root),
    quality: metric(value.quality),
    inversion: metric(value.inversion),
    noChord: metric(value.noChord),
    boundary: metric(value.boundary)
  };
}

function engineWeight(benchmark: { sampleCount: number; root: AutoScoreBenchmarkMetric; quality: AutoScoreBenchmarkMetric }) {
  if (benchmark.sampleCount < 24) return 1;
  const root = benchmark.root.accuracy ?? 0.5;
  const quality = benchmark.quality.accuracy ?? 0.5;
  return Math.round(Math.min(1.18, Math.max(0.78, 0.72 + (root * 0.58 + quality * 0.42) * 0.46)) * 1000) / 1000;
}

async function buildBenchmarkSummary() {
  const drafts = await prisma.dawScoreDraft.findMany({
    where: { targetInstrument: "guitar" },
    orderBy: { updatedAt: "desc" },
    take: 400,
    select: {
      id: true,
      analyzer: true,
      resultJson: true,
      updatedAt: true,
      project: { select: { songId: true, song: { select: { title: true, genre: true } } } }
    }
  });
  const seenSongs = new Set<string>();
  const scoreRows: Array<{
    draftId: string;
    songId: string;
    songTitle: string;
    genre: string;
    sourceProfile: string;
    benchmark: AutoScoreHumanBenchmark;
  }> = [];
  let humanConfirmedSongCount = 0;
  for (const draft of drafts) {
    if (seenSongs.has(draft.project.songId)) continue;
    const score = parseScore(draft.resultJson);
    const confirmed = score?.review?.status === "finalized" && score.review.verificationMethod === "manual";
    if (!score || !confirmed) continue;
    seenSongs.add(draft.project.songId);
    humanConfirmedSongCount += 1;
    const benchmark = score.humanBenchmark ?? buildAutoScoreHumanBenchmark(score);
    if (!benchmark) continue;
    scoreRows.push({
      draftId: draft.id,
      songId: draft.project.songId,
      songTitle: draft.project.song.title,
      genre: draft.project.song.genre || "未分類",
      sourceProfile: score.sourceProfile,
      benchmark
    });
  }

  const aggregate = emptyMetrics();
  const engines = new Map<string, {
    sampleCount: number;
    exactChord: MetricAccumulator;
    root: MetricAccumulator;
    quality: MetricAccumulator;
    contexts: Map<string, { correct: number; total: number }>;
  }>();
  const versions = new Map<string, { songCount: number; beatCount: number; metrics: ReturnType<typeof emptyMetrics> }>();
  let totalBeats = 0;
  for (const row of scoreRows) {
    totalBeats += row.benchmark.beatCount;
    for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) addMetric(aggregate[key], row.benchmark.metrics[key]);
    const version = versions.get(row.benchmark.pipelineVersion) ?? { songCount: 0, beatCount: 0, metrics: emptyMetrics() };
    version.songCount += 1;
    version.beatCount += row.benchmark.beatCount;
    for (const key of Object.keys(version.metrics) as Array<keyof typeof version.metrics>) addMetric(version.metrics[key], row.benchmark.metrics[key]);
    versions.set(row.benchmark.pipelineVersion, version);
    for (const engine of row.benchmark.engines) {
      const current = engines.get(engine.engineId) ?? {
        sampleCount: 0,
        exactChord: { correct: 0, total: 0 },
        root: { correct: 0, total: 0 },
        quality: { correct: 0, total: 0 },
        contexts: new Map<string, { correct: number; total: number }>()
      };
      current.sampleCount += engine.sampleCount;
      addMetric(current.exactChord, engine.exactChord);
      addMetric(current.root, engine.root);
      addMetric(current.quality, engine.quality);
      const contextKey = `${row.genre} · ${row.sourceProfile === "mixed_audio" ? "完整混音" : "單一音軌"}`;
      const context = current.contexts.get(contextKey) ?? { correct: 0, total: 0 };
      context.correct += engine.exactChord.correct;
      context.total += engine.exactChord.total;
      current.contexts.set(contextKey, context);
      engines.set(engine.engineId, current);
    }
  }

  return {
    standard: "songzu_human_benchmark_v1" as const,
    humanConfirmedSongCount,
    benchmarkedSongCount: scoreRows.length,
    awaitingComparableBaselineCount: Math.max(0, humanConfirmedSongCount - scoreRows.length),
    totalBeats,
    metrics: finalizeMetrics(aggregate),
    versions: [...versions.entries()].map(([pipelineVersion, value]) => ({
      pipelineVersion,
      songCount: value.songCount,
      beatCount: value.beatCount,
      metrics: finalizeMetrics(value.metrics)
    })),
    engines: [...engines.entries()].map(([engineId, value]) => {
      const contexts = [...value.contexts.entries()].map(([label, counts]) => ({ label, ...metric(counts) }))
        .filter((context) => context.total >= 8)
        .sort((left, right) => (right.accuracy ?? 0) - (left.accuracy ?? 0));
      const finalized = {
        engineId,
        sampleCount: value.sampleCount,
        exactChord: metric(value.exactChord),
        root: metric(value.root),
        quality: metric(value.quality),
        bestContext: contexts[0] ?? null,
        riskContext: contexts.at(-1) ?? null,
        automaticWeight: 1
      };
      return { ...finalized, automaticWeight: engineWeight(finalized) };
    }).sort((left, right) => right.sampleCount - left.sampleCount),
    latestBenchmarks: scoreRows.slice(0, 8).map((row) => ({
      draftId: row.draftId,
      songId: row.songId,
      songTitle: row.songTitle,
      pipelineVersion: row.benchmark.pipelineVersion,
      beatCount: row.benchmark.beatCount,
      metrics: row.benchmark.metrics
    }))
  };
}

function derivedStages(result: Record<string, unknown>, score: AutoScoreResult | null): HarmonyPipelineStageRun[] {
  const gate = score?.harmonyAnalysis?.qualityGate ?? (
    result.harmonyQualityGate && typeof result.harmonyQualityGate === "object"
      ? result.harmonyQualityGate as NonNullable<AutoScoreResult["harmonyAnalysis"]>["qualityGate"]
      : null
  );
  const methods = score?.harmonyAnalysis?.methods ?? [];
  const method = (id: string) => methods.find((item) => item.id === id);
  const preflight = score?.harmonyAnalysis?.sourceQuality ?? (
    result.sourceQuality && typeof result.sourceQuality === "object"
      ? result.sourceQuality as NonNullable<AutoScoreResult["harmonyAnalysis"]>["sourceQuality"]
      : null
  );
  return stageFallback.map((stage) => {
    if (stage.id === "source_preflight") return {
      ...stage,
      status: preflight?.analysisSuitability === "good" ? "passed" : preflight?.analysisSuitability === "limited" ? "degraded" : "review",
      detail: preflight ? `${preflight.codecName || "未知編碼"} · ${preflight.analysisSuitability}` : "舊工作未記錄來源預檢"
    };
    if (stage.id === "stem_separation") {
      const bass = method("bass_root_anchor");
      const quality = method("harmonic_instrument_quality");
      const participated = bass?.participated || quality?.participated;
      return { ...stage, status: participated ? "passed" : "skipped", detail: participated ? "Bass / Other Stem 已作證據" : "本次以原曲證據分析" };
    }
    if (stage.id === "beat_grid") {
      const beat = method("beat_downbeat_boundaries");
      return { ...stage, status: beat?.participated ? "passed" : "review", detail: beat?.note ?? "舊工作未記錄拍點狀態" };
    }
    if (stage.id === "bass_root") {
      const bass = method("bass_root_anchor");
      return { ...stage, status: bass?.participated ? "passed" : "review", detail: bass?.note ?? "根音證據未分開記錄" };
    }
    if (stage.id === "chord_quality") {
      const quality = method("harmonic_instrument_quality");
      return { ...stage, status: quality?.participated ? "passed" : "review", detail: quality?.note ?? "和弦性質證據未分開記錄" };
    }
    if (stage.id === "family_consensus") {
      const consensus = method("independent_family_consensus");
      return { ...stage, status: consensus?.participated ? "passed" : "review", detail: consensus?.note ?? "舊工作未記錄跨家族共識" };
    }
    return {
      ...stage,
      status: gate?.status === "pass" ? "passed" : gate?.status === "degraded" ? "degraded" : gate ? "review" : "pending",
      detail: gate?.reasons.join("；") ?? "尚無品質閘門結果"
    };
  });
}

async function latestPipelineEvidence(jobs: ControlPlaneJob[]) {
  const latest = jobs.find((job) => ["DEEP_ANALYSIS", "TRANSCRIPTION"].includes(job.jobType));
  if (!latest) return { job: null, run: null, score: null, result: {} as Record<string, unknown>, stages: stageFallback };
  const result = safeObject(latest.resultJson);
  const pipelineRun = isPipelineRun(result.pipelineRun) ? result.pipelineRun : null;
  const draftId = typeof result.draftId === "string" ? result.draftId : null;
  const draft = draftId ? await prisma.dawScoreDraft.findUnique({ where: { id: draftId }, select: { resultJson: true } }) : null;
  const score = draft ? parseScore(draft.resultJson) : null;
  return {
    job: latest,
    run: pipelineRun,
    score,
    result,
    stages: pipelineRun?.stages ?? derivedStages(result, score)
  };
}

export async function getHarmonyControlPlane(engines: EngineState[], jobs: ControlPlaneJob[]) {
  const [latest, benchmark] = await Promise.all([
    latestPipelineEvidence(jobs),
    buildBenchmarkSummary()
  ]);
  const runEngines = new Map((latest.run?.engines ?? []).map((engine) => [engine.engineId, engine]));
  const methodParticipation = new Map((latest.score?.harmonyAnalysis?.methods ?? []).map((method) => [method.id, method]));
  const participationAliases: Record<string, string[]> = {
    songzu_local_dsp_v2: ["legacy_audio_evidence"],
    songzu_harmony_v2: ["tuning_cqt_multiscale", "harmonic_instrument_quality", "bass_pitch_tracker"],
    madmom_rnn_beat_grid_v1: ["beat_downbeat_boundaries"],
    madmom_cnn_crf: ["independent_family_consensus"],
    basic_pitch: ["basic_pitch_notes"],
    btc_ismir19: ["btc_long_context"],
    demucs: ["bass_root_anchor", "harmonic_instrument_quality"],
    songzu_harmony_v12: ["independent_family_consensus", "defining_color_validation", "transient_boundary_validation", "key_aware_enharmonics", "structural_harmony_decoder"]
  };
  const latestExists = Boolean(latest.job);
  const qualityGate = latest.score?.harmonyAnalysis?.qualityGate ?? (
    latest.result.harmonyQualityGate && typeof latest.result.harmonyQualityGate === "object"
      ? latest.result.harmonyQualityGate as NonNullable<AutoScoreResult["harmonyAnalysis"]>["qualityGate"]
      : null
  );
  const enriched = engines.map((engine) => {
    const runtime = runEngines.get(engine.id);
    const aliases = participationAliases[engine.id] ?? [];
    const methods = aliases.map((alias) => methodParticipation.get(alias)).filter(Boolean);
    const participated = latest.run
      ? runtime?.participated ?? false
      : latestExists ? methods.some((method) => method?.participated) : null;
    const qualityPassed = runtime?.qualityPassed ?? (participated && qualityGate
      ? qualityGate.status === "pass" ? true : qualityGate.status === "degraded" ? false : null
      : null);
    const reliability = benchmark.engines.find((entry) => entry.engineId === engine.id);
    return {
      ...engine,
      version: engineVersions[engine.id] ?? "未標記",
      parameters: engineParameters[engine.id] ?? [],
      states: {
        installed: engine.available,
        connected: engine.connected,
        participated,
        qualityPassed
      },
      latest: runtime ? {
        durationMs: runtime.durationMs,
        cacheHits: runtime.cacheHits,
        cacheMisses: runtime.cacheMisses,
        detail: runtime.detail,
        error: runtime.error
      } : null,
      reliability: reliability ?? null,
      lastError: runtime?.error ?? (latest.job?.engine === engine.id ? latest.job.errorMessage : null)
    };
  });
  const latestDurationMs = latest.run?.durationMs ?? (
    latest.job?.startedAt && latest.job.completedAt ? latest.job.completedAt.getTime() - latest.job.startedAt.getTime() : null
  );
  const currentResources = getHarmonyHostResourceSnapshot();
  return {
    generatedAt: new Date().toISOString(),
    health: latest.run?.status ?? (qualityGate?.status === "pass" ? "success" : qualityGate?.status ?? (latest.job?.status === "FAILED" ? "failed" : latest.job ? "review" : "idle")),
    orchestrator: enriched.find((engine) => engine.role === "orchestrator") ?? null,
    stages: latest.stages,
    engineGroups: [
      { id: "required", label: "必要核心", engines: enriched.filter((engine) => engine.role === "core") },
      { id: "evidence", label: "選配證據", engines: enriched.filter((engine) => engine.role === "evidence") },
      { id: "separation", label: "分軌工具", engines: enriched.filter((engine) => engine.role === "separation") },
      { id: "experimental", label: "實驗功能", engines: enriched.filter((engine) => engine.role === "experimental" || engine.role === "feature") }
    ],
    latestRun: latest.job ? {
      id: latest.job.id,
      songId: latest.job.songId,
      songTitle: latest.run?.songTitle ?? latest.job.song?.title ?? "未綁定作品",
      audioFileName: latest.run?.audioFileName ?? latest.job.audioFile?.fileName ?? "音檔已移除",
      jobType: latest.job.jobType,
      target: latest.job.target,
      startedAt: latest.run?.startedAt ?? latest.job.startedAt?.toISOString() ?? latest.job.createdAt.toISOString(),
      completedAt: latest.run?.completedAt ?? latest.job.completedAt?.toISOString() ?? null,
      durationMs: latestDurationMs,
      status: latest.run?.status ?? (latest.job.status === "FAILED" ? "failed" : qualityGate?.status === "degraded" ? "degraded" : qualityGate?.status === "pass" ? "success" : qualityGate?.status === "review" || latest.job.status === "COMPLETED" ? "review" : "running"),
      errorReason: latest.run?.errorReason ?? latest.job.errorMessage
    } : null,
    keyResults: {
      rootConfidence: latest.run?.keyResults.rootConfidence ?? qualityGate?.rootConfidence ?? null,
      qualityConfidence: latest.run?.keyResults.qualityConfidence ?? qualityGate?.qualityConfidence ?? null,
      conflictBeatCount: latest.run?.keyResults.conflictBeatCount ?? qualityGate?.conflictBeatCount ?? null,
      highConfidenceBeatCount: latest.run?.keyResults.highConfidenceBeatCount ?? qualityGate?.highConfidenceBeatCount ?? null,
      beatCount: latest.run?.keyResults.beatCount ?? qualityGate?.beatCount ?? null
    },
    resources: {
      current: currentResources,
      latestRun: latest.run?.resources ?? null
    },
    benchmark,
    versions: [
      {
        version: HARMONY_PIPELINE_VERSION,
        status: "active" as const,
        parameterProfile: HARMONY_PARAMETER_PROFILE,
        parameterHash: HARMONY_PIPELINE_PARAMETER_HASH,
        parameters: HARMONY_PIPELINE_PARAMETERS,
        benchmark: benchmark.versions.find((version) => version.pipelineVersion === HARMONY_PIPELINE_VERSION) ?? null,
        rollbackMode: null
      },
      {
        version: "songzu_harmony_v11",
        status: "rollback" as const,
        parameterProfile: "v11-stable-readonly",
        parameterHash: null,
        parameters: null,
        benchmark: benchmark.versions.find((version) => version.pipelineVersion === "songzu_harmony_v11") ?? null,
        rollbackMode: "保留舊譜與結果供唯讀比較；不覆蓋目前人工定稿。"
      },
      {
        version: "songzu_harmony_v10",
        status: "archived" as const,
        parameterProfile: "v10-cross-family-baseline",
        parameterHash: null,
        parameters: null,
        benchmark: benchmark.versions.find((version) => version.pipelineVersion === "songzu_harmony_v10") ?? null,
        rollbackMode: "歷史基準，只供差異追溯。"
      }
    ]
  };
}

export type HarmonyControlPlane = Awaited<ReturnType<typeof getHarmonyControlPlane>>;
