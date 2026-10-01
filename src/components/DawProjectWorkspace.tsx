"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import {
  Archive,
  AudioLines,
  Check,
  ChevronDown,
  CircleStop,
  ClipboardPaste,
  Copy,
  Download,
  FileJson,
  Gauge,
  Guitar,
  Headphones,
  Magnet,
  MapPin,
  Mic2,
  MousePointer2,
  Music2,
  Palette,
  PanelLeftClose,
  Pause,
  Piano,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  SlidersHorizontal,
  TimerReset,
  Trash2,
  Volume2,
  Waves,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";

import type { AiAgentActionDto, AiAgentProviderStatus, AiConversationDto } from "@/lib/ai-agent";
import type { AutoScoreRhythmCalibration } from "@/lib/auto-score";
import { BrowserPcmRecorder } from "@/lib/browser-pcm-recorder";
import { createDiscreteAudioInput } from "@/lib/discrete-audio-input";
import { buildDawAdjustment, isCurrentDawProposal } from "@/lib/daw-adjustment";
import { defaultStudioSettings, getStudioSettings, getEffectiveStudioSettings, type StudioSettings, type Effects } from "@/lib/daw-dsp";
import { createDawChannel } from "@/lib/daw-channel-audio";
import { clampDawPan, clampDawTrackGain, dawClipEnvelope, dawClipEnvelopePoints, isDawMasterTransparent } from "@/lib/daw-mix-contract";
import { dawRecordingEvidence } from "@/lib/daw-recording-evidence";
import { buildDawWaveform, dawWaveformPath, dawWaveformPointCount, dawWaveformWindow, loadDawWaveforms, sampleDawWaveform, type DawWaveformResult, type DawWaveformSource } from "@/lib/daw-waveform";
import { DawCodexConsole } from "@/components/DawCodexConsole";
import { DawProfessionalConsole, useDawRecoveryJournal } from "@/components/DawProfessionalConsole";
import { DawScoreTimelineTracks } from "@/components/DawScoreTimelineTracks";
import { DawStylesheetGuard } from "@/components/DawStylesheetGuard";
import type { DawProjectDto } from "@/lib/daw";
import { audibleMasterTrackIds, audibleMixerTrackIds, createMixerMasterOutput, createMixerTrackBus, setMixerGate, type MixerScope } from "@/lib/daw-mixer-audio";
import {
  buildSmartMetronomeGrid,
  closeMetronomeAudioContext,
  DEFAULT_METRONOME_SOUND,
  DEFAULT_METRONOME_VOLUME,
  getMetronomeBeatDuration,
  isMetronomeSoundId,
  isSmartMetronomeRate,
  METRONOME_LOOKAHEAD_MS,
  METRONOME_SOUND_GROUPS,
  METRONOME_SOUND_OPTIONS,
  METRONOME_SOUND_STORAGE_KEY,
  METRONOME_START_DELAY_SECONDS,
  METRONOME_VOLUME_STORAGE_KEY,
  normalizeMetronomeVolume,
  recommendedSmartMetronomeRate,
  scheduleCleanMetronomeClick,
  scheduleMetronomeWindow,
  SMART_METRONOME_RATE_OPTIONS,
  type MetronomeSoundId,
  type MetronomeScheduleState,
  type SmartMetronomeRate
} from "@/lib/daw-metronome";
import type { SongDto } from "@/lib/music";
import {
  analyzePerformanceSamples,
  detectTunerReading,
  type PerformanceInstrument,
  type TunerReading
} from "@/lib/recording-performance";
import type { SoundLibraryItemDto } from "@/lib/sound-library";

const AutoScorePanel = dynamic(
  () => import("@/components/AutoScorePanel").then((module) => module.AutoScorePanel),
  {
    ssr: false,
    loading: () => <div className="daw-score-empty"><p>正在載入本機採譜引擎...</p></div>
  }
);

type Track = DawProjectDto["tracks"][number];
type Clip = Track["clips"][number];
type TakeLane = Track["takeLanes"][number];
type AutomationLane = Track["automationLanes"][number];
type DawStudioTheme = "emerald" | "crimson" | "amethyst" | "cyberpunk";
type DawPerformancePreference = "auto" | "quality" | "balanced" | "economy";
type DawRenderQuality = Exclude<DawPerformancePreference, "auto">;

const DAW_STUDIO_THEME_STORAGE_KEY = "songzu.daw.studio-theme.v1";
const DAW_PERFORMANCE_STORAGE_KEY = "songzu.daw.performance-mode.v1";
const DAW_STUDIO_THEME_LABELS: Record<DawStudioTheme, string> = {
  emerald: "翡翠玻璃",
  crimson: "緋紅暗室",
  amethyst: "紫曜晶殿",
  cyberpunk: "賽博龐克"
};
const DAW_PERFORMANCE_LABELS: Record<DawPerformancePreference, string> = {
  auto: "自動",
  quality: "精緻",
  balanced: "平衡",
  economy: "省資源"
};
type AvailableAudioFile = Pick<
  SongDto["audioFiles"][number],
  "id" | "fileName" | "fileType" | "versionName" | "durationSeconds" | "qualityStatus" | "storageProvider"
> & Partial<Pick<
  SongDto["audioFiles"][number],
  | "sourceKind"
  | "isProtectedOriginal"
  | "mimeType"
  | "codecName"
  | "parentAudioFileId"
>>;

type EngineStatus = {
  mode: string;
  native?: { version?: string; capabilities?: string[] } | null;
  message?: string;
};

type DawAudioDevice = {
  id?: string;
  name?: string;
  label?: string;
  isDefault?: boolean;
  maxChannels?: number;
  defaultSampleRate?: number | null;
  minBufferFrames?: number | null;
  maxBufferFrames?: number | null;
};

type DawDeviceStatus = {
  mode: string;
  inputDevices?: DawAudioDevice[];
  outputDevices?: DawAudioDevice[];
  nativeInputDevices?: DawAudioDevice[];
  nativeOutputDevices?: DawAudioDevice[];
  webInputDevices?: DawAudioDevice[];
  webOutputDevices?: DawAudioDevice[];
  message?: string;
};

type PlaybackEngineReport = {
  scheduledClips: number;
  skippedClips: number;
  effectChains: number;
  latencyMs: number | null;
  sampleRate: number;
  mode: string;
  startedAt: string;
};

type RenderOutput = {
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  downloadUrl: string;
  manifestFileName: string;
  manifestDownloadUrl: string;
};

type ProjectFileOutput = {
  fileName: string;
  fileSizeBytes: number;
  downloadUrl: string;
};

type StemsOutput = {
  fileName: string;
  fileSizeBytes: number;
  stemCount: number;
  downloadUrl: string;
  stems: Array<{ trackName: string; fileName: string; fileSizeBytes: number; sha256: string }>;
};

type DawRecordingStatus = "idle" | "counting" | "recording" | "saving" | "analyzing";
type DawChannelMode = "mono" | "stereo";
type DawCountInBars = 0 | 1 | 2 | 4;
type DawCaptureEngine = "native_wav" | "web";
type DawMonitorRoute = "off" | "native" | "hardware";
type DawTrackControl = "armed" | "monitoring" | "muted" | "solo";

type TimelinePlaybackOptions = {
  excludeTrackId?: string;
  soloTrackId?: string;
  trackOverride?: Track;
  previewDurationSeconds?: number;
  requiredTrackId?: string;
  includeMetronome?: boolean;
  recordingCue?: boolean;
  captureStartedAtMs?: number;
};

type LiveTrackControls = {
  fader: GainNode;
  panner: StereoPannerNode;
  polarity: GainNode;
  muteGate: GainNode;
};

type DawNativeRecordingStatus = {
  status: string;
  recordingId?: string | null;
  elapsedSeconds?: number;
  peak?: number;
  rms?: number;
  clipping?: boolean;
  error?: string | null;
  xrunCount?: number;
  diskWriteErrorCount?: number;
  outputUnderflowCount?: number;
};

type DawNativeRecordingResponse = {
  recordingId: string;
  inputDeviceName?: string;
  outputDeviceName?: string | null;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
};

type DawNativeRecordingSavedResponse = {
  song: SongDto;
  project: DawProjectDto | null;
  takeId: string;
  audioFileId: string;
  clipId: string;
};

type DawRecordingSessionMeta = {
  trackId: string;
  inputDeviceLabel: string;
  channelMode: DawChannelMode;
  countInBars: DawCountInBars;
  recordMode: "full" | "punch";
  punchInSeconds: number | null;
  punchOutSeconds: number | null;
  requestedSampleRate: number;
  overdubCueEnabled: boolean;
  captureLeadSeconds: number;
};

type DawRecordingCreateResponse = {
  song: SongDto;
  takeId: string;
  audioFileId: string;
  dawTrackId: string | null;
  clipId: string | null;
};

type CodexPolishAgentResponse = {
  providerStatus: AiAgentProviderStatus;
  conversation: AiConversationDto | null;
};

type DawDetectionIssue = {
  timestampSeconds: number;
  issueType: "timing" | "pitch" | "level" | "clipping";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  suggestion?: string;
  measuredValue?: number | null;
  expectedValue?: number | null;
};

type DawDetectionReportPayload = {
  detectionMode: string;
  overallScore: number;
  timingScore: number | null;
  pitchScore: number | null;
  levelScore: number | null;
  durationSeconds: number;
  peak: number;
  rms: number;
  tempoDriftMs: number | null;
  pitchDriftCents: number | null;
  summary: string;
  recommendations: string[];
  metrics: Record<string, unknown>;
  issues: DawDetectionIssue[];
  createTimestampComments: boolean;
};

const RACK_TABS = [
  ["recording", "錄音"],
  ["sounds", "音色"],
  ["effects", "效果"],
  ["ai", "Codex"],
  ["score", "自動採譜"],
  ["clip", "片段"]
] as const;

type RackTab = typeof RACK_TABS[number][0];


type RecordingMode = {
  id: string;
  label: string;
  trackType: string;
  defaultName: string;
  color: string;
  input: string;
  chain: string[];
};

type TakeCompRange = {
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  timelineStartSeconds: number;
};

type ClipTrimSide = "start" | "end";

type ClipClipboardItem = {
  audioFileId: string;
  sourceTrackId: string;
  startSeconds: number;
  offsetSeconds: number;
  durationSeconds: number | null;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  label: string | null;
  color: string | null;
};

type DawProjectUpdate = Partial<Pick<DawProjectDto, "title" | "bpm" | "musicalKey" | "sampleRate" | "bitDepth" | "timeSignature" | "status" | "engineMode">> & {
  projectMeta?: Record<string, unknown>;
};

function tracksAfterPatch(tracks: Track[], trackId: string, payload: Partial<Track>) {
  return tracks.map((item) => {
    if (item.id === trackId) return { ...item, ...payload };
    return {
      ...item,
      ...(payload.armed === true ? { armed: false } : {}),
      ...(payload.monitoring === true ? { monitoring: false } : {})
    };
  });
}

const GLASS_CONTROL_SELECTOR = [
  ".daw-studio-back",
  ".daw-header-action",
  ".daw-theme-trigger",
  ".daw-theme-option",
  ".daw-transport-button",
  ".daw-tool",
  ".daw-mode-add",
  ".daw-icon-button",
  ".daw-switch-grid button",
  ".daw-clip-tools button",
  ".daw-effects-toolbar button",
  ".daw-coach-actions button",
  ".daw-control-dock .button",
  ".daw-control-dock .daw-rack-tabs button",
  ".daw-track-controls button",
  ".daw-channel-buttons button",
  ".daw-master-actions button",
  ".daw-channel-actions button",
  ".daw-segmented button",
  ".daw-sound-pad",
  ".daw-effect-macros button",
  ".daw-score-targets button",
  ".daw-score-upload",
  ".daw-score-run"
].join(", ");

const GLASS_SURFACE_SELECTOR = [
  GLASS_CONTROL_SELECTOR,
  ".daw-control-dock .daw-rack-panel",
  ".daw-record-setup",
  ".daw-record-capture",
  ".daw-native-route",
  ".daw-effects-toolbar",
  ".daw-eq-strip label",
  ".daw-coach-item",
  ".daw-master-channel",
  ".daw-mixer-channel",
  ".daw-engine-box",
  ".daw-output-box",
  ".daw-take-item"
].join(", ");

function closestGlassElement(target: EventTarget | null, selector: string) {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

const glassPointerFrames = new WeakMap<HTMLElement, {
  frame: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}>();

function handleGlassPointerMove(event: PointerEvent<HTMLDivElement>) {
  const workspace = event.currentTarget;
  if (workspace.dataset.renderQuality === "economy" || workspace.dataset.realtimeActive === "true") return;

  const existing = glassPointerFrames.get(workspace);
  if (existing) {
    existing.clientX = event.clientX;
    existing.clientY = event.clientY;
    existing.target = event.target;
    return;
  }

  const pending = {
    frame: 0,
    clientX: event.clientX,
    clientY: event.clientY,
    target: event.target
  };
  pending.frame = window.requestAnimationFrame(() => {
    glassPointerFrames.delete(workspace);
    if (!workspace.isConnected) return;
    const workspaceRect = workspace.getBoundingClientRect();
    workspace.style.setProperty("--studio-pointer-x", `${Math.round(pending.clientX - workspaceRect.left)}px`);
    workspace.style.setProperty("--studio-pointer-y", `${Math.round(pending.clientY - workspaceRect.top)}px`);

    if (workspace.dataset.renderQuality !== "quality") return;
    const surface = closestGlassElement(pending.target, GLASS_SURFACE_SELECTOR);
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    surface.style.setProperty("--glass-pointer-x", `${Math.round(pending.clientX - rect.left)}px`);
    surface.style.setProperty("--glass-pointer-y", `${Math.round(pending.clientY - rect.top)}px`);
  });
  glassPointerFrames.set(workspace, pending);
}

function handleGlassPointerDown(event: PointerEvent<HTMLDivElement>) {
  if (
    event.currentTarget.dataset.renderQuality !== "quality" ||
    event.currentTarget.dataset.realtimeActive === "true" ||
    !event.isPrimary ||
    event.button !== 0 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) return;

  const control = closestGlassElement(event.target, GLASS_CONTROL_SELECTOR);
  if (!control || control.getAttribute("aria-disabled") === "true") return;
  if (control instanceof HTMLButtonElement && control.disabled) return;

  const rect = control.getBoundingClientRect();
  const diameter = Math.ceil(Math.max(rect.width, rect.height) * 2.1);
  const ripple = document.createElement("span");
  ripple.className = "daw-glass-ripple";
  ripple.setAttribute("aria-hidden", "true");
  ripple.style.width = `${diameter}px`;
  ripple.style.height = `${diameter}px`;
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;

  control.querySelectorAll(":scope > .daw-glass-ripple").forEach((node) => node.remove());
  control.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  window.setTimeout(() => ripple.remove(), 1000);
}

function formatTime(seconds: number | null | undefined) {
  const safe = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isPerformancePreference(value: string | null): value is DawPerformancePreference {
  return value === "auto" || value === "quality" || value === "balanced" || value === "economy";
}

function detectAutomaticRenderQuality(): { quality: DawRenderQuality; reason: string } {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigatorWithMemory.deviceMemory;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compactTouchDevice = navigator.maxTouchPoints > 0 && window.innerWidth < 900;

  if (reducedMotion || compactTouchDevice || cores <= 4 || (memory !== undefined && memory <= 4)) {
    return { quality: "economy", reason: compactTouchDevice ? "行動裝置自動降載" : "依裝置效能自動降載" };
  }
  if (cores >= 12 && (memory === undefined || memory >= 12)) {
    return { quality: "quality", reason: "裝置資源充足" };
  }
  return { quality: "balanced", reason: "保留玻璃質感並降低繪圖負擔" };
}

function waitForBrowserIdle(timeout = 900) {
  return new Promise<void>((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(() => resolve(), { timeout });
      return;
    }
    window.setTimeout(resolve, Math.min(timeout, 180));
  });
}

function decodedAudioBytes(buffer: AudioBuffer) {
  return buffer.length * Math.max(1, buffer.numberOfChannels) * 4;
}

function beatsPerBar(timeSignature: string | null | undefined) {
  const beats = Number(String(timeSignature ?? "4/4").split("/")[0]);
  return Number.isFinite(beats) && beats > 0 ? Math.round(beats) : 4;
}

function snapSeconds(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function getClipDuration(clip: Clip) {
  return Math.max(0.1, clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 20);
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTakeCompRange(value: TakeLane["selectedRange"]): TakeCompRange | null {
  if (!value) return null;
  const sourceStartSeconds = numberFromUnknown(value["sourceStartSeconds"] ?? value["startSeconds"]);
  const sourceEndSeconds = numberFromUnknown(value["sourceEndSeconds"] ?? value["endSeconds"]);
  const timelineStartSeconds = numberFromUnknown(value["timelineStartSeconds"] ?? value["timelineStart"]);
  if (sourceStartSeconds === null || sourceEndSeconds === null || sourceEndSeconds <= sourceStartSeconds) return null;
  return {
    sourceStartSeconds,
    sourceEndSeconds,
    timelineStartSeconds: timelineStartSeconds ?? sourceStartSeconds
  };
}

function roundMetric(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rangeStyle(value: number, min: number, max: number) {
  const progress = max === min ? 0 : ((clamp(value, min, max) - min) / (max - min)) * 100;
  return { "--range-progress": `${progress}%` } as CSSProperties;
}

function getAudioContextConstructor() {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

async function analyzeDawRecordedBlob(
  blob: Blob,
  options: { detectionMode: string; targetBpm: number | null; targetInstrument: PerformanceInstrument }
): Promise<DawDetectionReportPayload> {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) throw new Error("此瀏覽器不支援 Web Audio API");

  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const channelData = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) data[index] += (channelData[index] ?? 0) / buffer.numberOfChannels;
    }
    return {
      detectionMode: options.detectionMode,
      ...analyzePerformanceSamples(data, buffer.sampleRate, options),
      createTimestampComments: true
    };
  } finally {
    await context.close();
  }
}

function qualityClass(status: string | null | undefined) {
  if (status === "pass") return "tag green";
  if (status === "fail") return "tag danger";
  if (status === "warning") return "tag warn";
  return "tag";
}

function takeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    candidate: "候選",
    keeper: "最佳",
    needs_retake: "重錄",
    archived: "封存",
    comped: "已剪輯"
  };
  return labels[status] ?? status;
}

function takeStatusClass(status: string) {
  if (status === "keeper" || status === "comped") return "tag green";
  if (status === "needs_retake") return "tag warn";
  if (status === "archived") return "tag";
  return "tag";
}

function markerLabel(type: string) {
  const labels: Record<string, string> = {
    verse: "主歌",
    chorus: "副歌",
    bridge: "Bridge",
    "punch-in": "Punch-in",
    issue: "問題",
    idea: "想法"
  };
  return labels[type] ?? type;
}

function panLabel(value: number) {
  if (Math.abs(value) < 0.01) return "C";
  return value < 0 ? `L${Math.round(Math.abs(value) * 100)}` : `R${Math.round(value * 100)}`;
}

function gainDbLabel(value: number) {
  if (value <= 0) return "-inf";
  return `${(20 * Math.log10(value)).toFixed(1)}dB`;
}


function createMasterOutput(context: AudioContext, transparent: boolean) {
  return createMixerMasterOutput(context, transparent);
}

type PlaybackMasterState = {
  output: ReturnType<typeof createMasterOutput>;
  sourceTrackIds: Set<string>;
  graphTrackIds: Set<string>;
  routes: DawProjectDto["routes"];
  scope: MixerScope;
  effectsByTrack: Map<string, Effects>;
};

// Display geometry has its own minimum width. Audio duration must retain short
// clips and subtract the source offset when duration is implicit.
function getPlaybackClipDuration(clip: Clip, sourceDurationSeconds = clip.audioFile.durationSeconds) {
  if (clip.durationSeconds != null && Number.isFinite(clip.durationSeconds)) return Math.max(0, clip.durationSeconds);
  if (sourceDurationSeconds != null && Number.isFinite(sourceDurationSeconds)) {
    return Math.max(0, sourceDurationSeconds - Math.max(0, clip.offsetSeconds));
  }
  return Number.POSITIVE_INFINITY; // Decode before deciding the unknown end.
}

type AutomationTarget = { param: AudioParam; map?: (value: number) => number };

function scheduleAutomationTarget(
  target: AutomationTarget,
  lane: AutomationLane,
  playbackStart: number,
  playbackEnd: number,
  startAt: number
) {
  const enabledPoints = lane.points.filter((point) => point.timeSeconds <= playbackEnd);
  if (!enabledPoints.length) return;
  const mapValue = (value: number) => target.map?.(clamp(value, lane.minValue, lane.maxValue)) ?? clamp(value, lane.minValue, lane.maxValue);
  const lastBeforeStart = enabledPoints.filter((point) => point.timeSeconds <= playbackStart).at(-1);
  target.param.cancelScheduledValues(startAt);
  if (lastBeforeStart) target.param.setValueAtTime(mapValue(lastBeforeStart.value), startAt);
  for (const point of enabledPoints.filter((item) => item.timeSeconds > playbackStart)) {
    const value = mapValue(point.value);
    const time = startAt + Math.max(0, point.timeSeconds - playbackStart);
    if (point.curve === "step") target.param.setValueAtTime(value, time);
    else if (point.curve === "smooth") target.param.setTargetAtTime(value, time, 0.035);
    else target.param.linearRampToValueAtTime(value, time);
  }
}

const studioEffectKind = "songzu_recording_channel";

const recordingModes: RecordingMode[] = [
  {
    id: "vocal",
    label: "人聲",
    trackType: "vocal",
    defaultName: "主唱人聲",
    color: "#be123c",
    input: "麥克風 / 人聲乾訊號",
    chain: ["High-pass", "De-esser", "Compression", "Plate Reverb"]
  },
  {
    id: "guitar",
    label: "吉他",
    trackType: "guitar",
    defaultName: "吉他 DI",
    color: "#b45309",
    input: "DI / 麥克風收音",
    chain: ["Noise Gate", "Amp Tone", "Room", "Light Delay"]
  },
  {
    id: "piano",
    label: "鋼琴",
    trackType: "piano",
    defaultName: "鋼琴",
    color: "#2563eb",
    input: "MIDI / Line / 麥克風",
    chain: ["Soft EQ", "Stereo Width", "Hall Reverb"]
  },
  {
    id: "bass",
    label: "貝斯",
    trackType: "bass",
    defaultName: "貝斯 DI",
    color: "#0f766e",
    input: "DI 低頻基準",
    chain: ["Low Control", "Compression", "Saturation"]
  }
];

const fallbackSoundRack = [
  { id: "dry-vocal", name: "乾淨人聲", itemType: "preset", itemTypeLabel: "Preset", family: "Vocal", era: "Modern", chain: ["High-pass", "De-esser", "Comp"], character: ["清楚", "靠前"], useCases: ["主唱"], status: "ACTIVE", favorite: true },
  { id: "warm-guitar", name: "溫暖木吉他", itemType: "preset", itemTypeLabel: "Preset", family: "Guitar", era: "70s Folk", chain: ["Low cut", "Tape", "Room"], character: ["溫暖", "自然"], useCases: ["刷弦", "敬拜"], status: "ACTIVE", favorite: true },
  { id: "soft-piano", name: "柔和鋼琴", itemType: "preset", itemTypeLabel: "Preset", family: "Piano", era: "Modern Ballad", chain: ["Soft EQ", "Hall"], character: ["柔和", "寬"], useCases: ["前奏", "主歌"], status: "TESTING", favorite: false },
  { id: "tight-bass", name: "穩定 Bass DI", itemType: "preset", itemTypeLabel: "Preset", family: "Bass", era: "Modern", chain: ["Comp", "Low Control"], character: ["穩", "集中"], useCases: ["低頻基礎"], status: "ACTIVE", favorite: false }
];

const effectMacros = [
  {
    id: "vocal-cleanup",
    label: "人聲清理",
    chain: ["High-pass", "De-esser", "Level Rider"],
    settings: { lowGain: -2, midGain: 1.5, highGain: 2, compression: 0.52, noiseGate: 0.32 }
  },
  {
    id: "guitar-space",
    label: "吉他空間",
    chain: ["Room Reverb", "Short Delay"],
    settings: { lowGain: -1, midGain: 1, highGain: 0.5, echo: 0.22, reverb: 0.28, compression: 0.28 }
  },
  {
    id: "piano-wide",
    label: "鋼琴寬度",
    chain: ["Stereo Width", "Hall Reverb"],
    settings: { lowGain: -0.5, midGain: -1, highGain: 1.5, reverb: 0.42, compression: 0.2 }
  },
  {
    id: "mix-focus",
    label: "混音聚焦",
    chain: ["Gentle Comp", "Presence EQ"],
    settings: { lowGain: -1, midGain: 1.5, highGain: 1, compression: 0.46, noiseGate: 0.18 }
  }
];

function trackTypeLabel(value: string) {
  const labels: Record<string, string> = {
    audio: "Audio",
    vocal: "Vocal",
    guitar: "Guitar",
    piano: "Piano",
    bass: "Bass",
    drums: "Drums",
    reference: "Reference",
    bus: "Bus"
  };
  return labels[value] ?? value;
}


function withStudioSettings(effects: Array<Record<string, unknown>> | undefined, settings: StudioSettings) {
  const rest = (effects ?? []).filter((effect) => effect.kind !== studioEffectKind && effect.type !== studioEffectKind);
  return [{ kind: studioEffectKind, label: "錄音通道", ...settings }, ...rest];
}

function readRhythmCalibration(
  projectMeta: Record<string, unknown>,
  projectBpm: number | null | undefined
): AutoScoreRhythmCalibration | null {
  const value = projectMeta.rhythmCalibration;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rhythm = value as Partial<AutoScoreRhythmCalibration>;
  if (
    rhythm.engine !== "madmom_rnn_beat_grid_v1" ||
    !Number.isFinite(rhythm.bpm) ||
    !Number.isFinite(rhythm.displayBpm) ||
    !Array.isArray(rhythm.beatTimesSeconds) ||
    !Array.isArray(rhythm.beatNumbers) ||
    rhythm.beatTimesSeconds.length < 4 ||
    rhythm.beatTimesSeconds.length !== rhythm.beatNumbers.length
  ) return null;
  if (projectBpm && Math.abs(projectBpm - Number(rhythm.displayBpm)) > 2) return null;
  const beatTimesSeconds = rhythm.beatTimesSeconds.filter(
    (time, index, values): time is number => Number.isFinite(time) && time >= 0 && (index === 0 || time > Number(values[index - 1]))
  );
  if (beatTimesSeconds.length !== rhythm.beatTimesSeconds.length) return null;
  return rhythm as AutoScoreRhythmCalibration;
}

type SmartMetronomeSettings = {
  rate: SmartMetronomeRate;
  offsetSeconds: number;
  source: string;
  userSelected: boolean;
};

function readSmartMetronomeSettings(
  projectMeta: Record<string, unknown>,
  rhythm: AutoScoreRhythmCalibration | null
): SmartMetronomeSettings {
  const raw = projectMeta.smartMetronome;
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rate = isSmartMetronomeRate(value.rate)
    ? value.rate
    : recommendedSmartMetronomeRate(rhythm?.bpm);
  const rawOffset = typeof value.offsetSeconds === "number" ? value.offsetSeconds : 0;
  return {
    rate,
    offsetSeconds: clamp(rawOffset, -0.25, 0.25),
    source: typeof value.source === "string" ? value.source : rhythm ? "song_beat_grid" : "project_bpm",
    userSelected: value.userSelected === true
  };
}

function beatPositionAtTime(time: number, rhythm: AutoScoreRhythmCalibration | null, beatDurationSeconds: number) {
  if (!rhythm?.beatTimesSeconds.length || beatDurationSeconds <= 0) return time / Math.max(0.001, beatDurationSeconds);
  const beats = rhythm.beatTimesSeconds;
  if (time < beats[0]) return (time - beats[0]) / beatDurationSeconds;
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (beats[middle] <= time) low = middle;
    else high = middle - 1;
  }
  const index = low;
  const next = beats[index + 1] ?? beats[index] + beatDurationSeconds;
  return index + clamp((time - beats[index]) / Math.max(0.001, next - beats[index]), 0, 1);
}

function nearestBeatTime(value: number, rhythm: AutoScoreRhythmCalibration | null, beatDurationSeconds: number) {
  if (!rhythm?.beatTimesSeconds.length || beatDurationSeconds <= 0) {
    return Math.max(0, Math.round(value / Math.max(0.001, beatDurationSeconds)) * beatDurationSeconds);
  }
  const beats = rhythm.beatTimesSeconds;
  if (value <= beats[0]) {
    const steps = Math.round((beats[0] - value) / beatDurationSeconds);
    return Math.max(0, beats[0] - steps * beatDurationSeconds);
  }
  if (value >= beats.at(-1)!) {
    const steps = Math.round((value - beats.at(-1)!) / beatDurationSeconds);
    return beats.at(-1)! + steps * beatDurationSeconds;
  }
  let low = 0;
  let high = beats.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle] <= value) low = middle;
    else high = middle;
  }
  return value - beats[low] <= beats[high] - value ? beats[low] : beats[high];
}

