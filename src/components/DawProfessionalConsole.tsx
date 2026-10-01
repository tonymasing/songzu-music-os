"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  AudioWaveform,
  Cable,
  Check,
  Crosshair,
  GitBranch,
  Group,
  HardDrive,
  History,
  Layers3,
  Plus,
  Radio,
  Redo2,
  RefreshCw,
  Route,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Waves,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DawProjectDto } from "@/lib/daw";
import { automationDraftDirty, automationDraftKey, automationPayloadRevision, completeAutomationSave, discardAutomationDraft, editAutomationDraft, prepareAutomationSave, readAutomationDraft, type AutomationDraftPatch, type AutomationDraftStore, type AutomationDraftView, type AutomationMode, type AutomationSaveSnapshot } from "@/lib/daw-automation-drafts";
import { applyDspPatch, dspRevision, getEffectiveStudioSettings, type DspKey, type DspPatch, type Effects } from "@/lib/daw-dsp";

type ConsoleTab = "safety" | "editing" | "takes" | "mixer" | "dsp" | "automation";
type HistorySummary = { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null };
type EngineHealth = {
  ok?: boolean;
  mode?: string;
  error?: string;
  recording?: {
    status?: string;
    peak?: number;
    rms?: number;
    clipping?: boolean;
    xrunCount?: number;
    inputOverflowCount?: number;
    outputUnderflowCount?: number;
    diskWriteErrorCount?: number;
    callbackLoad?: number;
    freeDiskBytes?: number;
    error?: string | null;
  };
  recoverableRecordings?: RecoverableRecording[];
};
type RecoverableRecording = { relativePath: string; fileSizeBytes: number; recoverable: boolean };
type Props = {
  project: DawProjectDto;
  selectedTrackId: string;
  selectedClipId: string;
  selectedClipIds: string[];
  transportTime: number;
  punchIn: number;
  punchOut: number;
  bufferFrames: number;
  inputDeviceName: string;
  outputDeviceName: string;
  onProjectChange: (project: DawProjectDto) => void;
  onLatencyChange: (milliseconds: number) => void;
  onNotice: (message: string) => void;
  onDspPreview: (trackId: string, effects: Effects | null) => void;
  editsBlocked: boolean;
  onOperationStart: () => boolean;
  onOperationEnd: () => void;
};

