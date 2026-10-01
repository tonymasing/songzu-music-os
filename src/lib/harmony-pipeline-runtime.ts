import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

import type { HarmonyPipelineQualityGate } from "@/lib/harmony-pipeline-quality";

export const HARMONY_PIPELINE_VERSION = "songzu_harmony_v12" as const;
export const HARMONY_PARAMETER_PROFILE = "v12-structural-lead-sheet-2026.08.31-r14" as const;
export const HARMONY_PIPELINE_PARAMETERS = Object.freeze({
  rootConfidencePass: 0.68,
  qualityConfidencePass: 0.58,
  minimumIndependentFamilies: 2,
  maximumConflictRatio: 0.12,
  minimumHighConfidenceCoverage: 0.68,
  minimumBeatGridConfidence: 0.55,
  minimumStemReliability: 0.65,
  minimumDefiningColorSupport: 0.4,
  transientBoundaryEntrance: 0.62,
  transientBoundaryExit: 0.5,
  entryBoundaryWindowFraction: 0.3,
  stableBassBoundaryStrength: 0.84,
  structuralHarmonyLayer: true,
  decorativeColorMinimumBeats: 2,
  singleBeatStructuralQualityConfidence: 0.66,
  singleBeatStructuralBoundaryEntrance: 0.62,
  singleBeatStructuralBoundaryExit: 0.5,
  repeatedOrnamentCanPromoteSingleBeatSixth: false,
  isolatedUpperColorMinimumMidi: 72,
  isolatedUpperColorMinimumSemitoneGap: 9,
  relativeMinorSixthReinterpretation: true,
  relativeMinorRootNoteMinimum: 0.04,
  relativeMinorSeventhNoteSupport: 0.62,
  relativeMinorSeventhDefiningSupport: 0.4,
  registerGroundedColorContext: true,
  registerGroundedColorSupport: 0.4,
  initialHarmonyContinuationPrior: true,
  supportingReferenceStructuralFusion: true,
  rootQualityDecoupled: true,
  keyAwareEnharmonicSpelling: true,
  cqtFamilyWeightCap: 1.65,
  maxAnalysisSeconds: 600,
  maxRuntimeMs: 1_200_000,
  maxCapturedOutputMb: 64
});
export const HARMONY_PIPELINE_PARAMETER_HASH = createHash("sha256")
  .update(JSON.stringify(HARMONY_PIPELINE_PARAMETERS))
  .digest("hex");

export type HarmonyPipelineStageId =
  | "source_preflight"
  | "stem_separation"
  | "beat_grid"
  | "bass_root"
  | "chord_quality"
  | "family_consensus"
  | "quality_gate";

export type HarmonyPipelineRunStatus = "running" | "success" | "review" | "degraded" | "failed";
export type HarmonyPipelineStageStatus = "pending" | "running" | "passed" | "review" | "degraded" | "skipped" | "failed";

export type HarmonyPipelineResourceSnapshot = {
  capturedAt: string;
  cpuLoadPercent: number;
  processCpuAveragePercent: number;
  processMemoryMb: number;
  processPeakMemoryMb: number;
  systemMemoryUsedPercent: number;
  systemMemoryUsedMb: number;
  systemMemoryTotalMb: number;
  logicalCpuCount: number;
  modelDevice: string;
};

export type HarmonyPipelineStageRun = {
  id: HarmonyPipelineStageId;
  label: string;
  status: HarmonyPipelineStageStatus;
  durationMs: number | null;
  detail: string | null;
  error: string | null;
};

export type HarmonyEngineRunTelemetry = {
  engineId: string;
  participated: boolean;
  qualityPassed: boolean | null;
  durationMs: number;
  cacheHits: number;
  cacheMisses: number;
  detail: string | null;
  error: string | null;
};

export type HarmonyPipelineRunTelemetry = {
  schemaVersion: 1;
  runId: string;
  pipelineVersion: typeof HARMONY_PIPELINE_VERSION;
  parameterProfile: typeof HARMONY_PARAMETER_PROFILE;
  parameterHash: string;
  rollbackPoint: {
    pipelineVersion: "songzu_harmony_v11";
    parameterProfile: "v11-stable-readonly";
    mode: "read_only_comparison";
  };
  songId: string;
  songTitle: string;
  audioFileId: string;
  audioFileName: string;
  jobType: string;
  target: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: HarmonyPipelineRunStatus;
  errorReason: string | null;
  stages: HarmonyPipelineStageRun[];
  engines: HarmonyEngineRunTelemetry[];
  resources: {
    start: HarmonyPipelineResourceSnapshot;
    end: HarmonyPipelineResourceSnapshot;
    guard: {
      maxRuntimeMs: number;
      maxCapturedOutputMb: number;
      timedOut: boolean;
    };
    cacheHitRate: number | null;
  };
  keyResults: {
    rootConfidence: number | null;
    qualityConfidence: number | null;
    conflictBeatCount: number | null;
    highConfidenceBeatCount: number | null;
    beatCount: number | null;
  };
};