export function DawProjectWorkspace({
  initialProject,
  availableAudioFiles,
  soundLibraryItems = []
}: {
  initialProject: DawProjectDto;
  availableAudioFiles: AvailableAudioFile[];
  soundLibraryItems?: SoundLibraryItemDto[];
}) {
  const [project, setProject] = useState(initialProject);
  const [selectedTrackId, setSelectedTrackId] = useState(initialProject.tracks[0]?.id ?? "");
  const [selectedClipId, setSelectedClipId] = useState(initialProject.tracks[0]?.clips[0]?.id ?? "");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>(initialProject.tracks[0]?.clips[0]?.id ? [initialProject.tracks[0].clips[0].id] : []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transportTime, setTransportTime] = useState(0);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DawDeviceStatus | null>(null);
  const [latencyMessage, setLatencyMessage] = useState("");
  const [playbackEngineReport, setPlaybackEngineReport] = useState<PlaybackEngineReport | null>(null);
  const [renderOutput, setRenderOutput] = useState<RenderOutput | null>(null);
  const [projectFileOutput, setProjectFileOutput] = useState<ProjectFileOutput | null>(null);
  const [stemsOutput, setStemsOutput] = useState<StemsOutput | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [renderError, setRenderError] = useState("");
  const [audioFiles, setAudioFiles] = useState(availableAudioFiles);
  const [recordStandby, setRecordStandby] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<DawRecordingStatus>("idle");
  const [recordingInputPeak, setRecordingInputPeak] = useState(0);
  const [recordingPeakHold, setRecordingPeakHold] = useState(0);
  const [recordingRms, setRecordingRms] = useState(0);
  const [recordingClippingDetected, setRecordingClippingDetected] = useState(false);
  const [liveTuner, setLiveTuner] = useState<TunerReading | null>(null);
  const [overdubCueStatus, setOverdubCueStatus] = useState<"idle" | "preparing" | "active">("idle");
  const [countInBars, setCountInBars] = useState<DawCountInBars>(1);
  const [countInRemainingBeats, setCountInRemainingBeats] = useState(0);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("default");
  const [inputChannelStart, setInputChannelStart] = useState(0);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState("default");
  const [channelMode, setChannelMode] = useState<DawChannelMode>("mono");
  const [captureEngine, setCaptureEngine] = useState<DawCaptureEngine>("web");
  const [monitorRoute, setMonitorRoute] = useState<DawMonitorRoute>("off");
  const [bufferFrames, setBufferFrames] = useState(256);
  const [latencyCompensationMs, setLatencyCompensationMs] = useState(12.67);
  const [applyLatencyCompensation, setApplyLatencyCompensation] = useState(true);
  const [recordingError, setRecordingError] = useState("");
  const [recordingLimitNotice, setRecordingLimitNotice] = useState("");
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState("");
  const [lastRecordedTakeId, setLastRecordedTakeId] = useState("");
  const [codexProviderStatus, setCodexProviderStatus] = useState<AiAgentProviderStatus | null>(null);
  const [codexPolishBusyTakeId, setCodexPolishBusyTakeId] = useState("");
  const [codexConversationVersion, setCodexConversationVersion] = useState(0);
  const codexOperationBusyRef = useRef(false);
  const [codexOperationBusy, setCodexOperationBusy] = useState(false);
  const codexTakeRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => codexTakeRequestRef.current?.abort(), []);
  const [codexPolishMessage, setCodexPolishMessage] = useState("");
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [metronomeSound, setMetronomeSound] = useState<MetronomeSoundId>(DEFAULT_METRONOME_SOUND);
  const [metronomeVolume, setMetronomeVolume] = useState(DEFAULT_METRONOME_VOLUME);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(8);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [punchEnabled, setPunchEnabled] = useState(false);
  const [punchIn, setPunchIn] = useState(0);
  const [punchOut, setPunchOut] = useState(8);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<"select" | "split">("select");
  const [requestedRackTab, setActiveRackTab] = useState<RackTab>("recording");
  // Fast Refresh can retain a tab that was removed in an update.
  const activeRackTab = RACK_TABS.some(([value]) => value === requestedRackTab) ? requestedRackTab : "recording";
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [studioTheme, setStudioTheme] = useState<DawStudioTheme>("emerald");
  const [performancePreference, setPerformancePreference] = useState<DawPerformancePreference>("auto");
  const [automaticRenderQuality, setAutomaticRenderQuality] = useState<DawRenderQuality>("balanced");
  const [performanceReason, setPerformanceReason] = useState("正在判斷裝置效能");
  const [selectedTrackNameDraft, setSelectedTrackNameDraft] = useState(initialProject.tracks[0]?.name ?? "");
  const [projectBpmDraft, setProjectBpmDraft] = useState(String(initialProject.bpm ?? 120));
  const [projectKeyDraft, setProjectKeyDraft] = useState(initialProject.musicalKey ?? "C");
  const [projectTimeSignatureDraft, setProjectTimeSignatureDraft] = useState(initialProject.timeSignature);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [studioNotice, setStudioNotice] = useState("");
  const [selectedSoundId, setSelectedSoundId] = useState(soundLibraryItems[0]?.id ?? fallbackSoundRack[0].id);
  const [trackName, setTrackName] = useState("");
  const [trackType, setTrackType] = useState("audio");
  const [audioFileId, setAudioFileId] = useState(availableAudioFiles[0]?.id ?? "");
  const [markerLabelValue, setMarkerLabelValue] = useState("");
  const [markerType, setMarkerType] = useState("idea");
  const [markerTime, setMarkerTime] = useState("0");
  const [waveformsByAudioFileId, setWaveformsByAudioFileId] = useState<Partial<Record<string, DawWaveformResult>>>({});
  const [waveformRetry, setWaveformRetry] = useState(0);
  const [waveformDisplayGain, setWaveformDisplayGain] = useState(1);
  const [clipClipboard, setClipClipboard] = useState<ClipClipboardItem[]>([]);
  useDawRecoveryJournal(project);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const directMediaRef = useRef<HTMLAudioElement | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackNodesRef = useRef<AudioNode[]>([]);
  const playbackMeterAnimationRef = useRef<number | null>(null);
  const playbackMeterAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const playbackMasterAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackTrackControlsRef = useRef<Map<string, LiveTrackControls>>(new Map());
  const playbackScopeRef = useRef<MixerScope>({});
  const liveTracksRef = useRef(initialProject.tracks);
  const dspPreviewsRef = useRef(new Map<string, Effects>());
  const playbackDspRef = useRef(new Map<string, Array<(effects: Effects) => void>>());
  const playbackMasterRef = useRef<PlaybackMasterState | null>(null);
  const directMediaTrackIdRef = useRef<string | null>(null);
  const directMediaGateRef = useRef<GainNode | null>(null);
  const decodedAudioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const decodedAudioPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const decodedAudioCacheOrderRef = useRef<string[]>([]);
  const decodedAudioCacheBytesRef = useRef(0);
  const playbackStopTimerRef = useRef<number | null>(null);
  const transportVisualAnimationRef = useRef<number | null>(null);
  const transportVisualTimeRef = useRef(0);
  const pixelsPerSecondRef = useRef(10);
  const transportPositionLabelRef = useRef<HTMLElement | null>(null);
  const transportTimeLabelRef = useRef<HTMLElement | null>(null);
  const recordingTimeLabelRef = useRef<HTMLElement | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const inputMonitorStreamRef = useRef<MediaStream | null>(null);
  const inputMonitorContextRef = useRef<AudioContext | null>(null);
  const inputMonitorNodesRef = useRef<AudioNode[]>([]);
  const inputMonitorTrackIdRef = useRef<string | null>(null);
  const inputMonitorGainRef = useRef<GainNode | null>(null);
  const inputMonitorMuteRef = useRef<GainNode | null>(null);
  const pcmRecorderRef = useRef<BrowserPcmRecorder | null>(null);
  const webRecordingStoppingRef = useRef<BrowserPcmRecorder | null>(null);
  const stopDawRecordingRef = useRef<() => void>(() => {});
  const recordingTargetRef = useRef<Track | null>(null);
  const recordingStartingRef = useRef(false);
  const recordingStatusRef = useRef(recordingStatus);
  recordingStatusRef.current = recordingStatus;
  const nativeMonitorQueueRef = useRef(Promise.resolve());
  const nativeRecordingStoppingRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingLevelAnimationRef = useRef<number | null>(null);
  const recordingLevelContextRef = useRef<AudioContext | null>(null);
  const recordingMonitorGainRef = useRef<GainNode | null>(null);
  const recordingMonitorMuteRef = useRef<GainNode | null>(null);
  const recordingMonitorTrackIdRef = useRef<string | null>(null);
  const recordingMetronomeContextRef = useRef<AudioContext | null>(null);
  const recordingMetronomeTimerRef = useRef<number | null>(null);
  const metronomePreviewContextRef = useRef<AudioContext | null>(null);
  const recordingCountInTimerRef = useRef<number | null>(null);
  const recordingPunchTimerRef = useRef<number | null>(null);
  const nativeMeterTimerRef = useRef<number | null>(null);
  const nativeRecordingIdRef = useRef("");
  const nativeTrackIdRef = useRef("");
  const recordingTimelineStartRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const recordingCaptureLeadSecondsRef = useRef(0);
  const tunerUpdateAtRef = useRef(0);
  const meterAnalysisAtRef = useRef(0);
  const meterStateUpdateAtRef = useRef(0);
  const recordingPeakHoldValueRef = useRef(0);
  const recordingSessionMetaRef = useRef<DawRecordingSessionMeta | null>(null);
  const trackPatchSequenceRef = useRef(0);
  const pendingTrackPatchesRef = useRef<Array<{ version: number; trackId: string; payload: Partial<Track> }>>([]);
  const trackPatchQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const clipPatchVersionRef = useRef<Record<string, number>>({});
  const tapTempoTimesRef = useRef<number[]>([]);
  const studioNoticeTimerRef = useRef<number | null>(null);
  const clipDragRef = useRef<{ clip: Clip; startX: number; originalStartSeconds: number; moved: boolean } | null>(null);
  const clipTrimRef = useRef<{
    clip: Clip;
    side: ClipTrimSide;
    startX: number;
    originalStartSeconds: number;
    originalOffsetSeconds: number;
    originalDurationSeconds: number;
    moved: boolean;
  } | null>(null);
  const waveformCacheRef = useRef<Partial<Record<string, DawWaveformResult>>>({});
  const suppressClipClickRef = useRef(false);
  const [draggingClipId, setDraggingClipId] = useState("");
  const [dragPreview, setDragPreview] = useState<{ clipId: string; startSeconds: number } | null>(null);
  const [trimmingClip, setTrimmingClip] = useState<{
    clipId: string;
    side: ClipTrimSide;
    startSeconds: number;
    offsetSeconds: number;
    durationSeconds: number;
  } | null>(null);

  const renderQuality = performancePreference === "auto" ? automaticRenderQuality : performancePreference;
  const realtimeActive = isPlaying || recordingStatus !== "idle";
  const decodedAudioCacheLimitBytes = renderQuality === "quality" ? 384 * 1024 * 1024 : renderQuality === "balanced" ? 224 * 1024 * 1024 : 128 * 1024 * 1024;
  const allClips = useMemo(() => project.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))), [project]);
  const dawAudioFileIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...allClips.map(({ clip }) => clip.audioFileId),
          ...project.tracks.flatMap((track) => track.takeLanes.flatMap((lane) => (lane.recordingTake.audioFile?.id ? [lane.recordingTake.audioFile.id] : [])))
        ])
      ),
    [allClips, project.tracks]
  );
  const fetchableDawAudioFileIds = useMemo(
    () =>
      new Set([
        ...allClips.flatMap(({ clip }) =>
          clip.audioFile.fileAvailable &&
          clip.audioFile.filePath &&
          clip.audioFile.isProtectedOriginal &&
          ["pass", "warning"].includes(clip.audioFile.qualityStatus ?? "")
            ? [clip.audioFileId]
            : []
        ),
        ...project.tracks.flatMap((track) =>
          track.takeLanes.flatMap((lane) =>
            lane.recordingTake.audioFile?.fileAvailable &&
            lane.recordingTake.audioFile.filePath &&
            ["pass", "warning"].includes(lane.recordingTake.audioFile.qualityStatus ?? "")
              ? [lane.recordingTake.audioFile.id]
              : []
          )
        )
      ]),
    [allClips, project.tracks]
  );
  const waveformSourceKey = JSON.stringify(dawAudioFileIds.map(id => ({ id, available: fetchableDawAudioFileIds.has(id) })));
  const waveformHasErrors = dawAudioFileIds.some(id => waveformsByAudioFileId[id]?.status === "error");
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0] ?? null;
  const selectedClip =
    allClips.find((item) => item.clip.id === selectedClipId)?.clip ?? selectedTrack?.clips[0] ?? allClips[0]?.clip ?? null;
  const selectedClipTrack = allClips.find((item) => item.clip.id === selectedClip?.id)?.track ?? selectedTrack;
  const selectedTrackSettings = getStudioSettings(selectedTrack?.effects);
  const selectedTrackEffectiveSettings = getEffectiveStudioSettings(selectedTrack?.effects);
  const selectedTrackEffects = (selectedTrack?.effects ?? []).filter(
    (effect) => effect.kind !== studioEffectKind && effect.type !== studioEffectKind
  );
  const soundRackItems = soundLibraryItems.length ? soundLibraryItems : fallbackSoundRack;
  const selectedSound = soundRackItems.find((item) => item.id === selectedSoundId) ?? soundRackItems[0] ?? null;
  const timelineDuration = Math.max(90, Math.ceil(project.durationSeconds || 90));
  const pixelsPerSecond = 10 * zoom;
  pixelsPerSecondRef.current = pixelsPerSecond;
  const timelineLaneWidth = Math.max(720, timelineDuration * pixelsPerSecond);
  const rhythmCalibration = readRhythmCalibration(project.projectMeta, project.bpm);
  const smartMetronome = readSmartMetronomeSettings(project.projectMeta, rhythmCalibration);
  const effectiveBpm = rhythmCalibration?.bpm ?? project.bpm ?? 0;
  const beatDurationSeconds = effectiveBpm > 0 ? 60 / effectiveBpm : 0;
  const metronomeClickBpm = effectiveBpm * smartMetronome.rate;
  const currentBeatPosition = beatDurationSeconds > 0
    ? beatPositionAtTime(transportTime, rhythmCalibration, beatDurationSeconds)
    : 0;
  const currentBarBeatCount = beatsPerBar(project.timeSignature);
  const metronomeClicksPerBar = Math.max(1, Math.round(currentBarBeatCount * smartMetronome.rate));
  const firstGridBeatOffset = Math.max(0, (rhythmCalibration?.beatNumbers[0] ?? 1) - 1);
  const absoluteBeatPosition = Math.max(0, currentBeatPosition + firstGridBeatOffset);
  const selectedMetronomeSound = METRONOME_SOUND_OPTIONS.find((option) => option.id === metronomeSound) ?? METRONOME_SOUND_OPTIONS[0];
  const selectedSmartMetronomeRate = SMART_METRONOME_RATE_OPTIONS.find((option) => option.value === smartMetronome.rate) ?? SMART_METRONOME_RATE_OPTIONS[1];
  const timelineWidthStyle = {
    width: `calc(var(--daw-track-gutter) + ${timelineLaneWidth}px)`,
    "--timeline-lane-width": `${timelineLaneWidth}px`,
    "--bar-width": `${Math.max(24, beatDurationSeconds * currentBarBeatCount * pixelsPerSecond)}px`,
    "--bar-offset": `${Math.max(0, (rhythmCalibration?.firstDownbeatSeconds ?? 0) * pixelsPerSecond)}px`
  } as CSSProperties;
  const currentBar = Math.floor(absoluteBeatPosition / currentBarBeatCount) + 1;
  const currentBeat = Math.floor(absoluteBeatPosition % currentBarBeatCount) + 1;
  const currentTick = Math.floor((((currentBeatPosition % 1) + 1) % 1) * 100);
  const transportPosition = `${currentBar}.${currentBeat}.${String(currentTick).padStart(2, "0")}`;
  const secondsPerBar = beatDurationSeconds * currentBarBeatCount;
  const barsPerRulerTick = secondsPerBar > 0 ? Math.max(1, Math.ceil(58 / (secondsPerBar * pixelsPerSecond))) : 1;
  const rulerTicks = rhythmCalibration?.downbeatTimesSeconds.length
    ? rhythmCalibration.downbeatTimesSeconds
        .map((seconds, index) => ({ key: `grid-${index}`, seconds, label: index + 1 }))
        .filter((tick, index) => tick.seconds <= timelineDuration && index % barsPerRulerTick === 0)
    : secondsPerBar > 0
      ? Array.from({ length: Math.floor(timelineDuration / secondsPerBar) + 1 }, (_, index) => ({
          key: `fixed-${index}`,
          seconds: index * secondsPerBar,
          label: index + 1
        })).filter((_, index) => index % barsPerRulerTick === 0)
      : Array.from({ length: Math.floor(timelineDuration / 10) + 1 }, (_, index) => ({
          key: `seconds-${index}`,
          seconds: index * 10,
          label: formatTime(index * 10)
        }));
  const loopRangeValid = loopEnd > loopStart;
  const loopStartPercent = loopRangeValid ? Math.min(99, (loopStart * 100) / timelineDuration) : 0;
  const loopWidthPercent = loopRangeValid ? Math.max(0.8, ((loopEnd - loopStart) * 100) / timelineDuration) : 0;
  const punchRangeValid = punchOut > punchIn;
  const punchStartPercent = punchRangeValid ? Math.min(99, (punchIn * 100) / timelineDuration) : 0;
  const punchWidthPercent = punchRangeValid ? Math.max(0.8, ((punchOut - punchIn) * 100) / timelineDuration) : 0;
  const armedTrackCount = project.tracks.filter((track) => track.armed).length;
  const soloTrackCount = project.tracks.filter((track) => track.solo).length;
  const mutedTrackCount = project.tracks.filter((track) => track.muted).length;
  const scoreGuideLaneCount = new Set(project.scoreDrafts.map((draft) => draft.targetInstrument)).size;
  const dawDetectionMode =
    selectedTrackSettings.aiTiming && selectedTrackSettings.aiPitch
      ? "timing_pitch"
      : selectedTrackSettings.aiTiming
        ? "timing"
        : selectedTrackSettings.aiPitch
          ? "pitch"
          : selectedTrackSettings.aiLevel
            ? "level"
            : "off";
  const recordingBusy = recordingStatus !== "idle";
  const nativeEngineAvailable = engineStatus?.mode === "native_service";
  const inputDevices =
    captureEngine === "native_wav"
      ? deviceStatus?.nativeInputDevices ?? deviceStatus?.inputDevices ?? []
      : deviceStatus?.webInputDevices ?? deviceStatus?.inputDevices ?? [];
  const outputDevices =
    captureEngine === "native_wav"
      ? deviceStatus?.nativeOutputDevices ?? deviceStatus?.outputDevices ?? []
      : deviceStatus?.webOutputDevices ?? deviceStatus?.outputDevices ?? [];
  const deviceKey = (device: DawAudioDevice) => device.id || device.name || "default";
  const selectedInputDevice = inputDevices.find((device) => deviceKey(device) === selectedInputDeviceId) ?? null;
  const selectedOutputDevice = outputDevices.find((device) => deviceKey(device) === selectedOutputDeviceId) ?? null;
  const inputChannelOptions = Math.max(1, Math.min(64, selectedInputDevice?.maxChannels ?? 2) - (channelMode === "stereo" ? 1 : 0));
  const recordingPeakDb = recordingPeakHold > 0 ? 20 * Math.log10(recordingPeakHold) : null;
  const recordingSignal =
    recordingStatus !== "counting" && recordingStatus !== "recording"
      ? { status: "idle", label: "等待訊號", detail: "開始錄音後會即時檢查音量與爆音。" }
      : recordingClippingDetected || recordingInputPeak >= 0.98
        ? { status: "clipping", label: "疑似爆音", detail: "立即降低錄音介面或麥克風的實體增益。" }
        : recordingInputPeak >= 0.82
          ? { status: "hot", label: "訊號偏熱", detail: "建議降低實體增益，保留更多動態空間。" }
          : recordingRms < 0.004
            ? { status: "silent", label: "沒有明顯訊號", detail: "檢查輸入設備、線材、48V 與音軌監聽。" }
            : recordingRms < 0.025
              ? { status: "low", label: "訊號偏小", detail: "靠近麥克風，或小幅提高錄音介面的實體增益。" }
              : { status: "ready", label: "錄音範圍良好", detail: "目前有足夠音量與安全峰值，可以繼續錄製。" };
  const selectedClipSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const selectedClipItems = useMemo(() => allClips.filter(({ clip }) => selectedClipSet.has(clip.id)), [allClips, selectedClipSet]);
  const editSelectedClipItems = useMemo(() => {
    const seeds = selectedClipItems.length
      ? selectedClipItems
      : selectedClip
        ? allClips.filter(({ clip }) => clip.id === selectedClip.id)
        : [];
    const groupedIds = new Set(seeds.flatMap(({ clip }) => clip.groupId ? [clip.groupId] : []));
    const ids = new Set(seeds.map(({ clip }) => clip.id));
    return allClips.filter(({ clip }) => ids.has(clip.id) || (clip.groupId ? groupedIds.has(clip.groupId) : false));
  }, [allClips, selectedClip, selectedClipItems]);

  useEffect(() => {
    setSelectedTrackNameDraft(selectedTrack?.name ?? "");
  }, [selectedTrack?.id, selectedTrack?.name]);

  useEffect(() => {
    setProjectBpmDraft(String(project.bpm ?? 120));
    setProjectKeyDraft(project.musicalKey ?? "C");
    setProjectTimeSignatureDraft(project.timeSignature);
  }, [project.bpm, project.musicalKey, project.timeSignature]);

  useEffect(() => {
    const activeProfile = project.latencyProfiles.find((profile) => profile.isActive) ?? project.latencyProfiles[0];
    if (activeProfile) setLatencyCompensationMs(activeProfile.compensationMs);
  }, [project.latencyProfiles]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/agent")
      .then(async (response) => {
        const data = (await response.json()) as { providerStatus?: AiAgentProviderStatus; error?: string };
        if (!response.ok || !data.providerStatus) throw new Error(data.error || "無法確認 Codex 連線狀態。");
        if (!cancelled) setCodexProviderStatus(data.providerStatus);
      })
      .catch((error) => {
        if (cancelled) return;
        setCodexProviderStatus({
          provider: "local",
          displayName: "Codex 錄音師",
          connected: false,
          realModel: false,
          credentialKind: "尚未連線",
          model: null,
          message: error instanceof Error ? error.message : "無法確認 Codex 連線狀態。"
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const savedSound = window.localStorage.getItem(METRONOME_SOUND_STORAGE_KEY);
      if (isMetronomeSoundId(savedSound)) setMetronomeSound(savedSound);
      const savedVolume = Number(window.localStorage.getItem(METRONOME_VOLUME_STORAGE_KEY));
      if (Number.isFinite(savedVolume) && savedVolume > 0) setMetronomeVolume(normalizeMetronomeVolume(savedVolume));
    } catch {
      // Device preferences are optional; restricted browser storage must not block the DAW.
    }
  }, []);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(DAW_STUDIO_THEME_STORAGE_KEY);
      if (savedTheme === "emerald" || savedTheme === "crimson" || savedTheme === "amethyst" || savedTheme === "cyberpunk") {
        setStudioTheme(savedTheme);
      }
    } catch {
      // Theme preferences are optional and never block the recording workspace.
    }
  }, []);

  // Cyberpunk scrollbars: while a pane is being scrolled, move a light band along its
  // thumb. Decorative only; skipped while recording and in economy mode.
  const scrollbarFlowBlocked = studioTheme !== "cyberpunk" || recordingStatus !== "idle" || renderQuality === "economy";
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || scrollbarFlowBlocked) return;
    const active = new Map<HTMLElement, number>();
    let held: HTMLElement | null = null;
    let frame = 0;
    const tick = (now: number) => {
      active.forEach((until, element) => {
        if (element !== held && now > until) {
          element.removeAttribute("data-cyber-scrolling");
          element.style.removeProperty("--cyber-sb-flow");
          active.delete(element);
          return;
        }
        element.style.setProperty("--cyber-sb-flow", `${((now / 9) % 160) - 30}%`);
      });
      frame = active.size ? window.requestAnimationFrame(tick) : 0;
    };
    const onScroll = (event: Event) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !workspace.contains(element)) return;
      if (!active.has(element)) element.setAttribute("data-cyber-scrolling", "true");
      active.set(element, performance.now() + 900);
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    // Holding a scrollbar without moving keeps its light running until release.
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !workspace.contains(element)) return;
      const onVerticalBar = element.scrollHeight > element.clientHeight && event.offsetX >= element.clientWidth;
      const onHorizontalBar = element.scrollWidth > element.clientWidth && event.offsetY >= element.clientHeight;
      if (!onVerticalBar && !onHorizontalBar) return;
      held = element;
      onScroll(event);
    };
    const onPointerUp = () => {
      if (held) active.set(held, performance.now() + 900);
      held = null;
    };
    workspace.addEventListener("scroll", onScroll, { capture: true, passive: true });
    workspace.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      workspace.removeEventListener("scroll", onScroll, { capture: true });
      workspace.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (frame) window.cancelAnimationFrame(frame);
      active.forEach((_, element) => {
        element.removeAttribute("data-cyber-scrolling");
        element.style.removeProperty("--cyber-sb-flow");
      });
    };
  }, [scrollbarFlowBlocked]);

  useEffect(() => {
    try {
      const savedPreference = window.localStorage.getItem(DAW_PERFORMANCE_STORAGE_KEY);
      if (isPerformancePreference(savedPreference)) setPerformancePreference(savedPreference);
    } catch {
      // Performance preferences are optional and never block the recording workspace.
    }

    const updateAutomaticMode = () => {
      const detected = detectAutomaticRenderQuality();
      setAutomaticRenderQuality(detected.quality);
      setPerformanceReason(detected.reason);
    };
    updateAutomaticMode();
    window.addEventListener("resize", updateAutomaticMode);
    return () => window.removeEventListener("resize", updateAutomaticMode);
  }, []);

  useEffect(() => {
    transportVisualTimeRef.current = transportTime;
    workspaceRef.current?.style.setProperty("--daw-playhead-x", `${transportTime * pixelsPerSecond}px`);
  }, [pixelsPerSecond, transportTime]);

  function snapTimelineSeconds(value: number) {
    if (!snapEnabled || beatDurationSeconds <= 0) return snapSeconds(value);
    return snapSeconds(nearestBeatTime(value, rhythmCalibration, beatDurationSeconds));
  }

  const issueHighlights = useMemo(
    () =>
      project.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => {
          const evidence = dawRecordingEvidence(track, clip.id, clip.startSeconds);
          return evidence.issues.map((issue) => ({
              ...issue,
              id: `${clip.id}:${issue.id}`,
              timestampSeconds: issue.timelineSeconds,
              trackId: track.id,
              trackName: track.name,
              takeLabel: evidence.lane?.recordingTake.label ?? clip.label
            }));
        })
      ),
    [project]
  );

  const qualityWarnings = useMemo(
    () =>
      allClips.flatMap(({ track, clip }) => {
        const report = clip.audioFile.qualityReport;
        const warnings = report?.warnings ?? [];
        const statusWarning =
          clip.audioFile.qualityStatus && clip.audioFile.qualityStatus !== "pass"
            ? [`${clip.audioFile.fileName}：Audio QA ${clip.audioFile.qualityStatus}`]
            : [];
        return [...statusWarning, ...warnings].map((warning) => ({ trackName: track.name, clipLabel: clip.label, warning }));
      }),
    [allClips]
  );

  const trackHealthById = useMemo(() => {
    const entries = project.tracks.map((track) => {
      const settings = getEffectiveStudioSettings(track.effects);
      const effects = track.effects.filter((effect) => effect.kind !== studioEffectKind && effect.type !== studioEffectKind);
      const issueCount = track.takeLanes.reduce(
        (total, lane) => total + lane.recordingTake.reports.reduce((reportTotal, report) => reportTotal + report.issues.length, 0),
        0
      );
      const qaWarningCount = track.clips.reduce((total, clip) => {
        const statusWarning = clip.audioFile.qualityStatus && clip.audioFile.qualityStatus !== "pass" ? 1 : 0;
        return total + statusWarning + (clip.audioFile.qualityReport?.warnings.length ?? 0);
      }, 0);
      const commentCount = track.clips.reduce((total, clip) => total + clip.audioFile.commentCount, 0);
      const protectedOriginals = track.clips.filter((clip) => clip.audioFile.isProtectedOriginal).length;
      const status =
        issueCount > 0 || qaWarningCount > 0
          ? "needs_attention"
          : track.armed
            ? "record_ready"
            : track.clips.length
              ? "ready"
              : "empty";

      return [
        track.id,
        {
          settings,
          effects,
          issueCount,
          qaWarningCount,
          commentCount,
          protectedOriginals,
          status
        }
      ] as const;
    });
    return new Map(entries);
  }, [project.tracks]);

  const masterBus = useMemo(() => {
    const soloTracks = project.tracks.filter((track) => track.solo);
    const audibleTracks = (soloTracks.length ? soloTracks : project.tracks).filter((track) => !track.muted);
    const activeEffects = project.tracks.reduce(
      (total, track) => total + (trackHealthById.get(track.id)?.effects.length ?? 0),
      0
    );
    return {
      audibleTracks: audibleTracks.length,
      mutedTracks: project.tracks.length - audibleTracks.length,
      activeEffects,
      issueCount: issueHighlights.length,
      qaWarningCount: qualityWarnings.length
    };
  }, [issueHighlights.length, project.tracks, qualityWarnings.length, trackHealthById]);

  async function refreshDeviceStatus() {
    try {
      const response = await fetch("/api/daw-engine/devices", { cache: "no-store" });
      const data = (await response.json()) as DawDeviceStatus;
      const nativeInputDevices = data.mode === "native_service" ? data.inputDevices ?? [] : [];
      const nativeOutputDevices = data.mode === "native_service" ? data.outputDevices ?? [] : [];
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const browserInputs = devices
          .filter((device) => device.kind === "audioinput")
          .map((device, index) => ({ id: device.deviceId, label: device.label || `Input ${index + 1}` }));
        const browserOutputs = devices
          .filter((device) => device.kind === "audiooutput")
          .map((device, index) => ({ id: device.deviceId, label: device.label || `Output ${index + 1}` }));
        const nextStatus = {
          ...data,
          nativeInputDevices,
          nativeOutputDevices,
          webInputDevices: browserInputs,
          webOutputDevices: browserOutputs
        };
        setDeviceStatus(nextStatus);
        return;
      }
      setDeviceStatus({ ...data, nativeInputDevices, nativeOutputDevices, webInputDevices: [], webOutputDevices: [] });
    } catch {
      setDeviceStatus({
        mode: "web_fallback",
        inputDevices: [],
        outputDevices: [],
        message: "無法讀取裝置狀態。"
      });
    }
  }

  useEffect(() => {
    fetch("/api/daw-engine/status")
      .then((response) => response.json())
      .then((data) => {
        const status = data as EngineStatus;
        setEngineStatus(status);
        if (status.mode === "native_service") setCaptureEngine("native_wav");
      })
      .catch(() => setEngineStatus({ mode: "web_fallback", message: "無法讀取 engine status" }));
    void refreshDeviceStatus();
  }, []);

  useEffect(() => {
    const nextInputs =
      captureEngine === "native_wav"
        ? deviceStatus?.nativeInputDevices ?? []
        : deviceStatus?.webInputDevices ?? deviceStatus?.inputDevices ?? [];
    const nextOutputs =
      captureEngine === "native_wav"
        ? deviceStatus?.nativeOutputDevices ?? []
        : deviceStatus?.webOutputDevices ?? deviceStatus?.outputDevices ?? [];
    // Device refresh must not silently redirect an armed input to another mic.
    if (captureEngine === "native_wav") {
      setSelectedInputDeviceId((current) => current === "default" ? nextInputs[0]?.name || "default" : current);
      setSelectedOutputDeviceId((current) => current === "default" ? nextOutputs[0]?.name || "default" : current);
    }
  }, [captureEngine, deviceStatus]);

  useEffect(() => {
    if (isPlaying || recordingStatus !== "idle") return;
    const controller = new AbortController();
    const sources = JSON.parse(waveformSourceKey) as DawWaveformSource[];
    void loadDawWaveforms(sources, {
      signal: controller.signal,
      read: id => waveformCacheRef.current[id],
      idle: () => waitForBrowserIdle(350),
      publish: (id, result) => {
        waveformCacheRef.current = { ...waveformCacheRef.current, [id]: result };
        setWaveformsByAudioFileId(waveformCacheRef.current);
      },
      load: async (id, signal) => {
        const AudioContextCtor = getAudioContextConstructor();
        if (!AudioContextCtor) throw new Error("Web Audio unavailable");
        const timeout = AbortSignal.timeout(30_000);
        const requestSignal = AbortSignal.any([signal, timeout]);
        const response = await fetch(`/api/files/${id}`, { signal: requestSignal });
        if (!response.ok) throw new Error("Audio file unavailable");
        const bytes = await response.arrayBuffer();
        requestSignal.throwIfAborted();
        const context = new AudioContextCtor({ latencyHint: "playback" });
        try {
          const buffer = await context.decodeAudioData(bytes);
          requestSignal.throwIfAborted();
          return buildDawWaveform(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
        } finally {
          await context.close();
        }
      }
    });
    return () => controller.abort();
  }, [waveformSourceKey, waveformRetry, isPlaying, recordingStatus]);

  function retryWaveforms() {
    waveformCacheRef.current = Object.fromEntries(Object.entries(waveformCacheRef.current).filter(([, value]) => value?.status !== "error"));
    setWaveformsByAudioFileId(waveformCacheRef.current);
    setWaveformRetry(value => value + 1);
  }

  useEffect(() => {
    while (decodedAudioCacheBytesRef.current > decodedAudioCacheLimitBytes && decodedAudioCacheOrderRef.current.length > 1) {
      const oldestId = decodedAudioCacheOrderRef.current.shift();
      if (!oldestId) break;
      const oldestBuffer = decodedAudioCacheRef.current.get(oldestId);
      if (!oldestBuffer) continue;
      decodedAudioCacheRef.current.delete(oldestId);
      decodedAudioCacheBytesRef.current = Math.max(0, decodedAudioCacheBytesRef.current - decodedAudioBytes(oldestBuffer));
    }
  }, [decodedAudioCacheLimitBytes]);

  const disposeDawResources = useEffectEvent(() => {
      stopPlayback();
      void pcmRecorderRef.current?.cancel();
      pcmRecorderRef.current = null;
      stopInputMonitoring();
      stopDawRecordingResources();
      closeMetronomeAudioContext(metronomePreviewContextRef.current);
      decodedAudioCacheRef.current.clear();
      decodedAudioPromisesRef.current.clear();
      decodedAudioCacheOrderRef.current = [];
      decodedAudioCacheBytesRef.current = 0;
      if (studioNoticeTimerRef.current) window.clearTimeout(studioNoticeTimerRef.current);
  });
  useEffect(() => () => disposeDawResources(), []);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!nativeRecordingIdRef.current && !recordingStreamRef.current && !webRecordingStoppingRef.current) return;
      event.preventDefault();
      event.returnValue = "錄音尚未停止與入庫。";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, []);

  function setProjectFromResponse(data: { project?: DawProjectDto | null }) {
    if (!data.project) return;
    const tracks = pendingTrackPatchesRef.current.reduce(
      (current, patch) => tracksAfterPatch(current, patch.trackId, patch.payload), data.project.tracks
    );
    const previousTracks = liveTracksRef.current;
    liveTracksRef.current = tracks;
    applyLiveTrackPatch("", {}, tracks);
    for (const track of tracks) {
      const previous = previousTracks.find(item => item.id === track.id);
      const patch: Partial<Track> = {};
      for (const key of ["volume", "pan", "polarityInverted", "effects"] as const) {
        if (JSON.stringify(previous?.[key]) !== JSON.stringify(track[key])) Object.assign(patch, { [key]: track[key] });
      }
      if (Object.keys(patch).length) applyLiveTrackPatch(track.id, patch, tracks);
    }
    setProject({ ...data.project, tracks });
    const nextClipIds = new Set(data.project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    setSelectedClipIds((current) => current.filter((clipId) => nextClipIds.has(clipId)));
    setSelectedClipId((current) => (current && nextClipIds.has(current) ? current : data.project?.tracks[0]?.clips[0]?.id ?? ""));
    if (!data.project.tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(data.project.tracks[0]?.id ?? "");
    }
  }

  function showStudioNotice(message: string) {
    setStudioNotice(message);
    if (studioNoticeTimerRef.current) window.clearTimeout(studioNoticeTimerRef.current);
    studioNoticeTimerRef.current = window.setTimeout(() => setStudioNotice(""), 2800);
  }

  async function patchProject(payload: DawProjectUpdate, notice?: string) {
    setSaveState("saving");
    setProject((current) => ({ ...current, ...payload }));
    try {
      const response = await fetch(`/api/daw-projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "專案設定儲存失敗");
      setProjectFromResponse(data);
      setSaveState("saved");
      if (notice) showStudioNotice(notice);
      return true;
    } catch (error) {
      setSaveState("error");
      setRenderError(error instanceof Error ? error.message : "專案設定儲存失敗");
      await refreshDawProject();
      return false;
    }
  }

  function commitProjectBpm() {
    const bpm = clamp(Math.round(Number(projectBpmDraft) || project.bpm || 120), 20, 300);
    setProjectBpmDraft(String(bpm));
    if (bpm !== project.bpm) {
      const { rhythmCalibration: _rhythmCalibration, tempoMap: _tempoMap, ...projectMeta } = project.projectMeta;
      void patchProject({ bpm, projectMeta }, `速度已更新為 ${bpm} BPM；舊歌曲拍點校準已解除。`);
    }
  }

  function commitProjectKey() {
    const musicalKey = projectKeyDraft.trim() || "C";
    setProjectKeyDraft(musicalKey);
    if (musicalKey !== project.musicalKey) void patchProject({ musicalKey }, `調性已更新為 ${musicalKey}`);
  }

  function commitProjectTimeSignature(value = projectTimeSignatureDraft) {
    if (value !== project.timeSignature) void patchProject({ timeSignature: value }, `拍號已更新為 ${value}`);
  }

  function tapTempo() {
    const now = performance.now();
    const previous = tapTempoTimesRef.current.at(-1);
    if (!previous || now - previous > 2200) tapTempoTimesRef.current = [now];
    else tapTempoTimesRef.current = [...tapTempoTimesRef.current.slice(-5), now];
    if (tapTempoTimesRef.current.length < 2) {
      showStudioNotice("再點幾次來計算速度");
      return;
    }
    const intervals = tapTempoTimesRef.current.slice(1).map((time, index) => time - tapTempoTimesRef.current[index]);
    const average = intervals.reduce((total, interval) => total + interval, 0) / intervals.length;
    const bpm = clamp(Math.round(60000 / average), 20, 300);
    setProjectBpmDraft(String(bpm));
    if (tapTempoTimesRef.current.length >= 4) void patchProject({ bpm }, `Tap Tempo：${bpm} BPM`);
    else showStudioNotice(`目前估算 ${bpm} BPM`);
  }

  function audioFilesFromSong(song: SongDto): AvailableAudioFile[] {
    return song.audioFiles
      .filter((file) => !file.archivedAt)
      .map((file) => ({
        id: file.id,
        fileName: file.fileName,
        fileType: file.fileType,
        versionName: file.versionName,
        durationSeconds: file.durationSeconds,
        qualityStatus: file.qualityStatus,
        storageProvider: file.storageProvider,
        sourceKind: file.sourceKind,
        isProtectedOriginal: file.isProtectedOriginal,
        mimeType: file.mimeType,
        codecName: file.codecName,
        parentAudioFileId: file.parentAudioFileId
      }));
  }

  async function refreshDawProject() {
    const response = await fetch(`/api/songs/${project.songId}/daw-project`, { cache: "no-store" });
    setProjectFromResponse(await response.json());
  }

  function stopInputMonitoring() {
    inputMonitorStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputMonitorStreamRef.current = null;
    for (const node of inputMonitorNodesRef.current) {
      try {
        node.disconnect();
      } catch {
        // The browser may already have disconnected the input graph.
      }
    }
    inputMonitorNodesRef.current = [];
    inputMonitorGainRef.current = null;
    inputMonitorMuteRef.current = null;
    inputMonitorTrackIdRef.current = null;
    void inputMonitorContextRef.current?.close();
    inputMonitorContextRef.current = null;
  }

  function webInputConstraints(): MediaTrackConstraints {
    return {
      ...(selectedInputDeviceId && selectedInputDeviceId !== "default"
        ? { deviceId: { exact: selectedInputDeviceId } }
        : {}),
      channelCount: { ideal: 32, min: inputChannelStart + (channelMode === "stereo" ? 2 : 1) },
      sampleRate: { ideal: project.sampleRate },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
  }

  async function requestWebAudioInput() {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: webInputConstraints() }) };
  }

  async function startInputMonitoring(track: Track) {
    if (recordingStatus !== "idle") return;
    if (monitorRoute === "hardware") {
      stopInputMonitoring();
      showStudioNotice("使用錄音介面 Direct Monitor；App 不重複輸出監聽。");
      return;
    }
    if (captureEngine === "native_wav") {
      if (monitorRoute === "off") setMonitorRoute("native");
      showStudioNotice(`${track.name}：I 監聽已開，開始錄音時使用原生低延遲耳機監聽`);
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("目前連線無法開啟即時輸入監聽；請使用桌面 App 或 HTTPS 手機入口。");
    }
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) throw new Error("這個瀏覽器不支援即時輸入監聽。");

    stopInputMonitoring();
    const { stream } = await requestWebAudioInput();
    const context = new AudioContextCtor({ latencyHint: "interactive" });
    try {
      const sinkContext = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
      if (selectedOutputDeviceId !== "default") {
        if (!sinkContext.setSinkId) throw new Error("此瀏覽器無法指定監聽輸出，請選系統預設或使用原生引擎。");
        await sinkContext.setSinkId(selectedOutputDeviceId);
      }
      const input = createDiscreteAudioInput(context, stream, inputChannelStart, channelMode === "stereo" ? 2 : 1);
      const gain = context.createGain();
      const muteGate = context.createGain();
      gain.gain.value = recordingMonitorLevel(track);
      muteGate.gain.value = audibleMixerTrackIds(liveTracksRef.current, project.routes).has(track.id) ? 1 : 0;
      input.output.connect(gain).connect(muteGate).connect(context.destination);
      inputMonitorStreamRef.current = stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (inputMonitorStreamRef.current !== stream) return;
        stopInputMonitoring();
        setRecordingError("指定的輸入裝置已中斷；監聽已停止，未切換其他麥克風。");
      }, { once: true });
      inputMonitorContextRef.current = context;
      inputMonitorNodesRef.current = [...input.nodes, gain, muteGate];
      inputMonitorGainRef.current = gain;
      inputMonitorMuteRef.current = muteGate;
      inputMonitorTrackIdRef.current = track.id;
      if (monitorRoute === "off") setMonitorRoute("native");
      await context.resume();
      setRecordingError("");
      showStudioNotice(`${track.name}：Input ${inputChannelStart + 1} 監聽已開，請使用耳機避免回授`);
    } catch (error) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      void context.close();
      throw error;
    }
  }

  function stopDawRecordingResources() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    stopTransportVisualClock();
    setTransportTime(transportVisualTimeRef.current);
    if (recordingLevelAnimationRef.current) window.cancelAnimationFrame(recordingLevelAnimationRef.current);
    if (recordingMetronomeTimerRef.current) window.clearInterval(recordingMetronomeTimerRef.current);
    if (recordingCountInTimerRef.current) window.clearInterval(recordingCountInTimerRef.current);
    if (recordingPunchTimerRef.current) window.clearTimeout(recordingPunchTimerRef.current);
    if (nativeMeterTimerRef.current) window.clearInterval(nativeMeterTimerRef.current);
    void recordingLevelContextRef.current?.close();
    void recordingMetronomeContextRef.current?.close();
    recordingTimerRef.current = null;
    recordingLevelAnimationRef.current = null;
    recordingMetronomeTimerRef.current = null;
    recordingCountInTimerRef.current = null;
    recordingPunchTimerRef.current = null;
    nativeMeterTimerRef.current = null;
    recordingLevelContextRef.current = null;
    recordingMonitorGainRef.current = null;
    recordingMonitorMuteRef.current = null;
    recordingMonitorTrackIdRef.current = null;
    recordingMetronomeContextRef.current = null;
    pcmRecorderRef.current = null;
    setCountInRemainingBeats(0);
    setRecordingInputPeak(0);
    setRecordingRms(0);
    recordingPeakHoldValueRef.current = 0;
    workspaceRef.current?.style.setProperty("--daw-record-level", "0%");
    workspaceRef.current?.style.setProperty("--daw-record-peak", "0%");
    setLiveTuner(null);
    setOverdubCueStatus("idle");
  }

  function paintTransportVisual(seconds: number) {
    const safeSeconds = clamp(seconds, 0, timelineDuration);
    transportVisualTimeRef.current = safeSeconds;
    workspaceRef.current?.style.setProperty("--daw-playhead-x", `${safeSeconds * pixelsPerSecondRef.current}px`);
    const visualBeatDuration = project.bpm && project.bpm > 0 ? 60 / project.bpm : 0;
    const visualBeatPosition = visualBeatDuration > 0 ? safeSeconds / visualBeatDuration : 0;
    const visualBeatsPerBar = beatsPerBar(project.timeSignature);
    const visualBar = Math.floor(visualBeatPosition / visualBeatsPerBar) + 1;
    const visualBeat = Math.floor(visualBeatPosition % visualBeatsPerBar) + 1;
    const visualTick = Math.floor((visualBeatPosition % 1) * 100);
    const positionLabel = `${visualBar}.${visualBeat}.${String(visualTick).padStart(2, "0")}`;
    const timeLabel = `${formatTime(safeSeconds)} · 小節 / 拍 / tick`;
    const positionElement = transportPositionLabelRef.current;
    const timeElement = transportTimeLabelRef.current;
    if (positionElement && positionElement.textContent !== positionLabel) positionElement.textContent = positionLabel;
    if (timeElement && timeElement.textContent !== timeLabel) timeElement.textContent = timeLabel;
  }

  function stopTransportVisualClock() {
    if (transportVisualAnimationRef.current) window.cancelAnimationFrame(transportVisualAnimationRef.current);
    transportVisualAnimationRef.current = null;
  }

  function startTransportVisualClock(
    startSeconds: number,
    endSeconds: number,
    startedAtMs: number,
    recordingClock = false
  ) {
    stopTransportVisualClock();
    paintTransportVisual(startSeconds);
    let lastPaintAt = 0;
    const minimumPaintInterval = renderQuality === "quality" ? 16 : renderQuality === "balanced" ? 32 : 48;

    const tick = (now: number) => {
      const elapsedSeconds = Math.max(0, (now - startedAtMs) / 1000);
      const nextSeconds = Math.min(endSeconds, startSeconds + elapsedSeconds);
      if (now - lastPaintAt >= minimumPaintInterval || nextSeconds >= endSeconds) {
        paintTransportVisual(nextSeconds);
        if (recordingClock) {
          const recordingLabel = formatTime(elapsedSeconds);
          const recordingElement = recordingTimeLabelRef.current;
          if (recordingElement && recordingElement.textContent !== recordingLabel) recordingElement.textContent = recordingLabel;
        }
        lastPaintAt = now;
      }
      if (nextSeconds < endSeconds) transportVisualAnimationRef.current = window.requestAnimationFrame(tick);
      else transportVisualAnimationRef.current = null;
    };

    transportVisualAnimationRef.current = window.requestAnimationFrame(tick);
  }

  function startDirectMediaTransportClock(
    media: HTMLAudioElement,
    timelineStartSeconds: number,
    mediaStartSeconds: number,
    endSeconds: number
  ) {
    stopTransportVisualClock();
    paintTransportVisual(timelineStartSeconds);
    let lastPaintAt = 0;
    const minimumPaintInterval = renderQuality === "quality" ? 16 : renderQuality === "balanced" ? 32 : 48;

    const tick = (now: number) => {
      if (directMediaRef.current !== media) return;
      const nextSeconds = Math.min(
        endSeconds,
        timelineStartSeconds + Math.max(0, media.currentTime - mediaStartSeconds)
      );
      if (now - lastPaintAt >= minimumPaintInterval || nextSeconds >= endSeconds) {
        paintTransportVisual(nextSeconds);
        lastPaintAt = now;
      }
      if (!media.paused && !media.ended && nextSeconds < endSeconds) {
        transportVisualAnimationRef.current = window.requestAnimationFrame(tick);
      } else {
        transportVisualAnimationRef.current = null;
      }
    };

    transportVisualAnimationRef.current = window.requestAnimationFrame(tick);
  }

  function startRecordingClock(startedAtMs = performance.now()) {
    recordingStartedAtRef.current = startedAtMs;
    if (recordingTimeLabelRef.current) recordingTimeLabelRef.current.textContent = "0:00";
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    startTransportVisualClock(recordingTimelineStartRef.current, timelineDuration, startedAtMs, true);
  }

  function scheduleDawMetronomeClick(
    context: AudioContext,
    when: number,
    accented: boolean,
    trackPlayback = false,
    destination: AudioNode = context.destination
  ) {
    const nodes = scheduleCleanMetronomeClick(context, destination, when, accented, metronomeSound, metronomeVolume);
    if (trackPlayback) playbackNodesRef.current.push(...nodes);
  }

  function changeMetronomeSound(value: string) {
    if (!isMetronomeSoundId(value)) return;
    setMetronomeSound(value);
    try {
      window.localStorage.setItem(METRONOME_SOUND_STORAGE_KEY, value);
    } catch {
      // The selected sound still works for this session when storage is unavailable.
    }
    const option = METRONOME_SOUND_OPTIONS.find((item) => item.id === value);
    if (option) showStudioNotice(`節拍器已切換：${option.label}`);
  }

  function changeMetronomeVolume(value: number) {
    const nextVolume = normalizeMetronomeVolume(value);
    setMetronomeVolume(nextVolume);
    try {
      window.localStorage.setItem(METRONOME_VOLUME_STORAGE_KEY, String(nextVolume));
    } catch {
      // Keep the volume for this session when storage is unavailable.
    }
  }

  function changeSmartMetronomeRate(value: string) {
    const rate = Number(value);
    if (!isSmartMetronomeRate(rate)) return;
    const option = SMART_METRONOME_RATE_OPTIONS.find((item) => item.value === rate);
    const nextClicksPerBar = Math.max(1, Math.round(currentBarBeatCount * rate));
    const nextSettings: SmartMetronomeSettings = {
      ...smartMetronome,
      rate,
      userSelected: true
    };
    void patchProject(
      {
        projectMeta: {
          ...project.projectMeta,
          smartMetronome: nextSettings
        }
      },
      `節拍器已切換：${option?.label ?? `${rate}x`} · 每小節 ${nextClicksPerBar} 聲`
    );
  }

  function changeStudioTheme(nextTheme: DawStudioTheme) {
    if (studioTheme === nextTheme) {
      showStudioNotice(`目前主題：${DAW_STUDIO_THEME_LABELS[nextTheme]}`);
      return;
    }
    setStudioTheme(nextTheme);
    try {
      window.localStorage.setItem(DAW_STUDIO_THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the selected theme for this session when storage is unavailable.
    }
    showStudioNotice(`已切換：${DAW_STUDIO_THEME_LABELS[nextTheme]}`);
  }

  function changePerformancePreference(nextPreference: DawPerformancePreference) {
    setPerformancePreference(nextPreference);
    try {
      window.localStorage.setItem(DAW_PERFORMANCE_STORAGE_KEY, nextPreference);
    } catch {
      // Keep the selected mode for this session when storage is unavailable.
    }
    const effective = nextPreference === "auto" ? automaticRenderQuality : nextPreference;
    showStudioNotice(`畫面效能：${DAW_PERFORMANCE_LABELS[nextPreference]} · ${DAW_PERFORMANCE_LABELS[effective]}`);
  }

  async function previewSelectedMetronomeSound() {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      showStudioNotice("這台裝置無法試聽 Web Audio 節拍器");
      return;
    }
    closeMetronomeAudioContext(metronomePreviewContextRef.current);
    const context = new AudioContextCtor();
    metronomePreviewContextRef.current = context;
    try {
      await context.resume();
      const firstBeatTime = context.currentTime + 0.045;
      const previewBeatDuration = getMetronomeBeatDuration(metronomeClickBpm > 0 ? metronomeClickBpm : 120);
      const previewBeatCount = metronomeClicksPerBar;
      for (let beatIndex = 0; beatIndex < previewBeatCount; beatIndex += 1) {
        scheduleCleanMetronomeClick(
          context,
          context.destination,
          firstBeatTime + beatIndex * previewBeatDuration,
          beatIndex === 0,
          metronomeSound,
          metronomeVolume
        );
      }
      showStudioNotice(`試聽：${selectedMetronomeSound.label} · ${Math.round(metronomeVolume * 100)}%`);
      window.setTimeout(() => {
        if (metronomePreviewContextRef.current === context) metronomePreviewContextRef.current = null;
        closeMetronomeAudioContext(context);
      }, (previewBeatDuration * previewBeatCount + 0.18) * 1000);
    } catch {
      closeMetronomeAudioContext(context);
      if (metronomePreviewContextRef.current === context) metronomePreviewContextRef.current = null;
      showStudioNotice("節拍器試聽啟動失敗");
    }
  }

  function startDawMetronome(existingContext?: AudioContext, firstBeatTime?: number, initialBeat = 0) {
    const bpm = metronomeClickBpm;
    if (!metronomeEnabled || bpm <= 0) return;
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return;
    const context = existingContext ?? new AudioContextCtor();
    recordingMetronomeContextRef.current = context;
    const beatDuration = getMetronomeBeatDuration(bpm);
    const barBeats = metronomeClicksPerBar;
    let scheduleState: MetronomeScheduleState = {
      nextBeatTime: Math.max(firstBeatTime ?? context.currentTime + METRONOME_START_DELAY_SECONDS, context.currentTime + 0.005),
      beatIndex: initialBeat
    };
    if (recordingMetronomeTimerRef.current) window.clearInterval(recordingMetronomeTimerRef.current);
    void context.resume().catch(() => undefined);

    const schedule = () => {
      scheduleState = scheduleMetronomeWindow(scheduleState, context.currentTime, beatDuration, (when, beatIndex) => {
        scheduleDawMetronomeClick(context, when, beatIndex % barBeats === 0);
      });
    };

    schedule();
    recordingMetronomeTimerRef.current = window.setInterval(schedule, METRONOME_LOOKAHEAD_MS);
  }

  function runDawCountIn(onComplete: () => void, continueMetronome = true) {
    const bpm = metronomeClickBpm;
    const barBeats = metronomeClicksPerBar;
    const totalBeats = countInBars * barBeats;
    const AudioContextCtor = getAudioContextConstructor();
    if (bpm <= 0 || totalBeats <= 0 || !AudioContextCtor) {
      if (continueMetronome) startDawMetronome();
      onComplete();
      return;
    }

    const context = new AudioContextCtor();
    recordingMetronomeContextRef.current = context;
    const beatDuration = getMetronomeBeatDuration(bpm);
    const countInStartTime = context.currentTime + METRONOME_START_DELAY_SECONDS;
    const recordingStartTime = countInStartTime + totalBeats * beatDuration;
    setRecordingStatus("counting");
    setCountInRemainingBeats(totalBeats);
    void context.resume().catch(() => undefined);

    for (let beatIndex = 0; beatIndex < totalBeats; beatIndex += 1) {
      scheduleDawMetronomeClick(context, countInStartTime + beatIndex * beatDuration, beatIndex % barBeats === 0);
    }
    if (metronomeEnabled && continueMetronome) startDawMetronome(context, recordingStartTime);

    let complete = false;
    const updateCountIn = () => {
      if (complete) return;
      const beatsStarted = context.currentTime < countInStartTime
        ? 0
        : Math.min(totalBeats, Math.floor((context.currentTime - countInStartTime) / beatDuration) + 1);
      setCountInRemainingBeats(Math.max(0, totalBeats - beatsStarted));
      if (context.currentTime < recordingStartTime) return;
      complete = true;
      if (recordingCountInTimerRef.current) window.clearInterval(recordingCountInTimerRef.current);
      recordingCountInTimerRef.current = null;
      setCountInRemainingBeats(0);
      if (!metronomeEnabled || !continueMetronome) {
        void context.close();
        recordingMetronomeContextRef.current = null;
      }
      onComplete();
    };

    updateCountIn();
    recordingCountInTimerRef.current = window.setInterval(updateCountIn, 16);
  }

  async function startDawLevelMeter(stream: MediaStream, recordingTrack: Track, monitoringEnabled = recordingTrack.monitoring) {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor({ sampleRate: project.sampleRate, latencyHint: "interactive" });
    recordingLevelContextRef.current = context;
    const sinkContext = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
    if (monitorRoute === "native" && selectedOutputDeviceId !== "default") {
      if (!sinkContext.setSinkId) throw new Error("此瀏覽器無法指定監聽輸出，請選系統預設或使用原生引擎。");
      await sinkContext.setSinkId(selectedOutputDeviceId);
    }
    const count = channelMode === "stereo" ? 2 : 1;
    const input = createDiscreteAudioInput(context, stream, inputChannelStart, count);
    const splitter = context.createChannelSplitter(count);
    input.output.connect(splitter);
    const analysers = Array.from({ length: count }, (_, channel) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      splitter.connect(analyser, channel);
      return analyser;
    });
    const monitorGain = context.createGain();
    const monitorMute = context.createGain();
    monitorMute.gain.value = audibleMixerTrackIds(liveTracksRef.current, project.routes).has(recordingTrack.id) ? 1 : 0;
    const instrument = targetInstrumentForTrack(recordingTrack);
    monitorGain.gain.value = monitoringEnabled && monitorRoute === "native"
      ? recordingMonitorLevel(recordingTrack)
      : 0;
    const channelData = analysers.map((analyser) => new Float32Array(analyser.fftSize));
    const data = channelData[0];
    input.output.connect(monitorGain).connect(monitorMute).connect(context.destination);
    await context.resume();
    recordingMonitorGainRef.current = monitorGain;
    recordingMonitorMuteRef.current = monitorMute;
    recordingMonitorTrackIdRef.current = recordingTrack.id;
    meterAnalysisAtRef.current = 0;
    meterStateUpdateAtRef.current = 0;
    recordingPeakHoldValueRef.current = 0;

    const tick = () => {
      const now = performance.now();
      if (now - meterAnalysisAtRef.current < 48) {
        recordingLevelAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }
      meterAnalysisAtRef.current = now;
      let sum = 0;
      let peak = 0;
      for (let channel = 0; channel < count; channel += 1) {
        analysers[channel].getFloatTimeDomainData(channelData[channel]);
        for (const sample of channelData[channel]) {
          sum += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      const rms = Math.sqrt(sum / (data.length * count));
      const level = clamp(rms * 4, 0, 1);
      recordingPeakHoldValueRef.current = Math.max(recordingPeakHoldValueRef.current, peak);
      workspaceRef.current?.style.setProperty("--daw-record-level", `${Math.round(level * 100)}%`);
      workspaceRef.current?.style.setProperty("--daw-record-peak", `${Math.min(99, Math.round(peak * 100))}%`);

      if (now - meterStateUpdateAtRef.current >= 125) {
        meterStateUpdateAtRef.current = now;
        setRecordingRms(rms);
        setRecordingInputPeak(peak);
        setRecordingPeakHold(recordingPeakHoldValueRef.current);
        if (peak >= 0.98) setRecordingClippingDetected(true);
      }
      if (dawDetectionMode.includes("pitch") && now - tunerUpdateAtRef.current >= 160) {
        tunerUpdateAtRef.current = now;
        setLiveTuner(detectTunerReading(data, context.sampleRate, instrument));
      }
      recordingLevelAnimationRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }

  function targetInstrumentForTrack(track: Track): PerformanceInstrument {
    return ["vocal", "guitar", "piano", "bass", "drums"].includes(track.trackType)
      ? (track.trackType as PerformanceInstrument)
      : "other";
  }

  function updateNativeMeter(status: DawNativeRecordingStatus) {
    const peak = clamp(status.peak ?? 0, 0, 1);
    const rms = clamp(status.rms ?? 0, 0, 1);
    recordingPeakHoldValueRef.current = Math.max(recordingPeakHoldValueRef.current, peak);
    workspaceRef.current?.style.setProperty("--daw-record-level", `${Math.round(clamp(rms * 4, 0, 1) * 100)}%`);
    workspaceRef.current?.style.setProperty("--daw-record-peak", `${Math.min(99, Math.round(peak * 100))}%`);
    setRecordingInputPeak(peak);
    setRecordingRms(rms);
    setRecordingPeakHold(recordingPeakHoldValueRef.current);
    if (status.clipping || peak >= 0.98) setRecordingClippingDetected(true);
    if (status.error) setRecordingError(status.error);
    else if (status.diskWriteErrorCount) setRecordingError("原生錄音發生磁碟寫入錯誤；請停止並檢查這段 take，不能視為完整錄音。");
    else if (status.xrunCount) setRecordingError("原生音訊發生緩衝或裝置異常；這段 take 需要檢查掉音。");
  }

  function startNativeMeterPolling() {
    const poll = async () => {
      try {
        const response = await fetch("/api/daw-engine/recordings/status", { cache: "no-store" });
        if (!response.ok) return;
        updateNativeMeter((await response.json()) as DawNativeRecordingStatus);
      } catch {
        // A short status miss must not interrupt the protected native WAV recording.
      }
    };
    void poll();
    nativeMeterTimerRef.current = window.setInterval(poll, 140);
  }

  function playbackEligibleTrackIds(excludeTrackId?: string, soloTrackId?: string) {
    if (soloTrackId && project.tracks.some((track) => track.id === soloTrackId)) return new Set([soloTrackId]);
    return new Set(project.tracks.filter((track) => track.id !== excludeTrackId).map((track) => track.id));
  }

  function audibleTrackIdsForState(tracks: Track[]) {
    return audibleMixerTrackIds(tracks, project.routes, playbackScopeRef.current);
  }

  function audibleTrackIds(excludeTrackId?: string, soloTrackId?: string) {
    return audibleMixerTrackIds(liveTracksRef.current, project.routes, { excludeTrackId, soloTrackId });
  }

  function smoothAudioParam(param: AudioParam, value: number, seconds = 0.012) {
    const context = contextRef.current;
    if (!context || context.state === "closed") return;
    const now = context.currentTime;
    const current = Number.isFinite(param.value) ? param.value : value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  function updatePlaybackMaster(nextTracks: Track[] = liveTracksRef.current, immediate = false) {
    const master = playbackMasterRef.current;
    if (!master) return;
    const graphTracks = nextTracks.filter(track => master.graphTrackIds.has(track.id));
    const contributors = audibleMasterTrackIds(graphTracks, master.routes, master.sourceTrackIds, master.scope);
    const effects = graphTracks.filter(track => contributors.has(track.id)).map(track => master.effectsByTrack.get(track.id) ?? track.effects);
    master.output.updateTransparent(isDawMasterTransparent(effects), immediate);
  }

  function applyLiveTrackPatch(trackId: string, payload: Partial<Track>, nextTracks: Track[]) {
    const audibleTrackIds = audibleTrackIdsForState(nextTracks);
    for (const [id, controls] of playbackTrackControlsRef.current) {
      setMixerGate(controls.muteGate, audibleTrackIds.has(id));
    }
    const monitorAudible = audibleMixerTrackIds(nextTracks, project.routes);
    if (inputMonitorMuteRef.current) setMixerGate(inputMonitorMuteRef.current, monitorAudible.has(inputMonitorTrackIdRef.current ?? ""));
    if (recordingMonitorMuteRef.current) setMixerGate(recordingMonitorMuteRef.current, monitorAudible.has(recordingMonitorTrackIdRef.current ?? ""));
    updateNativeRecordingMonitor(nextTracks);

    const controls = playbackTrackControlsRef.current.get(trackId);
    if (controls) {
      if (payload.volume !== undefined) smoothAudioParam(controls.fader.gain, clampDawTrackGain(payload.volume));
      if (payload.pan !== undefined) smoothAudioParam(controls.panner.pan, clampDawPan(payload.pan));
      if (payload.polarityInverted !== undefined) smoothAudioParam(controls.polarity.gain, payload.polarityInverted ? -1 : 1, 0.004);
    }

    const nextTrack = nextTracks.find((track) => track.id === trackId);
    if (payload.effects !== undefined && nextTrack) {
      const effects = dspPreviewsRef.current.get(trackId) ?? nextTrack.effects;
      playbackDspRef.current.get(trackId)?.forEach(update => update(effects));
    }
    if (payload.monitoring !== undefined && recordingMonitorGainRef.current && recordingMonitorTrackIdRef.current === trackId) {
      const level = payload.monitoring && monitorRoute === "native"
        ? recordingMonitorLevel(nextTrack)
        : 0;
      smoothMonitorLevel(recordingMonitorGainRef.current, level);
    }
    if (payload.effects !== undefined && nextTrack && recordingMonitorGainRef.current && recordingMonitorTrackIdRef.current === trackId) {
      const level = nextTrack.monitoring && monitorRoute === "native"
        ? recordingMonitorLevel(nextTrack)
        : 0;
      smoothMonitorLevel(recordingMonitorGainRef.current, level);
    }
    if (payload.effects !== undefined && nextTrack && inputMonitorGainRef.current && inputMonitorTrackIdRef.current === trackId) {
      smoothMonitorLevel(inputMonitorGainRef.current, recordingMonitorLevel(nextTrack));
    }

    const directMedia = directMediaRef.current;
    const directTrackId = directMediaTrackIdRef.current;
    if (directMedia && directTrackId) {
      const audible = audibleTrackIds.has(directTrackId);
      if (directMediaGateRef.current) setMixerGate(directMediaGateRef.current, audible);
      else directMedia.muted = !audible;
    }
    updatePlaybackMaster(nextTracks);
  }

  function recordingMonitorLevel(track?: Track) {
    const settings = getStudioSettings(track?.effects);
    return clamp(settings.monitorLevel * settings.inputGain, 0, 1.5);
  }

  function smoothMonitorLevel(node: GainNode, level: number) {
    const now = node.context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(level, now + 0.006);
  }

  function updateNativeRecordingMonitor(tracks: Track[]) {
    const recordingId = nativeRecordingIdRef.current;
    if (!recordingId || nativeRecordingStoppingRef.current || monitorRoute !== "native") return;
    const track = tracks.find((item) => item.id === nativeTrackIdRef.current);
    const level = track?.monitoring && audibleMixerTrackIds(tracks, project.routes).has(track.id)
      ? recordingMonitorLevel(track) : 0;
    nativeMonitorQueueRef.current = nativeMonitorQueueRef.current.then(async () => {
      if (nativeRecordingIdRef.current !== recordingId) return;
      const response = await fetch("/api/daw-engine/recording-monitor", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId, level })
      });
      if (!response.ok) throw new Error("原生監聽更新失敗；請停止錄音檢查引擎，原始 take 不受音量控制影響。");
    }).catch((error) => {
      if (nativeRecordingIdRef.current === recordingId && !nativeRecordingStoppingRef.current) {
        setRecordingError(error instanceof Error ? error.message : "原生監聽更新失敗。");
      }
    });
  }

  async function decodedClipBuffer(context: AudioContext, clip: Clip) {
    const cached = decodedAudioCacheRef.current.get(clip.audioFileId);
    if (cached) {
      decodedAudioCacheOrderRef.current = [
        ...decodedAudioCacheOrderRef.current.filter((audioFileId) => audioFileId !== clip.audioFileId),
        clip.audioFileId
      ];
      return cached;
    }
    const pending = decodedAudioPromisesRef.current.get(clip.audioFileId);
    if (pending) return pending;
    if (!clip.audioFile.fileAvailable) return null;

    const promise = (async () => {
      const response = await fetch(`/api/files/${clip.audioFileId}`);
      if (!response.ok) return null;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      decodedAudioCacheRef.current.set(clip.audioFileId, buffer);
      decodedAudioCacheOrderRef.current.push(clip.audioFileId);
      decodedAudioCacheBytesRef.current += decodedAudioBytes(buffer);

      while (decodedAudioCacheBytesRef.current > decodedAudioCacheLimitBytes && decodedAudioCacheOrderRef.current.length > 1) {
        const oldestId = decodedAudioCacheOrderRef.current.shift();
        if (!oldestId || oldestId === clip.audioFileId) continue;
        const oldestBuffer = decodedAudioCacheRef.current.get(oldestId);
        if (!oldestBuffer) continue;
        decodedAudioCacheRef.current.delete(oldestId);
        decodedAudioCacheBytesRef.current = Math.max(0, decodedAudioCacheBytesRef.current - decodedAudioBytes(oldestBuffer));
      }
      return buffer;
    })().finally(() => decodedAudioPromisesRef.current.delete(clip.audioFileId));

    decodedAudioPromisesRef.current.set(clip.audioFileId, promise);
    return promise;
  }

  async function preloadRecordingCue(excludeTrackId: string) {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return;
    const activeTrackIds = audibleTrackIds(excludeTrackId);
    const clips = allClips.filter(({ track, clip }) => activeTrackIds.has(track.id) && clip.audioFile.fileAvailable);
    if (!clips.length) return;
    setOverdubCueStatus("preparing");
    const context = new AudioContextCtor();
    try {
      await Promise.all(clips.map(({ clip }) => decodedClipBuffer(context, clip).catch(() => null)));
    } finally {
      await context.close();
    }
  }

  async function startOverdubCue(track: Track, captureStartedAtMs: number) {
    try {
      const leadSeconds =
        (await playTimeline(recordingTimelineStartRef.current, {
          excludeTrackId: track.id,
          recordingCue: true,
          captureStartedAtMs
        })) ?? 0;
      recordingCaptureLeadSecondsRef.current = leadSeconds;
      if (recordingSessionMetaRef.current) recordingSessionMetaRef.current.captureLeadSeconds = leadSeconds;
      setOverdubCueStatus("active");
    } catch (error) {
      recordingCaptureLeadSecondsRef.current = 0;
      setOverdubCueStatus("idle");
      setRecordingError(
        `錄音已開始，但伴奏 cue 啟動失敗：${error instanceof Error ? error.message : "未知錯誤"}。目前 take 仍會保存。`
      );
    }
  }

  async function beginNativeDawRecording(track: Track) {
    try {
      const inputDeviceName = selectedInputDevice?.name || selectedInputDevice?.label || null;
      const outputDeviceName = monitorRoute === "native" ? selectedOutputDevice?.name || selectedOutputDevice?.label || null : null;
      const requestStartedAtMs = performance.now();
      const response = await fetch(`/api/songs/${project.songId}/native-recordings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          dawTrackId: track.id,
          inputDeviceName,
          outputDeviceName,
          sampleRate: project.sampleRate,
          channels: channelMode === "stereo" ? 2 : 1,
          inputChannelStart,
          bitDepth: 24,
          bufferFrames,
          monitorRoute,
          monitorLevel: track.monitoring && audibleMixerTrackIds(liveTracksRef.current, project.routes).has(track.id)
            ? recordingMonitorLevel(track) : 0,
          latencyCompensationMs: applyLatencyCompensation ? latencyCompensationMs : 0
        })
      });
      const data = (await response.json()) as DawNativeRecordingResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "原生 WAV 錄音無法啟動。");
      const responseReceivedAtMs = performance.now();
      const estimatedCaptureStartedAtMs = requestStartedAtMs + (responseReceivedAtMs - requestStartedAtMs) / 2;
      nativeRecordingIdRef.current = data.recordingId;
      nativeTrackIdRef.current = track.id;
      updateNativeRecordingMonitor(liveTracksRef.current);
      if (punchEnabled) setTransportTime(punchIn);
      setRecordingStatus("recording");
      startRecordingClock(estimatedCaptureStartedAtMs);
      startNativeMeterPolling();
      void startOverdubCue(track, estimatedCaptureStartedAtMs);
      if (punchEnabled) {
        recordingPunchTimerRef.current = window.setTimeout(stopDawRecording, Math.max(100, (punchOut - punchIn) * 1000));
      }
    } catch (error) {
      stopDawRecordingResources();
      nativeRecordingIdRef.current = "";
      nativeTrackIdRef.current = "";
      setRecordingStatus("idle");
      setRecordingError(error instanceof Error ? error.message : "原生 WAV 錄音無法啟動。");
    }
  }

  async function prepareNativeDawRecording(track: Track) {
    if (!nativeEngineAvailable) {
      setRecordingError("原生錄音引擎尚未啟動；請使用桌面 App，或切換到 Web 備援錄音。");
      return;
    }
    if (!engineStatus?.native?.capabilities?.includes("discrete_input_routing")) {
      setRecordingError("原生引擎需更新獨立輸入路由後才能錄音。");
      return;
    }
    if (!selectedInputDevice || (monitorRoute === "native" && !selectedOutputDevice)) {
      setRecordingError("指定的錄音或監聽裝置已離線；請重新選擇，系統不會自動切換。");
      return;
    }
    if (!inputDevices.length) {
      setRecordingError("CoreAudio 找不到輸入裝置，請先接上錄音介面或麥克風，再重新整理裝置。");
      return;
    }
    if (monitorRoute === "native" && !outputDevices.length) {
      setRecordingError("App 軟體監聽需要可用的耳機輸出裝置。");
      return;
    }

    try {
      if (!await patchTrack(track, { armed: true, monitoring: monitorRoute !== "off" })) throw new Error("錄音軌設定未成功保存；本次沒有啟動錄音。");
      setRecordStandby(true);
      setRecordingPeakHold(0);
      setRecordingClippingDetected(false);
      recordingTimelineStartRef.current = punchEnabled ? punchIn : transportVisualTimeRef.current;
      recordingCaptureLeadSecondsRef.current = 0;
      nativeTrackIdRef.current = track.id;
      const cueTrackIds = audibleTrackIds(track.id);
      recordingSessionMetaRef.current = {
        trackId: track.id,
        inputDeviceLabel: `${selectedInputDevice?.name || selectedInputDevice?.label || "CoreAudio Input"} / Input ${inputChannelStart + 1}${channelMode === "stereo" ? `-${inputChannelStart + 2}` : ""}`,
        channelMode,
        countInBars,
        recordMode: punchEnabled ? "punch" : "full",
        punchInSeconds: punchEnabled ? punchIn : null,
        punchOutSeconds: punchEnabled ? punchOut : null,
        requestedSampleRate: project.sampleRate,
        overdubCueEnabled: metronomeEnabled || allClips.some(({ track: cueTrack }) => cueTrackIds.has(cueTrack.id)),
        captureLeadSeconds: 0
      };
      await preloadRecordingCue(track.id);
      runDawCountIn(() => void beginNativeDawRecording(track), false);
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "";
      setRecordingError(
        errorName === "NotAllowedError"
          ? "麥克風權限被拒絕，請到 macOS 系統設定的隱私權與安全性中允許頌祖音樂 OS 使用麥克風。"
          : error instanceof Error
            ? error.message
            : "無法取得原生錄音權限。"
      );
      stopDawRecordingResources();
      setRecordingStatus("idle");
    }
  }

  async function analyzeAndSaveRecordedTake(blob: Blob, takeId: string, instrument: PerformanceInstrument) {
    const reportPayload = await analyzeDawRecordedBlob(blob, {
      detectionMode: dawDetectionMode,
      targetBpm: project.bpm,
      targetInstrument: instrument
    });
    const analysisResponse = await fetch(`/api/recording-takes/${takeId}/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload)
    });
    if (!analysisResponse.ok) throw new Error(await analysisResponse.text());
  }

  async function stopNativeDawRecording() {
    const recordingId = nativeRecordingIdRef.current;
    const recordedTrack = recordingTargetRef.current;
    if (!recordingId || !recordedTrack) return;
    if (nativeRecordingStoppingRef.current) return;
    nativeRecordingStoppingRef.current = true;
    if (recordingPunchTimerRef.current) window.clearTimeout(recordingPunchTimerRef.current);
    recordingPunchTimerRef.current = null;
    setRecordingStatus("saving");
    try {
      await nativeMonitorQueueRef.current;
      const sessionMeta = recordingSessionMetaRef.current;
      const targetInstrument = targetInstrumentForTrack(recordedTrack);
      const response = await fetch(`/api/songs/${project.songId}/native-recordings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          recordingId,
          dawTrackId: recordedTrack.id,
          targetInstrument,
          detectionMode: dawDetectionMode,
          targetBpm: project.bpm,
          targetKey: project.musicalKey,
          metronomeEnabled,
          inputDeviceName: sessionMeta?.inputDeviceLabel || "CoreAudio Input",
          outputDeviceName: monitorRoute === "native" ? selectedOutputDevice?.name || selectedOutputDevice?.label || null : null,
          channelMode,
          countInBars,
          recordMode: punchEnabled ? "punch" : "full",
          punchInSeconds: punchEnabled ? punchIn : null,
          punchOutSeconds: punchEnabled ? punchOut : null,
          timelineStartSeconds: recordingTimelineStartRef.current,
          monitorRoute,
          bufferFrames,
          latencyCompensationMs,
          applyLatencyCompensation,
          cueCompensationSeconds: recordingCaptureLeadSecondsRef.current
        })
      });
      const data = (await response.json()) as DawNativeRecordingSavedResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "原生 WAV 停止或入庫失敗。");
      nativeRecordingIdRef.current = "";
      nativeTrackIdRef.current = "";
      stopDawRecordingResources();
      setLastRecordedTakeId(data.takeId);
      setAudioFiles(audioFilesFromSong(data.song));
      setAudioFileId(data.audioFileId);
      setRecordingPreviewUrl(`/api/files/${data.audioFileId}`);
      if (data.project) setProjectFromResponse(data);
      setSelectedClipId(data.clipId);
      setSelectedClipIds([data.clipId]);
      setSelectedTrackId(recordedTrack.id);
      if (dawDetectionMode !== "off") {
        setRecordingStatus("analyzing");
        try {
          const recordedResponse = await fetch(`/api/files/${data.audioFileId}`);
          if (!recordedResponse.ok) throw new Error("無法讀取剛完成的原生 WAV。");
          await analyzeAndSaveRecordedTake(await recordedResponse.blob(), data.takeId, targetInstrument);
          await refreshDawProject();
        } catch (analysisError) {
          setRecordingError(
            analysisError instanceof Error ? `WAV 已保存，但拍子／音準分析失敗：${analysisError.message}` : "WAV 已保存，但拍子／音準分析失敗。"
          );
        }
      }
      setRecordingStatus("idle");
    } catch (error) {
      setRecordingStatus("recording");
      setRecordingError(
        `${error instanceof Error ? error.message : "原生 WAV 停止失敗。"} 錄音引擎可能仍在擷取，請再次按「停止錄音」。`
      );
    } finally {
      nativeRecordingStoppingRef.current = false;
    }
  }

  async function startDawRecording() {
    if (recordingStartingRef.current || recordingStatus !== "idle") return;
    if (codexOperationBusyRef.current) {
      setRecordingError("控制室操作尚未完成，請等待或取消請求後再開始錄音。");
      return;
    }
    setRecordingError("");
    setRecordingLimitNotice("");
    if (!selectedTrack) {
      setRecordingError("請先選取或建立一條錄音軌。");
      return;
    }
    if (!window.isSecureContext) {
      setRecordingError("手機／平板麥克風錄音需要 HTTPS 安全連線；目前仍可播放、編輯與標記。請改用本機 HTTPS 入口後再錄音。");
      return;
    }
    if (captureEngine === "web" && !navigator.mediaDevices?.getUserMedia) {
      setRecordingError("這台裝置或瀏覽器不支援麥克風錄音，請改用最新版 Safari、Chrome 或桌面 App。");
      return;
    }
    if (punchEnabled && !punchRangeValid) {
      setRecordingError("定點重錄的終點必須晚於起點，請先設定有效區間。");
      return;
    }
    stopInputMonitoring();
    recordingStartingRef.current = true;
    recordingTargetRef.current = selectedTrack;
    if (captureEngine === "native_wav") {
      try { await prepareNativeDawRecording(selectedTrack); }
      finally { recordingStartingRef.current = false; }
      return;
    }

    try {
      if (!await patchTrack(selectedTrack, { armed: true })) throw new Error("錄音軌設定未成功保存；本次沒有啟動錄音。");
      setRecordStandby(true);
      setRecordingPeakHold(0);
      setRecordingClippingDetected(false);
      recordingTimelineStartRef.current = punchEnabled ? punchIn : transportVisualTimeRef.current;
      recordingCaptureLeadSecondsRef.current = 0;
      const recordingInstrument = targetInstrumentForTrack(selectedTrack);
      const { stream } = await requestWebAudioInput();
      const inputTrack = stream.getAudioTracks()[0];
      const inputSettings = inputTrack?.getSettings();
      recordingStreamRef.current = stream;
      inputTrack?.addEventListener("ended", () => {
        if (recordingStreamRef.current !== stream) return;
        setRecordingError("指定的錄音輸入已中斷；已停止並保留目前錄音，不會切換到其他麥克風。");
        if (pcmRecorderRef.current) stopDawRecordingRef.current();
        else cancelDawRecordingPreparation();
      }, { once: true });
      recordingSessionMetaRef.current = {
        trackId: selectedTrack.id,
        inputDeviceLabel: `${inputTrack?.label || selectedInputDevice?.label || "系統預設輸入"} / Input ${inputChannelStart + 1}${channelMode === "stereo" ? `-${inputChannelStart + 2}` : ""}`,
        channelMode,
        countInBars,
        recordMode: punchEnabled ? "punch" : "full",
        punchInSeconds: punchEnabled ? punchIn : null,
        punchOutSeconds: punchEnabled ? punchOut : null,
        requestedSampleRate: inputSettings?.sampleRate ?? project.sampleRate,
        overdubCueEnabled:
          metronomeEnabled || allClips.some(({ track: cueTrack }) => audibleTrackIds(selectedTrack.id).has(cueTrack.id)),
        captureLeadSeconds: 0
      };
      await startDawLevelMeter(stream, selectedTrack, selectedTrack.monitoring);
      void refreshDeviceStatus();

      await preloadRecordingCue(selectedTrack.id);
      runDawCountIn(() => {
        if (recordingStreamRef.current !== stream) return;
        void BrowserPcmRecorder.create(stream, project.sampleRate, channelMode === "stereo" ? 2 : 1, inputChannelStart, recordingLevelContextRef.current ?? undefined, {
          onLimitWarning: (recorder) => {
            if (recordingStreamRef.current === stream && pcmRecorderRef.current === recorder) {
              setRecordingLimitNotice("Web 錄音即將達到 30 分鐘上限；剩約 1 分鐘，到限會自動停止並保存。");
            }
          },
          onLimitReached: (recorder) => {
            if (recordingStreamRef.current !== stream || pcmRecorderRef.current !== recorder) return;
            setRecordingLimitNotice("已達 30 分鐘上限，錄音已自動停止，正在保存。");
            stopDawRecordingRef.current();
          }
        })
          .then((recorder) => {
            if (recordingStreamRef.current !== stream) {
              void recorder.cancel();
              return;
            }
            pcmRecorderRef.current = recorder;
            const captureStartedAtMs = performance.now();
            if (punchEnabled) setTransportTime(punchIn);
            setRecordingStatus("recording");
            startRecordingClock(captureStartedAtMs);
            void startOverdubCue(selectedTrack, captureStartedAtMs);
            if (punchEnabled) {
              recordingPunchTimerRef.current = window.setTimeout(stopDawRecording, Math.max(100, (punchOut - punchIn) * 1000));
            }
          })
          .catch((pcmError) => {
            setRecordingError(pcmError instanceof Error ? pcmError.message : "無法啟動 24-bit PCM 錄音。");
            stopDawRecordingResources();
            setRecordingStatus("idle");
          });
      }, false);
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "";
      setRecordingError(
        errorName === "NotAllowedError"
          ? "麥克風權限被拒絕，請到瀏覽器或系統設定允許頌祖音樂 OS 使用麥克風。"
          : errorName === "NotFoundError"
            ? "找不到可用麥克風，請先連接錄音設備再重試。"
            : errorName === "NotReadableError"
              ? "麥克風正被其他程式使用，請關閉其他錄音軟體後重試。"
              : error instanceof Error
                ? error.message
                : "無法開始錄音，請確認麥克風權限。"
      );
      stopDawRecordingResources();
      setRecordingStatus("idle");
    } finally {
      recordingStartingRef.current = false;
    }
  }

  function cancelDawRecordingPreparation() {
    void pcmRecorderRef.current?.cancel();
    pcmRecorderRef.current = null;
    stopPlayback(false);
    stopDawRecordingResources();
    setRecordingStatus("idle");
    setRecordingError("已取消錄音倒數，沒有建立音檔。");
  }

  function stopDawRecording() {
    if (recordingStatusRef.current === "counting") {
      cancelDawRecordingPreparation();
      return;
    }
    stopPlayback(false);
    if (nativeRecordingIdRef.current) {
      void stopNativeDawRecording();
      return;
    }
    const recorder = pcmRecorderRef.current;
    if (!recorder) {
      stopDawRecordingResources();
      return;
    }
    if (webRecordingStoppingRef.current === recorder) return;
    webRecordingStoppingRef.current = recorder;
    let releasedForSave = false;
    setRecordingStatus("saving");
    void recorder.stop()
      .then((recording) => {
        // Cancellation/unmount clears this identity before the flush resolves.
        if (pcmRecorderRef.current !== recorder) return;
        stopDawRecordingResources();
        releasedForSave = true;
        if (recording.limitReached) setRecordingLimitNotice("已達 30 分鐘上限，錄音已自動停止。");
        else setRecordingLimitNotice("");
        if (recording.truncated) setRecordingError("錄音收尾逾時；已保留取得的 WAV，這段需要檢查完整性。");
        return saveDawRecording(recording.blob);
      })
      .catch((stopError) => {
        if (pcmRecorderRef.current !== recorder && !releasedForSave) return;
        if (!releasedForSave) stopDawRecordingResources();
        setRecordingError(stopError instanceof Error ? stopError.message : "無法完成 24-bit WAV。" );
        setRecordingStatus("idle");
      })
      .finally(() => {
        if (webRecordingStoppingRef.current === recorder) webRecordingStoppingRef.current = null;
      });
  }
  stopDawRecordingRef.current = stopDawRecording;

  async function saveDawRecording(blob: Blob) {
    const sessionMeta = recordingSessionMetaRef.current;
    const recordedTrack = recordingTargetRef.current;
    if (!recordedTrack || recordedTrack.id !== sessionMeta?.trackId) throw new Error("錄音目標不符，禁止寫入其他音軌。");
    try {
      if (recordingPreviewUrl) URL.revokeObjectURL(recordingPreviewUrl);
      setRecordingPreviewUrl(URL.createObjectURL(blob));
      const extension = blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `daw-${recordedTrack.trackType}-${Date.now()}.${extension}`, { type: blob.type || "audio/wav" });
      const formData = new FormData();
      formData.set("file", file);
      formData.set("targetInstrument", targetInstrumentForTrack(recordedTrack));
      formData.set("detectionMode", dawDetectionMode);
      formData.set("targetBpm", project.bpm?.toString() ?? "");
      formData.set("targetKey", project.musicalKey ?? "");
      formData.set("metronomeEnabled", String(metronomeEnabled));
      formData.set("notes", `DAW 錄音軌：${recordedTrack.name}`);
      formData.set("dawTrackId", recordedTrack.id);
      formData.set("inputDeviceLabel", sessionMeta?.inputDeviceLabel ?? "系統預設輸入");
      formData.set("channelMode", sessionMeta?.channelMode ?? channelMode);
      formData.set("countInBars", String(sessionMeta?.countInBars ?? countInBars));
      formData.set("recordMode", sessionMeta?.recordMode ?? (punchEnabled ? "punch" : "full"));
      formData.set("punchInSeconds", sessionMeta?.punchInSeconds?.toString() ?? "");
      formData.set("punchOutSeconds", sessionMeta?.punchOutSeconds?.toString() ?? "");
      formData.set("timelineStartSeconds", String(recordingTimelineStartRef.current));
      formData.set("requestedSampleRate", String(sessionMeta?.requestedSampleRate ?? project.sampleRate));
      formData.set("captureLeadSeconds", String(sessionMeta?.captureLeadSeconds ?? recordingCaptureLeadSecondsRef.current));
      formData.set("overdubCueEnabled", String(sessionMeta?.overdubCueEnabled ?? false));

      const uploadResponse = await fetch(`/api/songs/${project.songId}/recording-takes`, {
        method: "POST",
        body: formData
      });
      if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
      const created = (await uploadResponse.json()) as DawRecordingCreateResponse;
      setLastRecordedTakeId(created.takeId);
      setAudioFiles(audioFilesFromSong(created.song));
      if (created.audioFileId) setAudioFileId(created.audioFileId);

      if (dawDetectionMode !== "off") {
        setRecordingStatus("analyzing");
        try {
          await analyzeAndSaveRecordedTake(blob, created.takeId, targetInstrumentForTrack(recordedTrack));
        } catch (analysisError) {
          setRecordingError(analysisError instanceof Error ? `Take 已保存，但分析失敗：${analysisError.message}` : "Take 已保存，但分析失敗。");
        }
      }

      await refreshDawProject();
      if (created.dawTrackId) setSelectedTrackId(created.dawTrackId);
      if (created.clipId) {
        setSelectedClipId(created.clipId);
        setSelectedClipIds([created.clipId]);
      }
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "錄音儲存失敗。");
    } finally {
      setRecordingStatus("idle");
    }
  }

  function recordingSessionProtected() {
    return recordingStartingRef.current || recordingStatusRef.current !== "idle" || Boolean(recordingStreamRef.current) || Boolean(nativeRecordingIdRef.current);
  }

  function beginCodexOperation(allowDspDraft = false) {
    if (!allowDspDraft && dspPreviewsRef.current.size) {
      setRenderError("請先儲存或放棄 DSP 草稿，再使用 Codex A/B。");
      return false;
    }
    if (recordingSessionProtected() || codexOperationBusyRef.current || pendingTrackPatchesRef.current.length || saveState !== "saved") return false;
    codexOperationBusyRef.current = true;
    setCodexOperationBusy(true);
    return true;
  }

  function endCodexOperation() {
    codexOperationBusyRef.current = false;
    setCodexOperationBusy(false);
  }

  async function askCodexToPolishTake(lane: TakeLane, track: Track) {
    const clip = track.clips.find(item => item.audioFileId === lane.recordingTake.audioFile?.id);
    if (!clip) {
      setCodexPolishMessage("請先將這個 Take 放入時間軸，才能對同一片段試聽與調整。");
      return;
    }
    if (!beginCodexOperation()) return;
    const controller = new AbortController();
    codexTakeRequestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 95_000);
    setSelectedTrackId(track.id);
    setSelectedClipId(clip.id);
    setSelectedClipIds([clip.id]);
    setCodexPolishBusyTakeId(lane.recordingTake.id);
    setCodexPolishMessage("正在檢查這個 Take；原始音檔不會傳送或覆寫。");
    setActiveRackTab("ai");
    try {
      const storageKey = `songzu.daw.codex-conversation.${project.id}`;
      const response = await fetch(`/api/daw-projects/${project.id}/codex-chat`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: window.localStorage.getItem(storageKey),
          trackId: track.id, selectedClipId: clip.id, playheadSeconds: clip.startSeconds,
          message: "檢查這個 Take 的技術疑點，區分實測證據與待回聽判斷；如有必要，提出一個溫和且可 A/B 試聽的通道調整，不用效果掩蓋演奏問題。"
        })
      });
      const data = (await response.json()) as CodexPolishAgentResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Codex 無法完成這個 Take 的檢查。");
      if (!data.providerStatus.realModel || data.providerStatus.provider !== "codex_cli") throw new Error("Codex 尚未連線；沒有改用其他模型。");
      if (data.conversation?.id) window.localStorage.setItem(storageKey, data.conversation.id);
      setCodexProviderStatus(data.providerStatus);
      setCodexConversationVersion(version => version + 1);
      setCodexPolishMessage("檢查結果已送到控制室；有調整方案時，先比較 A/B 再決定是否套用。");
    } catch (error) {
      setCodexPolishMessage(controller.signal.aborted ? "已取消或逾時，沒有套用調整。" : error instanceof Error ? error.message : "Codex 暫時無法使用。");
    } finally {
      window.clearTimeout(timer);
      codexTakeRequestRef.current = null;
      setCodexPolishBusyTakeId("");
      endCodexOperation();
    }
  }

  function codexTrackOverride(action: AiAgentActionDto) {
    const track = project.tracks.find(item => item.id === action.payload?.trackId);
    if (!track || !isCurrentDawProposal(track, action.payload)) return null;
    return { ...track, ...buildDawAdjustment(track, action.payload?.settings, String(action.payload?.presetLabel ?? "Codex 試聽方案")) };
  }

  async function auditionCodexAction(action: AiAgentActionDto, mode: "original" | "proposal") {
    if (recordingSessionProtected()) return false;
    const trackId = typeof action.payload?.trackId === "string" ? action.payload.trackId : "";
    const track = project.tracks.find((item) => item.id === trackId);
    if (!track || action.payload?.projectId !== project.id || !isCurrentDawProposal(track, action.payload)) {
      setRenderError("方案已過期或音軌已變更，請重新詢問。");
      return false;
    }
    if (!track.clips.length) {
      setRenderError("這條音軌尚未有時間軸片段，請先把錄音 Take 放進時間軸再試聽。");
      return false;
    }
    if (track.muted || track.volume <= 0 || track.clips.every(clip => clip.gain <= 0)) {
      setRenderError("這條音軌目前靜音或音量為零，請先恢復可聽音量再比較。");
      return false;
    }
    const audition =
      action.payload?.audition && typeof action.payload.audition === "object" && !Array.isArray(action.payload.audition)
        ? (action.payload.audition as Record<string, unknown>)
        : {};
    const firstClipStart = Math.min(...track.clips.map((clip) => clip.startSeconds));
    const selectedTrackClip = track.clips.find((clip) => clip.id === selectedClipId) ?? track.clips[0];
    const requestedStart = typeof audition.startSeconds === "number" ? audition.startSeconds : selectedTrackClip?.startSeconds ?? firstClipStart;
    const durationSeconds = typeof audition.durationSeconds === "number" ? audition.durationSeconds : 15;
    const startSeconds = track.clips.some((clip) => {
      const duration = getClipDuration(clip);
      return requestedStart >= clip.startSeconds && requestedStart < clip.startSeconds + duration;
    })
      ? requestedStart
      : selectedTrackClip?.startSeconds ?? firstClipStart;
    const trackOverride = mode === "proposal" ? codexTrackOverride(action) : null;
    if (mode === "proposal" && !trackOverride) {
      setRenderError("Codex 方案參數不完整，已停止試聽且沒有修改音軌。");
      return false;
    }
    setRenderError("");
    const started = await playTimeline(startSeconds, {
      soloTrackId: audition.soloTrack === false ? undefined : track.id,
      trackOverride: trackOverride ?? undefined,
      requiredTrackId: track.id,
      previewDurationSeconds: clamp(durationSeconds, 3, 30),
      includeMetronome: false
    });
    return started !== null;
  }

  async function reviewCodexIssue(start: number, end: number, trackId: string) {
    if (recordingSessionProtected() || end <= start) return false;
    return await playTimeline(start, { soloTrackId: trackId, requiredTrackId: trackId, previewDurationSeconds: end - start, includeMetronome: false }) !== null;
  }

  async function playCodexMixPreview() {
    if (recordingSessionProtected()) return;
    setRenderError("");
    await playTimeline(transportVisualTimeRef.current, { previewDurationSeconds: 20, includeMetronome: false });
  }

  async function patchTrack(track: Track, payload: Partial<Track>) {
    const version = ++trackPatchSequenceRef.current;
    pendingTrackPatchesRef.current.push({ version, trackId: track.id, payload });
    const nextTracks = tracksAfterPatch(liveTracksRef.current, track.id, payload);
    liveTracksRef.current = nextTracks;
    applyLiveTrackPatch(track.id, payload, nextTracks);
    setSaveState("saving");
    setProject((current) => ({
      ...current,
      tracks: tracksAfterPatch(current.tracks, track.id, payload)
    }));
    const save = async () => {
      try {
        const response = await fetch(`/api/daw-tracks/${track.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "音軌更新失敗");
        pendingTrackPatchesRef.current = pendingTrackPatchesRef.current.filter((patch) => patch.version !== version);
        setProjectFromResponse(data);
        setSaveState(pendingTrackPatchesRef.current.length ? "saving" : "saved");
        return true;
      } catch (error) {
        pendingTrackPatchesRef.current = pendingTrackPatchesRef.current.filter((patch) => patch.version !== version);
        setSaveState("error");
        setRenderError(error instanceof Error ? error.message : "音軌更新失敗");
        await refreshDawProject().catch(() => {});
        return false;
      }
    };
    // Serialize persistence across tracks (R/I are exclusive), while the
    // audio and UI change immediately. Older responses retain pending intent.
    const request = trackPatchQueueRef.current.then(save, save);
    trackPatchQueueRef.current = request;
    return request;
  }

  async function toggleTrackControl(track: Track, control: DawTrackControl) {
    const currentTrack = liveTracksRef.current.find((item) => item.id === track.id) ?? track;
    const enabled = !currentTrack[control];
    setSelectedTrackId(track.id);

    if (control === "armed") {
      const saved = await patchTrack(track, { armed: enabled });
      if (!saved) return;
      setRecordStandby(enabled);
      setActiveRackTab("recording");
      showStudioNotice(`${track.name}：R 錄音待命${enabled ? "已開啟，這條軌是目前錄音目標" : "已關閉"}`);
      return;
    }

    if (control === "monitoring") {
      const saved = await patchTrack(track, { monitoring: enabled });
      if (!saved) return;
      setActiveRackTab("recording");
      if (!enabled) {
        if (inputMonitorTrackIdRef.current === track.id) stopInputMonitoring();
        setRecordingError("");
        showStudioNotice(`${track.name}：I 輸入監聽已關閉`);
        return;
      }
      try {
        await startInputMonitoring({ ...track, monitoring: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "無法開啟輸入監聽。";
        setRecordingError(`${message} I 已保持待命；接上輸入裝置後，關閉再開啟 I 即可重試。`);
        showStudioNotice(`${track.name}：I 已待命，等待可用輸入裝置`);
      }
      return;
    }

    if (control === "muted") {
      if (await patchTrack(track, { muted: enabled })) {
        showStudioNotice(`${track.name}：M 靜音${enabled ? "已立即開啟" : "已解除"}`);
      }
      return;
    }

    const payload: Partial<Track> = enabled && currentTrack.muted
      ? { solo: true, muted: false }
      : { solo: enabled };
    if (await patchTrack(track, payload)) {
      showStudioNotice(`${track.name}：S 獨奏${enabled ? "已立即開啟" : "已解除"}`);
    }
  }

  async function updateStudioSettings(patch: Partial<StudioSettings>) {
    if (!selectedTrack) return;
    const nextSettings = { ...selectedTrackSettings, ...patch };
    await patchTrack(selectedTrack, { effects: withStudioSettings(selectedTrack.effects, nextSettings) });
  }

  function previewDsp(trackId: string, effects: Effects | null) {
    if (effects) dspPreviewsRef.current.set(trackId, effects);
    else dspPreviewsRef.current.delete(trackId);
    const current = effects ?? liveTracksRef.current.find(track => track.id === trackId)?.effects;
    if (current) playbackDspRef.current.get(trackId)?.forEach(update => update(current));
  }

  async function applyRecordingMode(mode: RecordingMode) {
    if (!selectedTrack) return;
    await patchTrack(selectedTrack, {
      trackType: mode.trackType,
      color: mode.color,
      armed: true,
      monitoring: true,
      effects: withStudioSettings(selectedTrack.effects, {
        ...selectedTrackSettings,
        instrumentPreset: mode.label,
        inputGain: mode.trackType === "vocal" ? 0.68 : 0.74,
        monitorLevel: 0.82,
        reverb: mode.trackType === "piano" ? 0.28 : selectedTrackSettings.reverb,
        echo: mode.trackType === "guitar" ? 0.16 : selectedTrackSettings.echo
      })
    });
    setRecordStandby(true);
  }

  async function createRecordingTrack(mode: RecordingMode) {
    const response = await fetch(`/api/daw-projects/${project.id}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: mode.defaultName, trackType: mode.trackType, color: mode.color })
    });
    const data = (await response.json()) as { project?: DawProjectDto | null };
    if (!data.project) return;
    const created =
      [...data.project.tracks].reverse().find((track) => track.name === mode.defaultName && track.trackType === mode.trackType) ??
      data.project.tracks[data.project.tracks.length - 1];
    setProjectFromResponse(data);
    if (created) {
      setSelectedTrackId(created.id);
      setActiveRackTab("recording");
      await patchTrack(created, {
        armed: true,
        monitoring: true,
        effects: withStudioSettings(created.effects, { ...defaultStudioSettings, instrumentPreset: mode.label })
      });
      setSelectedTrackId(created.id);
    }
    setRecordStandby(true);
  }

  async function applySoundToTrack(item: { id: string; name: string; chain: string[] }) {
    if (!selectedTrack) return;
    setSelectedSoundId(item.id);
    const nextSettings = { ...selectedTrackSettings, instrumentPreset: item.name };
    const soundEffect = {
      kind: "sound_preset",
      soundId: item.id,
      label: item.name,
      chain: item.chain,
      appliedAt: new Date().toISOString()
    };
    const otherEffects = selectedTrackEffects.filter((effect) => effect.kind !== "sound_preset");
    await patchTrack(selectedTrack, { effects: [...withStudioSettings([], nextSettings), soundEffect, ...otherEffects] });
  }

  async function toggleEffectMacro(macro: (typeof effectMacros)[number]) {
    if (!selectedTrack) return;
    const exists = selectedTrackEffects.some((effect) => effect.kind === "effect_macro" && effect.id === macro.id);
    const nextEffects = exists
      ? selectedTrackEffects.filter((effect) => !(effect.kind === "effect_macro" && effect.id === macro.id))
      : [
          ...selectedTrackEffects,
          {
            kind: "effect_macro",
            id: macro.id,
            label: macro.label,
            chain: macro.chain,
            settings: macro.settings,
            appliedAt: new Date().toISOString()
          }
        ];
    await patchTrack(selectedTrack, { effects: [...withStudioSettings([], selectedTrackSettings), ...nextEffects] });
  }

  async function resetSelectedTrackChannel() {
    if (!selectedTrack) return;
    await patchTrack(selectedTrack, {
      volume: 1,
      pan: 0,
      effects: withStudioSettings([], {
        ...defaultStudioSettings,
        instrumentPreset: selectedTrackSettings.instrumentPreset
      })
    });
    showStudioNotice("音軌控制已重設");
  }

  async function patchClip(clip: Clip, payload: Partial<Clip>, operationGroupId?: string) {
    const version = (clipPatchVersionRef.current[clip.id] ?? 0) + 1;
    clipPatchVersionRef.current[clip.id] = version;
    setSaveState("saving");
    setProject((current) => ({
      ...current,
      tracks: current.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((item) => (item.id === clip.id ? { ...item, ...payload } : item))
      }))
    }));
    try {
      const response = await fetch(`/api/daw-clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...(operationGroupId ? { operationGroupId } : {}) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Clip 更新失敗");
      if (clipPatchVersionRef.current[clip.id] === version) {
        setRenderError("");
        setProjectFromResponse(data);
        setSaveState("saved");
      }
      return true;
    } catch (error) {
      if (clipPatchVersionRef.current[clip.id] === version) {
        setSaveState("error");
        setRenderError(error instanceof Error ? error.message : "Clip 更新失敗");
        await refreshDawProject();
      }
      return false;
    }
  }

  async function patchTakeLane(lane: TakeLane, payload: Partial<Pick<TakeLane, "compStatus" | "notes" | "selectedRange">>) {
    const response = await fetch(`/api/daw-take-lanes/${lane.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Take lane 更新失敗");
      return false;
    }
    setRenderError("");
    setProjectFromResponse(data);
    return true;
  }

  function handleClipClick(event: MouseEvent<HTMLButtonElement>, track: Track, clip: Clip) {
    event.stopPropagation();
    if (suppressClipClickRef.current) return;
    setSelectedTrackId(track.id);
    setSelectedClipId(clip.id);
    if (activeTool === "split") {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const splitTime = snapTimelineSeconds(clip.startSeconds + getClipDuration(clip) * ratio);
      setTransportTime(splitTime);
      void splitClipAtTime(clip, splitTime);
      setActiveTool("select");
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setSelectedClipIds((current) => (current.includes(clip.id) ? current.filter((clipId) => clipId !== clip.id) : [...current, clip.id]));
      return;
    }
    setSelectedClipIds([clip.id]);
  }

  function seekTimelineFromPointer(event: PointerEvent<HTMLElement>, trackId?: string) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, .daw-trim-handle")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const seconds = timelineDuration * ratio;
    if (isPlaying) stopPlayback(false);
    setTransportTime(snapEnabled ? snapTimelineSeconds(seconds) : snapSeconds(seconds));
    if (trackId) setSelectedTrackId(trackId);
  }

  function clipToClipboardItem(clip: Clip): ClipClipboardItem {
    return {
      audioFileId: clip.audioFileId,
      sourceTrackId: clip.trackId,
      startSeconds: clip.startSeconds,
      offsetSeconds: clip.offsetSeconds,
      durationSeconds: clip.durationSeconds,
      gain: clip.gain,
      fadeInSeconds: clip.fadeInSeconds,
      fadeOutSeconds: clip.fadeOutSeconds,
      label: clip.label,
      color: clip.color
    };
  }

  function copySelectedClips() {
    const items = editSelectedClipItems.map(({ clip }) => clipToClipboardItem(clip));
    if (!items.length && selectedClip) items.push(clipToClipboardItem(selectedClip));
    setClipClipboard(items);
  }

  async function createClipOnTrack(trackId: string, item: ClipClipboardItem, startSeconds: number) {
    const response = await fetch(`/api/daw-tracks/${trackId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioFileId: item.audioFileId,
        startSeconds: snapTimelineSeconds(startSeconds),
        offsetSeconds: item.offsetSeconds,
        durationSeconds: item.durationSeconds,
        gain: item.gain,
        fadeInSeconds: item.fadeInSeconds,
        fadeOutSeconds: item.fadeOutSeconds,
        label: item.label ? `${item.label} · copy` : null,
        color: item.color
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Clip 建立失敗");
      return null;
    }
    setRenderError("");
    setProjectFromResponse(data);
    return data.project as DawProjectDto | null;
  }

  async function pasteClipsAtPlayhead() {
    if (!selectedTrack || !clipClipboard.length) return;
    const earliest = Math.min(...clipClipboard.map((item) => item.startSeconds));
    const createdIds: string[] = [];
    let latestProject: DawProjectDto | null = null;

    for (const item of clipClipboard) {
      latestProject = await createClipOnTrack(selectedTrack.id, item, transportVisualTimeRef.current + item.startSeconds - earliest);
    }

    if (latestProject) {
      const latestClipIds = new Set(latestProject.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      const previousClipIds = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      for (const clipId of latestClipIds) {
        if (!previousClipIds.has(clipId)) createdIds.push(clipId);
      }
    }
    if (createdIds.length) {
      setSelectedClipIds(createdIds);
      setSelectedClipId(createdIds[0]);
    }
  }

  async function duplicateSelectedClips() {
    const clips = editSelectedClipItems;
    if (!clips.length) return;
    const offset = beatDurationSeconds > 0 ? beatDurationSeconds : 1;
    const createdIds: string[] = [];
    let latestProject: DawProjectDto | null = null;

    for (const { track, clip } of clips) {
      latestProject = await createClipOnTrack(track.id, clipToClipboardItem(clip), clip.startSeconds + offset);
    }

    if (latestProject) {
      const latestClipIds = new Set(latestProject.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      const previousClipIds = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      for (const clipId of latestClipIds) {
        if (!previousClipIds.has(clipId)) createdIds.push(clipId);
      }
    }
    if (createdIds.length) {
      setSelectedClipIds(createdIds);
      setSelectedClipId(createdIds[0]);
    }
  }

  async function deleteSelectedClips() {
    const targetClips = editSelectedClipItems.map(({ clip }) => clip).filter((clip) => !clip.locked);
    if (!targetClips.length) return;

    let latestData: { project?: DawProjectDto | null } | null = null;
    for (const clip of targetClips) {
      const response = await fetch(`/api/daw-clips/${clip.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setRenderError(data.error ?? "Clip 刪除失敗");
        return;
      }
      latestData = data;
    }

    setRenderError("");
    setSelectedClipIds([]);
    setSelectedClipId("");
    if (latestData) setProjectFromResponse(latestData);
  }

  async function nudgeSelectedClips(deltaSeconds: number) {
    const targetClips = editSelectedClipItems.map(({ clip }) => clip);
    const operationGroupId = `nudge-${Date.now()}`;
    for (const clip of targetClips.filter((item) => !item.locked)) {
      await patchClip(clip, { startSeconds: snapTimelineSeconds(clip.startSeconds + deltaSeconds) }, operationGroupId);
    }
  }

  function selectAllClips() {
    const ids = allClips.map(({ clip }) => clip.id);
    setSelectedClipIds(ids);
    if (ids[0]) setSelectedClipId(ids[0]);
  }

  function startClipDrag(event: PointerEvent<HTMLButtonElement>, track: Track, clip: Clip) {
    event.stopPropagation();
    setSelectedTrackId(track.id);
    setSelectedClipId(clip.id);
    if (!selectedClipSet.has(clip.id)) {
      setSelectedClipIds(clip.groupId
        ? allClips.filter((item) => item.clip.groupId === clip.groupId).map((item) => item.clip.id)
        : [clip.id]);
    }
    if (activeTool === "split") return;
    if (clipTrimRef.current) return;
    if (clip.locked) return;
    clipDragRef.current = {
      clip,
      startX: event.clientX,
      originalStartSeconds: clip.startSeconds,
      moved: false
    };
    setDraggingClipId(clip.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveClipDrag(event: PointerEvent<HTMLButtonElement>) {
    const draft = clipDragRef.current;
    if (!draft) return;
    const deltaSeconds = (event.clientX - draft.startX) / pixelsPerSecond;
    if (Math.abs(deltaSeconds) >= 0.04) draft.moved = true;
    setDragPreview({
      clipId: draft.clip.id,
      startSeconds: snapTimelineSeconds(draft.originalStartSeconds + deltaSeconds)
    });
  }

  async function endClipDrag(event: PointerEvent<HTMLButtonElement>, clip: Clip) {
    const draft = clipDragRef.current;
    if (!draft || draft.clip.id !== clip.id) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const previewStart = dragPreview?.clipId === clip.id ? dragPreview.startSeconds : draft.originalStartSeconds;
    if (draft.moved && previewStart !== clip.startSeconds) {
      suppressClipClickRef.current = true;
      const deltaSeconds = previewStart - clip.startSeconds;
      const grouped = clip.groupId
        ? allClips.filter((item) => item.clip.groupId === clip.groupId).map((item) => item.clip)
        : [clip];
      const operationGroupId = `move-${clip.groupId ?? clip.id}-${Date.now()}`;
      for (const item of grouped.filter((item) => !item.locked)) {
        await patchClip(item, { startSeconds: snapTimelineSeconds(item.startSeconds + deltaSeconds) }, operationGroupId);
      }
      window.setTimeout(() => {
        suppressClipClickRef.current = false;
      }, 80);
    }
    clipDragRef.current = null;
    setDraggingClipId("");
    setDragPreview(null);
  }

  function startClipTrim(event: PointerEvent<HTMLSpanElement>, clip: Clip, side: ClipTrimSide) {
    event.stopPropagation();
    event.preventDefault();
    setSelectedClipId(clip.id);
    if (clip.locked) return;
    clipTrimRef.current = {
      clip,
      side,
      startX: event.clientX,
      originalStartSeconds: clip.startSeconds,
      originalOffsetSeconds: clip.offsetSeconds,
      originalDurationSeconds: getClipDuration(clip),
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setTrimmingClip({
      clipId: clip.id,
      side,
      startSeconds: clip.startSeconds,
      offsetSeconds: clip.offsetSeconds,
      durationSeconds: getClipDuration(clip)
    });
  }

  function moveClipTrim(event: PointerEvent<HTMLSpanElement>) {
    const draft = clipTrimRef.current;
    if (!draft) return;
    const rawDeltaSeconds = (event.clientX - draft.startX) / pixelsPerSecond;
    if (Math.abs(rawDeltaSeconds) >= 0.04) draft.moved = true;

    if (draft.side === "start") {
      const snappedStart = snapTimelineSeconds(draft.originalStartSeconds + rawDeltaSeconds);
      const deltaSeconds = clamp(snappedStart - draft.originalStartSeconds, -draft.originalOffsetSeconds, draft.originalDurationSeconds - 0.1);
      setTrimmingClip({
        clipId: draft.clip.id,
        side: draft.side,
        startSeconds: snapSeconds(draft.originalStartSeconds + deltaSeconds),
        offsetSeconds: snapSeconds(draft.originalOffsetSeconds + deltaSeconds),
        durationSeconds: Math.max(0.1, snapSeconds(draft.originalDurationSeconds - deltaSeconds))
      });
      return;
    }

    const snappedEnd = snapTimelineSeconds(draft.originalStartSeconds + draft.originalDurationSeconds + rawDeltaSeconds);
    const deltaSeconds = Math.max(0.1 - draft.originalDurationSeconds, snappedEnd - draft.originalStartSeconds - draft.originalDurationSeconds);
    setTrimmingClip({
      clipId: draft.clip.id,
      side: draft.side,
      startSeconds: draft.originalStartSeconds,
      offsetSeconds: draft.originalOffsetSeconds,
      durationSeconds: Math.max(0.1, snapSeconds(draft.originalDurationSeconds + deltaSeconds))
    });
  }

  async function endClipTrim(event: PointerEvent<HTMLSpanElement>, clip: Clip) {
    const draft = clipTrimRef.current;
    if (!draft || draft.clip.id !== clip.id) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const preview = trimmingClip?.clipId === clip.id ? trimmingClip : null;
    if (preview && draft.moved) {
      await patchClip(clip, {
        startSeconds: preview.startSeconds,
        offsetSeconds: preview.offsetSeconds,
        durationSeconds: preview.durationSeconds
      });
    }
    clipTrimRef.current = null;
    setTrimmingClip(null);
  }

  async function trimClipEnd(clip: Clip, deltaSeconds: number) {
    await patchClip(clip, { durationSeconds: Math.max(0.1, snapSeconds(getClipDuration(clip) + deltaSeconds)) });
  }

  async function trimClipStart(clip: Clip, deltaSeconds: number) {
    const nextOffset = snapSeconds(clip.offsetSeconds + deltaSeconds);
    const nextDuration = snapSeconds(getClipDuration(clip) - deltaSeconds);
    if (nextOffset < 0 || nextDuration < 0.1) {
      setRenderError("Clip 起點已到邊界，不能再往前或縮短。");
      return;
    }
    await patchClip(clip, {
      startSeconds: snapTimelineSeconds(clip.startSeconds + deltaSeconds),
      offsetSeconds: nextOffset,
      durationSeconds: nextDuration
    });
  }

  async function deleteClip(clip: Clip) {
    if (clip.locked) {
      setRenderError("Clip 已鎖定，請先解除鎖定再刪除。");
      return;
    }
    const response = await fetch(`/api/daw-clips/${clip.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Clip 刪除失敗");
      return;
    }
    setRenderError("");
    setSelectedClipId("");
    setProjectFromResponse(data);
  }

  async function splitClipAtTime(clip: Clip, requestedTime: number) {
    if (clip.locked) {
      setRenderError("Clip 已鎖定，請先解除鎖定再切分。");
      return;
    }
    const duration = getClipDuration(clip);
    const splitTime = snapTimelineSeconds(requestedTime);
    const splitOffset = snapSeconds(splitTime - clip.startSeconds);
    if (splitOffset <= 0.1 || splitOffset >= duration - 0.1) {
      setRenderError("播放頭必須在 clip 中間，才能切分。");
      return;
    }

    const firstDuration = splitOffset;
    const secondDuration = snapSeconds(duration - splitOffset);
    const updated = await patchClip(clip, { durationSeconds: firstDuration, fadeOutSeconds: 0 });
    if (!updated) return;

    const response = await fetch(`/api/daw-tracks/${clip.trackId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioFileId: clip.audioFileId,
        startSeconds: splitTime,
        offsetSeconds: snapSeconds(clip.offsetSeconds + splitOffset),
        durationSeconds: secondDuration,
        gain: clip.gain,
        fadeInSeconds: 0,
        fadeOutSeconds: clip.fadeOutSeconds,
        label: `${clip.label ?? clip.audioFile.fileName} · split`,
        color: clip.color
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Clip 切分失敗");
      return;
    }
    setRenderError("");
    setProjectFromResponse(data);
    showStudioNotice(`已在 ${formatTime(splitTime)} 切分片段`);
  }

  async function splitClipAtPlayhead(clip: Clip) {
    await splitClipAtTime(clip, transportVisualTimeRef.current);
  }

  async function setLaneCompFromPunch(lane: TakeLane) {
    if (!punchRangeValid) {
      setRenderError("請先設定有效的 Punch In / Out 區間。");
      return;
    }
    await patchTakeLane(lane, {
      selectedRange: {
        sourceStartSeconds: snapSeconds(punchIn),
        sourceEndSeconds: snapSeconds(punchOut),
        timelineStartSeconds: snapSeconds(punchIn),
        createdFrom: "daw_punch_range",
        createdAt: new Date().toISOString()
      },
      notes: `Comp 區間 ${formatTime(punchIn)} - ${formatTime(punchOut)}`
    });
  }

  function prepareIssueRetake(timestampSeconds: number, trackId?: string) {
    if (recordingSessionProtected() || codexOperationBusyRef.current) return;
    if (trackId) setSelectedTrackId(trackId);
    const start = snapTimelineSeconds(Math.max(0, timestampSeconds - 1.5));
    const end = snapTimelineSeconds(Math.min(timelineDuration, timestampSeconds + 2.5));
    setTransportTime(timestampSeconds);
    setPunchIn(start);
    setPunchOut(Math.max(start + 0.5, end));
    setPunchEnabled(true);
    setActiveRackTab("recording");
    showStudioNotice(`已建立 ${formatTime(start)} - ${formatTime(end)} 重錄區間`);
  }

  async function createCompClipFromTake(lane: TakeLane, track: Track) {
    const audioFile = lane.recordingTake.audioFile;
    if (!audioFile) {
      setRenderError("這個 take 尚未綁定音檔，不能建立 Comp Clip。");
      return;
    }
    const range =
      readTakeCompRange(lane.selectedRange) ??
      (punchRangeValid
        ? { sourceStartSeconds: snapSeconds(punchIn), sourceEndSeconds: snapSeconds(punchOut), timelineStartSeconds: snapSeconds(punchIn) }
        : null);
    if (!range) {
      setRenderError("請先用 Punch In / Out 標記 take comp 區間。");
      return;
    }

    const response = await fetch(`/api/daw-tracks/${track.id}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioFileId: audioFile.id,
        startSeconds: snapTimelineSeconds(range.timelineStartSeconds),
        offsetSeconds: snapSeconds(range.sourceStartSeconds),
        durationSeconds: snapSeconds(range.sourceEndSeconds - range.sourceStartSeconds),
        label: `${lane.recordingTake.label} · comp ${formatTime(range.sourceStartSeconds)}`,
        color: track.color
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Comp Clip 建立失敗");
      return;
    }
    setRenderError("");
    setProjectFromResponse(data);
    await patchTakeLane(lane, { compStatus: "comped" });
  }

  async function placeTakeOnTimeline(lane: TakeLane, track: Track) {
    const audioFile = lane.recordingTake.audioFile;
    if (!audioFile) {
      setRenderError("這個 take 尚未綁定音檔，不能放進時間軸。");
      return;
    }

    const response = await fetch(`/api/daw-tracks/${track.id}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioFileId: audioFile.id,
        startSeconds: snapTimelineSeconds(transportVisualTimeRef.current),
        durationSeconds: audioFile.durationSeconds,
        label: `${lane.recordingTake.label} · timeline`,
        color: track.color
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "Take 放入時間軸失敗");
      return;
    }
    setRenderError("");
    setProjectFromResponse(data);
    await patchTakeLane(lane, { compStatus: "comped" });
  }

  async function addTrack() {
    if (!trackName.trim()) return;
    const response = await fetch(`/api/daw-projects/${project.id}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trackName.trim(), trackType })
    });
    const data = await response.json();
    setProjectFromResponse(data);
    setTrackName("");
  }

  async function commitSelectedTrackName() {
    if (!selectedTrack) return;
    const name = selectedTrackNameDraft.trim();
    if (!name) {
      setSelectedTrackNameDraft(selectedTrack.name);
      return;
    }
    if (name !== selectedTrack.name && (await patchTrack(selectedTrack, { name }))) showStudioNotice("音軌名稱已儲存");
  }

  async function duplicateSelectedTrack() {
    if (!selectedTrack) return;
    setSaveState("saving");
    const response = await fetch(`/api/daw-projects/${project.id}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${selectedTrack.name} 複本`,
        trackType: selectedTrack.trackType,
        color: selectedTrack.color
      })
    });
    const data = (await response.json()) as { project?: DawProjectDto | null; error?: string };
    if (!response.ok || !data.project) {
      setSaveState("error");
      setRenderError(data.error ?? "音軌複製失敗");
      return;
    }
    const previousIds = new Set(project.tracks.map((track) => track.id));
    const duplicate = data.project.tracks.find((track) => !previousIds.has(track.id));
    setProjectFromResponse(data);
    if (!duplicate) return;
    await patchTrack(duplicate, {
      volume: selectedTrack.volume,
      pan: selectedTrack.pan,
      effects: selectedTrack.effects,
      muted: false,
      solo: false,
      armed: false,
      monitoring: false
    });
    for (const clip of selectedTrack.clips) {
      await createClipOnTrack(duplicate.id, clipToClipboardItem(clip), clip.startSeconds);
    }
    setSelectedTrackId(duplicate.id);
    setSaveState("saved");
    showStudioNotice(`已複製 ${selectedTrack.name}`);
  }

  async function deleteSelectedTrack() {
    if (!selectedTrack) return;
    if (recordingBusy) {
      setRenderError("錄音進行中不能刪除音軌。");
      return;
    }
    if (!window.confirm(`刪除音軌「${selectedTrack.name}」？原始音檔仍會保留在作品庫。`)) return;
    const response = await fetch(`/api/daw-tracks/${selectedTrack.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "音軌刪除失敗");
      return;
    }
    setProjectFromResponse(data);
    setSelectedTrackId(data.project?.tracks[0]?.id ?? "");
    setSelectedClipId("");
    setSelectedClipIds([]);
    showStudioNotice("音軌已刪除，原始音檔仍受保護");
  }

  async function addClip() {
    if (!selectedTrack || !audioFileId) return;
    const response = await fetch(`/api/daw-tracks/${selectedTrack.id}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioFileId, startSeconds: snapTimelineSeconds(transportVisualTimeRef.current) })
    });
    setProjectFromResponse(await response.json());
  }

  async function addMarker() {
    if (!markerLabelValue.trim()) return;
    const response = await fetch(`/api/daw-projects/${project.id}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markerType,
        label: markerLabelValue.trim(),
        timestampSeconds: Number(markerTime) || 0
      })
    });
    setProjectFromResponse(await response.json());
    setMarkerLabelValue("");
  }

  async function addQuickMarker() {
    const timestampSeconds = snapTimelineSeconds(transportVisualTimeRef.current);
    const response = await fetch(`/api/daw-projects/${project.id}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markerType: "idea",
        label: `標記 ${formatTime(timestampSeconds)}`,
        timestampSeconds
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "標記建立失敗");
      return;
    }
    setProjectFromResponse(data);
    setMarkerTime(String(timestampSeconds));
    showStudioNotice(`已在 ${formatTime(timestampSeconds)} 加入標記`);
  }

  async function deleteMarker(markerId: string) {
    const response = await fetch(`/api/daw-markers/${markerId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setRenderError(data.error ?? "標記刪除失敗");
      return;
    }
    setProjectFromResponse(data);
    showStudioNotice("標記已刪除");
  }

  async function saveSnapshot() {
    const response = await fetch(`/api/daw-projects/${project.id}/mix-snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `快照 ${new Date().toLocaleString("zh-TW")}` })
    });
    setProjectFromResponse(await response.json());
  }

  async function toggleRecordStandby() {
    const next = !recordStandby;
    setRecordStandby(next);
    if (next && selectedTrack && !selectedTrack.armed) {
      await patchTrack(selectedTrack, { armed: true, monitoring: true });
    }
  }

  function focusTrackRack(trackId: string, tab: RackTab) {
    setSelectedTrackId(trackId);
    setActiveRackTab(tab);
  }

  async function renderMixdown() {
    if (dspPreviewsRef.current.size || saveState !== "saved" || codexOperationBusyRef.current) {
      setRenderError("請先儲存或放棄 DSP 草稿，並等待目前操作完成再匯出。");
      return;
    }
    setExportBusy("mixdown");
    setRenderError("");
    setRenderOutput(null);
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/render`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setRenderError(data.error ?? "輸出失敗");
        return;
      }
      setRenderOutput(data.output as RenderOutput);
    } finally {
      setExportBusy(null);
    }
  }

  async function exportProjectFile() {
    if (dspPreviewsRef.current.size || saveState !== "saved" || codexOperationBusyRef.current) {
      setRenderError("請先儲存或放棄 DSP 草稿，並等待目前操作完成再匯出。");
      return;
    }
    setExportBusy("project-file");
    setRenderError("");
    setProjectFileOutput(null);
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/project-file`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setRenderError(data.error ?? "Manifest 輸出失敗");
        return;
      }
      setProjectFileOutput(data.output as ProjectFileOutput);
    } finally {
      setExportBusy(null);
    }
  }

  async function exportStemsZip() {
    if (dspPreviewsRef.current.size || saveState !== "saved" || codexOperationBusyRef.current) {
      setRenderError("請先儲存或放棄 DSP 草稿，並等待目前操作完成再匯出。");
      return;
    }
    setExportBusy("stems");
    setRenderError("");
    setStemsOutput(null);
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/stems`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setRenderError(data.error ?? "Stems ZIP 輸出失敗");
        return;
      }
      setStemsOutput(data.output as StemsOutput);
    } finally {
      setExportBusy(null);
    }
  }

  async function runLatencyTest() {
    const response = await fetch("/api/daw-engine/latency-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sampleRate: project.sampleRate,
        bufferFrames,
        monitorEnabled: monitorRoute === "native"
      })
    });
    const data = await response.json();
    if (typeof data.suggestedCompensationMs === "number") {
      setLatencyCompensationMs(Number(data.suggestedCompensationMs.toFixed(2)));
    }
    setLatencyMessage(
      data.estimatedRoundTripMs !== null && data.estimatedRoundTripMs !== undefined
        ? `${data.status === "estimated" ? "估算" : "量測"} ${Number(data.estimatedRoundTripMs).toFixed(2)} ms · 已填入補償值`
        : data.message ?? "原生延遲估算目前不可用。"
    );
  }

  function scheduleTimelineMetronome(
    context: AudioContext,
    playbackStart: number,
    playbackEnd: number,
    startAt: number,
    destination: AudioNode
  ) {
    const calibratedBeats = rhythmCalibration
      ? buildSmartMetronomeGrid(
          rhythmCalibration.beatTimesSeconds,
          rhythmCalibration.beatNumbers,
          smartMetronome.rate,
          smartMetronome.offsetSeconds,
          rhythmCalibration.firstDownbeatSeconds
        )
      : Array.from(
          {
            length: Math.max(
              0,
              Math.floor(playbackEnd / Math.max(0.001, beatDurationSeconds / smartMetronome.rate)) -
                Math.ceil(playbackStart / Math.max(0.001, beatDurationSeconds / smartMetronome.rate)) +
                1
            )
          },
          (_, index) => {
            const clickDuration = beatDurationSeconds / smartMetronome.rate;
            const clickIndex = Math.ceil(playbackStart / clickDuration) + index;
            const clicksPerBar = metronomeClicksPerBar;
            return {
              beatTime: clickIndex * clickDuration,
              accented: clickIndex % clicksPerBar === 0,
              subdivision: smartMetronome.rate === 2 && clickIndex % 2 === 1
            };
          }
        );
    for (const { beatTime, accented } of calibratedBeats) {
      if (beatTime < playbackStart - 0.001 || beatTime > playbackEnd + 0.001) continue;
      scheduleDawMetronomeClick(
        context,
        startAt + Math.max(0, beatTime - playbackStart),
        accented,
        true,
        destination
      );
    }
  }

  function startPlaybackMeters(
    trackAnalysers: Map<string, AnalyserNode>,
    masterAnalyser: AnalyserNode,
    sidechains: Array<{ sourceTrackId: string; destinationGain: GainNode; depth: number }> = []
  ) {
    if (playbackMeterAnimationRef.current) window.cancelAnimationFrame(playbackMeterAnimationRef.current);
    playbackMeterAnalysersRef.current = trackAnalysers;
    playbackMasterAnalyserRef.current = masterAnalyser;
    const buffers = new Map<string, Float32Array<ArrayBuffer>>();
    const peakHolds = new Map<string, number>();
    const currentMeters = new Map<string, { peak: number; rms: number }>();
    let lastPaint = 0;

    const read = (key: string, analyser: AnalyserNode) => {
      let data = buffers.get(key);
      if (!data || data.length !== analyser.fftSize) {
        data = new Float32Array(analyser.fftSize);
        buffers.set(key, data);
      }
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      let squares = 0;
      for (const sample of data) {
        peak = Math.max(peak, Math.abs(sample));
        squares += sample * sample;
      }
      return { peak, rms: Math.sqrt(squares / Math.max(1, data.length)) };
    };

    const paint = (now: number) => {
      if (now - lastPaint >= 50) {
        lastPaint = now;
        for (const [trackId, analyser] of trackAnalysers) {
          const meter = read(trackId, analyser);
          currentMeters.set(trackId, meter);
          const previousHold = peakHolds.get(trackId) ?? 0;
          const hold = meter.peak >= previousHold ? meter.peak : Math.max(meter.peak, previousHold - 0.025);
          peakHolds.set(trackId, hold);
          const element = workspaceRef.current?.querySelector<HTMLElement>(`[data-daw-track-meter="${trackId}"]`);
          if (element) {
            element.style.height = `${Math.round(clamp(Math.max(meter.rms * 2.4, meter.peak * 0.82), 0, 1) * 100)}%`;
            element.dataset.clipping = meter.peak >= 0.999 ? "true" : "false";
            element.title = `Peak ${gainDbLabel(meter.peak)} · RMS ${gainDbLabel(meter.rms)}`;
          }
        }
        for (const sidechain of sidechains) {
          const source = currentMeters.get(sidechain.sourceTrackId);
          if (!source) continue;
          const reduction = clamp(source.rms * 7.5 * sidechain.depth, 0, 0.82);
          sidechain.destinationGain.gain.setTargetAtTime(1 - reduction, sidechain.destinationGain.context.currentTime, 0.018);
        }
        const master = read("master", masterAnalyser);
        const masterElement = workspaceRef.current?.querySelector<HTMLElement>("[data-daw-master-meter]");
        if (masterElement) {
          masterElement.style.height = `${Math.round(clamp(Math.max(master.rms * 2.4, master.peak * 0.86), 0, 1) * 100)}%`;
          masterElement.dataset.clipping = master.peak >= 0.999 ? "true" : "false";
        }
        const readout = workspaceRef.current?.querySelector<HTMLElement>("[data-daw-master-readout]");
        if (readout) readout.textContent = `${gainDbLabel(master.peak)} peak`;
      }
      playbackMeterAnimationRef.current = window.requestAnimationFrame(paint);
    };
    playbackMeterAnimationRef.current = window.requestAnimationFrame(paint);
  }

  function stopPlayback(resetPosition = true) {
    if (playbackMeterAnimationRef.current) window.cancelAnimationFrame(playbackMeterAnimationRef.current);
    playbackMeterAnimationRef.current = null;
    playbackMeterAnalysersRef.current.clear();
    playbackMasterAnalyserRef.current = null;
    workspaceRef.current?.querySelectorAll<HTMLElement>("[data-daw-track-meter], [data-daw-master-meter]").forEach((element) => {
      element.style.height = "2%";
      element.dataset.clipping = "false";
    });
    const directMedia = directMediaRef.current;
    directMediaRef.current = null;
    directMediaTrackIdRef.current = null;
    directMediaGateRef.current = null;
    playbackTrackControlsRef.current.clear();
    playbackDspRef.current.clear();
    playbackMasterRef.current = null;
    playbackScopeRef.current = {};
    if (directMedia) {
      directMedia.onended = null;
      directMedia.onerror = null;
      directMedia.pause();
      directMedia.removeAttribute("src");
      directMedia.load();
    }
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    }
    sourcesRef.current = [];
    for (const node of playbackNodesRef.current) {
      try {
        node.disconnect();
      } catch {
        // Node may already be disconnected when the context closes.
      }
    }
    playbackNodesRef.current = [];
    if (contextRef.current) {
      void contextRef.current.close();
      contextRef.current = null;
    }
    if (playbackStopTimerRef.current) {
      window.clearTimeout(playbackStopTimerRef.current);
      playbackStopTimerRef.current = null;
    }
    const stoppedAt = transportVisualTimeRef.current;
    stopTransportVisualClock();
    setIsPlaying(false);
    if (resetPosition) {
      paintTransportVisual(0);
      setTransportTime(0);
    } else {
      setTransportTime(stoppedAt);
    }
  }

  async function playTimeline(
    startOverride: number | null = null,
    options: TimelinePlaybackOptions = {}
  ): Promise<number | null> {
    const requestedStart = startOverride ?? transportVisualTimeRef.current;
    stopPlayback(false);
    playbackScopeRef.current = { excludeTrackId: options.excludeTrackId, soloTrackId: options.soloTrackId };
    // Schedule every eligible track on the same clock. Mute and solo are
    // handled by live per-track gates so either state can change mid-playback.
    const activeTrackIds = playbackEligibleTrackIds(options.excludeTrackId, options.soloTrackId);
    const currentAudibleTrackIds = () => audibleTrackIdsForState(liveTracksRef.current);
    const playbackTrackFor = (track: Track): Track => {
      const override = options.trackOverride?.id === track.id ? options.trackOverride : null;
      const liveTrack = override ?? liveTracksRef.current.find(item => item.id === track.id) ?? track;
      return { ...liveTrack, effects: override ? override.effects : dspPreviewsRef.current.get(track.id) ?? liveTrack.effects };
    };
    const boundedPreview = options.previewDurationSeconds !== undefined;
    const shouldLoop = !options.recordingCue && !boundedPreview && loopEnabled && loopRangeValid;
    const playbackStart = shouldLoop
      ? requestedStart >= loopStart && requestedStart < loopEnd
        ? requestedStart
        : loopStart
      : requestedStart >= timelineDuration - 0.05
        ? 0
        : clamp(requestedStart, 0, timelineDuration);
    const naturalPlaybackEnd = options.recordingCue && punchEnabled && punchRangeValid
      ? punchOut
      : shouldLoop
        ? loopEnd
        : timelineDuration;
    const playbackEnd = options.previewDurationSeconds
      ? Math.min(naturalPlaybackEnd, playbackStart + clamp(options.previewDurationSeconds, 0.1, 30))
      : naturalPlaybackEnd;
    const playbackDuration = Math.max(0.1, playbackEnd - playbackStart);
    const overlappingClips = allClips
      .filter(({ track }) => activeTrackIds.has(track.id))
      .map(({ track, clip }) => ({
        track: playbackTrackFor(track),
        clip,
        clipDuration: getPlaybackClipDuration(clip)
      }))
      .filter(({ clip, clipDuration }) =>
        Math.min(clip.startSeconds + clipDuration, playbackEnd) > Math.max(clip.startSeconds, playbackStart)
      );
    if (options.requiredTrackId && !overlappingClips.some(item => item.track.id === options.requiredTrackId && item.clip.audioFile.fileAvailable)) {
      setRenderError("選取片段沒有可用音檔，未啟動試聽。");
      return null;
    }
    const directMediaCandidate = !options.recordingCue && overlappingClips.length === 1
      ? overlappingClips[0]
      : null;
    const directMediaSettings = directMediaCandidate
      ? getEffectiveStudioSettings(directMediaCandidate.track.effects)
      : null;
    const directAudioContextConstructor = getAudioContextConstructor();
    const canUseDirectMedia = Boolean(
      // Media playback is a streaming optimization for a complete original.
      // Trims, short clips, seeks and bounded windows need sample scheduling.
      !boundedPreview && !shouldLoop &&
      !project.routes.some(route => !route.muted) &&
      !project.tracks.some(track => track.automationLanes.some(lane => lane.enabled && lane.mode !== "off")) &&
      directMediaCandidate?.clip.audioFile.fileAvailable &&
      Number.isFinite(directMediaCandidate.clipDuration) &&
      directMediaCandidate.clipDuration >= 0.1 &&
      directMediaCandidate.clip.offsetSeconds === 0 &&
      directMediaCandidate.clip.audioFile.durationSeconds != null &&
      Math.abs(directMediaCandidate.clipDuration - directMediaCandidate.clip.audioFile.durationSeconds) < 0.000001 &&
      Math.abs(playbackStart - directMediaCandidate.clip.startSeconds) < 0.000001 &&
      playbackEnd >= directMediaCandidate.clip.startSeconds + directMediaCandidate.clipDuration &&
      directMediaSettings?.effectsBypassed &&
      Math.abs(directMediaCandidate.track.volume - 1) < 0.0001 &&
      Math.abs(directMediaCandidate.track.pan) < 0.0001 &&
      directMediaCandidate.clip.gain === 1 &&
      directMediaCandidate.clip.fadeInSeconds <= 0 &&
      directMediaCandidate.clip.fadeOutSeconds <= 0 &&
      (directAudioContextConstructor || (
        directMediaSettings.inputGain === 1 &&
        directMediaCandidate.track.volume === 1 && directMediaCandidate.track.pan === 0 &&
        !directMediaCandidate.track.polarityInverted && directMediaCandidate.track.stereoMode === "stereo"
      ))
    );

    if (directMediaCandidate && canUseDirectMedia) {
      const { clip } = directMediaCandidate;
      const audibleStart = Math.max(clip.startSeconds, playbackStart);
      let audibleEnd = Math.min(clip.startSeconds + getPlaybackClipDuration(clip), playbackEnd);
      const sourceStartSeconds = Math.max(0, clip.offsetSeconds + audibleStart - clip.startSeconds);
      const media = new Audio(`/api/files/${clip.audioFileId}`);
      const AudioContextCtor = directAudioContextConstructor;
      const useSharedSmartClock = Boolean(AudioContextCtor);
      let sharedContext: AudioContext | null = null;
      let mediaGate: GainNode | null = null;
      let directAnalyser: AnalyserNode | null = null;
      let directMasterOutput: ReturnType<typeof createMasterOutput> | null = null;
      directMediaRef.current = media;
      directMediaTrackIdRef.current = directMediaCandidate.track.id;
      media.preload = "auto";
      media.volume = 1;
      media.playbackRate = 1;
      media.preservesPitch = true;
      media.muted = !useSharedSmartClock;
      const isCurrentAttempt = () => directMediaRef.current === media && (!sharedContext || contextRef.current === sharedContext);
      const discardObsoleteAttempt = () => {
        // Never clear shared refs or stop a newer playback from an old promise.
        media.onended = null;
        media.onerror = null;
        media.pause();
        media.removeAttribute("src");
        media.load();
        if (sharedContext && sharedContext.state !== "closed") void sharedContext.close().catch(() => {});
      };

      try {
        if (useSharedSmartClock && AudioContextCtor) {
          sharedContext = new AudioContextCtor({ latencyHint: "interactive" });
          contextRef.current = sharedContext;
          const sinkContext = sharedContext as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
          if (selectedOutputDeviceId !== "default" && sinkContext.setSinkId) {
            await sinkContext.setSinkId(selectedOutputDeviceId);
            if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
          }
          const mediaSource = sharedContext.createMediaElementSource(media);
          const playbackTrack = playbackTrackFor(directMediaCandidate.track);
          const bus = createMixerTrackBus(sharedContext, playbackTrack, currentAudibleTrackIds().has(playbackTrack.id));
          // Startup gating is independent of mute/solo ramp cancellation.
          mediaGate = sharedContext.createGain();
          directAnalyser = bus.analyser;
          directAnalyser.fftSize = 2048;
          directAnalyser.smoothingTimeConstant = 0.7;
          mediaGate.gain.value = 0;
          mediaSource.connect(mediaGate);
          const channel = createDawChannel(sharedContext, mediaGate, playbackTrack.effects, bus.input);
          directMasterOutput = createMasterOutput(sharedContext, true);
          directAnalyser.connect(directMasterOutput.input);
          playbackMasterRef.current = {
            output: directMasterOutput, sourceTrackIds: new Set([playbackTrack.id]), graphTrackIds: new Set([playbackTrack.id]),
            routes: [], scope: { ...playbackScopeRef.current }, effectsByTrack: new Map([[playbackTrack.id, playbackTrack.effects]])
          };
          playbackDspRef.current.set(directMediaCandidate.track.id, [effects => {
            channel.update(effects);
            playbackMasterRef.current?.effectsByTrack.set(playbackTrack.id, effects);
            updatePlaybackMaster();
          }]);
          playbackTrackControlsRef.current.set(directMediaCandidate.track.id, bus);
          playbackNodesRef.current.push(mediaSource, mediaGate, ...bus.nodes, ...channel.nodes, ...directMasterOutput.nodes);
          directMediaGateRef.current = bus.muteGate;
          updatePlaybackMaster(liveTracksRef.current, true);
          await sharedContext.resume();
          if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
        } else {
          const sinkMedia = media as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
          if (selectedOutputDeviceId !== "default" && sinkMedia.setSinkId) {
            await sinkMedia.setSinkId(selectedOutputDeviceId);
            if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
          }
        }
        if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("原檔載入逾時")), 12_000);
            media.addEventListener("loadedmetadata", () => {
              window.clearTimeout(timeout);
              resolve();
            }, { once: true });
            media.addEventListener("error", () => {
              window.clearTimeout(timeout);
              reject(new Error("原檔無法由系統播放器解碼"));
            }, { once: true });
            media.load();
          });
          if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
        }
        if (Number.isFinite(media.duration)) {
          audibleEnd = Math.min(audibleEnd, clip.startSeconds + Math.max(0, media.duration - Math.max(0, clip.offsetSeconds)));
          if (audibleEnd <= audibleStart) throw new Error("片段範圍沒有可播放的音訊樣本");
        }
        const exactSourceStart = Math.min(
          sourceStartSeconds,
          Number.isFinite(media.duration) ? media.duration : sourceStartSeconds
        );
        if (Math.abs(media.currentTime - exactSourceStart) > 0.01) {
          const seekCompleted = new Promise<void>((resolve) => {
            const timeout = window.setTimeout(resolve, 2_000);
            media.addEventListener("seeked", () => {
              window.clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
          media.currentTime = exactSourceStart;
          await seekCompleted;
          if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
        }
        // Finish loading/seeking before playback and open at the first sample;
        // a muted media pre-roll would discard the beginning of the original.
        if (sharedContext && mediaGate) mediaGate.gain.setValueAtTime(1, sharedContext.currentTime);
        if (!sharedContext) {
          media.muted = !currentAudibleTrackIds().has(directMediaCandidate.track.id);
        }
        await media.play();
        if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
      } catch (error) {
        if (!isCurrentAttempt()) { discardObsoleteAttempt(); return null; }
        stopPlayback(false);
        setRenderError(error instanceof Error ? `原生直通播放失敗：${error.message}` : "原生直通播放失敗");
        return null;
      }

      let timelineNow = Math.min(
        audibleEnd,
        audibleStart + Math.max(0, media.currentTime - sourceStartSeconds)
      );
      let metronomeSampleRate = clip.audioFile.sampleRate ?? project.sampleRate;
      let metronomeLatencyMs: number | null = null;
      if (sharedContext && mediaGate) {
        const outputLatency = "outputLatency" in sharedContext && typeof sharedContext.outputLatency === "number"
          ? sharedContext.outputLatency
          : 0;
        // Song and click share an output context. Only future clicks receive
        // scheduling lead; the source itself is never muted for this lead.
        const syncLeadSeconds = 0.04;
        const syncAt = sharedContext.currentTime + syncLeadSeconds;
        const timelineAtSync = Math.min(
          audibleEnd,
          audibleStart + Math.max(0, media.currentTime + syncLeadSeconds - sourceStartSeconds)
        );
        if (options.includeMetronome !== false && metronomeEnabled) scheduleTimelineMetronome(
          sharedContext,
          timelineAtSync,
          audibleEnd,
          syncAt,
          directMasterOutput!.input
        );
        metronomeSampleRate = sharedContext.sampleRate;
        metronomeLatencyMs = Math.round((sharedContext.baseLatency + outputLatency) * 1000);
        timelineNow = Math.min(
          audibleEnd,
          audibleStart + Math.max(0, media.currentTime - sourceStartSeconds)
        );
      }

      setRenderError("");
      setPlaybackEngineReport({
        scheduledClips: 1,
        skippedClips: 0,
        effectChains: sharedContext && !getEffectiveStudioSettings(playbackMasterRef.current?.effectsByTrack.get(directMediaCandidate.track.id) ?? directMediaCandidate.track.effects).effectsBypassed ? 1 : 0,
        latencyMs: metronomeLatencyMs,
        sampleRate: clip.audioFile.sampleRate ?? metronomeSampleRate,
        mode: sharedContext
          ? `Web Audio 媒體串流 · ${project.timeSignature} 節拍共時鐘 · ${metronomeClicksPerBar} 聲/小節`
          : "原生媒體直通 · 未經 DSP",
        startedAt: new Date().toISOString()
      });
      setIsPlaying(true);
      if (directAnalyser && directMasterOutput && directMediaCandidate) {
        startPlaybackMeters(new Map([[directMediaCandidate.track.id, directAnalyser]]), directMasterOutput.analyser);
      }
      setTransportTime(timelineNow);
      startDirectMediaTransportClock(media, timelineNow, media.currentTime, audibleEnd);
      const finishDirectPlayback = () => {
        if (directMediaRef.current !== media) return;
        if (shouldLoop) {
          void playTimeline(loopStart);
          return;
        }
        stopPlayback(true);
      };
      media.onended = finishDirectPlayback;
      media.onerror = () => {
        if (directMediaRef.current !== media) return;
        stopPlayback(false);
        setRenderError("原檔串流播放中斷；已停止播放，原始音檔未變更。");
      };
      const checkDirectPlaybackEnd = () => {
        if (directMediaRef.current !== media) return;
        const remaining = audibleEnd - (audibleStart + Math.max(0, media.currentTime - sourceStartSeconds));
        if (media.ended || remaining <= 0) finishDirectPlayback();
        else {
          // Buffering can stop the media clock. Wall time alone must never
          // truncate the still-unplayed end of a streamed original.
          playbackStopTimerRef.current = window.setTimeout(checkDirectPlaybackEnd, clamp(remaining * 1000, 100, 1000));
        }
      };
      playbackStopTimerRef.current = window.setTimeout(
        checkDirectPlaybackEnd,
        Math.max(0.1, audibleEnd - timelineNow) * 1000 + 80
      );
      return 0;
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      setRenderError("這個瀏覽器不支援 Web Audio timeline 播放。");
      return null;
    }

    const context = new AudioContextCtor();
    contextRef.current = context;
    const playbackSampleStart = Math.round(playbackStart * context.sampleRate) / context.sampleRate;
    let scheduled = 0;
    let skipped = 0;
    let effectChains = 0;
    const preparedClips: Array<{
      track: Track;
      clip: Clip;
      buffer: AudioBuffer;
      audibleStart: number;
      audibleEnd: number;
      clipDurationSeconds: number;
      clipStartSeconds: number;
      sourceOffsetSeconds: number;
    }> = [];

    await Promise.all(
      allClips
        .filter(({ track }) => activeTrackIds.has(track.id))
        .map(async ({ track, clip }) => {
          try {
            const estimatedDuration = getPlaybackClipDuration(clip);
            if (Math.min(clip.startSeconds + estimatedDuration, playbackEnd) <= Math.max(clip.startSeconds, playbackStart)) return;
            if (!clip.audioFile.fileAvailable) {
              skipped += 1;
              return;
            }
            const buffer = await decodedClipBuffer(context, clip);
            if (!buffer) {
              skipped += 1;
              return;
            }
            const clipDurationSeconds = getPlaybackClipDuration(clip, buffer.duration);
            const clipStartFrame = Math.round(clip.startSeconds * context.sampleRate);
            const sourceOffsetSeconds = Math.max(0, Math.round(clip.offsetSeconds * buffer.sampleRate) / buffer.sampleRate);
            const availableFrames = Math.max(0, Math.round((buffer.duration - sourceOffsetSeconds) * context.sampleRate));
            const clipEndFrame = clipStartFrame + Math.min(Math.round(clipDurationSeconds * context.sampleRate), availableFrames);
            const audibleStartFrame = Math.max(clipStartFrame, Math.round(playbackStart * context.sampleRate));
            const audibleEndFrame = Math.min(clipEndFrame, Math.round(playbackEnd * context.sampleRate));
            if (audibleEndFrame <= audibleStartFrame) return;
            preparedClips.push({
              track: playbackTrackFor(track), clip, buffer, clipDurationSeconds, sourceOffsetSeconds,
              clipStartSeconds: clipStartFrame / context.sampleRate,
              audibleStart: audibleStartFrame / context.sampleRate, audibleEnd: audibleEndFrame / context.sampleRate
            });
          } catch {
            skipped += 1;
            // Missing external files are surfaced in Audio Repair / QA; playback skips them here.
          }
        })
    );

    if (contextRef.current !== context) {
      if (context.state !== "closed") void context.close();
      return null;
    }
    if (boundedPreview && (!preparedClips.length || (options.requiredTrackId && !preparedClips.some(item => item.track.id === options.requiredTrackId)))) {
      stopPlayback(false);
      setRenderError("選取音檔無法解碼，未完成試聽。");
      return null;
    }

    const masterOutput = createMasterOutput(context, true);
    playbackMasterRef.current = {
      output: masterOutput, sourceTrackIds: new Set(preparedClips.map(({ track }) => track.id)),
      graphTrackIds: new Set(project.tracks.map(track => track.id)), routes: project.routes,
      scope: { ...playbackScopeRef.current }, effectsByTrack: new Map()
    };
    playbackNodesRef.current.push(...masterOutput.nodes);
    const startAt = context.currentTime + 0.08;

    const trackBuses = new Map<string, ReturnType<typeof createMixerTrackBus>>();
    const trackInputs = new Map<string, GainNode>();
    for (const track of project.tracks) {
      const liveTrack = playbackTrackFor(track);
      const bus = createMixerTrackBus(context, liveTrack, currentAudibleTrackIds().has(track.id));
      const input = context.createGain();
      trackInputs.set(track.id, input);
      const effects = liveTrack.effects;
      const chain = createDawChannel(context, input, effects, bus.input);
      playbackMasterRef.current.effectsByTrack.set(track.id, effects);
      const scheduleChannelAutomation = (from: number, at: number) => {
        const current = liveTracksRef.current.find(item => item.id === track.id) ?? track;
        for (const lane of current.automationLanes.filter(item => item.enabled && item.mode !== "off")) {
          const target = chain.automationTargets[lane.parameter];
          if (target) scheduleAutomationTarget(target, lane, from, playbackEnd, at);
        }
      };
      scheduleChannelAutomation(playbackStart, startAt);
      playbackDspRef.current.set(track.id, [nextEffects => {
        if (chain.update(nextEffects)) scheduleChannelAutomation(playbackStart + Math.max(0, context.currentTime - startAt), context.currentTime);
        playbackMasterRef.current?.effectsByTrack.set(track.id, nextEffects);
        updatePlaybackMaster();
      }]);
      if (chain.hasAudibleFx) effectChains += 1;
      trackBuses.set(track.id, bus);
      playbackTrackControlsRef.current.set(track.id, bus);
      playbackNodesRef.current.push(...bus.nodes, input, ...chain.nodes);
    }
    updatePlaybackMaster(liveTracksRef.current, true);
    const sidechainPairs = project.routes
      .filter((route) => route.routeType === "sidechain" && !route.muted && route.sourceTrackId && route.destinationTrackId)
      .flatMap((route) => {
        const destination = route.destinationTrackId ? trackBuses.get(route.destinationTrackId) : null;
        return destination && route.sourceTrackId
          ? [{ sourceTrackId: route.sourceTrackId, destinationGain: destination.duckGain, depth: clamp(route.gain, 0, 1) }]
          : [];
      });

    const busTrackIds = new Set(project.tracks.filter((track) => track.trackType === "bus").map((track) => track.id));
    for (const track of project.tracks) {
      const bus = trackBuses.get(track.id);
      if (!bus) continue;
      const outputRoute = project.routes.find((route) => route.sourceTrackId === track.id && route.routeType === "output" && !route.muted);
      const destination = outputRoute?.destinationTrackId && busTrackIds.has(outputRoute.destinationTrackId)
        ? trackInputs.get(outputRoute.destinationTrackId)
        : null;
      bus.analyser.connect(destination ?? masterOutput.input);

      for (const route of project.routes.filter((item) => item.sourceTrackId === track.id && ["send", "cue"].includes(item.routeType) && !item.muted)) {
        const send = context.createGain();
        send.gain.value = clamp(route.gain, 0, 2);
        const sendPan = context.createStereoPanner();
        sendPan.pan.value = clamp(route.pan, -1, 1);
        const sendDestination = route.destinationTrackId && busTrackIds.has(route.destinationTrackId)
          ? trackInputs.get(route.destinationTrackId)
          : masterOutput.input;
        const routeSource = route.preFader ? bus.preFaderTap : bus.analyser;
        routeSource.connect(send).connect(sendPan).connect(sendDestination ?? masterOutput.input);
        const sendAutomation = track.automationLanes.find((lane) => lane.parameter === "send" && lane.enabled && lane.mode !== "off");
        if (sendAutomation) scheduleAutomationTarget({ param: send.gain }, sendAutomation, playbackStart, playbackEnd, startAt);
        playbackNodesRef.current.push(send, sendPan);
      }
    }

    const captureLeadSeconds = options.captureStartedAtMs == null
      ? 0
      : Math.max(0, (performance.now() - options.captureStartedAtMs) / 1000 + 0.08);
    if (options.includeMetronome !== false && metronomeEnabled && beatDurationSeconds > 0) {
      scheduleTimelineMetronome(context, playbackStart, playbackEnd, startAt, masterOutput.input);
    }

    for (const track of project.tracks) {
      const bus = trackBuses.get(track.id);
      if (!bus) continue;
      for (const lane of track.automationLanes.filter((item) => item.enabled && item.mode !== "off")) {
        const target = lane.parameter === "volume"
          ? { param: bus.fader.gain }
          : lane.parameter === "pan"
            ? { param: bus.panner.pan }
            : null;
        if (target) scheduleAutomationTarget(target, lane, playbackStart, playbackEnd, startAt);
      }
    }

    for (const { track, clip, buffer, audibleStart, audibleEnd, clipDurationSeconds, clipStartSeconds, sourceOffsetSeconds } of preparedClips) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      const trackBus = trackBuses.get(track.id);
      if (!trackBus) continue;
      const clipGain = context.createGain();
      source.connect(clipGain).connect(trackInputs.get(track.id)!);
      playbackNodesRef.current.push(clipGain);
      const scheduledStart = startAt + audibleStart - playbackSampleStart;
      const scheduledDuration = audibleEnd - audibleStart;
      const envelope = dawClipEnvelope(clip, clipDurationSeconds, context.sampleRate);
      const envelopePoints = dawClipEnvelopePoints(envelope, audibleStart - clipStartSeconds, scheduledDuration);
      clipGain.gain.cancelScheduledValues(scheduledStart);
      envelopePoints.forEach((point, index) => {
        if (index === 0) clipGain.gain.setValueAtTime(point.gain, scheduledStart);
        else clipGain.gain.linearRampToValueAtTime(point.gain, scheduledStart + point.timeSeconds);
      });
      source.start(
        scheduledStart,
        sourceOffsetSeconds + audibleStart - clipStartSeconds,
        scheduledDuration
      );
      sourcesRef.current.push(source);
      scheduled += 1;
    }

    startPlaybackMeters(new Map(Array.from(trackBuses, ([id, bus]) => [id, bus.analyser])), masterOutput.analyser, sidechainPairs);

    setRenderError("");
    setPlaybackEngineReport({
      scheduledClips: scheduled,
      skippedClips: skipped,
      effectChains,
      latencyMs: typeof context.baseLatency === "number" ? Math.round(context.baseLatency * 1000) : null,
      sampleRate: context.sampleRate,
      mode: engineStatus?.mode === "native_service" ? "native_service + web_monitor" : "web_audio_dsp",
      startedAt: new Date().toISOString()
    });
    if (!options.recordingCue) {
      setIsPlaying(true);
      setTransportTime(playbackStart);
      startTransportVisualClock(playbackStart, playbackEnd, performance.now() + 80);
    }
    playbackStopTimerRef.current = window.setTimeout(() => {
      if (shouldLoop) {
        void playTimeline(loopStart);
        return;
      }
      stopPlayback(!options.recordingCue);
    }, (playbackDuration + 0.08) * 1000);
    return captureLeadSeconds;
  }

  async function stepPersistedHistory(action: "undo" | "redo") {
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) as { project?: DawProjectDto; operation?: { label?: string } | null; error?: string } : {};
      if (!response.ok || !data.project) throw new Error(data.error ?? "編輯歷史操作失敗。");
      setProjectFromResponse(data);
      showStudioNotice(data.operation?.label
        ? `${action === "undo" ? "已復原" : "已重做"}：${data.operation.label}`
        : "目前沒有可執行的歷史動作");
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "編輯歷史操作失敗。");
    }
  }

  const handleDawKeyDown = useEffectEvent((event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (event.code === "Space") {
        event.preventDefault();
        if (isPlaying) stopPlayback(false);
        else void playTimeline();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        stopPlayback();
        return;
      }

      if (!modifier && key === "m") {
        event.preventDefault();
        setMetronomeEnabled((current) => !current);
        return;
      }

      if (!modifier && key === "l") {
        event.preventDefault();
        setLoopEnabled((current) => !current);
        return;
      }

      if (!modifier && key === "b") {
        event.preventDefault();
        setActiveTool((current) => (current === "split" ? "select" : "split"));
        return;
      }

      if (!modifier && key === "r" && recordingStatus !== "saving" && recordingStatus !== "analyzing") {
        event.preventDefault();
        if (recordingStatus === "recording") stopDawRecording();
        else if (recordingStatus === "counting") cancelDawRecordingPreparation();
        else void startDawRecording();
        return;
      }

      if (modifier && key === "a") {
        event.preventDefault();
        selectAllClips();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        void stepPersistedHistory(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        void stepPersistedHistory("redo");
        return;
      }
      if (modifier && key === "c") {
        event.preventDefault();
        copySelectedClips();
        return;
      }
      if (modifier && key === "v") {
        event.preventDefault();
        void pasteClipsAtPlayhead();
        return;
      }
      if (modifier && key === "d") {
        event.preventDefault();
        void duplicateSelectedClips();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelectedClips();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void nudgeSelectedClips(event.shiftKey ? -1 : -0.1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void nudgeSelectedClips(event.shiftKey ? 1 : 0.1);
      }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleDawKeyDown);
    return () => window.removeEventListener("keydown", handleDawKeyDown);
  }, []);

  return (
    <div
      ref={workspaceRef}
      className={`daw-studio-workspace tool-${activeTool}`}
      data-studio-theme={studioTheme}
      data-render-quality={renderQuality}
      data-performance-preference={performancePreference}
      data-realtime-active={realtimeActive ? "true" : "false"}
      data-recording-active={recordingStatus !== "idle" ? "true" : "false"}
      data-testid="daw-studio-workspace"
      onPointerMove={handleGlassPointerMove}
      onPointerDown={handleGlassPointerDown}
    >
      <header className="daw-studio-header">
        <div className="daw-studio-title">
          <Link className="daw-studio-back" href="/daw" aria-label="回到 DAW 專案" title="回到 DAW 專案">
            <RotateCcw size={17} />
          </Link>
          <span>
            <small>頌祖 DAW Core · 錄音室</small>
            <strong>{project.song.title}</strong>
            <em>{project.title}</em>
          </span>
          <i className={`daw-save-state ${saveState}`}>{saveState === "saving" ? "儲存中" : saveState === "error" ? "未儲存" : "已儲存"}</i>
        </div>
        <div className="daw-studio-stats" aria-label="專案規格">
          <span className={engineStatus?.mode === "native_service" ? "live" : ""}>
            <Radio size={13} />
            <strong>{engineStatus?.mode === "native_service" ? "原生" : "Web"}</strong>
          </span>
          <span className="daw-performance-status" title={`畫面效能：${performanceReason}`}>
            <Gauge size={13} />
            <strong>{performancePreference === "auto" ? `自動 · ${DAW_PERFORMANCE_LABELS[renderQuality]}` : DAW_PERFORMANCE_LABELS[renderQuality]}</strong>
          </span>
          <span>
            <strong>{project.sampleRate / 1000}k / {project.bitDepth}</strong>
            WAV
          </span>
          <span>
            <strong>{project.tracks.length}</strong>
            音軌
          </span>
        </div>
        <div className="daw-studio-actions">
          <Link className="daw-header-action" href={`/songs/${project.songId}`} title="回作品資料">
            <Archive size={16} />
            <span>作品</span>
          </Link>
          <button className="daw-header-action" type="button" onClick={saveSnapshot} title="儲存混音快照">
            <Save size={16} />
            <span>快照</span>
          </button>
          <button className="daw-header-action" type="button" onClick={exportProjectFile} disabled={exportBusy === "project-file"} title="匯出專案檔">
            <FileJson size={16} />
            <span>專案</span>
          </button>
          <details className="daw-theme-menu" data-testid="daw-theme-picker">
            <summary className="daw-theme-trigger" title="更換錄音室主題">
              <Palette size={16} aria-hidden="true" />
              <span className="daw-theme-trigger-copy">
                <small>主題</small>
                <strong>{DAW_STUDIO_THEME_LABELS[studioTheme]}</strong>
              </span>
              <i className={`daw-theme-swatch ${studioTheme}`} aria-hidden="true" />
              <ChevronDown className="daw-theme-chevron" size={14} aria-hidden="true" />
            </summary>
            <div className="daw-theme-popover" role="group" aria-label="選擇錄音室主題">
              <div className="daw-theme-popover-heading">
                <span>
                  <small>錄音室外觀</small>
                  <strong>選擇主題</strong>
                </span>
                <Palette size={17} aria-hidden="true" />
              </div>
              {([
                ["emerald", "翡翠玻璃", "清透翡翠"],
                ["crimson", "緋紅暗室", "深紅低光"],
                ["amethyst", "紫曜晶殿", "紫晶鉑金"],
                ["cyberpunk", "賽博龐克", "霓虹粉青"]
              ] as const).map(([themeId, themeName, themeTone]) => (
                <button
                  className={`daw-theme-option ${themeId} ${studioTheme === themeId ? "active" : ""}`}
                  type="button"
                  onClick={(event) => {
                    changeStudioTheme(themeId);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                  aria-label={`使用${themeName}主題`}
                  aria-pressed={studioTheme === themeId}
                  data-testid={`daw-theme-${themeId}`}
                  key={themeId}
                >
                  <i className={`daw-theme-swatch ${themeId}`} aria-hidden="true" />
                  <span>
                    <strong>{themeName}</strong>
                    <small>{themeTone}</small>
                  </span>
                  <i className="daw-theme-selected" aria-hidden="true">
                    {studioTheme === themeId ? <Check size={15} /> : null}
                  </i>
                </button>
              ))}
              <div className="daw-performance-picker">
                <span>
                  <small>畫面效能</small>
                  <strong>{performancePreference === "auto" ? `自動使用${DAW_PERFORMANCE_LABELS[renderQuality]}` : DAW_PERFORMANCE_LABELS[renderQuality]}</strong>
                </span>
                <div role="group" aria-label="選擇 DAW 畫面效能">
                  {(["auto", "quality", "balanced", "economy"] as const).map((mode) => (
                    <button
                      className={performancePreference === mode ? "active" : ""}
                      type="button"
                      onClick={() => changePerformancePreference(mode)}
                      aria-pressed={performancePreference === mode}
                      data-testid={`daw-performance-${mode}`}
                      key={mode}
                    >
                      {DAW_PERFORMANCE_LABELS[mode]}
                    </button>
                  ))}
                </div>
                <p>{performancePreference === "auto" ? performanceReason : "手動模式會保留到下次開啟。錄音時仍會暫停裝飾動畫。"}</p>
              </div>
            </div>
          </details>
          <button className="daw-header-action primary" type="button" onClick={renderMixdown} title="輸出混音 WAV">
            <Download size={16} />
            <span>輸出</span>
          </button>
        </div>
        {studioNotice ? <div className="daw-studio-notice" role="status">{studioNotice}</div> : null}
      </header>

      <section className="daw-console" aria-label="播放與錄音控制">
        <div className="daw-console-left">
          <button className="daw-transport-button" type="button" onClick={() => stopPlayback()} aria-label="回到開頭" title="回到開頭">
            <RotateCcw size={17} />
          </button>
          <button className="daw-transport-button" type="button" onClick={() => stopPlayback(false)} aria-label="停止" title="停止並保留播放頭">
            <CircleStop size={17} />
          </button>
          <button
            className={isPlaying ? "daw-transport-button primary" : "daw-transport-button"}
            type="button"
            onClick={isPlaying ? () => stopPlayback(false) : () => void playTimeline()}
            aria-label={isPlaying ? "暫停" : "播放"}
            title={isPlaying ? "暫停" : "播放"}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            className={recordingStatus === "recording" || recordingStatus === "counting" ? "daw-transport-button record active" : "daw-transport-button record"}
            type="button"
            onClick={recordingStatus === "recording" ? stopDawRecording : recordingStatus === "counting" ? cancelDawRecordingPreparation : startDawRecording}
            aria-label={recordingStatus === "recording" ? "停止錄音" : recordingStatus === "counting" ? "取消倒數" : "開始錄音"}
            title={recordingStatus === "recording" ? "停止錄音" : recordingStatus === "counting" ? "取消倒數" : "開始錄音"}
            disabled={!selectedTrack || recordingStatus === "saving" || recordingStatus === "analyzing"}
          >
            <span className="daw-record-dot" />
          </button>
        </div>
        <div className="daw-time-display" aria-label="播放位置">
          <strong ref={transportPositionLabelRef}>{transportPosition}</strong>
          <span ref={transportTimeLabelRef}>{formatTime(transportTime)} · 小節 / 拍 / tick</span>
        </div>
        <div className="daw-project-lcd">
          <label>
            <input
              aria-label="專案 BPM"
              inputMode="numeric"
              min="20"
              max="300"
              type="number"
              value={projectBpmDraft}
              onChange={(event) => setProjectBpmDraft(event.target.value)}
              onBlur={commitProjectBpm}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
            <small>BPM</small>
          </label>
          <label>
            <select
              aria-label="專案拍號"
              value={projectTimeSignatureDraft}
              onChange={(event) => {
                setProjectTimeSignatureDraft(event.target.value);
                commitProjectTimeSignature(event.target.value);
              }}
            >
              <option value="4/4">4/4</option>
              <option value="3/4">3/4</option>
              <option value="6/8">6/8</option>
              <option value="2/4">2/4</option>
              <option value="5/4">5/4</option>
            </select>
            <small>拍號</small>
          </label>
          <label>
            <input
              aria-label="專案調性"
              value={projectKeyDraft}
              onChange={(event) => setProjectKeyDraft(event.target.value)}
              onBlur={commitProjectKey}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
            <small>調性</small>
          </label>
        </div>
        {rhythmCalibration ? (
          <div className="daw-rhythm-lock" title={`標準 ${project.timeSignature} · 每小節 ${metronomeClicksPerBar} 拍 · 第一個強拍 ${rhythmCalibration.firstDownbeatSeconds.toFixed(2)} 秒 · 校準 ${Math.round(smartMetronome.offsetSeconds * 1000)} ms`}>
            <Radio size={14} />
            <span><strong>{metronomeClicksPerBar}</strong><small>拍 / 小節</small></span>
          </div>
        ) : null}
        <div className="daw-console-tools">
          <button className={libraryOpen ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setLibraryOpen((value) => !value)} title={libraryOpen ? "隱藏錄音來源" : "顯示錄音來源"}>
            <PanelLeftClose size={15} />
            <span>音源</span>
          </button>
          <div className="daw-metronome-control" data-enabled={metronomeEnabled ? "true" : "false"}>
            <button className={metronomeEnabled ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setMetronomeEnabled((value) => !value)} title={metronomeEnabled ? "關閉節拍器" : "開啟節拍器"}>
              <Ruler size={15} />
              <span>節拍器</span>
            </button>
            <select
              className="daw-metronome-select"
              aria-label="節拍器音色"
              title={selectedMetronomeSound.description}
              value={metronomeSound}
              onChange={(event) => changeMetronomeSound(event.target.value)}
            >
              {METRONOME_SOUND_GROUPS.map((group) => (
                <optgroup label={group} key={group}>
                  {METRONOME_SOUND_OPTIONS.filter((option) => option.group === group).map((option) => (
                    <option value={option.id} key={option.id}>{option.shortLabel}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              className="daw-metronome-rate-select"
              aria-label="節拍器提示密度"
              title={`歌曲基準 ${effectiveBpm.toFixed(2)} BPM · ${project.timeSignature} · 每小節 ${metronomeClicksPerBar} 聲`}
              value={smartMetronome.rate}
              onChange={(event) => changeSmartMetronomeRate(event.target.value)}
            >
              {SMART_METRONOME_RATE_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <label className="daw-metronome-volume" title={`節拍器音量 ${Math.round(metronomeVolume * 100)}%`}>
              <Volume2 size={13} aria-hidden="true" />
              <input
                type="range"
                min="0.25"
                max="1.5"
                step="0.05"
                value={metronomeVolume}
                onChange={(event) => changeMetronomeVolume(Number(event.target.value))}
                aria-label="節拍器音量"
              />
              <span>{Math.round(metronomeVolume * 100)}%</span>
            </label>
            <button className="daw-tool icon-only daw-metronome-preview" type="button" onClick={() => void previewSelectedMetronomeSound()} aria-label={`試聽${selectedMetronomeSound.label}`} title={`試聽${selectedMetronomeSound.label}`}>
              <Volume2 size={15} />
            </button>
          </div>
          <button className="daw-tool" type="button" onClick={tapTempo} title="依點擊速度設定 BPM">
            <TimerReset size={15} />
            <span>Tap</span>
          </button>
          <button className={loopEnabled ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setLoopEnabled((value) => !value)} title="循環播放">
            <RotateCcw size={15} />
            <span>循環</span>
          </button>
          <button className={snapEnabled ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setSnapEnabled((value) => !value)} title="吸附到拍點">
            <Magnet size={15} />
            <span>吸附</span>
          </button>
          <button className={activeTool === "select" ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setActiveTool("select")} title="選取工具">
            <MousePointer2 size={15} />
            <span>選取</span>
          </button>
          <button className={activeTool === "split" ? "daw-tool active" : "daw-tool"} type="button" onClick={() => setActiveTool((value) => value === "split" ? "select" : "split")} title="切分工具：點擊片段進行切分">
            <Scissors size={15} />
            <span>切分</span>
          </button>
          <button className="daw-tool" type="button" onClick={() => void addQuickMarker()} title="在播放頭新增標記">
            <MapPin size={15} />
            <span>標記</span>
          </button>
          <button className="daw-tool icon-only" type="button" aria-label="縮小時間軸" title="縮小時間軸" disabled={zoom <= 0.65} onClick={() => setZoom((value) => Math.max(0.65, Number((value / 1.4).toFixed(2))))}>
            <ZoomOut size={15} />
          </button>
          <button className="daw-tool icon-only" type="button" aria-label="放大時間軸" title="放大時間軸" disabled={zoom >= 16} onClick={() => setZoom((value) => Math.min(16, Number((value * 1.4).toFixed(2))))}>
            <ZoomIn size={15} />
          </button>
          <label className="daw-waveform-scale" title="波形顯示倍率，不改變播放或錄音音量">
            <AudioLines size={15} aria-hidden="true" />
            <input type="range" min="1" max="4" step="0.25" value={waveformDisplayGain} onChange={event => setWaveformDisplayGain(Number(event.target.value))} aria-label="波形顯示倍率" />
            <output>{waveformDisplayGain.toFixed(waveformDisplayGain % 1 ? 2 : 0)}x</output>
          </label>
          {waveformHasErrors ? (
            <button className="daw-tool icon-only" type="button" title="重新載入失敗的波形" aria-label="重新載入失敗的波形" disabled={realtimeActive} onClick={retryWaveforms}>
              <RefreshCw size={15} />
            </button>
          ) : null}
        </div>
      </section>

      <div className={libraryOpen ? "daw-studio-main" : "daw-studio-main library-hidden"}>
        <aside className="daw-library-pane" aria-label="音軌與音色資料庫">
          <div className="daw-pane-heading">
            <span>資料庫</span>
            <strong>新增錄音軌</strong>
            <small>先選來源，再按 + 建立音軌。</small>
          </div>
          <section className="daw-recording-modebar" aria-label="錄音軌快速設定">
            {recordingModes.map((mode) => (
              <div className={selectedTrack?.trackType === mode.trackType ? "daw-recording-mode active" : "daw-recording-mode"} key={mode.id}>
                <button type="button" onClick={() => applyRecordingMode(mode)}>
                  <i className="daw-mode-icon" aria-hidden="true">
                    {mode.id === "vocal" ? <Mic2 size={17} /> : mode.id === "guitar" ? <Guitar size={17} /> : mode.id === "piano" ? <Piano size={17} /> : <Music2 size={17} />}
                  </i>
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.input}</small>
                  </span>
                </button>
                <button
                  className="daw-mode-add"
                  type="button"
                  onClick={() => createRecordingTrack(mode)}
                  title={`新增 ${mode.label} 錄音軌`}
                  aria-label={`新增 ${mode.label} 錄音軌`}
                >
                  <Plus size={14} />
                </button>
              </div>
            ))}
          </section>
          <div className="daw-library-shortcuts" aria-label="控制器快捷鍵">
            <button type="button" onClick={() => setActiveRackTab("sounds")}>
              <Waves size={15} />
              音色與預設
            </button>
            <button type="button" onClick={() => setActiveRackTab("recording")}>
              <Mic2 size={15} />
              輸入與監聽
            </button>
            <button type="button" onClick={() => setActiveRackTab("effects")}>
              <SlidersHorizontal size={15} />
              EQ 與效果
            </button>
            <button type="button" onClick={() => setActiveRackTab("ai")}>
              <Gauge size={15} />
              AI 錄音偵測
            </button>
          </div>
          <div className={`daw-library-signal ${recordingSignal.status}`}>
            <span>輸入訊號</span>
            <strong>{recordingPeakDb === null ? "-- dBFS" : `${recordingPeakDb.toFixed(1)} dBFS`}</strong>
            <i><b style={{ width: "var(--daw-record-level, 0%)" }} /></i>
            <small>{recordingSignal.label}</small>
          </div>
        </aside>

        <div className="daw-arrangement-pane">
      <section className="daw-edit-strip">
        <div className="daw-edit-actions">
          <button type="button" onClick={selectAllClips} disabled={!allClips.length}>
            全選
          </button>
          <button type="button" onClick={copySelectedClips} disabled={!selectedClipItems.length && !selectedClip}>
            <Copy size={14} />
            複製
          </button>
          <button type="button" onClick={pasteClipsAtPlayhead} disabled={!clipClipboard.length || !selectedTrack}>
            <ClipboardPaste size={14} />
            貼上
          </button>
          <button type="button" onClick={duplicateSelectedClips} disabled={!selectedClipItems.length && !selectedClip}>
            重複
          </button>
          <button className="danger" type="button" onClick={deleteSelectedClips} disabled={!selectedClipItems.length && !selectedClip}>
            <Trash2 size={14} />
            刪除
          </button>
        </div>
        <div className="daw-loop-controls">
          <button className={loopEnabled ? "active" : ""} type="button" onClick={() => setLoopEnabled((value) => !value)}>
            循環 {loopEnabled ? "開" : "關"}
          </button>
          <label>
            起點
            <input className="input" type="number" min="0" step="0.1" value={loopStart} onChange={(event) => setLoopStart(snapTimelineSeconds(Number(event.target.value)))} />
          </label>
          <button type="button" onClick={() => setLoopStart(snapTimelineSeconds(transportVisualTimeRef.current))}>
            設起點
          </button>
          <label>
            終點
            <input className="input" type="number" min="0" step="0.1" value={loopEnd} onChange={(event) => setLoopEnd(snapTimelineSeconds(Number(event.target.value)))} />
          </label>
          <button type="button" onClick={() => setLoopEnd(snapTimelineSeconds(Math.max(transportVisualTimeRef.current, loopStart + 0.1)))}>
            設終點
          </button>
        </div>
      </section>

      <section className="daw-session-strip">
        <span className={recordStandby ? "recording" : ""}>錄音待命 {recordStandby ? "開" : "關"}</span>
        <span>節拍器 {metronomeEnabled ? `開 · ${selectedMetronomeSound.shortLabel}${rhythmCalibration ? ` · ${selectedSmartMetronomeRate.label} · ${metronomeClicksPerBar} 聲/小節` : ""}` : "關"}</span>
        {rhythmCalibration ? <span>歌曲基準 {rhythmCalibration.bpm.toFixed(2)} BPM · 每分鐘 {metronomeClickBpm.toFixed(2)} 拍 · 強拍 {formatTime(rhythmCalibration.firstDownbeatSeconds)} · 校準 {Math.round(smartMetronome.offsetSeconds * 1000)} ms</span> : null}
        <span>循環 {loopEnabled ? "開" : "關"}</span>
        <span>吸附 {snapEnabled ? (beatDurationSeconds > 0 ? `${beatDurationSeconds.toFixed(2)} 秒` : "開") : "關"}</span>
        <span>選取 {selectedClipItems.length || (selectedClip ? 1 : 0)}</span>
        <span>剪貼簿 {clipClipboard.length}</span>
        <span className={recordingStatus === "recording" ? "recording" : ""}>錄音狀態 {recordingStatus}</span>
        {recordingLimitNotice ? <span role="status">{recordingLimitNotice}</span> : null}
        <span>獨奏 {soloTrackCount}</span>
        <span>靜音 {mutedTrackCount}</span>
        <span>縮放 {Math.round(zoom * 100)}%</span>
      </section>

      <section className="daw-detail-layout">
        <div className="panel daw-timeline-panel">
          <div className="daw-timeline-header">
            <div>
              <h2>音軌時間軸</h2>
              <p className="muted">錄音、音訊片段、標記與錄音層都採非破壞性編輯，原始音檔不會被覆蓋。</p>
            </div>
            <div className="tag-row">
              <span className="tag">{project.tracks.length} 音軌</span>
              <span className="tag">{allClips.length} 片段</span>
              {scoreGuideLaneCount ? <span className="tag">{scoreGuideLaneCount} 採譜導引</span> : null}
              <span className="tag">{project.markers.length} 標記</span>
            </div>
          </div>
          <div className="daw-punch-editor">
            <button className={punchEnabled ? "active" : ""} type="button" onClick={() => setPunchEnabled((current) => !current)}>
              <Ruler size={15} />
              定點重錄 {punchEnabled ? "開" : "關"}
            </button>
            <label>
              起點
              <input className="input" type="number" min="0" step="0.1" value={punchIn} onChange={(event) => setPunchIn(snapSeconds(Number(event.target.value)))} />
            </label>
            <button className="ghost" type="button" onClick={() => setPunchIn(snapSeconds(transportVisualTimeRef.current))}>
              設起點
            </button>
            <label>
              終點
              <input className="input" type="number" min="0" step="0.1" value={punchOut} onChange={(event) => setPunchOut(snapSeconds(Number(event.target.value)))} />
            </label>
            <button className="ghost" type="button" onClick={() => setPunchOut(snapSeconds(Math.max(transportVisualTimeRef.current, punchIn + 0.1)))}>
              設終點
            </button>
            <span>{punchRangeValid ? `${formatTime(punchIn)} - ${formatTime(punchOut)}` : "請設定有效區間"}</span>
          </div>
          <div
            className="daw-timeline-scroll"
            onScroll={(event) => {
              // Keep scrolling lanes out of the translucent, fixed control column.
              const timeline = event.currentTarget;
              timeline.style.setProperty("--daw-timeline-scroll-left", `${Math.max(0, timeline.scrollLeft)}px`);
            }}
          >
            <div className="daw-ruler" style={timelineWidthStyle}>
              <div className="daw-ruler-corner">
                <span>{snapEnabled ? "吸附拍點" : "自由移動"}</span>
                <strong>{Math.round(zoom * 100)}%</strong>
              </div>
              <div className="daw-ruler-lane" onPointerDown={(event) => seekTimelineFromPointer(event)}>
                {loopRangeValid ? (
                  <div
                    className={loopEnabled ? "daw-loop-range active" : "daw-loop-range"}
                    style={{ left: `${loopStartPercent}%`, width: `${loopWidthPercent}%` }}
                  >
                    <span>循環</span>
                  </div>
                ) : null}
                {punchRangeValid ? (
                  <div
                    className={punchEnabled ? "daw-punch-range active" : "daw-punch-range"}
                    style={{ left: `${punchStartPercent}%`, width: `${punchWidthPercent}%` }}
                  >
                    <span>重錄</span>
                  </div>
                ) : null}
                <div className="daw-playhead" />
                {rulerTicks.map((tick) => (
                  <span className="daw-ruler-tick" key={tick.key} style={{ left: `${Math.min(100, (tick.seconds * 100) / timelineDuration)}%` }}>
                    <strong>{tick.label}</strong>
                    <small>{formatTime(tick.seconds)}</small>
                  </span>
                ))}
                {project.markers.map((marker) => (
                  <button
                    className="daw-marker"
                    key={marker.id}
                    style={{ left: `${Math.min(99, (marker.timestampSeconds * 100) / timelineDuration)}%` }}
                    type="button"
                    title={`${markerLabel(marker.markerType)} · ${marker.label}`}
                    onClick={() => setTransportTime(marker.timestampSeconds)}
                  >
                    <MapPin size={13} />
                    {marker.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="daw-track-stack" style={timelineWidthStyle}>
              {project.tracks.map((track) => (
                <div
                  className={selectedTrack?.id === track.id ? "daw-track-row selected" : "daw-track-row"}
                  key={track.id}
                  onClick={() => setSelectedTrackId(track.id)}
                >
                  <div className="daw-track-label" style={{ borderColor: track.color ?? "var(--line)" }}>
                    <div className="daw-track-title">
                      <strong>{track.name}</strong>
                      <span>{track.trackType}</span>
                    </div>
                    <div className="daw-track-controls" onClick={(event) => event.stopPropagation()}>
                      <button className={track.armed ? "active rec" : ""} type="button" onClick={() => void toggleTrackControl(track, "armed")} title={`R 錄音待命 · ${track.armed ? "開" : "關"}`} aria-label={`${track.name} R 錄音待命`} aria-pressed={track.armed} data-control="armed">
                        R
                      </button>
                      <button className={track.monitoring ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "monitoring")} title={`I 輸入監聽 · ${track.monitoring ? "開" : "關"}`} aria-label={`${track.name} I 輸入監聽`} aria-pressed={track.monitoring} data-control="monitoring">
                        I
                      </button>
                      <button className={track.muted ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "muted")} title={`M 靜音 · ${track.muted ? "開" : "關"}`} aria-label={`${track.name} M 靜音`} aria-pressed={track.muted} data-control="muted">
                        M
                      </button>
                      <button className={track.solo ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "solo")} title={`S 獨奏 · ${track.solo ? "開" : "關"}`} aria-label={`${track.name} S 獨奏`} aria-pressed={track.solo} data-control="solo">
                        S
                      </button>
                    </div>
                    <div className="daw-mini-meter" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.round(track.volume * 64 + track.clips.length * 8))}%` }} />
                    </div>
                  </div>
                  <div className="daw-clip-lane" onPointerDown={(event) => seekTimelineFromPointer(event, track.id)}>
                    {loopRangeValid && loopEnabled ? (
                      <div className="daw-loop-lane-range" style={{ left: `${loopStartPercent}%`, width: `${loopWidthPercent}%` }} />
                    ) : null}
                    {punchRangeValid && punchEnabled ? (
                      <div className="daw-punch-lane-range" style={{ left: `${punchStartPercent}%`, width: `${punchWidthPercent}%` }} />
                    ) : null}
                    <div className="daw-lane-playhead" />
                    {track.clips.map((clip) => {
                      const trimPreview = trimmingClip?.clipId === clip.id ? trimmingClip : null;
                      const displayDuration = trimPreview?.durationSeconds ?? getClipDuration(clip);
                      const width = (displayDuration * 100) / timelineDuration;
                      const displayStart = trimPreview?.startSeconds ?? (dragPreview?.clipId === clip.id ? dragPreview.startSeconds : clip.startSeconds);
                      const left = Math.max(0, (displayStart * 100) / timelineDuration);
                      const waveform = waveformsByAudioFileId[clip.audioFileId];
                      const waveformOffset = trimPreview?.offsetSeconds ?? clip.offsetSeconds;
                      const clipWaveform = waveform?.status === "ready" ? dawWaveformWindow(
                        waveform,
                        waveformOffset,
                        displayDuration,
                        dawWaveformPointCount(width / 100 * timelineLaneWidth, renderQuality)
                      ) : [];
                      const waveformPath = dawWaveformPath(clipWaveform, waveformDisplayGain);
                      const waveformStatus = waveform?.status ?? (realtimeActive ? "waiting" : "loading");
                      const clipSelected = selectedClip?.id === clip.id || selectedClipSet.has(clip.id);
                      return (
                        <button
                          className={[
                            "daw-clip",
                            clipSelected ? "selected" : "",
                            draggingClipId === clip.id ? "dragging" : "",
                            trimPreview ? `trimming ${trimPreview.side}` : "",
                            clip.locked ? "locked" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={clip.id}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: "1px",
                            borderColor: clip.color ?? track.color ?? "var(--accent)",
                            "--clip-color": clip.color ?? track.color ?? "#2ca083"
                          } as CSSProperties}
                          type="button"
                          title={clip.locked ? "已鎖定，解除鎖定後才能拖動" : activeTool === "split" ? "點擊此處切分片段" : "拖動可移動片段"}
                          onPointerDown={(event) => startClipDrag(event, track, clip)}
                          onPointerMove={moveClipDrag}
                          onPointerUp={(event) => endClipDrag(event, clip)}
                          onPointerCancel={(event) => endClipDrag(event, clip)}
                          onClick={(event) => {
                            handleClipClick(event, track, clip);
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="daw-trim-handle start"
                            onPointerDown={(event) => startClipTrim(event, clip, "start")}
                            onPointerMove={moveClipTrim}
                            onPointerUp={(event) => endClipTrim(event, clip)}
                            onPointerCancel={(event) => endClipTrim(event, clip)}
                          />
                          <span className="daw-clip-label">{clip.label ?? clip.audioFile.fileName}</span>
                          <span className={waveform?.status === "ready" ? "daw-clip-waveform" : "daw-clip-waveform is-empty"} data-waveform-status={waveformStatus} data-waveform-points={clipWaveform.length} data-waveform-message={waveformStatus === "error" ? "波形讀取失敗" : waveformStatus === "unavailable" ? "音檔不可讀取" : waveformStatus === "waiting" ? "波形待載入" : "波形載入中"} aria-hidden="true">
                            {waveformPath ? (
                              <svg viewBox={`0 0 ${Math.max(1, clipWaveform.length - 1)} 100`} preserveAspectRatio="none">
                                <path d={waveformPath} />
                              </svg>
                            ) : null}
                          </span>
                          <small>
                            {formatTime(displayDuration)}
                            {trimPreview ? ` · ${formatTime(trimPreview.offsetSeconds)}` : ""}
                          </small>
                          <span
                            aria-hidden="true"
                            className="daw-trim-handle end"
                            onPointerDown={(event) => startClipTrim(event, clip, "end")}
                            onPointerMove={moveClipTrim}
                            onPointerUp={(event) => endClipTrim(event, clip)}
                            onPointerCancel={(event) => endClipTrim(event, clip)}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <DawScoreTimelineTracks
                projectId={project.id}
                timelineDuration={timelineDuration}
                onSeek={(seconds) => {
                  paintTransportVisual(seconds);
                  setTransportTime(seconds);
                }}
              />
            </div>
          </div>
        </div>
      </section>
        </div>
      </div>

      <section className="daw-control-dock" aria-label="音軌控制器">
        <aside className="daw-rack stack">
          <div className="daw-rack-top">
            <div>
              <span className="eyebrow">錄音通道</span>
              <h2>{selectedTrack?.name ?? "尚未選取音軌"}</h2>
              <p>{selectedTrack ? `${trackTypeLabel(selectedTrack.trackType)} · ${selectedTrackSettings.instrumentPreset}` : "先建立 vocal、guitar、piano 或 bass 錄音軌。"}</p>
            </div>
            <button
              className={recordStandby ? "daw-rec-button active wide" : "daw-rec-button wide"}
              type="button"
              onClick={toggleRecordStandby}
            >
              <Mic2 size={16} />
              {recordStandby ? "待錄中" : "錄音待命"}
            </button>
          </div>

          <div className="daw-rack-tabs" role="tablist" aria-label="錄音控制分頁">
            {RACK_TABS.map(([value, label]) => (
              <button
                className={activeRackTab === value ? "active" : ""}
                key={value}
                type="button"
                onClick={() => setActiveRackTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeRackTab === "recording" ? (
            <div className="daw-rack-panel">
              {selectedTrack ? (
                <>
                  <div className="daw-track-identity-editor">
                    <label className="field">
                      <span>音軌名稱</span>
                      <input
                        className="input"
                        value={selectedTrackNameDraft}
                        onChange={(event) => setSelectedTrackNameDraft(event.target.value)}
                        onBlur={() => void commitSelectedTrackName()}
                        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                      />
                    </label>
                    <label className="daw-track-color" title="音軌顏色">
                      <input type="color" value={selectedTrack.color ?? "#218a75"} onChange={(event) => void patchTrack(selectedTrack, { color: event.target.value })} />
                      <span style={{ background: selectedTrack.color ?? "#218a75" }} />
                    </label>
                    <button className="daw-icon-button" type="button" onClick={() => void duplicateSelectedTrack()} title="複製音軌" aria-label="複製音軌">
                      <Copy size={15} />
                    </button>
                    <button className="daw-icon-button danger" type="button" onClick={() => void deleteSelectedTrack()} title="刪除音軌" aria-label="刪除音軌">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="daw-switch-grid">
                    <button className={selectedTrack.armed ? "active rec" : ""} type="button" onClick={() => void toggleTrackControl(selectedTrack, "armed")} aria-label={`${selectedTrack.name} R 錄音待命`} aria-pressed={selectedTrack.armed} data-control="armed">
                      R 錄音
                    </button>
                    <button className={selectedTrack.monitoring ? "active" : ""} type="button" onClick={() => void toggleTrackControl(selectedTrack, "monitoring")} aria-label={`${selectedTrack.name} I 輸入監聽`} aria-pressed={selectedTrack.monitoring} data-control="monitoring">
                      I 監聽
                    </button>
                    <button className={selectedTrack.muted ? "active" : ""} type="button" onClick={() => void toggleTrackControl(selectedTrack, "muted")} aria-label={`${selectedTrack.name} M 靜音`} aria-pressed={selectedTrack.muted} data-control="muted">
                      M 靜音
                    </button>
                    <button className={selectedTrack.solo ? "active" : ""} type="button" onClick={() => void toggleTrackControl(selectedTrack, "solo")} aria-label={`${selectedTrack.name} S 獨奏`} aria-pressed={selectedTrack.solo} data-control="solo">
                      S 獨奏
                    </button>
                  </div>
	                  <div className="daw-channel-readout">
	                    <span>
	                      <strong>{Math.round(selectedTrackSettings.inputGain * 100)}%</strong>
	                      軟體修整
                    </span>
                    <span>
                      <strong>{Math.round(selectedTrackSettings.monitorLevel * 100)}%</strong>
                      監聽
                    </span>
                    <span>
                      <strong>{Math.round(selectedTrack.volume * 100)}%</strong>
                      音量
                    </span>
                    <span>
                      <strong>{selectedTrack.pan.toFixed(2)}</strong>
	                      聲像
	                    </span>
	                  </div>
                  <div className="daw-record-setup">
                    <div className="daw-record-setup-head">
                      <span>
                        <strong>輸入與錄音方式</strong>
                        <small>{captureEngine === "native_wav" ? "CoreAudio · 24-bit WAV" : "Web Audio 備援模式"}</small>
                      </span>
                      <button className="daw-icon-button" type="button" onClick={refreshDeviceStatus} title="重新整理錄音裝置" aria-label="重新整理錄音裝置">
                        <RotateCcw size={15} />
                      </button>
                    </div>
                    <div className="daw-record-option-row">
                      <span>錄音引擎</span>
                      <div className="daw-segmented" role="group" aria-label="錄音引擎">
                        <button
                          className={captureEngine === "native_wav" ? "active" : ""}
                          type="button"
                          onClick={() => { stopInputMonitoring(); setSelectedInputDeviceId("default"); setSelectedOutputDeviceId("default"); setInputChannelStart(0); setCaptureEngine("native_wav"); }}
                          disabled={recordingBusy || !nativeEngineAvailable}
                          title={nativeEngineAvailable ? "使用桌面原生 24-bit WAV 錄音" : "只在桌面 App 可用"}
                        >
                          原生 WAV
                        </button>
                        <button className={captureEngine === "web" ? "active" : ""} type="button" onClick={() => { stopInputMonitoring(); setSelectedInputDeviceId("default"); setSelectedOutputDeviceId("default"); setInputChannelStart(0); setCaptureEngine("web"); }} disabled={recordingBusy}>
                          Web 備援
                        </button>
                      </div>
                    </div>
                    <label className="field">
                      <span>{captureEngine === "native_wav" ? "CoreAudio 輸入" : "瀏覽器音訊輸入"}</span>
                      <select className="input" aria-label={captureEngine === "native_wav" ? "CoreAudio 輸入" : "瀏覽器音訊輸入"} value={selectedInputDeviceId} onChange={(event) => { stopInputMonitoring(); setInputChannelStart(0); setSelectedInputDeviceId(event.target.value); }} disabled={recordingBusy}>
                        {selectedInputDeviceId !== "default" && !selectedInputDevice ? <option value={selectedInputDeviceId}>已離線：{selectedInputDeviceId}</option> : null}
                        {captureEngine === "web" || !inputDevices.length ? <option value="default">{captureEngine === "native_wav" ? "尚未找到錄音裝置" : "系統預設輸入"}</option> : null}
                        {inputDevices.filter((device) => captureEngine !== "web" || deviceKey(device) !== "default").map((device, index) => (
                          <option key={`${deviceKey(device)}-${index}`} value={deviceKey(device)}>
                            {device.label || device.name || `輸入 ${index + 1}`}{device.isDefault ? " · 預設" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="daw-record-option-row">
                      <span>聲道</span>
                      <div className="daw-segmented" role="group" aria-label="錄音聲道">
                        {(["mono", "stereo"] as DawChannelMode[]).map((mode) => (
                          <button className={channelMode === mode ? "active" : ""} key={mode} type="button" onClick={() => { stopInputMonitoring(); setInputChannelStart(0); setChannelMode(mode); }} disabled={recordingBusy}>
                            {mode === "mono" ? "單聲道" : "立體聲"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="field">
                      <span>獨立輸入聲道</span>
                      <select className="input" aria-label="獨立輸入聲道" value={inputChannelStart} disabled={recordingBusy}
                        onChange={(event) => { stopInputMonitoring(); setInputChannelStart(Number(event.target.value)); }}>
                        {Array.from({ length: inputChannelOptions }, (_, index) => (
                          <option value={index} key={index}>Input {index + 1}{channelMode === "stereo" ? ` + ${index + 2}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    <div className="daw-record-option-row">
                      <span>倒數</span>
                      <div className="daw-segmented" role="group" aria-label="錄音倒數小節">
                        {([0, 1, 2, 4] as DawCountInBars[]).map((bars) => (
                          <button className={countInBars === bars ? "active" : ""} key={bars} type="button" onClick={() => setCountInBars(bars)} disabled={recordingBusy}>
                            {bars === 0 ? "關" : `${bars} 小節`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="daw-record-option-row">
                      <span>模式</span>
                      <div className="daw-segmented" role="group" aria-label="錄音模式">
                        <button className={!punchEnabled ? "active" : ""} type="button" onClick={() => setPunchEnabled(false)} disabled={recordingBusy}>
                          完整 Take
                        </button>
                        <button className={punchEnabled ? "active" : ""} type="button" onClick={() => setPunchEnabled(true)} disabled={recordingBusy}>
                          定點重錄
                        </button>
                      </div>
                    </div>
                    {captureEngine === "native_wav" ? (
                      <div className="daw-native-route">
                        <div className="daw-record-option-row">
                          <span>耳機監聽</span>
                          <div className="daw-segmented" role="group" aria-label="耳機監聽路由">
                            <button className={monitorRoute === "off" ? "active" : ""} type="button" onClick={() => setMonitorRoute("off")} disabled={recordingBusy}>
                              關閉
                            </button>
                            <button className={monitorRoute === "native" ? "active" : ""} type="button" onClick={() => setMonitorRoute("native")} disabled={recordingBusy}>
                              軟體監聽
                            </button>
                            <button className={monitorRoute === "hardware" ? "active" : ""} type="button" onClick={() => setMonitorRoute("hardware")} disabled={recordingBusy}>
                              硬體直通
                            </button>
                          </div>
                        </div>
                        {monitorRoute === "native" ? (
                          <label className="field">
                            <span>耳機輸出</span>
                            <select className="input" value={selectedOutputDeviceId} onChange={(event) => setSelectedOutputDeviceId(event.target.value)} disabled={recordingBusy}>
                              {!outputDevices.length ? <option value="default">尚未找到耳機輸出</option> : null}
                              {outputDevices.map((device, index) => (
                                <option key={`${deviceKey(device)}-${index}`} value={deviceKey(device)}>
                                  {device.label || device.name || `輸出 ${index + 1}`}{device.isDefault ? " · 預設" : ""}
                                </option>
                              ))}
                            </select>
                            <small className="field-help">軟體監聽只能使用耳機，喇叭會造成回授。</small>
                          </label>
                        ) : null}
                        <p className="daw-route-note">
                          {monitorRoute === "hardware"
                            ? "由錄音介面的硬體直通（Direct Monitor）送往耳機，延遲最低；App 不重送聲音。"
                            : monitorRoute === "native"
                              ? "輸入會由 Rust 引擎送往指定耳機，可聽到 App 回送但會受 buffer 延遲影響。"
                              : "不回送輸入聲音，只錄製受保護 WAV。"}
                        </p>
                        <p className="daw-route-note">倒數與節拍器目前跟隨 macOS 系統輸出；錄音前請確認它也通往耳機。</p>
                        <div className="daw-record-option-row">
                          <span>音訊緩衝</span>
                          <div className="daw-segmented" role="group" aria-label="音訊 Buffer">
                            {[64, 128, 256, 512].map((frames) => (
                              <button className={bufferFrames === frames ? "active" : ""} key={frames} type="button" onClick={() => setBufferFrames(frames)} disabled={recordingBusy}>
                                {frames}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="daw-latency-control">
                          <label className="toggle-row">
                            <input type="checkbox" checked={applyLatencyCompensation} onChange={(event) => setApplyLatencyCompensation(event.target.checked)} disabled={recordingBusy} />
                            延遲補償
                          </label>
                          <label>
                            <span>補償值</span>
                            <input className="input" type="number" min="0" max="500" step="0.01" value={latencyCompensationMs} onChange={(event) => setLatencyCompensationMs(clamp(Number(event.target.value), 0, 500))} disabled={recordingBusy || !applyLatencyCompensation} />
                            <em>ms</em>
                          </label>
                          <button className="button ghost" type="button" onClick={runLatencyTest} disabled={recordingBusy}>
                            <Gauge size={15} />
                            估算延遲
                          </button>
                        </div>
                        {latencyMessage ? <p className="daw-route-note">{latencyMessage}</p> : null}
                      </div>
                    ) : null}
                    <div className="daw-record-format">
                      <span>{project.sampleRate / 1000} kHz</span>
                      <span>{captureEngine === "native_wav" ? "24-bit WAV" : "瀏覽器編碼"}</span>
                      <span>{punchEnabled ? `${formatTime(punchIn)} - ${formatTime(punchOut)}` : "完整錄音"}</span>
                      {captureEngine === "native_wav" ? <span>{bufferFrames} frames</span> : null}
                    </div>
                    {punchEnabled && !punchRangeValid ? <p className="error-text">定點重錄區間無效，請在時間軸上重新設定起點與終點。</p> : null}
                  </div>
                  <div className="daw-record-capture">
                    <div className="daw-record-capture-head">
                      <span>
                        <strong>
                          {recordingStatus === "recording"
                            ? <span ref={recordingTimeLabelRef}>0:00</span>
                            : recordingStatus === "counting"
                              ? countInRemainingBeats > 0
                                ? `${countInRemainingBeats} 拍`
                                : "準備進拍"
                              : "錄音擷取"}
                        </strong>
                        <small>
                          {recordingStatus === "recording"
                            ? punchEnabled
                              ? "定點重錄中，抵達終點會自動停止"
                              : "正在錄音"
                            : recordingStatus === "counting"
                              ? "倒數中，先確認耳機與演奏姿勢"
                              : recordingStatus === "saving"
                                ? "保存受保護的錄音版本"
                                : recordingStatus === "analyzing"
                                  ? "本機分析拍點、音準、音量與爆音"
                                  : "確認輸入後開始錄音"}
                        </small>
                      </span>
                      <button
                        className={recordingStatus === "recording" ? "button danger" : "button primary"}
                        type="button"
                        onClick={recordingStatus === "recording" ? stopDawRecording : recordingStatus === "counting" ? cancelDawRecordingPreparation : startDawRecording}
                        disabled={recordingStatus === "saving" || recordingStatus === "analyzing"}
                      >
                        {recordingStatus === "recording" ? <CircleStop size={16} /> : recordingStatus === "counting" ? <CircleStop size={16} /> : <Mic2 size={16} />}
                        {recordingStatus === "recording" ? "停止錄音" : recordingStatus === "counting" ? "取消倒數" : recordingBusy ? "處理中" : "開始錄音"}
                      </button>
                    </div>
                    <div className={`daw-record-meter ${recordingSignal.status}`} aria-label="輸入音量">
                      <span className="target-zone" aria-hidden="true" />
                      <i style={{ width: "var(--daw-record-level, 0%)" }} />
                      <b style={{ left: "var(--daw-record-peak, 0%)" }} aria-hidden="true" />
                    </div>
                    <div className={`daw-record-signal ${recordingSignal.status}`}>
                      <span>
                        <strong>{recordingSignal.label}</strong>
                        <small>{recordingSignal.detail}</small>
                      </span>
                      <em>{recordingPeakDb === null ? "-- dBFS" : `${recordingPeakDb.toFixed(1)} dBFS`}</em>
                    </div>
                    <div className={liveTuner ? "daw-live-tuner active" : "daw-live-tuner"}>
                      <span className="daw-live-tuner-label">
                        <Music2 size={16} />
                        <small>即時調音</small>
                      </span>
                      <strong>{liveTuner ? `${liveTuner.note}${liveTuner.octave}` : captureEngine === "native_wav" ? "錄後分析" : "--"}</strong>
                      <div className="daw-tuner-rail" aria-label={liveTuner ? `音準偏移 ${liveTuner.cents} cents` : "等待可辨識單音"}>
                        <i className="center" aria-hidden="true" />
                        <b style={{ left: `${liveTuner ? clamp(50 + liveTuner.cents, 2, 98) : 50}%` }} aria-hidden="true" />
                      </div>
                      <em>
                        {liveTuner
                          ? `${liveTuner.cents > 0 ? "+" : ""}${liveTuner.cents.toFixed(1)} cents · ${liveTuner.frequencyHz.toFixed(1)} Hz`
                          : captureEngine === "native_wav"
                            ? "WAV 完成後自動判讀"
                            : "等待穩定單音"}
                      </em>
                    </div>
                    <div className="daw-record-meta">
                      <span>音軌：{selectedTrack.name}</span>
                      <span>{captureEngine === "native_wav" ? "原生 WAV" : "Web 備援"}</span>
                      <span>偵測：{dawDetectionMode}</span>
                      <span>節拍器：{metronomeEnabled ? `開 · ${selectedMetronomeSound.label}` : "關"}</span>
                      <span>{channelMode === "mono" ? "Mono" : "Stereo"}</span>
                      <span>
                        伴奏：{overdubCueStatus === "preparing" ? "預載中" : overdubCueStatus === "active" ? `同步 · ${Math.round(recordingCaptureLeadSecondsRef.current * 1000)}ms` : "待命"}
                      </span>
                    </div>
                    <p className="daw-record-hint">
                      {captureEngine === "native_wav"
                        ? "桌面原生模式保存 24-bit WAV；伴奏 cue、延遲與啟動差值會以非破壞性 offset 對齊。"
                        : "Web 備援保存瀏覽器原始 take；伴奏 cue 與錄音起點會自動對齊。每段上限 30 分鐘，到限自動停止並保存。"}
                    </p>
                    {recordingPreviewUrl ? (
                      <CyberAudioPlayer controls src={recordingPreviewUrl} />
                    ) : null}
                    {lastRecordedTakeId ? <p className="muted">最近錄音版本已保存：{lastRecordedTakeId}</p> : null}
                    {recordingError ? <p className="error-text">{recordingError}</p> : null}
	                  </div>
	                  <div className="field">
                    <label>監聽輸入修整 {Math.round(selectedTrackSettings.inputGain * 100)}%</label>
	                    <input className="range" style={rangeStyle(selectedTrackSettings.inputGain, 0, 1.5)} type="range" min="0" max="1.5" step="0.01" value={selectedTrackSettings.inputGain} onChange={(event) => updateStudioSettings({ inputGain: Number(event.target.value) })} />
                      <small className="field-help">這不會改變錄音介面的實體增益；爆音時請調低硬體旋鈕。</small>
                  </div>
                  <div className="field">
                    <label>監聽音量 {Math.round(selectedTrackSettings.monitorLevel * 100)}%</label>
                    <input className="range" style={rangeStyle(selectedTrackSettings.monitorLevel, 0, 1.5)} type="range" min="0" max="1.5" step="0.01" value={selectedTrackSettings.monitorLevel} onChange={(event) => updateStudioSettings({ monitorLevel: Number(event.target.value) })} />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>音量 {selectedTrack.volume.toFixed(2)}</label>
                      <input className="range" style={rangeStyle(selectedTrack.volume, 0, 2)} type="range" min="0" max="2" step="0.01" value={selectedTrack.volume} onChange={(event) => patchTrack(selectedTrack, { volume: Number(event.target.value) })} />
                    </div>
                    <div className="field">
                      <label>聲像 {selectedTrack.pan.toFixed(2)}</label>
                      <input className="range" style={rangeStyle(selectedTrack.pan, -1, 1)} type="range" min="-1" max="1" step="0.01" value={selectedTrack.pan} onChange={(event) => patchTrack(selectedTrack, { pan: Number(event.target.value) })} />
                    </div>
                  </div>
                </>
              ) : (
                <p className="muted">尚未建立錄音軌。請從上方人聲、吉他、鋼琴或貝斯新增。</p>
              )}
            </div>
          ) : null}

          {activeRackTab === "sounds" ? (
            <div className="daw-rack-panel">
              <div className="daw-sound-grid">
                {soundRackItems.slice(0, 12).map((item) => (
                  <button
                    className={selectedSound?.id === item.id ? "daw-sound-pad active" : "daw-sound-pad"}
                    key={item.id}
                    type="button"
                    onClick={() => applySoundToTrack(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.family ?? item.itemTypeLabel}</span>
                    <small>{item.chain.slice(0, 3).join(" · ") || "乾訊號"}</small>
                  </button>
                ))}
              </div>
              <Link className="button ghost" href="/sounds">
                開啟音色資料庫
              </Link>
            </div>
          ) : null}

          {activeRackTab === "effects" ? (
            <div className={selectedTrackSettings.effectsBypassed ? "daw-rack-panel effects-bypassed" : "daw-rack-panel"}>
              <div className="daw-effects-toolbar">
                <span>
                  <strong>{selectedTrackSettings.effectsBypassed ? "效果已旁通" : "即時效果鏈"}</strong>
                  <small>{selectedTrackEffects.filter((effect) => effect.kind === "effect_macro").length} 個巨集啟用</small>
                </span>
                <div>
                  <button className={selectedTrackSettings.effectsBypassed ? "active" : ""} type="button" onClick={() => void updateStudioSettings({ effectsBypassed: !selectedTrackSettings.effectsBypassed })}>
                    {selectedTrackSettings.effectsBypassed ? "恢復效果" : "旁通效果"}
                  </button>
                  <button type="button" onClick={() => void resetSelectedTrackChannel()}>重設</button>
                </div>
              </div>
              <div className="daw-eq-strip">
                {[
                  ["lowGain", "低頻"],
                  ["midGain", "中頻"],
                  ["highGain", "高頻"]
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      className="range vertical"
                      style={rangeStyle(selectedTrackSettings[key as "lowGain" | "midGain" | "highGain"], -12, 12)}
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={selectedTrackSettings[key as "lowGain" | "midGain" | "highGain"]}
                      onChange={(event) => updateStudioSettings({ [key]: Number(event.target.value) } as Partial<StudioSettings>)}
                    />
                    <strong>{selectedTrackEffectiveSettings[key as "lowGain" | "midGain" | "highGain"]} dB</strong>
                  </label>
                ))}
              </div>
              <div className="field-row">
                <div className="field">
                  <label>回音 Echo {Math.round(selectedTrackEffectiveSettings.echo * 100)}%</label>
                  <input className="range" style={rangeStyle(selectedTrackSettings.echo, 0, 1)} type="range" min="0" max="1" step="0.01" value={selectedTrackSettings.echo} onChange={(event) => updateStudioSettings({ echo: Number(event.target.value) })} />
                </div>
                <div className="field">
                  <label>殘響 Reverb {Math.round(selectedTrackEffectiveSettings.reverb * 100)}%</label>
                  <input className="range" style={rangeStyle(selectedTrackSettings.reverb, 0, 1)} type="range" min="0" max="1" step="0.01" value={selectedTrackSettings.reverb} onChange={(event) => updateStudioSettings({ reverb: Number(event.target.value) })} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>壓縮 {Math.round(selectedTrackEffectiveSettings.compression * 100)}%</label>
                  <input className="range" style={rangeStyle(selectedTrackSettings.compression, 0, 1)} type="range" min="0" max="1" step="0.01" value={selectedTrackSettings.compression} onChange={(event) => updateStudioSettings({ compression: Number(event.target.value) })} />
                </div>
                <div className="field">
                  <label>噪音閘門 {Math.round(selectedTrackEffectiveSettings.noiseGate * 100)}%</label>
                  <input className="range" style={rangeStyle(selectedTrackSettings.noiseGate, 0, 1)} type="range" min="0" max="1" step="0.01" value={selectedTrackSettings.noiseGate} onChange={(event) => updateStudioSettings({ noiseGate: Number(event.target.value) })} />
                </div>
              </div>
              <div className="daw-effect-macros">
                {effectMacros.map((macro) => {
                  const active = selectedTrackEffects.some((effect) => effect.kind === "effect_macro" && effect.id === macro.id);
                  return (
                    <button className={active ? "active" : ""} key={macro.id} type="button" onClick={() => toggleEffectMacro(macro)}>
                      <strong>{macro.label}</strong>
                      <span>{macro.chain.join(" · ")}</span>
                    </button>
                  );
                })}
              </div>
              <div className="daw-dsp-flow">
                <span>片段增益</span>
                <span>三段等化器</span>
                <span>壓縮器</span>
                <span>回音 / 殘響</span>
                <span>Pan</span>
                <span>母帶限制器</span>
              </div>
              <p className="muted">即時播放與 WAV 匯出共用同一組 Fade、Pan、EQ、Gate、壓縮、回音、殘響與 master limiter 參數。</p>
            </div>
          ) : null}

          {activeRackTab === "ai" ? (
            <div className="daw-rack-panel daw-codex-rack">
              <DawCodexConsole
                key={codexConversationVersion}
                project={project}
                selectedTrack={selectedTrack}
                selectedClipId={selectedClipId}
                playheadSeconds={transportTime}
                providerStatus={codexProviderStatus}
                isPlaying={isPlaying}
                recordingState={recordingStatus}
                editsPending={saveState !== "saved" || Boolean(codexPolishBusyTakeId)}
                onOperationStart={beginCodexOperation}
                onOperationEnd={endCodexOperation}
                onReviewIssue={reviewCodexIssue}
                onAudition={auditionCodexAction}
                onPlayMix={playCodexMixPreview}
                onStop={() => { if (!recordingSessionProtected()) stopPlayback(false); }}
                onActionApplied={refreshDawProject}
              />
              <details className="daw-codex-detection">
                <summary>錄音偵測與問題點</summary>
                <div className="daw-switch-grid ai">
                  <button className={selectedTrackSettings.aiTiming ? "active" : ""} type="button" onClick={() => updateStudioSettings({ aiTiming: !selectedTrackSettings.aiTiming })}>
                    拍子偵測
                  </button>
                  <button className={selectedTrackSettings.aiPitch ? "active" : ""} type="button" onClick={() => updateStudioSettings({ aiPitch: !selectedTrackSettings.aiPitch })}>
                    音準偵測
                  </button>
                  <button className={selectedTrackSettings.aiLevel ? "active" : ""} type="button" onClick={() => updateStudioSettings({ aiLevel: !selectedTrackSettings.aiLevel })}>
                    音量偵測
                  </button>
                </div>
                {issueHighlights.length || qualityWarnings.length ? (
                  <div className="daw-coach-list">
                    {issueHighlights.filter(issue => issue.trackId === selectedTrack?.id).slice(0, 5).map((issue) => (
                      <div className="daw-coach-item" key={issue.id}>
                        <span>{formatTime(issue.timestampSeconds)}</span>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                        {issue.suggestion ? <em>{issue.suggestion}</em> : null}
                        <div className="daw-coach-actions">
                          <button type="button" onClick={() => setTransportTime(issue.timestampSeconds)}>定位</button>
                          <button type="button" onClick={() => prepareIssueRetake(issue.timestampSeconds, issue.trackId)} disabled={recordingBusy}>設為重錄區</button>
                        </div>
                      </div>
                    ))}
                    {qualityWarnings.slice(0, 4).map((warning, index) => (
                      <div className="daw-coach-item" key={`${warning.clipLabel}-${index}`}>
                        <span>QA</span>
                        <strong>{warning.clipLabel ?? warning.trackName}</strong>
                        <p>{warning.warning}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">目前沒有可顯示的分析疑點；尚未判定演奏是否正確。</p>
                )}
              </details>
            </div>
          ) : null}

          {activeRackTab === "score" ? (
            <div className="daw-rack-panel daw-score-rack-panel">
              <AutoScorePanel project={project} audioFiles={audioFiles} onProjectChange={(nextProject) => setProjectFromResponse({ project: nextProject })} />
            </div>
          ) : null}

          {activeRackTab === "clip" ? (
            <div className="daw-rack-panel">
              {selectedClip ? (
                <>
                  <div className="tag-row">
                    <span className={qualityClass(selectedClip.audioFile.qualityStatus)}>{selectedClip.audioFile.qualityStatus}</span>
                    <span className="tag">{selectedClipTrack?.name}</span>
                  </div>
                  <div className="daw-clip-tools">
                    <button type="button" onClick={() => nudgeSelectedClips(-1)} disabled={selectedClip.locked}>
                      -1s
                    </button>
                    <button type="button" onClick={() => nudgeSelectedClips(-0.1)} disabled={selectedClip.locked}>
                      -0.1
                    </button>
                    <button type="button" onClick={() => nudgeSelectedClips(0.1)} disabled={selectedClip.locked}>
                      +0.1
                    </button>
                    <button type="button" onClick={() => nudgeSelectedClips(1)} disabled={selectedClip.locked}>
                      +1s
                    </button>
                  </div>
                  <div className="daw-clip-tools">
                    <button type="button" onClick={() => trimClipStart(selectedClip, 0.1)} disabled={selectedClip.locked}>
                      切頭 +0.1
                    </button>
                    <button type="button" onClick={() => trimClipStart(selectedClip, -0.1)} disabled={selectedClip.locked}>
                      還原頭 -0.1
                    </button>
                    <button type="button" onClick={() => trimClipEnd(selectedClip, -0.1)} disabled={selectedClip.locked}>
                      收尾 -0.1
                    </button>
                    <button type="button" onClick={() => trimClipEnd(selectedClip, 0.1)} disabled={selectedClip.locked}>
                      延尾 +0.1
                    </button>
                  </div>
                  <div className="daw-clip-tools">
                    <button type="button" onClick={() => splitClipAtPlayhead(selectedClip)} disabled={selectedClip.locked}>
                      <Scissors size={14} />
                      播放頭切分
                    </button>
                    <button className="danger" type="button" onClick={() => deleteClip(selectedClip)} disabled={selectedClip.locked}>
                      <Trash2 size={14} />
                      刪除 Clip
                    </button>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Start</label>
                      <input className="input" type="number" min="0" step="0.1" value={selectedClip.startSeconds} onChange={(event) => patchClip(selectedClip, { startSeconds: Number(event.target.value) })} />
                    </div>
                    <div className="field">
                      <label>Offset</label>
                      <input className="input" type="number" min="0" step="0.1" value={selectedClip.offsetSeconds} onChange={(event) => patchClip(selectedClip, { offsetSeconds: Number(event.target.value) })} />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Duration</label>
                      <input className="input" type="number" min="0.1" step="0.1" value={selectedClip.durationSeconds ?? selectedClip.audioFile.durationSeconds ?? ""} onChange={(event) => patchClip(selectedClip, { durationSeconds: Number(event.target.value) || null })} />
                    </div>
                    <div className="field">
                      <label>Gain</label>
                      <input className="input" type="number" min="0" max="4" step="0.05" value={selectedClip.gain} onChange={(event) => patchClip(selectedClip, { gain: Number(event.target.value) })} />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Fade In</label>
                      <input className="input" type="number" min="0" max="60" step="0.1" value={selectedClip.fadeInSeconds} onChange={(event) => patchClip(selectedClip, { fadeInSeconds: Number(event.target.value) })} />
                    </div>
                    <div className="field">
                      <label>Fade Out</label>
                      <input className="input" type="number" min="0" max="60" step="0.1" value={selectedClip.fadeOutSeconds} onChange={(event) => patchClip(selectedClip, { fadeOutSeconds: Number(event.target.value) })} />
                    </div>
                  </div>
                  <label className="toggle-row">
                    <input type="checkbox" checked={selectedClip.locked} onChange={(event) => patchClip(selectedClip, { locked: event.target.checked })} />
                    鎖定 clip metadata
                  </label>
                </>
              ) : (
                <p className="muted">選取 timeline clip 後可調整。</p>
              )}
            </div>
          ) : null}
        </aside>
      </section>

      <details className="daw-mixer-strip">
        <summary className="daw-dock-summary">
          <span>
            <strong>混音器</strong>
            <small>音軌音量、聲像、主輸出與 AI / QA 狀態</small>
          </span>
          <Headphones size={18} />
        </summary>
        <div className="daw-mixer-console">
          <aside className="daw-master-channel">
            <div className="daw-master-head">
              <span className="daw-master-kicker"><Waves size={15} /> 主輸出</span>
              <strong title={project.song.title}>{project.song.title}</strong>
              <small>{masterBus.audibleTracks} 軌播放 · {masterBus.mutedTracks} 軌靜音</small>
            </div>
            <div className="daw-master-meter" aria-label="Master bus meter">
              <span data-daw-master-meter data-clipping="false" style={{ height: "2%" }} />
            </div>
            <div className="daw-master-readout">
              <span>
                <strong data-daw-master-readout>-inf peak</strong>
                餘裕
              </span>
              <span>
                <strong>{masterBus.activeEffects}</strong>
                效果
              </span>
              <span className={masterBus.issueCount || masterBus.qaWarningCount ? "warn" : ""}>
                <strong>{masterBus.issueCount + masterBus.qaWarningCount}</strong>
                AI / QA
              </span>
            </div>
            <div className="daw-master-actions">
              <button type="button" onClick={saveSnapshot}>
                <Save size={14} />
                快照
              </button>
              <button type="button" onClick={renderMixdown}>
                <Download size={14} />
                混音輸出
              </button>
            </div>
          </aside>

          <div className="daw-mixer-scroll">
          {project.tracks.map((track) => {
            const health = trackHealthById.get(track.id);
            const settings = health?.settings ?? getStudioSettings(track.effects);
            const effectsCount = health?.effects.length ?? 0;
            const attentionCount = (health?.issueCount ?? 0) + (health?.qaWarningCount ?? 0);
            return (
              <div className={track.id === selectedTrack?.id ? "daw-mixer-channel active" : "daw-mixer-channel"} key={track.id}>
                <div className="daw-channel-color" style={{ background: track.color ?? "var(--accent)" }} />
                <div className="daw-channel-strip-head">
                  <button className="daw-channel-name" type="button" title={track.name} onClick={() => focusTrackRack(track.id, "recording")}>
                    {track.name}
                  </button>
                  <span>{trackTypeLabel(track.trackType)}</span>
                </div>
                <div className="daw-channel-status-row">
                  <span className={track.armed ? "live" : ""}>{track.armed ? "待錄" : "閒置"}</span>
                  <span>{track.clips.length} 個片段</span>
                  <span className={attentionCount ? "warn" : ""}>{attentionCount ? `${attentionCount} 項檢查` : "正常"}</span>
                </div>
                <div className="daw-channel-buttons">
                  <button className={track.armed ? "active rec" : ""} type="button" onClick={() => void toggleTrackControl(track, "armed")} title="錄音待命" aria-label={`${track.name} R 錄音待命`} aria-pressed={track.armed} data-control="armed">
                    R
                  </button>
                  <button className={track.monitoring ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "monitoring")} title="輸入監聽" aria-label={`${track.name} I 輸入監聽`} aria-pressed={track.monitoring} data-control="monitoring">
                    I
                  </button>
                  <button className={track.muted ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "muted")} title="靜音" aria-label={`${track.name} M 靜音`} aria-pressed={track.muted} data-control="muted">
                    M
                  </button>
                  <button className={track.solo ? "active" : ""} type="button" onClick={() => void toggleTrackControl(track, "solo")} title="獨奏" aria-label={`${track.name} S 獨奏`} aria-pressed={track.solo} data-control="solo">
                    S
                  </button>
                </div>

                <div className="daw-channel-body">
                <div className="daw-channel-fader">
                  <div className="daw-channel-meter">
                    <span data-daw-track-meter={track.id} data-clipping="false" style={{ height: "2%" }} />
                  </div>
                    <label aria-label={`${track.name} 音量 ${gainDbLabel(track.volume)}`}>
                      <input
                        className="range vertical"
                        style={rangeStyle(track.volume, 0, 2)}
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={track.volume}
                        onChange={(event) => patchTrack(track, { volume: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="daw-channel-main-controls">
                    <div className="daw-channel-gain-readout">
                      <span>音量</span>
                      <strong>{gainDbLabel(track.volume)}</strong>
                    </div>
                    <label>
                      <span className="daw-channel-control-title"><span>聲像</span><strong>{panLabel(track.pan)}</strong></span>
                      <input
                        className="range"
                        style={rangeStyle(track.pan, -1, 1)}
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={track.pan}
                        onChange={(event) => patchTrack(track, { pan: Number(event.target.value) })}
                      />
                    </label>
                    <div className="daw-channel-eq">
                      <span>L {settings.lowGain}</span>
                      <span>M {settings.midGain}</span>
                      <span>H {settings.highGain}</span>
                    </div>
                    <div className="daw-channel-preset">
                      <span>{settings.instrumentPreset}</span>
                      <strong>{effectsCount} 個效果 · {Math.round(settings.reverb * 100)}% 殘響</strong>
                      <em>{Math.round(settings.echo * 100)}% 回音 · {health?.commentCount ?? 0} 則留言</em>
                    </div>
                  </div>
                </div>

                <div className="daw-channel-actions">
                  <button type="button" onClick={() => focusTrackRack(track.id, "recording")}>
                    <Mic2 size={13} />
                    錄音
                  </button>
                  <button type="button" onClick={() => focusTrackRack(track.id, "effects")}>
                    <SlidersHorizontal size={13} />
                    效果
                  </button>
                  <button type="button" onClick={() => focusTrackRack(track.id, "ai")}>
                    <Gauge size={13} />
                    AI
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </details>

      <details className="daw-utility-drawer">
        <summary>
          <span>
            <strong>專案工具與版本管理</strong>
            <small>新增片段、標記、引擎、輸出、AI 問題與 Take 管理</small>
          </span>
          <SlidersHorizontal size={17} />
        </summary>
        <div className="daw-utility-content">
      <section className="section grid-3">
        <div className="panel pad stack">
          <div className="toolbar compact-toolbar">
            <h2>新增音軌 / 片段</h2>
            <Plus size={18} color="var(--accent)" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>音軌名稱</label>
              <input className="input" value={trackName} onChange={(event) => setTrackName(event.target.value)} placeholder="Lead Vocal" />
            </div>
            <div className="field">
              <label>類型</label>
              <select className="select" value={trackType} onChange={(event) => setTrackType(event.target.value)}>
                <option value="audio">音訊</option>
                <option value="vocal">人聲</option>
                <option value="guitar">吉他</option>
                <option value="piano">鋼琴</option>
                <option value="bass">貝斯</option>
                <option value="drums">鼓組</option>
                <option value="reference">參考音軌</option>
                <option value="bus">群組音軌</option>
              </select>
            </div>
          </div>
          <button className="button" type="button" onClick={addTrack}>
            <Plus size={16} />
            新增音軌
          </button>
          <div className="field">
            <label>把音檔放到選取音軌</label>
            <select className="select" value={audioFileId} onChange={(event) => setAudioFileId(event.target.value)}>
              {audioFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.versionName ?? file.fileName} · {file.fileType}
                </option>
              ))}
            </select>
          </div>
          <button className="button" type="button" onClick={addClip} disabled={!selectedTrack || !audioFileId}>
            <AudioLines size={16} />
            加入片段
          </button>
        </div>

        <div className="panel pad stack">
          <div className="toolbar compact-toolbar">
            <h2>時間標記</h2>
            <MapPin size={18} color="var(--accent)" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>類型</label>
              <select className="select" value={markerType} onChange={(event) => setMarkerType(event.target.value)}>
                <option value="idea">想法</option>
                <option value="verse">主歌</option>
                <option value="chorus">副歌</option>
                <option value="bridge">過門</option>
                <option value="punch-in">定點重錄</option>
                <option value="issue">問題</option>
              </select>
            </div>
            <div className="field">
              <label>時間秒</label>
              <input className="input" type="number" min="0" value={markerTime} onChange={(event) => setMarkerTime(event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>標記名稱</label>
            <input className="input" value={markerLabelValue} onChange={(event) => setMarkerLabelValue(event.target.value)} placeholder="副歌要重唱" />
          </div>
          <button className="button" type="button" onClick={addMarker}>
            <Plus size={16} />
            新增標記
          </button>
          <div className="daw-marker-list">
            {project.markers.map((marker) => (
              <div className="daw-marker-item" key={marker.id}>
                <button type="button" onClick={() => setTransportTime(marker.timestampSeconds)}>
                  <span>{formatTime(marker.timestampSeconds)}</span>
                  <strong>{marker.label}</strong>
                  <em>{markerLabel(marker.markerType)}</em>
                </button>
                <button className="daw-marker-delete" type="button" onClick={() => void deleteMarker(marker.id)} title="刪除標記" aria-label={`刪除標記 ${marker.label}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel pad stack">
          <div className="toolbar compact-toolbar">
            <h2>引擎 / 輸出</h2>
            <Gauge size={18} color="var(--accent)" />
          </div>
          <div className="daw-engine-box">
            <span className="tag">{engineStatus?.mode === "native_service" ? "原生引擎" : engineStatus ? "網頁備援" : "讀取中"}</span>
            <p className="muted">{engineStatus?.message ?? "桌面 App 會自動啟動原生音訊引擎。"}</p>
          </div>
          <div className="daw-engine-grid">
            <span>
              <strong>{deviceStatus?.inputDevices?.length ?? 0}</strong>
              輸入
            </span>
            <span>
              <strong>{deviceStatus?.outputDevices?.length ?? 0}</strong>
              輸出
            </span>
            <span>
              <strong>{playbackEngineReport?.latencyMs ?? "--"}</strong>
              Web 延遲
            </span>
            <span>
              <strong>{playbackEngineReport?.effectChains ?? 0}</strong>
              DSP 鏈
            </span>
          </div>
          <div className="daw-engine-actions">
            <button className="button" type="button" onClick={runLatencyTest}>
              估算延遲
            </button>
            <button className="button ghost" type="button" onClick={refreshDeviceStatus}>
              重新整理裝置
            </button>
          </div>
          {latencyMessage ? <p className="muted">{latencyMessage}</p> : null}
          <div className="daw-engine-box compact">
            <strong>播放處理</strong>
            <span>{playbackEngineReport ? `${playbackEngineReport.scheduledClips} 個片段 · 略過 ${playbackEngineReport.skippedClips} 個 · ${playbackEngineReport.sampleRate / 1000}k` : "本次工作階段尚未播放"}</span>
            <small>{playbackEngineReport?.mode ?? "Web Audio 可用"}</small>
          </div>
          <button className="button primary" type="button" onClick={renderMixdown}>
            <Download size={16} />
            {exportBusy === "mixdown" ? "輸出中" : "輸出混音 WAV"}
          </button>
          <button className="button" type="button" onClick={exportStemsZip} disabled={exportBusy === "stems"}>
            <Archive size={16} />
            {exportBusy === "stems" ? "打包中" : "輸出 Stems ZIP"}
          </button>
          <button className="button ghost" type="button" onClick={exportProjectFile} disabled={exportBusy === "project-file"}>
            <FileJson size={16} />
            {exportBusy === "project-file" ? "輸出中" : "下載 .songzu-project"}
          </button>
          {renderError ? <p className="error-text">{renderError}</p> : null}
          {projectFileOutput ? (
            <div className="daw-output-box">
              <strong>{projectFileOutput.fileName}</strong>
              <span>{Math.max(1, Math.round(projectFileOutput.fileSizeBytes / 1024))} KB</span>
              <a className="button" href={projectFileOutput.downloadUrl}>
                下載 Manifest
              </a>
            </div>
          ) : null}
          {renderOutput ? (
            <div className="daw-output-box">
              <strong>{renderOutput.fileName}</strong>
              <span>{Math.round(renderOutput.fileSizeBytes / 1024 / 1024)} MB</span>
              <a className="button" href={renderOutput.downloadUrl}>
                下載 WAV
              </a>
              <a className="button ghost" href={renderOutput.manifestDownloadUrl}>
                下載 Manifest
              </a>
            </div>
          ) : null}
          {stemsOutput ? (
            <div className="daw-output-box">
              <strong>{stemsOutput.fileName}</strong>
              <span>{stemsOutput.stemCount} stems</span>
              <span>{Math.round(stemsOutput.fileSizeBytes / 1024 / 1024)} MB</span>
              <a className="button primary" href={stemsOutput.downloadUrl}>
                下載 ZIP
              </a>
              <div className="daw-stem-list">
                {stemsOutput.stems.map((stem) => (
                  <span key={stem.sha256}>
                    {stem.trackName} · {Math.max(1, Math.round(stem.fileSizeBytes / 1024))} KB
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section daw-coach-layout">
        <div className="panel pad stack">
          <div className="toolbar compact-toolbar">
            <h2>Codex 錄音師</h2>
            <Volume2 size={18} color="var(--accent)" />
          </div>
          <div className="daw-output-box">
            <div>
              <strong>{codexProviderStatus?.realModel ? "Codex 已連線" : codexProviderStatus ? "Codex 尚未連線" : "正在確認 Codex"}</strong>
              <p className="muted">
                {codexProviderStatus?.message ?? "正在確認桌面 Codex 登入與模型狀態。"}
              </p>
            </div>
            <div className="tag-row">
              <span className={codexProviderStatus?.realModel ? "tag green" : "tag warn"}>
                {codexProviderStatus?.realModel ? "真實 Codex" : "不改用其他模型"}
              </span>
              <span className="tag">先審核再套用</span>
              <span className="tag">原始錄音不覆蓋</span>
            </div>
            <p className="muted">通道調整需先試聽與批准；演奏疑點由製作人回聽確認。</p>
          </div>
          {codexPolishMessage ? (
            <div className="daw-output-box">
              <div>
                <strong>Codex 錄音師</strong>
                <p className="muted">{codexPolishMessage}</p>
              </div>
              {codexPolishBusyTakeId ? <button type="button" onClick={() => codexTakeRequestRef.current?.abort()}>取消請求</button> : null}
            </div>
          ) : null}
          {issueHighlights.length || qualityWarnings.length ? (
            <div className="daw-coach-list">
              {issueHighlights.slice(0, 8).map((issue) => (
                <div className="daw-coach-item" key={issue.id}>
                  <span>{formatTime(issue.timestampSeconds)}</span>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                  {issue.suggestion ? <em>{issue.suggestion}</em> : null}
                  <div className="daw-coach-actions">
                    <button type="button" onClick={() => setTransportTime(issue.timestampSeconds)}>定位</button>
                    <button type="button" onClick={() => prepareIssueRetake(issue.timestampSeconds, issue.trackId)} disabled={recordingBusy}>設為重錄區</button>
                  </div>
                </div>
              ))}
              {qualityWarnings.slice(0, 6).map((warning, index) => (
                <div className="daw-coach-item" key={`${warning.clipLabel}-${index}`}>
                  <span>QA</span>
                  <strong>{warning.clipLabel ?? warning.trackName}</strong>
                  <p>{warning.warning}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">目前沒有 timing / pitch / level issue，也沒有 Audio QA 阻塞。</p>
          )}
        </div>

        <div className="panel pad stack">
          <div className="toolbar compact-toolbar">
            <div>
              <h2>錄音版本管理</h2>
              <p className="muted">挑選最佳 take、標記重錄，或用 Punch 區間建立 comp clip。</p>
            </div>
            <Waves size={18} color="var(--accent)" />
          </div>
          <div className="daw-take-list">
            {project.tracks.flatMap((track) =>
              track.takeLanes.map((lane) => {
                const report = lane.recordingTake.reports[0];
                const issueCount = report?.issues.length ?? 0;
                const audioFile = lane.recordingTake.audioFile;
                const compRange = readTakeCompRange(lane.selectedRange);
                const takeDuration = Math.max(0.1, audioFile?.durationSeconds ?? compRange?.sourceEndSeconds ?? 12);
                const takeWaveform = audioFile ? (waveformsByAudioFileId[audioFile.id]?.peaks ?? []) : [];
                const compStartPercent = compRange ? Math.min(98, (compRange.sourceStartSeconds * 100) / takeDuration) : 0;
                const compWidthPercent = compRange ? Math.max(2, ((compRange.sourceEndSeconds - compRange.sourceStartSeconds) * 100) / takeDuration) : 0;
                return (
                  <div className={lane.compStatus === "keeper" ? "daw-take-item keeper" : "daw-take-item"} key={lane.id}>
                    <div className="daw-take-main">
                      <strong>{lane.recordingTake.label}</strong>
                      <p className="muted">
                        {track.name} · Take {lane.recordingTake.takeNumber} · {audioFile?.fileName ?? "音檔待確認"}
                      </p>
                    </div>
                    <div className="daw-take-lane-strip" aria-hidden="true">
                      <div className="daw-take-lane-waveform">
                        {sampleDawWaveform(takeWaveform, 64).map((peak, index) => (
                          <i key={`${lane.id}-take-wave-${index}`} style={{ height: `${Math.max(12, Math.round(peak * 100))}%` }} />
                        ))}
                      </div>
                      {compRange ? (
                        <span
                          className="daw-take-lane-selection"
                          style={{ left: `${compStartPercent}%`, width: `${Math.min(100 - compStartPercent, compWidthPercent)}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="daw-take-badges">
                      <span className={takeStatusClass(lane.compStatus)}>{takeStatusLabel(lane.compStatus)}</span>
                      {report ? <span className={report.overallScore >= 80 ? "tag green" : "tag warn"}>{report.overallScore} 分</span> : <span className="tag">待分析</span>}
                      {issueCount ? <span className="tag warn">{issueCount} 問題</span> : <span className="tag green">無主要問題</span>}
                      {audioFile ? <span className={qualityClass(audioFile.qualityStatus)}>{audioFile.qualityStatus}</span> : null}
                    </div>
                    {compRange ? (
                      <div className="daw-take-comp-range">
                        <span>Comp</span>
                        {formatTime(compRange.sourceStartSeconds)} - {formatTime(compRange.sourceEndSeconds)} → {formatTime(compRange.timelineStartSeconds)}
                      </div>
                    ) : null}
                    <div className="daw-take-actions">
                      <button
                        className="button primary"
                        type="button"
                        onClick={() => void askCodexToPolishTake(lane, track)}
                        disabled={!audioFile || Boolean(codexPolishBusyTakeId) || recordingBusy || saveState !== "saved"}
                      >
                        <AudioLines size={15} />
                        {codexPolishBusyTakeId === lane.recordingTake.id ? "Codex 分析中" : "Codex 修飾"}
                      </button>
                      <button className="button" type="button" onClick={() => patchTakeLane(lane, { compStatus: "keeper" })}>
                        最佳
                      </button>
                      <button className="button" type="button" onClick={() => patchTakeLane(lane, { compStatus: "needs_retake" })}>
                        重錄
                      </button>
                      <button className="button ghost" type="button" onClick={() => patchTakeLane(lane, { compStatus: "archived" })}>
                        封存
                      </button>
                      <button className="button primary" type="button" onClick={() => placeTakeOnTimeline(lane, track)} disabled={!audioFile}>
                        放進時間軸
                      </button>
                      <button className="button" type="button" onClick={() => setLaneCompFromPunch(lane)} disabled={!punchRangeValid}>
                        標記 Punch
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          compRange
                            ? patchTakeLane(lane, {
                                selectedRange: {
                                  sourceStartSeconds: compRange.sourceStartSeconds,
                                  sourceEndSeconds: compRange.sourceEndSeconds,
                                  timelineStartSeconds: snapSeconds(transportVisualTimeRef.current),
                                  alignedFrom: "transport_playhead",
                                  alignedAt: new Date().toISOString()
                                }
                              })
                            : undefined
                        }
                        disabled={!compRange}
                      >
                        對齊播放頭
                      </button>
                      <button className="button primary" type="button" onClick={() => createCompClipFromTake(lane, track)} disabled={!audioFile}>
                        建立 Comp Clip
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {!project.tracks.some((track) => track.takeLanes.length) ? <p className="muted">尚未有錄音 take lane。</p> : null}
          </div>
        </div>
      </section>
        </div>
      </details>
      <DawProfessionalConsole
        project={project}
        selectedTrackId={selectedTrack?.id ?? ""}
        selectedClipId={selectedClip?.id ?? ""}
        selectedClipIds={selectedClipIds}
        transportTime={transportTime}
        punchIn={punchIn}
        punchOut={punchOut}
        bufferFrames={bufferFrames}
        inputDeviceName={selectedInputDevice?.name ?? selectedInputDevice?.label ?? "系統預設輸入"}
        outputDeviceName={selectedOutputDevice?.name ?? selectedOutputDevice?.label ?? "系統預設輸出"}
        onProjectChange={(nextProject) => setProjectFromResponse({ project: nextProject })}
        onDspPreview={previewDsp}
        onOperationStart={() => beginCodexOperation(true)}
        onOperationEnd={endCodexOperation}
        editsBlocked={codexOperationBusy || recordingStatus !== "idle" || saveState !== "saved"}
        onLatencyChange={(milliseconds) => {
          setLatencyCompensationMs(milliseconds);
          setApplyLatencyCompensation(true);
        }}
        onNotice={showStudioNotice}
      />
      <DawStylesheetGuard />
    </div>
  );
}