const AUTOMATION_PARAMETERS = [
  { value: "volume", label: "音量", min: 0, max: 2, defaultValue: 1 },
  { value: "pan", label: "聲像", min: -1, max: 1, defaultValue: 0 },
  { value: "lowGain", label: "低頻", min: -12, max: 12, defaultValue: 0 },
  { value: "midGain", label: "中頻", min: -12, max: 12, defaultValue: 0 },
  { value: "highGain", label: "高頻", min: -12, max: 12, defaultValue: 0 },
  { value: "compression", label: "壓縮", min: 0, max: 1, defaultValue: 0 },
  { value: "reverb", label: "殘響", min: 0, max: 1, defaultValue: 0 },
  { value: "echo", label: "回音", min: 0, max: 1, defaultValue: 0 }
] as const;

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "--";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function formatTime(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${Math.floor(safe % 60).toString().padStart(2, "0")}.${Math.floor((safe % 1) * 10)}`;
}

function peakToDb(value?: number) {
  if (!value || value <= 0) return "-∞";
  return `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let data: unknown = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`伺服器回傳無法解析的內容（HTTP ${response.status}）。`);
    }
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : `操作失敗（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return data as T;
}

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DawProfessionalConsole({
  project,
  selectedTrackId,
  selectedClipId,
  selectedClipIds,
  transportTime,
  punchIn,
  punchOut,
  bufferFrames,
  inputDeviceName,
  outputDeviceName,
  onProjectChange,
  onLatencyChange,
  onNotice,
  onDspPreview,
  editsBlocked,
  onOperationStart,
  onOperationEnd
}: Props) {
  const [tab, setTab] = useState<ConsoleTab>("safety");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [recoverableFiles, setRecoverableFiles] = useState<RecoverableRecording[]>([]);
  const [history, setHistory] = useState<HistorySummary>({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  const [routeType, setRouteType] = useState<"output" | "send" | "cue" | "sidechain">("send");
  const [routeDestination, setRouteDestination] = useState("");
  const [routeGain, setRouteGain] = useState(0.5);
  const [automationParameter, setAutomationParameter] = useState<(typeof AUTOMATION_PARAMETERS)[number]["value"]>("volume");
  const [automationDrafts, setAutomationDrafts] = useState<AutomationDraftStore>({});
  const [automationSavingKey, setAutomationSavingKey] = useState<string | null>(null);
  const automationSaveRef = useRef<AutomationSaveSnapshot | null>(null);
  const automationSession = useMemo(() => ({ projectId: project.id }), [project.id]);
  const automationSessionRef = useRef<typeof automationSession | null>(null);
  const [activeTakeLaneId, setActiveTakeLaneId] = useState("");
  const [compSourceStart, setCompSourceStart] = useState(0);
  const [compSourceEnd, setCompSourceEnd] = useState(4);
  const [latencyProgress, setLatencyProgress] = useState("");
  const [nativePlayback, setNativePlayback] = useState<{ status: string; playbackId?: string | null; scheduledClips?: number; elapsedSeconds?: number; mode?: string } | null>(null);
  const [dspDrafts, setDspDrafts] = useState<Record<string, { baseRevision: string; patch: DspPatch }>>({});
  const [dspHistory, setDspHistory] = useState<{ operationId: string; undone: boolean } | null>(null);
  const dspBusyRef = useRef(false);
  const previewRef = useRef(onDspPreview);
  previewRef.current = onDspPreview;
  const latencySessionRef = useRef<MediaStream | null>(null);

  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId) ?? null;
  const dspEdit = selectedTrack ? dspDrafts[selectedTrack.id] : undefined;
  const dspBaseRevision = dspRevision(selectedTrack?.effects ?? []);
  const dspConflict = Boolean(dspEdit && dspEdit.baseRevision !== dspBaseRevision);
  const dspEffects = selectedTrack && dspEdit && !dspConflict ? applyDspPatch(selectedTrack.effects, dspEdit.patch) : selectedTrack?.effects ?? [];
  const dspDraft = getEffectiveStudioSettings(dspEffects);
  const dspPatchSignature = JSON.stringify(dspEdit?.patch ?? null);
  const busTracks = useMemo(() => project.tracks.filter((track) => track.trackType === "bus"), [project.tracks]);
  const availableRouteDestinations = useMemo(() => {
    const candidates = routeType === "sidechain" ? project.tracks : busTracks;
    return candidates.filter((track) => track.id !== selectedTrack?.id);
  }, [busTracks, project.tracks, routeType, selectedTrack?.id]);
  const routeCanCreate = Boolean(
    selectedTrack &&
    !busy &&
    (routeType === "output" || availableRouteDestinations.some((track) => track.id === routeDestination))
  );
  const takeLanes = project.tracks.flatMap((track) => track.takeLanes.map((lane) => ({ lane, track })));
  const activeTakeLane = takeLanes.find(({ lane }) => lane.id === activeTakeLaneId) ?? takeLanes[0] ?? null;
  const latestLatency = project.latencyProfiles.find((profile) => profile.isActive) ?? project.latencyProfiles[0] ?? null;
  const latestHealth = project.healthSnapshots[0] ?? null;
  const currentAutomationDefinition = AUTOMATION_PARAMETERS.find((item) => item.value === automationParameter) ?? AUTOMATION_PARAMETERS[0];
  const currentAutomationLane = selectedTrack?.automationLanes.find((lane) => lane.parameter === automationParameter) ?? null;
  const automationKey = automationDraftKey(project.id, selectedTrack?.id ?? "", automationParameter);
  const automationDraft = useMemo(() => readAutomationDraft(automationDrafts[automationKey], currentAutomationLane, currentAutomationDefinition), [automationDrafts, automationKey, currentAutomationLane, currentAutomationDefinition]);
  const automationMode = automationDraft.data.mode;
  const automationValue = automationDraft.value;
  const automationPoints = automationDraft.data.points;
  const automationEditingBlocked = !selectedTrack || Boolean(busy) || editsBlocked || Boolean(automationSavingKey) || automationDraft.conflict;
  const unsavedAutomationCount = useMemo(() => Object.entries(automationDrafts).filter(([key, draft]) => key.startsWith(`[${JSON.stringify(project.id)},`) && automationDraftDirty(draft)).length, [automationDrafts, project.id]);
  const routingForTrack = project.routes.filter((route) => route.sourceTrackId === selectedTrack?.id);
  const pendingRecoveryCount = project.recoveryEntries.filter((entry) => entry.status === "RECOVERABLE").length;
  const healthRecording = health?.recording;
  const healthIsClean = Boolean(
    health?.ok &&
    !(healthRecording?.clipping) &&
    !(healthRecording?.xrunCount) &&
    !(healthRecording?.outputUnderflowCount) &&
    !(healthRecording?.diskWriteErrorCount)
  );

  useEffect(() => {
    if (!activeTakeLaneId && takeLanes[0]) setActiveTakeLaneId(takeLanes[0].lane.id);
  }, [activeTakeLaneId, takeLanes]);

  useEffect(() => {
    const destinationIsValid = availableRouteDestinations.some((track) => track.id === routeDestination);
    if (routeType === "output") {
      if (routeDestination && !destinationIsValid) setRouteDestination("");
      return;
    }
    if (!destinationIsValid) setRouteDestination(availableRouteDestinations[0]?.id ?? "");
  }, [availableRouteDestinations, routeDestination, routeType]);

  useEffect(() => {
    automationSessionRef.current = automationSession;
    return () => { automationSessionRef.current = null; };
  }, [automationSession]);

  useEffect(() => {
    if (!selectedTrack) return;
    const trackId = selectedTrack.id;
    previewRef.current(trackId, dspEdit && !dspConflict ? dspEffects : null);
    return () => previewRef.current(trackId, null);
    // The revision and patch cover effect content; transport renders must not reset audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrack?.id, dspBaseRevision, dspPatchSignature, dspConflict]);

  function changeDsp(patch: DspPatch) {
    if (!selectedTrack || dspBusyRef.current || editsBlocked || dspConflict) return;
    setDspDrafts(current => ({ ...current, [selectedTrack.id]: {
      baseRevision: current[selectedTrack.id]?.baseRevision ?? dspBaseRevision,
      patch: { ...current[selectedTrack.id]?.patch, ...patch }
    } }));
  }

  function discardDsp(trackId: string) {
    previewRef.current(trackId, null);
    setDspDrafts(current => { const next = { ...current }; delete next[trackId]; return next; });
  }

  async function refreshHistory() {
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/history`, { cache: "no-store" });
      setHistory(await readApiResponse<HistorySummary>(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法讀取編輯歷史。");
    }
  }

  async function refreshHealth(saveSnapshot = false) {
    setBusy("health");
    setError("");
    try {
      const response = await fetch("/api/daw-engine/health", saveSnapshot
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }) }
        : { cache: "no-store" });
      const data = await readApiResponse<EngineHealth & { health?: EngineHealth }>(response);
      const nextHealth = data.health ?? data;
      setHealth(nextHealth);
      setRecoverableFiles(nextHealth.recoverableRecordings ?? []);
      if (saveSnapshot) onNotice("已保存音訊引擎健康快照");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "原生引擎健康檢查失敗。";
      setError(message);
      setHealth({ ok: false, mode: "web_fallback", error: message });
    } finally {
      setBusy("");
    }
  }

  async function refreshRecovery() {
    setBusy("recovery-list");
    setError("");
    try {
      const data = await readApiResponse<{ files: RecoverableRecording[] }>(await fetch("/api/daw-engine/recovery", { cache: "no-store" }));
      setRecoverableFiles(data.files ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法讀取事故錄音。");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void refreshHistory();
    void refreshHealth(false);
    void refreshRecovery();
    return () => latencySessionRef.current?.getTracks().forEach((track) => track.stop());
    // Project id is the session boundary; user-triggered refreshes handle later snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (nativePlayback?.status !== "playing") return;
    const timer = window.setInterval(() => {
      void fetch(`/api/daw-projects/${project.id}/native-playback`, { cache: "no-store" })
        .then((response) => readApiResponse<typeof nativePlayback>(response))
        .then((status) => setNativePlayback(status))
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [nativePlayback?.status, project.id]);

  async function stepHistory(action: "undo" | "redo") {
    if (editsBlocked || busy) return;
    setBusy(action);
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto; history: HistorySummary; operation: { label: string } | null }>(
        await fetch(`/api/daw-projects/${project.id}/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        })
      );
      onProjectChange(data.project);
      setHistory(data.history);
      onNotice(data.operation ? `${action === "undo" ? "已復原" : "已重做"}：${data.operation.label}` : "目前沒有可執行的歷史動作");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "編輯歷史操作失敗。");
    } finally {
      setBusy("");
    }
  }

  async function runPrecision(action: "start" | "end" | "crossfade" | "group") {
    if ((action === "start" || action === "end" || action === "crossfade") && !selectedClipId) {
      setError("請先在時間軸選取一個片段。");
      return;
    }
    if (action === "group" && selectedClipIds.length < 2) {
      setError("群組至少需要選取兩個片段。");
      return;
    }
    setBusy(`precision-${action}`);
    setError("");
    try {
      const response = action === "group"
        ? await fetch(`/api/daw-projects/${project.id}/clip-groups`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clipIds: selectedClipIds })
          })
        : await fetch(`/api/daw-clips/${selectedClipId}/precision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "crossfade"
              ? { action: "auto_crossfade", durationSeconds: 0.012 }
              : { action: "zero_crossing", boundary: action, searchMs: 24 })
          });
      const data = await readApiResponse<{ project: DawProjectDto }>(response);
      onProjectChange(data.project);
      await refreshHistory();
      onNotice(action === "crossfade" ? "已建立 12 ms 自動交叉淡化" : action === "group" ? "片段已建立永久群組" : `已對齊${action === "start" ? "起點" : "終點"}零交越`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "精準剪輯失敗。");
    } finally {
      setBusy("");
    }
  }

  async function recoverRecordings() {
    setBusy("recover");
    setError("");
    try {
      const data = await readApiResponse<{ recovered: string[]; skipped: string[] }>(await fetch("/api/daw-engine/recovery", { method: "POST" }));
      await refreshRecovery();
      onNotice(`事故復原完成：救回 ${data.recovered.length} 個，略過 ${data.skipped.length} 個`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "事故錄音復原失敗。");
    } finally {
      setBusy("");
    }
  }

  async function runLatencyCalibration() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("此環境無法取得麥克風，請在桌面 App 或 HTTPS 頁面測試。");
      return;
    }
    setBusy("latency");
    setError("");
    setLatencyProgress("正在取得輸入裝置...");
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false
      });
      latencySessionRef.current = stream;
      const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("瀏覽器不支援 AudioContext。");
      context = new AudioContextConstructor({ sampleRate: project.sampleRate, latencyHint: "interactive" });
      await context.resume();
      setLatencyProgress("請提高喇叭音量；將播放三個短脈衝並由麥克風量測。");
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(1024, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);

      const outputLatencySeconds = typeof context.outputLatency === "number" ? context.outputLatency : context.baseLatency || 0;
      const measurements: number[] = [];
      const peaks: number[] = [];
      for (let pass = 0; pass < 3; pass += 1) {
        const clickAt = context.currentTime + 0.34;
        const detected = new Promise<{ at: number; peak: number }>((resolve, reject) => {
          let strongestPeak = 0;
          let strongestAt = 0;
          const timeout = window.setTimeout(() => reject(new Error("沒有收到校正脈衝。請打開喇叭，或用實體 loopback 線連接輸出與輸入。")), 1800);
          processor.onaudioprocess = (event) => {
            const samples = event.inputBuffer.getChannelData(0);
            const bufferStart = event.playbackTime || context!.currentTime;
            for (let index = 0; index < samples.length; index += 1) {
              const absolute = Math.abs(samples[index]);
              const sampleTime = bufferStart + index / context!.sampleRate;
              if (sampleTime < clickAt + 0.006 || sampleTime > clickAt + 1.1) continue;
              if (absolute > strongestPeak) {
                strongestPeak = absolute;
                strongestAt = sampleTime;
              }
            }
            if (strongestPeak >= 0.045 && strongestAt > clickAt) {
              window.clearTimeout(timeout);
              processor.onaudioprocess = null;
              resolve({ at: strongestAt, peak: strongestPeak });
            }
          };
        });

        const oscillator = context.createOscillator();
        const clickGain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(2100 + pass * 170, clickAt);
        clickGain.gain.setValueAtTime(0.0001, clickAt);
        clickGain.gain.exponentialRampToValueAtTime(0.7, clickAt + 0.001);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, clickAt + 0.012);
        oscillator.connect(clickGain);
        clickGain.connect(context.destination);
        oscillator.start(clickAt);
        oscillator.stop(clickAt + 0.014);
        const result = await detected;
        measurements.push(Math.max(0, (result.at - clickAt) * 1000));
        peaks.push(result.peak);
        setLatencyProgress(`已完成 ${pass + 1}/3 次量測...`);
        await new Promise((resolve) => window.setTimeout(resolve, 160));
      }

      const sorted = [...measurements].sort((a, b) => a - b);
      const roundTripMs = sorted[1];
      const spreadMs = sorted.at(-1)! - sorted[0];
      const outputLatencyMs = outputLatencySeconds * 1000;
      const compensationMs = Math.max(0, roundTripMs - outputLatencyMs);
      const confidence = Math.max(0.2, Math.min(0.98, 1 - spreadMs / Math.max(12, roundTripMs) + Math.min(...peaks)));
      await readApiResponse(await fetch(`/api/daw-projects/${project.id}/latency-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputDeviceName: inputDeviceName || "系統預設輸入",
          outputDeviceName: outputDeviceName || "系統預設輸出",
          sampleRate: context.sampleRate,
          bufferFrames,
          measuredRoundTripMs: roundTripMs,
          inputLatencyMs: compensationMs,
          outputLatencyMs,
          compensationMs,
          method: "acoustic_loopback",
          confidence,
          measurement: { passesMs: measurements, spreadMs, peaks, contextBaseLatencyMs: (context.baseLatency || 0) * 1000 }
        })
      }));
      onLatencyChange(compensationMs);
      setLatencyProgress(`完成：往返 ${roundTripMs.toFixed(1)} ms，錄音補償 ${compensationMs.toFixed(1)} ms。`);
      onNotice(`延遲校正完成：補償 ${compensationMs.toFixed(1)} ms`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "延遲校正失敗。";
      setError(message);
      setLatencyProgress("");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      latencySessionRef.current = null;
      if (context) await context.close().catch(() => undefined);
      setBusy("");
    }
  }

  async function toggleNativePlayback() {
    setBusy("native-playback");
    setError("");
    try {
      if (nativePlayback?.status === "playing" && nativePlayback.playbackId) {
        const data = await readApiResponse<typeof nativePlayback>(await fetch(`/api/daw-projects/${project.id}/native-playback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", playbackId: nativePlayback.playbackId })
        }));
        setNativePlayback(data);
        onNotice("原生磁碟串流已停止");
      } else {
        const data = await readApiResponse<typeof nativePlayback>(await fetch(`/api/daw-projects/${project.id}/native-playback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", startSeconds: transportTime, outputDeviceName, masterGain: 1 })
        }));
        setNativePlayback(data);
        onNotice(`原生磁碟串流已啟動：${data?.scheduledClips ?? 0} 個片段`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "原生磁碟串流失敗。");
    } finally {
      setBusy("");
    }
  }

  async function patchTrack(payload: Record<string, unknown>, notice: string) {
    if (!selectedTrack) return;
    setBusy("track");
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-tracks/${selectedTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }));
      onProjectChange(data.project);
      await refreshHistory();
      onNotice(notice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "音軌設定失敗。");
    } finally {
      setBusy("");
    }
  }

  async function createBus() {
    setBusy("bus");
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-projects/${project.id}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Bus ${busTracks.length + 1}`, trackType: "bus", color: "#8b5cf6" })
      }));
      onProjectChange(data.project);
      onNotice("已建立 Bus 音軌");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法建立 Bus。");
    } finally {
      setBusy("");
    }
  }

  async function saveDsp() {
    if (!selectedTrack || !dspEdit || dspConflict || dspBusyRef.current || editsBlocked) return;
    if (!onOperationStart()) return;
    const trackId = selectedTrack.id;
    dspBusyRef.current = true;
    setBusy("dsp"); setError("");
    try {
      const response = await fetch(`/api/daw-tracks/${trackId}/dsp`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dspEdit)
      });
      if (response.status === 409) {
        const conflict = await response.json() as { project?: DawProjectDto; error?: string };
        if (conflict.project) onProjectChange(conflict.project);
        throw new Error(conflict.error ?? "音軌效果已在別處修改。");
      }
      const data = await readApiResponse<{ project: DawProjectDto; operationId: string }>(response);
      onProjectChange(data.project);
      discardDsp(trackId);
      setDspHistory({ operationId: data.operationId, undone: false });
      await refreshHistory();
      onNotice("DSP 已儲存");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "DSP 儲存失敗，草稿已保留。"); }
    finally { dspBusyRef.current = false; setBusy(""); onOperationEnd(); }
  }

  async function stepDspHistory() {
    if (!dspHistory || dspEdit || dspBusyRef.current || editsBlocked) return;
    if (!onOperationStart()) return;
    dspBusyRef.current = true; setBusy("dsp-history"); setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto; history: HistorySummary }>(await fetch(`/api/daw-projects/${project.id}/history`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dspHistory.undone ? "redo" : "undo", expectedOperationId: dspHistory.operationId })
      }));
      onProjectChange(data.project); setHistory(data.history);
      setDspHistory({ ...dspHistory, undone: !dspHistory.undone });
      onNotice(dspHistory.undone ? "已重做 DSP" : "已復原 DSP");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "DSP 復原失敗。"); }
    finally { dspBusyRef.current = false; setBusy(""); onOperationEnd(); }
  }

  async function createRoute() {
    if (!selectedTrack) return;
    if (!routeCanCreate) {
      setError(routeType === "sidechain" ? "請選擇另一條音軌作為 Sidechain 來源。" : "請先建立並選擇一個 Bus 音軌。");
      return;
    }
    setBusy("route");
    setError("");
    try {
      const destinationTrackId = routeDestination || null;
      const destination = project.tracks.find((track) => track.id === destinationTrackId);
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-projects/${project.id}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTrackId: selectedTrack.id,
          destinationTrackId,
          routeType,
          name: `${selectedTrack.name} → ${destination?.name ?? "Master"}`,
          preFader: routeType === "cue",
          gain: routeType === "output" ? 1 : routeGain,
          pan: 0,
          muted: false
        })
      }));
      onProjectChange(data.project);
      await refreshHistory();
      onNotice(`已建立 ${routeType.toUpperCase()} 路由`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "路由建立失敗。");
    } finally {
      setBusy("");
    }
  }

  async function updateRoute(routeId: string, payload: Record<string, unknown>) {
    setBusy(`route-${routeId}`);
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }));
      onProjectChange(data.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "路由更新失敗。");
    } finally {
      setBusy("");
    }
  }

  async function deleteRoute(routeId: string) {
    setBusy(`route-${routeId}`);
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-routes/${routeId}`, { method: "DELETE" }));
      onProjectChange(data.project);
      onNotice("路由已刪除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "路由刪除失敗。");
    } finally {
      setBusy("");
    }
  }

  function changeAutomation(change: AutomationDraftPatch | ((view: AutomationDraftView) => AutomationDraftPatch)) {
    if (automationEditingBlocked || automationSaveRef.current) return;
    setAutomationDrafts(current => editAutomationDraft(current, automationKey, currentAutomationLane, currentAutomationDefinition, change));
  }

  function addAutomationPoint() {
    changeAutomation(view => {
      const point = { timeSeconds: Math.max(0, transportTime), value: view.value, curve: "smooth" as const };
      return { points: [...view.data.points.filter(item => Math.abs(item.timeSeconds - point.timeSeconds) > 0.01), point] };
    });
  }

  function discardCurrentAutomation() {
    if (!selectedTrack || automationSaveRef.current) return;
    setAutomationDrafts(current => discardAutomationDraft(current, automationKey));
  }

  async function saveAutomation() {
    if (!selectedTrack || automationEditingBlocked || automationSaveRef.current) return;
    const snapshot = prepareAutomationSave(automationDrafts, automationKey, currentAutomationLane, currentAutomationDefinition);
    if (!snapshot) return;
    if (!onOperationStart()) {
      setError("目前有錄音或其他操作進行中，Automation 草稿已保留，稍後可再儲存。");
      return;
    }
    const trackId = selectedTrack.id;
    const parameter = automationParameter;
    const definition = currentAutomationDefinition;
    const session = automationSession;
    automationSaveRef.current = snapshot;
    setAutomationSavingKey(snapshot.key);
    setBusy("automation");
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto | null }>(await fetch(`/api/daw-tracks/${trackId}/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameter, ...snapshot.payload })
      }));
      if (automationSessionRef.current !== session) return;
      const savedLane = data.project?.tracks.find(track => track.id === trackId)?.automationLanes.find(lane => lane.parameter === parameter);
      if (!data.project || data.project.id !== session.projectId || !savedLane) throw new Error("伺服器未回傳可核對的 Automation 設定。");
      onProjectChange(data.project);
      setAutomationDrafts(current => completeAutomationSave(current, snapshot, savedLane, definition));
      const responseMatches = automationPayloadRevision(readAutomationDraft(undefined, savedLane, definition).data) === automationPayloadRevision(snapshot.payload);
      onNotice(responseMatches ? `${definition.label} Automation 已儲存` : `${definition.label} Automation 已回傳較新設定，草稿已保留，請檢查衝突。`);
      // History is project-scoped too: a delayed result must not replace the
      // history in a different project opened while this save was pending.
      void fetch(`/api/daw-projects/${session.projectId}/history`, { cache: "no-store" })
        .then(response => readApiResponse<HistorySummary>(response))
        .then(summary => { if (automationSessionRef.current === session) setHistory(summary); })
        .catch(() => undefined);
    } catch (caught) {
      if (automationSessionRef.current === session) setError(`${caught instanceof Error ? caught.message : "Automation 儲存失敗。"} 草稿已保留，可再次儲存。`);
    } finally {
      if (automationSaveRef.current === snapshot) automationSaveRef.current = null;
      if (automationSessionRef.current) {
        setAutomationSavingKey(null);
        setBusy(current => current === "automation" ? "" : current);
      }
      onOperationEnd();
    }
  }

  async function addCompSegment() {
    if (!activeTakeLane) {
      setError("目前沒有可用的 Take lane。");
      return;
    }
    const sourceEndSeconds = Math.max(compSourceStart + 0.05, compSourceEnd);
    setBusy("comp-segment");
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-take-lanes/${activeTakeLane.lane.id}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceStartSeconds: compSourceStart,
          sourceEndSeconds,
          timelineStartSeconds: punchOut > punchIn ? punchIn : transportTime,
          fadeInSeconds: 0.012,
          fadeOutSeconds: 0.012,
          active: true
        })
      }));
      onProjectChange(data.project);
      await refreshHistory();
      onNotice("已加入一段 Take Comp 選區");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Comp 區段建立失敗。");
    } finally {
      setBusy("");
    }
  }

  async function deleteCompSegment(segmentId: string) {
    setBusy(`comp-${segmentId}`);
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto }>(await fetch(`/api/daw-comp-segments/${segmentId}`, { method: "DELETE" }));
      onProjectChange(data.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Comp 區段刪除失敗。");
    } finally {
      setBusy("");
    }
  }

  async function materializeComp() {
    if (!activeTakeLane) return;
    setBusy("materialize-comp");
    setError("");
    try {
      const data = await readApiResponse<{ project: DawProjectDto; createdClipCount: number }>(await fetch(`/api/daw-take-lanes/${activeTakeLane.lane.id}/comp`, { method: "POST" }));
      onProjectChange(data.project);
      await refreshHistory();
      onNotice(`Take Comp 已落地為 ${data.createdClipCount} 個非破壞性片段`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Take Comp 建立失敗。");
    } finally {
      setBusy("");
    }
  }

  const tabs = useMemo(() => [
    { id: "safety" as const, label: "錄音安全", icon: ShieldCheck },
    { id: "editing" as const, label: "精準編輯", icon: Crosshair },
    { id: "takes" as const, label: "Take Comp", icon: Layers3 },
    { id: "mixer" as const, label: "Mixer 路由", icon: Route },
    { id: "dsp" as const, label: "DSP", icon: SlidersHorizontal },
    { id: "automation" as const, label: "Automation", icon: AudioWaveform }
  ], []);

  return (
    <section className="daw-pro-console" aria-label="DAW 專業控制台">
      <header className="daw-pro-console-header">
        <div>
          <span className="daw-pro-eyebrow"><Zap size={13} /> Professional Core</span>
          <h2>專業控制台</h2>
          <p>校正、復原、精準剪輯、Comp、路由與自動化都保留非破壞性歷史。</p>
        </div>
        <div className="daw-pro-header-status">
          <span className={healthIsClean ? "is-good" : "is-watch"}><Activity size={14} /> {healthIsClean ? "引擎穩定" : health?.mode === "web_fallback" ? "Web fallback" : "待檢查"}</span>
          <span><History size={14} /> {project.editOperations.length} 筆歷史</span>
          <span className={pendingRecoveryCount ? "is-watch" : "is-good"}><HardDrive size={14} /> {pendingRecoveryCount ? `${pendingRecoveryCount} 筆待復原` : "日誌正常"}</span>
        </div>
      </header>

      <nav className="daw-pro-tabs" aria-label="專業控制台分類">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}><Icon size={15} />{item.label}</button>;
        })}
      </nav>

      {error ? <div className="daw-pro-error" role="alert"><AlertTriangle size={16} />{error}<button type="button" onClick={() => setError("")} aria-label="關閉錯誤">×</button></div> : null}

      {tab === "safety" ? (
        <div className="daw-pro-body daw-pro-safety">
          <div className="daw-pro-primary">
            <div className="daw-pro-section-heading">
              <div><h3>引擎健康</h3><p>數值來自真實 callback、磁碟與錄音訊號，不使用假電平。</p></div>
              <div className="daw-pro-inline-actions">
                <button type="button" onClick={() => void refreshHealth(false)} disabled={Boolean(busy)}><RefreshCw size={14} />重新檢查</button>
                <button type="button" onClick={() => void refreshHealth(true)} disabled={Boolean(busy)}><Save size={14} />保存快照</button>
              </div>
            </div>
            <div className="daw-pro-metric-grid">
              <div><span>Peak</span><strong>{peakToDb(healthRecording?.peak ?? latestHealth?.peak ?? 0)}</strong></div>
              <div><span>RMS</span><strong>{peakToDb(healthRecording?.rms ?? latestHealth?.rms ?? 0)}</strong></div>
              <div className={(healthRecording?.xrunCount ?? latestHealth?.xrunCount ?? 0) ? "danger" : ""}><span>XRUN</span><strong>{healthRecording?.xrunCount ?? latestHealth?.xrunCount ?? 0}</strong></div>
              <div className={(healthRecording?.outputUnderflowCount ?? latestHealth?.outputUnderflowCount ?? 0) ? "danger" : ""}><span>Underrun</span><strong>{healthRecording?.outputUnderflowCount ?? latestHealth?.outputUnderflowCount ?? 0}</strong></div>
              <div><span>Callback</span><strong>{Math.round((healthRecording?.callbackLoad ?? latestHealth?.callbackLoad ?? 0) * 100)}%</strong></div>
              <div><span>可用磁碟</span><strong>{formatBytes(healthRecording?.freeDiskBytes ?? (latestHealth?.freeDiskBytes ? Number(latestHealth.freeDiskBytes) : null))}</strong></div>
            </div>
            <div className="daw-pro-meter-row">
              <span>輸入真實峰值</span>
              <div><i style={{ width: `${Math.min(100, Math.max(1, (healthRecording?.peak ?? latestHealth?.peak ?? 0) * 100))}%` }} /></div>
              <em>{healthRecording?.clipping || latestHealth?.clipping ? "CLIP" : "SAFE"}</em>
            </div>
            <div className="daw-pro-native-stream">
              <span><HardDrive size={15} /><strong>原生磁碟串流</strong><small>長音檔不先載入記憶體；效果編輯仍可切回 Web Audio。</small></span>
              <em>{nativePlayback?.status === "playing" ? `${nativePlayback.scheduledClips ?? 0} clips · ${(nativePlayback.elapsedSeconds ?? 0).toFixed(1)}s` : "待命"}</em>
              <button type="button" onClick={() => void toggleNativePlayback()} disabled={Boolean(busy)}>{nativePlayback?.status === "playing" ? "停止" : "從播放頭試聽"}</button>
            </div>
          </div>

          <aside className="daw-pro-side">
            <div className="daw-pro-section-heading"><div><h3>實測延遲補償</h3><p>請讓麥克風能收到喇叭脈衝；實體 loopback 線最準。</p></div><Cable size={19} /></div>
            <dl className="daw-pro-readout">
              <div><dt>目前補償</dt><dd>{latestLatency ? `${latestLatency.compensationMs.toFixed(1)} ms` : "未校正"}</dd></div>
              <div><dt>Buffer</dt><dd>{bufferFrames} frames</dd></div>
              <div><dt>可信度</dt><dd>{latestLatency ? `${Math.round(latestLatency.confidence * 100)}%` : "--"}</dd></div>
            </dl>
            <button className="daw-pro-primary-action" type="button" onClick={() => void runLatencyCalibration()} disabled={Boolean(busy)}><Radio size={15} />{busy === "latency" ? "校正中" : "開始三次實測"}</button>
            {latencyProgress ? <p className="daw-pro-progress">{latencyProgress}</p> : null}
          </aside>

          <div className="daw-pro-recovery">
            <div className="daw-pro-section-heading">
              <div><h3>事故錄音復原</h3><p>原生錄音先寫入安全暫存 WAV；斷電或閃退後可修復檔頭並入庫。</p></div>
              <button type="button" onClick={() => void refreshRecovery()} disabled={Boolean(busy)}><RefreshCw size={14} />掃描</button>
            </div>
            {recoverableFiles.length ? (
              <div className="daw-pro-recovery-list">
                {recoverableFiles.map((file) => <div key={file.relativePath}><Waves size={15} /><span><strong>{file.relativePath.split("/").at(-1)}</strong><small>{formatBytes(file.fileSizeBytes)} · {file.recoverable ? "可修復" : "需人工檢查"}</small></span></div>)}
                <button className="daw-pro-primary-action" type="button" onClick={() => void recoverRecordings()} disabled={Boolean(busy)}><ShieldCheck size={15} />全部安全復原</button>
              </div>
            ) : <p className="daw-pro-empty"><Check size={15} />沒有未完成的安全暫存錄音。</p>}
          </div>
        </div>
      ) : null}

      {tab === "editing" ? (
        <div className="daw-pro-body daw-pro-editing">
          <div className="daw-pro-history-strip">
            <div><History size={17} /><span><strong>可持久化編輯歷史</strong><small>重新開啟 App 後仍可 Undo／Redo</small></span></div>
            <button type="button" onClick={() => void stepHistory("undo")} disabled={!history.canUndo || Boolean(busy)} title={history.undoLabel ?? "沒有可復原動作"}><Undo2 size={16} />復原</button>
            <button type="button" onClick={() => void stepHistory("redo")} disabled={!history.canRedo || Boolean(busy)} title={history.redoLabel ?? "沒有可重做動作"}><Redo2 size={16} />重做</button>
          </div>
          <div className="daw-pro-tool-grid">
            <button type="button" onClick={() => void runPrecision("start")} disabled={!selectedClipId || Boolean(busy)}><Crosshair size={18} /><span><strong>起點零交越</strong><small>搜尋 ±24 ms 真實 PCM 零交越</small></span></button>
            <button type="button" onClick={() => void runPrecision("end")} disabled={!selectedClipId || Boolean(busy)}><Crosshair size={18} /><span><strong>終點零交越</strong><small>避免剪輯點爆裂聲</small></span></button>
            <button type="button" onClick={() => void runPrecision("crossfade")} disabled={!selectedClipId || Boolean(busy)}><ArrowLeftRight size={18} /><span><strong>自動 Crossfade</strong><small>與相鄰片段建立 12 ms 交叉淡化</small></span></button>
            <button type="button" onClick={() => void runPrecision("group")} disabled={selectedClipIds.length < 2 || Boolean(busy)}><Group size={18} /><span><strong>片段群組</strong><small>{selectedClipIds.length} 個已選片段同步編輯</small></span></button>
          </div>
          <p className="daw-pro-selection-note">目前片段：{selectedClipId ? selectedClipId.slice(-8) : "未選取"} · 多選 {selectedClipIds.length} 個</p>
        </div>
      ) : null}

      {tab === "takes" ? (
        <div className="daw-pro-body daw-pro-takes">
          <div className="daw-pro-take-setup">
            <label>Take 來源<select value={activeTakeLane?.lane.id ?? ""} onChange={(event) => setActiveTakeLaneId(event.target.value)}>{takeLanes.map(({ lane, track }) => <option key={lane.id} value={lane.id}>{track.name} · {lane.recordingTake.label}</option>)}</select></label>
            <label>來源開始<input type="number" min="0" step="0.01" value={compSourceStart} onChange={(event) => setCompSourceStart(Math.max(0, Number(event.target.value) || 0))} /></label>
            <label>來源結束<input type="number" min="0.05" step="0.01" value={compSourceEnd} onChange={(event) => setCompSourceEnd(Math.max(0.05, Number(event.target.value) || 0.05))} /></label>
            <button type="button" onClick={() => { setCompSourceStart(Math.max(0, punchIn)); setCompSourceEnd(Math.max(punchIn + 0.05, punchOut)); }} disabled={punchOut <= punchIn}><Crosshair size={14} />套用 Punch</button>
            <button className="daw-pro-primary-action" type="button" onClick={() => void addCompSegment()} disabled={!activeTakeLane || Boolean(busy)}><Plus size={15} />加入 Comp 區段</button>
          </div>
          <div className="daw-pro-comp-lane">
            <header><div><strong>{activeTakeLane?.track.name ?? "尚無 Take"}</strong><small>{activeTakeLane?.lane.recordingTake.label ?? "錄製 Take 後即可 comp"}</small></div><span>{activeTakeLane?.lane.compSegments.length ?? 0} 區段</span></header>
            {activeTakeLane?.lane.compSegments.length ? activeTakeLane.lane.compSegments.map((segment, index) => (
              <div className={segment.active ? "daw-pro-comp-segment active" : "daw-pro-comp-segment"} key={segment.id}>
                <span>{index + 1}</span>
                <strong>{formatTime(segment.sourceStartSeconds)} → {formatTime(segment.sourceEndSeconds)}</strong>
                <small>放到 {formatTime(segment.timelineStartSeconds)} · 淡入/出 {Math.round(segment.fadeInSeconds * 1000)}/{Math.round(segment.fadeOutSeconds * 1000)} ms</small>
                <button type="button" onClick={() => void deleteCompSegment(segment.id)} disabled={Boolean(busy)} aria-label="刪除 Comp 區段"><Trash2 size={14} /></button>
              </div>
            )) : <p className="daw-pro-empty">先選一段來源時間，再加入 Comp。原始 Take 不會被裁掉。</p>}
            <button className="daw-pro-primary-action" type="button" onClick={() => void materializeComp()} disabled={!activeTakeLane?.lane.compSegments.some((segment) => segment.active) || Boolean(busy)}><Sparkles size={15} />建立非破壞性 Comp</button>
          </div>
        </div>
      ) : null}

      {tab === "mixer" ? (
        <div className="daw-pro-body daw-pro-mixer">
          <div className="daw-pro-channel-strip">
            <header><div><strong>{selectedTrack?.name ?? "未選音軌"}</strong><small>{selectedTrack?.trackType ?? "--"} · I/O 與相位</small></div><SlidersHorizontal size={18} /></header>
            <div className="daw-pro-channel-controls">
              <label>輸入<input key={`${selectedTrack?.id}-${selectedTrack?.inputSource}`} defaultValue={selectedTrack?.inputSource ?? "系統預設"} onBlur={(event) => void patchTrack({ inputSource: event.target.value }, "輸入來源已更新")} disabled={!selectedTrack || Boolean(busy)} /></label>
              <label>聲道<select value={selectedTrack?.stereoMode ?? "stereo"} onChange={(event) => void patchTrack({ stereoMode: event.target.value }, "聲道模式已更新")} disabled={!selectedTrack || Boolean(busy)}><option value="mono">Mono</option><option value="stereo">Stereo</option><option value="mid_side">Mid / Side</option></select></label>
              <button className={selectedTrack?.polarityInverted ? "active" : ""} type="button" onClick={() => void patchTrack({ polarityInverted: !selectedTrack?.polarityInverted }, "極性已切換")} disabled={!selectedTrack || Boolean(busy)}><AudioWaveform size={15} />Ø 極性</button>
            </div>
          </div>

          <div className="daw-pro-route-builder">
            <div className="daw-pro-section-heading"><div><h3>Bus / Send / Cue</h3><p>建立真實路由；Cue 預設為 pre-fader，適合耳機混音。</p></div><button type="button" onClick={() => void createBus()} disabled={Boolean(busy)}><Plus size={14} />Bus</button></div>
            <div className="daw-pro-route-form">
              <select value={routeType} onChange={(event) => setRouteType(event.target.value as typeof routeType)}><option value="output">Output</option><option value="send">Send</option><option value="cue">Cue</option><option value="sidechain">Sidechain</option></select>
              <select value={routeDestination} onChange={(event) => setRouteDestination(event.target.value)} disabled={routeType !== "output" && !availableRouteDestinations.length}>
                {routeType === "output" ? <option value="">Master</option> : null}
                {!availableRouteDestinations.length && routeType !== "output" ? <option value="">{routeType === "sidechain" ? "沒有其他音軌" : "請先建立 Bus"}</option> : null}
                {availableRouteDestinations.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
              <label>Gain<input type="range" min="0" max="2" step="0.01" value={routeGain} onChange={(event) => setRouteGain(Number(event.target.value))} /><span>{routeGain.toFixed(2)}</span></label>
              <button className="daw-pro-primary-action" type="button" onClick={() => void createRoute()} disabled={!routeCanCreate}><GitBranch size={15} />建立路由</button>
            </div>
            <div className="daw-pro-route-list">
              {routingForTrack.map((route) => {
                const destination = project.tracks.find((track) => track.id === route.destinationTrackId)?.name ?? "Master";
                return <div key={`${route.id}-${route.updatedAt}`}><span className="daw-pro-route-type">{route.routeType}</span><strong>{route.name}</strong><small>{destination} · {route.preFader ? "Pre" : "Post"}</small><input aria-label={`${route.name} gain`} type="range" min="0" max="2" step="0.01" defaultValue={route.gain} onPointerUp={(event) => void updateRoute(route.id, { gain: Number(event.currentTarget.value) })} onKeyUp={(event) => void updateRoute(route.id, { gain: Number(event.currentTarget.value) })} /><button type="button" className={route.muted ? "active" : ""} onClick={() => void updateRoute(route.id, { muted: !route.muted })}>{route.muted ? "開啟" : "靜音"}</button><button type="button" onClick={() => void deleteRoute(route.id)} aria-label="刪除路由"><Trash2 size={14} /></button></div>;
              })}
              {!routingForTrack.length ? <p className="daw-pro-empty">此音軌目前直接送到 Master，尚未建立額外路由。</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "dsp" ? (
        <div className="daw-pro-body daw-pro-dsp">
          <div className="daw-pro-section-heading">
            <div><h3>專業 Channel Strip</h3><p>{selectedTrack?.name ?? "未選音軌"} · {dspEdit ? "未儲存" : "已儲存"} · {dspDraft.effectsBypassed ? "旁通" : "啟用"}</p></div>
            <button type="button" aria-label={dspHistory?.undone ? "重做 DSP" : "復原 DSP"} title={dspHistory?.undone ? "重做 DSP" : "復原 DSP"} onClick={() => void stepDspHistory()} disabled={!dspHistory || Boolean(dspEdit) || Boolean(busy) || editsBlocked}>{dspHistory?.undone ? <Redo2 size={14} /> : <Undo2 size={14} />}</button>
            <button type="button" aria-label="放棄 DSP 草稿" title="放棄 DSP 草稿" onClick={() => selectedTrack && discardDsp(selectedTrack.id)} disabled={!dspEdit || Boolean(busy)}><RefreshCw size={14} /></button>
            <label><input type="checkbox" checked={!dspDraft.effectsBypassed} onChange={event => changeDsp({ effectsBypassed: !event.target.checked })} disabled={!selectedTrack || Boolean(busy) || editsBlocked || dspConflict} />啟用 DSP</label>
            <button className="daw-pro-primary-action" type="button" onClick={() => void saveDsp()} disabled={!selectedTrack || !dspEdit || dspConflict || Boolean(busy) || editsBlocked}><Save size={14} />儲存 DSP</button>
          </div>
          {dspConflict ? <p role="alert">音軌效果已在別處變更；草稿未覆蓋新設定，請放棄草稿後重新調整。</p> : null}
          {editsBlocked ? <p role="status">錄音、其他操作或儲存進行中，DSP 編輯暫停。</p> : null}
          <div className="daw-pro-dsp-grid">
            {([
              ["highPassHz", "高通濾波", 20, 2000, 1, "Hz"],
              ["lowPassHz", "低通濾波", 2000, 22_000, 10, "Hz"],
              ["lowGain", "低頻增益", -12, 12, 0.1, "dB"],
              ["midGain", "中頻增益", -12, 12, 0.1, "dB"],
              ["highGain", "高頻增益", -12, 12, 0.1, "dB"],
              ["midFrequency", "中頻中心", 120, 12_000, 10, "Hz"],
              ["midQ", "中頻 Q", 0.2, 12, 0.05, "Q"],
              ["compression", "壓縮", 0, 1, 0.01, "%"],
              ["noiseGate", "Noise Gate", 0, 1, 0.01, "%"],
              ["echo", "回音", 0, 1, 0.01, "%"],
              ["reverb", "殘響", 0, 1, 0.01, "%"]
            ] as Array<[DspKey, string, number, number, number, string]>).map(([key, label, min, max, step, unit]) => (
              <label key={key}>
                <span>{label}<strong>{unit === "%" ? `${Math.round(dspDraft[key] * 100)}%` : `${Math.round(dspDraft[key] * 100) / 100} ${unit}`}</strong></span>
                <input aria-label={label} type="range" min={min} max={max} step={step} value={dspDraft[key]} disabled={!selectedTrack || Boolean(busy) || editsBlocked || dspConflict || selectedTrack.automationLanes.some(lane => lane.parameter === key && lane.enabled && lane.mode !== "off")} title={selectedTrack?.automationLanes.some(lane => lane.parameter === key && lane.enabled && lane.mode !== "off") ? "此參數由 Automation 控制" : label} onChange={(event) => changeDsp({ [key]: Number(event.target.value), effectsBypassed: false })} />
              </label>
            ))}
          </div>
          <div className="daw-pro-dsp-signal-flow"><span>Input</span><i /><span>Gate</span><i /><span>HPF / LPF</span><i /><span>Parametric EQ</span><i /><span>Compressor</span><i /><span>Echo / Reverb</span><i /><span>Bus</span></div>
        </div>
      ) : null}

      {tab === "automation" ? (
        <div className="daw-pro-body daw-pro-automation">
          <div className="daw-pro-automation-header">
            <label>參數<select aria-label="Automation 參數" value={automationParameter} onChange={(event) => setAutomationParameter(event.target.value as typeof automationParameter)}>{AUTOMATION_PARAMETERS.map((parameter) => <option key={parameter.value} value={parameter.value}>{parameter.label}</option>)}</select></label>
            <label>模式<select aria-label="Automation 模式" value={automationMode} disabled={automationEditingBlocked} onChange={(event) => changeAutomation({ mode: event.target.value as AutomationMode, enabled: event.target.value !== "off" })}><option value="off">Off</option><option value="read">Read</option><option value="touch">Touch</option><option value="latch">Latch</option><option value="write">Write</option></select></label>
            <label className="daw-pro-automation-value">值<input aria-label="Automation 值" type="range" min={currentAutomationDefinition.min} max={currentAutomationDefinition.max} step="0.01" value={automationValue} disabled={automationEditingBlocked} onChange={(event) => changeAutomation({ value: Number(event.target.value) })} /><strong>{automationValue.toFixed(2)}</strong></label>
            <button type="button" onClick={addAutomationPoint} disabled={automationEditingBlocked}><Plus size={14} />在 {formatTime(transportTime)} 加點</button>
            <button className="daw-pro-primary-action" type="button" aria-label="儲存 Automation" onClick={() => void saveAutomation()} disabled={automationEditingBlocked || !automationDraft.dirty}><Save size={14} />{automationSavingKey === automationKey ? "儲存中" : "儲存"}</button>
            <button type="button" aria-label="放棄 Automation 草稿" onClick={discardCurrentAutomation} disabled={!selectedTrack || !automationDrafts[automationKey] || Boolean(automationSavingKey)}><RefreshCw size={14} />放棄草稿</button>
          </div>
          <p className="daw-pro-selection-note" role="status" aria-label="Automation 草稿狀態">
            {selectedTrack?.name ?? "未選音軌"} · {currentAutomationDefinition.label} · {automationSavingKey === automationKey ? "儲存中" : automationDraft.dirty ? "未儲存" : currentAutomationLane ? "已儲存" : "尚未建立"}
            {unsavedAutomationCount ? ` · 此專案有 ${unsavedAutomationCount} 組未儲存 Automation` : ""}
          </p>
          {automationDraft.conflict ? <p className="daw-pro-error" role="alert" aria-label="Automation 草稿衝突">此參數的已儲存設定已變更；你的草稿仍保留，儲存已暫停。放棄此草稿可載入最新設定，再重新調整。</p> : null}
          {editsBlocked && !automationSavingKey ? <p className="daw-pro-selection-note" role="status">錄音或其他操作進行中，Automation 草稿已保留，稍後可繼續編輯與儲存。</p> : null}
          <div className="daw-pro-automation-lane">
            <div className="daw-pro-automation-scale"><span>{currentAutomationDefinition.max}</span><span>{currentAutomationDefinition.min}</span></div>
            <div className="daw-pro-automation-canvas">
              <svg viewBox="0 0 1000 180" preserveAspectRatio="none" aria-label={`${currentAutomationDefinition.label} automation curve`}>
                <polyline points={(automationPoints.length ? automationPoints : [{ timeSeconds: 0, value: currentAutomationDefinition.defaultValue }]).map((point) => {
                  const duration = Math.max(project.durationSeconds, transportTime, 30);
                  const x = Math.min(1000, (point.timeSeconds / duration) * 1000);
                  const y = 180 - ((point.value - currentAutomationDefinition.min) / Math.max(0.001, currentAutomationDefinition.max - currentAutomationDefinition.min)) * 180;
                  return `${x},${Math.max(0, Math.min(180, y))}`;
                }).join(" ")} />
                {automationPoints.map((point, index) => {
                  const duration = Math.max(project.durationSeconds, transportTime, 30);
                  const x = Math.min(1000, (point.timeSeconds / duration) * 1000);
                  const y = 180 - ((point.value - currentAutomationDefinition.min) / Math.max(0.001, currentAutomationDefinition.max - currentAutomationDefinition.min)) * 180;
                  return <circle key={`${point.timeSeconds}-${index}`} cx={x} cy={Math.max(0, Math.min(180, y))} r="7" />;
                })}
              </svg>
            </div>
          </div>
          <div className="daw-pro-automation-points">
            {automationPoints.map((point, index) => <button key={`${point.timeSeconds}-${index}`} type="button" aria-label={`刪除 Automation 控制點 ${formatTime(point.timeSeconds)}`} disabled={automationEditingBlocked} onClick={() => changeAutomation(view => ({ points: view.data.points.filter((_, pointIndex) => pointIndex !== index) }))}><span>{formatTime(point.timeSeconds)}</span><strong>{point.value.toFixed(2)}</strong><Trash2 size={13} /></button>)}
            {!automationPoints.length ? <p className="daw-pro-empty">尚未有控制點。移動播放頭、設定數值，再加入控制點。</p> : null}
          </div>
          <p className="daw-pro-selection-note">{selectedTrack?.name ?? "未選音軌"} · {currentAutomationLane ? `${currentAutomationLane.points.length} 個已儲存控制點` : "尚未建立 Automation lane"}</p>
          <p className="daw-pro-selection-note">切換音軌與參數會保留本頁草稿；關閉或重新整理頁面前，請逐項儲存。</p>
        </div>
      ) : null}
    </section>
  );
}

export function useDawRecoveryJournal(project: DawProjectDto) {
  const sessionIdRef = useRef(newSessionId());
  const sequenceRef = useRef(0);
  const lastUpdatedAtRef = useRef("");

  useEffect(() => {
    if (!project.updatedAt || lastUpdatedAtRef.current === project.updatedAt) return;
    lastUpdatedAtRef.current = project.updatedAt;
    const timer = window.setTimeout(() => {
      sequenceRef.current += 1;
      void fetch(`/api/daw-projects/${project.id}/recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          eventType: "autosave_checkpoint",
          payload: {
            sequence: sequenceRef.current,
            projectUpdatedAt: project.updatedAt,
            trackCount: project.tracks.length,
            clipCount: project.tracks.reduce((total, track) => total + track.clips.length, 0),
            activeEditSequence: project.editOperations.find((operation) => operation.status === "APPLIED")?.sequence ?? null
          }
        })
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    const resolveSession = () => {
      void fetch(`/api/daw-projects/${project.id}/recovery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, status: "RESOLVED" }),
        keepalive: true
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", resolveSession);
    return () => {
      window.removeEventListener("pagehide", resolveSession);
      void fetch(`/api/daw-projects/${project.id}/recovery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, status: "RESOLVED" }),
        keepalive: true
      }).catch(() => undefined);
    };
  }, [project.id]);
}