type MutableStage = HarmonyPipelineStageRun & { startedAtMs: number | null };
type MutableEngine = HarmonyEngineRunTelemetry & { startedAtMs: number | null };

type RuntimeState = {
  runId: string;
  pipelineVersion: typeof HARMONY_PIPELINE_VERSION;
  parameterProfile: typeof HARMONY_PARAMETER_PROFILE;
  parameterHash: string;
  songId: string;
  songTitle: string;
  audioFileId: string;
  audioFileName: string;
  jobType: string;
  target: string;
  startedAtIso: string;
  startedAtMs: number;
  startResources: HarmonyPipelineResourceSnapshot;
  stages: Map<HarmonyPipelineStageId, MutableStage>;
  engines: Map<string, MutableEngine>;
  qualityGate: HarmonyPipelineQualityGate | null;
  maxRuntimeMs: number;
  maxCapturedOutputMb: number;
  timedOut: boolean;
};

const stageDefinitions: Array<{ id: HarmonyPipelineStageId; label: string }> = [
  { id: "source_preflight", label: "來源預檢" },
  { id: "stem_separation", label: "分軌" },
  { id: "beat_grid", label: "拍點" },
  { id: "bass_root", label: "Bass 根音" },
  { id: "chord_quality", label: "和弦性質" },
  { id: "family_consensus", label: "跨家族共識" },
  { id: "quality_gate", label: "品質閘門" }
];

const runtimeStorage = new AsyncLocalStorage<RuntimeState>();

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function resourceSnapshot(): HarmonyPipelineResourceSnapshot {
  const memory = process.memoryUsage();
  const usage = process.resourceUsage();
  const uptimeSeconds = Math.max(0.001, process.uptime());
  const cpuCount = Math.max(1, cpus().length);
  const processCpuSeconds = (usage.userCPUTime + usage.systemCPUTime) / 1_000_000;
  const systemTotal = totalmem();
  const systemUsed = Math.max(0, systemTotal - freemem());
  return {
    capturedAt: new Date().toISOString(),
    cpuLoadPercent: round(Math.min(100, Math.max(0, loadavg()[0] / cpuCount * 100))),
    processCpuAveragePercent: round(Math.min(100, Math.max(0, processCpuSeconds / uptimeSeconds / cpuCount * 100))),
    processMemoryMb: round(memory.rss / 1024 / 1024),
    processPeakMemoryMb: round(usage.maxRSS / 1024),
    systemMemoryUsedPercent: round(systemTotal ? systemUsed / systemTotal * 100 : 0),
    systemMemoryUsedMb: round(systemUsed / 1024 / 1024),
    systemMemoryTotalMb: round(systemTotal / 1024 / 1024),
    logicalCpuCount: cpuCount,
    modelDevice: process.env.SONGZU_DEMUCS_DEVICE?.trim() || (process.platform === "darwin" ? "CPU / Apple Accelerate" : "auto")
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知錯誤");
}

function ensureEngine(state: RuntimeState, engineId: string): MutableEngine {
  const current = state.engines.get(engineId);
  if (current) return current;
  const created: MutableEngine = {
    engineId,
    participated: false,
    qualityPassed: null,
    durationMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    detail: null,
    error: null,
    startedAtMs: null
  };
  state.engines.set(engineId, created);
  return created;
}

export function currentHarmonyPipelineRun() {
  return runtimeStorage.getStore() ?? null;
}

export function markHarmonyEngine(input: {
  engineId: string;
  participated?: boolean;
  qualityPassed?: boolean | null;
  detail?: string | null;
  error?: string | null;
  durationMs?: number;
}) {
  const state = runtimeStorage.getStore();
  if (!state) return;
  const engine = ensureEngine(state, input.engineId);
  engine.participated = input.participated ?? true;
  if (input.qualityPassed !== undefined) engine.qualityPassed = input.qualityPassed;
  if (input.detail !== undefined) engine.detail = input.detail;
  if (input.error !== undefined) engine.error = input.error;
  if (input.durationMs !== undefined) engine.durationMs += Math.max(0, input.durationMs);
}

export function markHarmonyCache(engineId: string, hit: boolean) {
  const state = runtimeStorage.getStore();
  if (!state) return;
  const engine = ensureEngine(state, engineId);
  engine.participated = true;
  if (hit) engine.cacheHits += 1;
  else engine.cacheMisses += 1;
}

export function markHarmonyQualityGate(gate: HarmonyPipelineQualityGate) {
  const state = runtimeStorage.getStore();
  if (!state) return;
  state.qualityGate = gate;
  markHarmonyEngine({
    engineId: HARMONY_PIPELINE_VERSION,
    qualityPassed: gate.status === "pass",
    detail: gate.reasons.join("；")
  });
}

export function skipHarmonyPipelineStage(stageId: HarmonyPipelineStageId, detail: string) {
  const stage = runtimeStorage.getStore()?.stages.get(stageId);
  if (!stage || stage.status !== "pending") return;
  stage.status = "skipped";
  stage.detail = detail;
}

export function markHarmonyPipelineFallback(detail: string) {
  const state = runtimeStorage.getStore();
  if (!state) return;
  assertHarmonyPipelineDeadline();
  for (const stage of state.stages.values()) {
    if (stage.status !== "failed" && stage.status !== "running") continue;
    stage.status = "degraded";
    stage.detail = [stage.detail, detail].filter(Boolean).join("；");
    stage.startedAtMs = null;
  }
  const gateStage = state.stages.get("quality_gate");
  if (gateStage && (gateStage.status === "pending" || gateStage.status === "skipped")) {
    gateStage.status = "degraded";
    gateStage.detail = detail;
  }
  markHarmonyEngine({
    engineId: HARMONY_PIPELINE_VERSION,
    participated: true,
    qualityPassed: false,
    detail
  });
}

export async function runHarmonyPipelineStage<T>(
  stageId: HarmonyPipelineStageId,
  operation: () => Promise<T>,
  options?: { detail?: string; outcome?: (value: T) => "passed" | "review" | "degraded" }
): Promise<T> {
  const state = runtimeStorage.getStore();
  const stage = state?.stages.get(stageId);
  if (!stage) return operation();
  stage.status = "running";
  stage.startedAtMs = performance.now();
  if (options?.detail) stage.detail = options.detail;
  try {
    assertHarmonyPipelineDeadline();
    const value = await operation();
    assertHarmonyPipelineDeadline();
    stage.durationMs = round(performance.now() - stage.startedAtMs, 0);
    stage.status = options?.outcome?.(value) ?? "passed";
    return value;
  } catch (error) {
    stage.durationMs = round(performance.now() - stage.startedAtMs, 0);
    stage.status = "failed";
    stage.error = errorMessage(error);
    throw error;
  } finally {
    stage.startedAtMs = null;
  }
}

export function runHarmonyPipelineStageSync<T>(
  stageId: HarmonyPipelineStageId,
  operation: () => T,
  options?: { detail?: string; outcome?: (value: T) => "passed" | "review" | "degraded" }
): T {
  const state = runtimeStorage.getStore();
  const stage = state?.stages.get(stageId);
  if (!stage) return operation();
  stage.status = "running";
  stage.startedAtMs = performance.now();
  if (options?.detail) stage.detail = options.detail;
  try {
    assertHarmonyPipelineDeadline();
    const value = operation();
    assertHarmonyPipelineDeadline();
    stage.durationMs = round(performance.now() - stage.startedAtMs, 0);
    stage.status = options?.outcome?.(value) ?? "passed";
    return value;
  } catch (error) {
    stage.durationMs = round(performance.now() - stage.startedAtMs, 0);
    stage.status = "failed";
    stage.error = errorMessage(error);
    throw error;
  } finally {
    stage.startedAtMs = null;
  }
}

export function assertHarmonyPipelineDeadline() {
  const state = runtimeStorage.getStore();
  if (state && (state.timedOut || performance.now() >= state.startedAtMs + state.maxRuntimeMs)) {
    state.timedOut = true;
    throw new Error("本機分析已超過總執行時限，未啟動後續分析，也不會把逾時結果標為成功；原檔與已確認樂譜保留。");
  }
}

export function pipelineRuntimeGuard() {
  assertHarmonyPipelineDeadline();
  const state = runtimeStorage.getStore();
  return state ? {
    deadlineMs: state.startedAtMs + state.maxRuntimeMs,
    remainingRuntimeMs: Math.max(0, state.startedAtMs + state.maxRuntimeMs - performance.now()),
    maxRuntimeMs: state.maxRuntimeMs,
    maxCapturedOutputBytes: state.maxCapturedOutputMb * 1024 * 1024
  } : null;
}

export function markPipelineTimedOut() {
  const state = runtimeStorage.getStore();
  if (state) state.timedOut = true;
}

function finalizeTelemetry(state: RuntimeState, error: unknown | null): HarmonyPipelineRunTelemetry {
  const completedAt = new Date();
  const gate = state.qualityGate;
  const errorReason = error ? errorMessage(error) : null;
  const hasFailedStage = [...state.stages.values()].some((stage) => stage.status === "failed");
  const hasDegradedStage = [...state.stages.values()].some((stage) => stage.status === "degraded");
  const hasReviewStage = [...state.stages.values()].some((stage) => stage.status === "review");
  const status: HarmonyPipelineRunStatus = errorReason || hasFailedStage
    ? "failed"
    : gate?.status === "degraded" || hasDegradedStage
      ? "degraded"
      : gate?.status === "review" || hasReviewStage
        ? "review"
        : gate?.status === "pass"
          ? "success"
          : "review";
  const stages = [...state.stages.values()].map(({ startedAtMs: _startedAtMs, ...stage }) => {
    if (stage.status === "running") {
      return { ...stage, status: "failed" as const, error: errorReason || "工作未正常結束" };
    }
    return stage;
  });
  const engines = [...state.engines.values()].map(({ startedAtMs: _startedAtMs, ...engine }) => engine);
  const cacheHits = engines.reduce((sum, engine) => sum + engine.cacheHits, 0);
  const cacheMisses = engines.reduce((sum, engine) => sum + engine.cacheMisses, 0);
  return {
    schemaVersion: 1,
    runId: state.runId,
    pipelineVersion: state.pipelineVersion,
    parameterProfile: state.parameterProfile,
    parameterHash: state.parameterHash,
    rollbackPoint: {
      pipelineVersion: "songzu_harmony_v11",
      parameterProfile: "v11-stable-readonly",
      mode: "read_only_comparison"
    },
    songId: state.songId,
    songTitle: state.songTitle,
    audioFileId: state.audioFileId,
    audioFileName: state.audioFileName,
    jobType: state.jobType,
    target: state.target,
    startedAt: state.startedAtIso,
    completedAt: completedAt.toISOString(),
    durationMs: round(performance.now() - state.startedAtMs, 0),
    status,
    errorReason,
    stages,
    engines,
    resources: {
      start: state.startResources,
      end: resourceSnapshot(),
      guard: {
        maxRuntimeMs: state.maxRuntimeMs,
        maxCapturedOutputMb: state.maxCapturedOutputMb,
        timedOut: state.timedOut
      },
      cacheHitRate: cacheHits + cacheMisses ? round(cacheHits / (cacheHits + cacheMisses), 4) : null
    },
    keyResults: {
      rootConfidence: gate?.rootConfidence ?? null,
      qualityConfidence: gate?.qualityConfidence ?? null,
      conflictBeatCount: gate?.conflictBeatCount ?? null,
      highConfidenceBeatCount: gate?.highConfidenceBeatCount ?? null,
      beatCount: gate?.beatCount ?? null
    }
  };
}

export async function executeHarmonyPipelineRun<T>(input: {
  runId: string;
  parameterHash?: string;
  songId: string;
  songTitle: string;
  audioFileId: string;
  audioFileName: string;
  jobType: string;
  target: string;
  maxRuntimeMs?: number;
  maxCapturedOutputMb?: number;
}, operation: () => Promise<T>): Promise<{ value: T | null; telemetry: HarmonyPipelineRunTelemetry; error: unknown | null }> {
  for (const [name, value] of [["maxRuntimeMs", input.maxRuntimeMs], ["maxCapturedOutputMb", input.maxCapturedOutputMb]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`${name} 必須是有限的正數`);
  }
  const startedAt = new Date();
  const state: RuntimeState = {
    runId: input.runId,
    pipelineVersion: HARMONY_PIPELINE_VERSION,
    parameterProfile: HARMONY_PARAMETER_PROFILE,
    parameterHash: input.parameterHash ?? HARMONY_PIPELINE_PARAMETER_HASH,
    songId: input.songId,
    songTitle: input.songTitle,
    audioFileId: input.audioFileId,
    audioFileName: input.audioFileName,
    jobType: input.jobType,
    target: input.target,
    startedAtIso: startedAt.toISOString(),
    startedAtMs: performance.now(),
    startResources: resourceSnapshot(),
    stages: new Map(stageDefinitions.map((definition) => [definition.id, {
      ...definition,
      status: "pending" as const,
      durationMs: null,
      detail: null,
      error: null,
      startedAtMs: null
    }])),
    engines: new Map(),
    qualityGate: null,
    maxRuntimeMs: input.maxRuntimeMs ?? HARMONY_PIPELINE_PARAMETERS.maxRuntimeMs,
    maxCapturedOutputMb: input.maxCapturedOutputMb ?? HARMONY_PIPELINE_PARAMETERS.maxCapturedOutputMb,
    timedOut: false
  };
  return runtimeStorage.run(state, async () => {
    markHarmonyEngine({ engineId: HARMONY_PIPELINE_VERSION, participated: true });
    try {
      assertHarmonyPipelineDeadline();
      const value = await operation();
      assertHarmonyPipelineDeadline();
      return { value, telemetry: finalizeTelemetry(state, null), error: null };
    } catch (error) {
      return { value: null, telemetry: finalizeTelemetry(state, error), error };
    }
  });
}

export function getHarmonyHostResourceSnapshot() {
  return resourceSnapshot();
}
