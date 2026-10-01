"use client";

import {
  CheckCircle2,
  CloudUpload,
  FolderInput,
  Link2Off,
  Mic,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MobileTrack = {
  id: string;
  name: string;
  trackType: string;
};

type MobileSong = {
  id: string;
  title: string;
  bpm: number | null;
  musicalKey: string | null;
  project: { id: string; tracks: MobileTrack[] } | null;
};

type RecordingContext = {
  version: string | null;
  songs: MobileSong[];
};

type NativeCapabilities = {
  native: boolean;
  platform: string;
  format: string;
  preferredSampleRate: number;
  preferredBitDepth: number;
  inputAvailable: boolean;
  pendingCount: number;
};

type NativeRecordingStatus = {
  recording: boolean;
  id?: string;
  elapsedSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  level?: number;
  averagePowerDb?: number;
  peakPowerDb?: number;
  inputDeviceLabel?: string;
  error?: string;
};

type NativeRecording = {
  id: string;
  fileName: string;
  label: string;
  createdAt: string;
  durationSeconds: number;
  fileSizeBytes: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  sha256: string;
  inputDeviceLabel: string;
  uploaded: boolean;
  uploadedAt?: string;
  serverAudioFileId?: string;
};

type MobileRecorderPlugin = {
  capabilities: () => Promise<NativeCapabilities>;
  start: (options: { label: string; sampleRate: number; bitDepth: number; channels: number }) => Promise<NativeRecordingStatus>;
  status: () => Promise<NativeRecordingStatus>;
  stop: () => Promise<NativeRecording>;
  list: () => Promise<{ recordings: NativeRecording[] }>;
  readChunk: (options: { id: string; offset: number; length: number }) => Promise<{ data: string }>;
  markUploaded: (options: { id: string; serverAudioFileId: string }) => Promise<void>;
};

type RecordingDestination = {
  songId: string;
  songTitle: string;
  dawTrackId: string | null;
  targetInstrument: "vocal" | "guitar" | "piano" | "bass" | "drums" | "other";
  label: string;
  targetBpm: number | null;
  targetKey: string;
};

type UploadJob = {
  uploadId: string;
  uploadToken: string;
  chunkSizeBytes: number;
};

type CapacitorWindow = Window & {
  Capacitor?: {
    getPlatform?: () => string;
    Plugins?: { MobileRecorder?: MobileRecorderPlugin };
  };
};

const recordingContextKey = "songzu.mobile.recordingContext";
const recordingDraftKey = "songzu.mobile.recordingDrafts";
const uploadJobKey = "songzu.mobile.uploadJobs";
const launcherKey = "songzu.mobile.launcherUrl";

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function saveStoredJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function recorderPlugin() {
  return (window as CapacitorWindow).Capacitor?.Plugins?.MobileRecorder ?? null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "發生未知錯誤");
}

function formatDuration(value: number, precise = false) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${precise ? remainder.toFixed(1).padStart(4, "0") : String(Math.floor(remainder)).padStart(2, "0")}`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDb(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > -99 ? `${Number(value).toFixed(1)} dB` : "-∞ dB";
}

function base64ArrayBuffer(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function validLauncher(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "localhost" || !["http:", "https:", "capacitor:"].includes(url.protocol)) return "";
    return url.protocol === "capacitor:" ? `${url.protocol}//${url.host}` : url.origin;
  } catch {
    return "";
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options, signal: controller.signal });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}

export function MobileNativeRecorder() {
  const router = useRouter();
  const pollingRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hostOnline, setHostOnline] = useState(true);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const [capabilities, setCapabilities] = useState<NativeCapabilities | null>(null);
  const [context, setContext] = useState<RecordingContext>(() => ({ version: null, songs: [] }));
  const [recordings, setRecordings] = useState<NativeRecording[]>([]);
  const [songId, setSongId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [instrument, setInstrument] = useState<RecordingDestination["targetInstrument"]>("vocal");
  const [label, setLabel] = useState("手機錄音");
  const [activeRecordingId, setActiveRecordingId] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputPeakDb, setInputPeakDb] = useState<number | undefined>(undefined);
  const [inputDevice, setInputDevice] = useState("等待偵測");
  const [recordingFormat, setRecordingFormat] = useState("48 kHz / 24-bit WAV / Mono");
  const [status, setStatus] = useState<{ state: "checking" | "ready" | "recording" | "syncing" | "error"; title: string; message: string }>({
    state: "checking",
    title: "檢查錄音引擎",
    message: "正在確認手機麥克風與本機保存空間。"
  });
  const [syncingId, setSyncingId] = useState("");
  const [syncProgress, setSyncProgress] = useState(0);

  const selectedSong = useMemo(() => context.songs.find((song) => song.id === songId) ?? null, [context.songs, songId]);
  const tracks = useMemo(() => selectedSong?.project?.tracks ?? [], [selectedSong]);
  const pendingCount = recordings.filter((recording) => !recording.uploaded).length;

  const currentDestination = useCallback((): RecordingDestination => ({
    songId: selectedSong?.id || "",
    songTitle: selectedSong?.title || "尚未指定歌曲",
    dawTrackId: trackId || null,
    targetInstrument: instrument,
    label: label.trim() || "手機錄音",
    targetBpm: selectedSong?.bpm || null,
    targetKey: selectedSong?.musicalKey || ""
  }), [instrument, label, selectedSong, trackId]);

  const refreshRecordings = useCallback(async () => {
    const plugin = recorderPlugin();
    if (!plugin) return;
    const result = await plugin.list();
    setRecordings(Array.isArray(result.recordings) ? result.recordings : []);
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const next = await requestJson<RecordingContext>("/api/mobile/recording-context", {}, 8_000);
      setContext(next);
      saveStoredJson(recordingContextKey, next);
      setHostOnline(true);
      setSongId((current) => current || next.songs[0]?.id || "");
    } catch (error) {
      const cached = readStoredJson<RecordingContext>(recordingContextKey, { version: null, songs: [] });
      setContext(cached);
      setHostOnline(false);
      setStatus((current) => activeRecordingId ? current : {
        state: "error",
        title: "主機目前離線",
        message: `${errorMessage(error)}。仍可錄製 WAV，連線恢復後再同步。`
      });
    }
  }, [activeRecordingId]);

  const updateLiveStatus = useCallback((next: NativeRecordingStatus) => {
    setElapsedSeconds(Number(next.elapsedSeconds || 0));
    setInputLevel(Math.min(1, Math.max(0, Number(next.level || 0))));
    setInputPeakDb(next.peakPowerDb);
    setInputDevice(next.inputDeviceLabel || "手機麥克風");
    if (next.sampleRate) {
      setRecordingFormat(`${Math.round(next.sampleRate / 1000)} kHz / ${next.bitDepth || 24}-bit WAV / ${Number(next.channels || 1) > 1 ? "Stereo" : "Mono"}`);
    }
  }, []);

  const beginPolling = useCallback(() => {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(async () => {
      const plugin = recorderPlugin();
      if (!plugin) return;
      try {
        const next = await plugin.status();
        updateLiveStatus(next);
        if (!next.recording && next.error) {
          setStatus({ state: "error", title: "錄音輸入已中斷", message: `${next.error}。請停止並封存目前內容。` });
        }
      } catch (error) {
        setStatus({ state: "error", title: "無法讀取錄音狀態", message: errorMessage(error) });
      }
    }, 150);
  }, [updateLiveStatus]);

  const prepareRecorder = useCallback(async () => {
    const plugin = recorderPlugin();
    if (!plugin) {
      setCapabilities(null);
      setStatus({ state: "error", title: "需要安裝版手機 App", message: "瀏覽器可預覽流程；原生無損 WAV 只在 iPhone、iPad 或 Android App 中提供。" });
      return;
    }
    try {
      const next = await plugin.capabilities();
      setCapabilities(next);
      setRecordingFormat(`${Math.round((next.preferredSampleRate || 48_000) / 1000)} kHz / ${next.preferredBitDepth || 24}-bit WAV / Mono`);
      setStatus(next.inputAvailable
        ? { state: "ready", title: "原生錄音引擎就緒", message: "WAV 原檔會保留在手機，直到同步驗證完成。" }
        : { state: "error", title: "找不到麥克風", message: "請允許麥克風權限，或接上可用的錄音輸入。" });
      const current = await plugin.status();
      if (current.recording && current.id) {
        setActiveRecordingId(current.id);
        setStatus({ state: "recording", title: "正在寫入原生 WAV", message: "主機離線也不會中斷手機原檔保存。" });
        updateLiveStatus(current);
        beginPolling();
      }
      await refreshRecordings();
    } catch (error) {
      setCapabilities(null);
      setStatus({ state: "error", title: "原生錄音引擎無法啟動", message: errorMessage(error) });
    }
  }, [beginPolling, refreshRecordings, updateLiveStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isMobileApp = params.get("mobileApp") === "1" || Boolean(recorderPlugin());
    if (!isMobileApp) return;
    setEnabled(true);
    const launcher = validLauncher(params.get("launcher") || "");
    if (launcher) window.localStorage.setItem(launcherKey, launcher);
    setContext(readStoredJson<RecordingContext>(recordingContextKey, { version: null, songs: [] }));
    void loadContext();
    void prepareRecorder();

    const healthTimer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const health = await requestJson<{ pairingRequired: boolean; trusted: boolean }>("/api/mobile/health", {}, 5_000);
        const lost = Boolean(health.pairingRequired && !health.trusted);
        setAuthorizationLost(lost);
        setHostOnline(!lost);
      } catch {
        setHostOnline(false);
      }
    }, 12_000);

    return () => {
      window.clearInterval(healthTimer);
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [loadContext, prepareRecorder]);

  useEffect(() => {
    if (!tracks.some((track) => track.id === trackId)) setTrackId(tracks[0]?.id || "");
  }, [trackId, tracks]);

  async function toggleRecording() {
    const plugin = recorderPlugin();
    if (!plugin || !capabilities?.inputAvailable) return;
    try {
      if (activeRecordingId) {
        const saved = await plugin.stop();
        setActiveRecordingId("");
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        pollingRef.current = null;
        setElapsedSeconds(saved.durationSeconds || 0);
        setInputLevel(0);
        setStatus({ state: "ready", title: "錄音已保存在手機", message: "原檔未壓縮、未覆蓋；連上 Mac 後可做完整性驗證與入庫。" });
        await refreshRecordings();
        return;
      }

      const destination = currentDestination();
      const next = await plugin.start({ label: destination.label, sampleRate: 48_000, bitDepth: 24, channels: 1 });
      if (!next.id) throw new Error("錄音引擎沒有回傳檔案識別碼。");
      const drafts = readStoredJson<Record<string, RecordingDestination>>(recordingDraftKey, {});
      drafts[next.id] = destination;
      saveStoredJson(recordingDraftKey, drafts);
      setActiveRecordingId(next.id);
      setStatus({ state: "recording", title: "正在寫入原生 WAV", message: "即使主機離線，錄音也會留在手機的 App 私有空間。" });
      updateLiveStatus(next);
      beginPolling();
    } catch (error) {
      setStatus({ state: "error", title: activeRecordingId ? "停止錄音失敗" : "無法開始錄音", message: errorMessage(error) });
    }
  }

  function assignRecording(id: string) {
    const drafts = readStoredJson<Record<string, RecordingDestination>>(recordingDraftKey, {});
    drafts[id] = currentDestination();
    saveStoredJson(recordingDraftKey, drafts);
    setRecordings((current) => [...current]);
  }

  async function syncRecording(recording: NativeRecording) {
    const plugin = recorderPlugin();
    if (!plugin) return;
    const drafts = readStoredJson<Record<string, RecordingDestination>>(recordingDraftKey, {});
    const destination = drafts[recording.id] || currentDestination();
    if (!destination.songId) {
      setStatus({ state: "error", title: "還不能同步", message: "請先選擇歌曲，再把目前歸檔位置套用到這段錄音。" });
      return;
    }

    setSyncingId(recording.id);
    setSyncProgress(0);
    setStatus({ state: "syncing", title: "正在驗證並同步", message: `${destination.songTitle} · 0%` });
    try {
      const jobs = readStoredJson<Record<string, UploadJob>>(uploadJobKey, {});
      let job: UploadJob | null = jobs[recording.id] || null;
      let offset = 0;
      if (job) {
        try {
          const uploadState = await requestJson<{ status: string; nextOffset: number }>(`/api/mobile/recordings/uploads/${job.uploadId}`, {
            headers: { "X-Upload-Token": job.uploadToken }
          });
          if (uploadState.status !== "uploading") throw new Error("舊工作不可續傳");
          offset = uploadState.nextOffset;
        } catch {
          delete jobs[recording.id];
          job = null;
        }
      }

      if (!job) {
        const started = await requestJson<UploadJob & { nextOffset: number }>("/api/mobile/recordings/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            songId: destination.songId,
            dawTrackId: destination.dawTrackId,
            fileName: recording.fileName,
            mimeType: "audio/wav",
            fileSizeBytes: recording.fileSizeBytes,
            sha256: recording.sha256,
            durationSeconds: recording.durationSeconds,
            sampleRate: recording.sampleRate,
            bitDepth: recording.bitDepth,
            channels: recording.channels,
            inputDeviceLabel: recording.inputDeviceLabel || "手機麥克風",
            targetInstrument: destination.targetInstrument,
            detectionMode: "timing_pitch",
            targetBpm: destination.targetBpm,
            targetKey: destination.targetKey,
            timelineStartSeconds: 0,
            notes: "手機原生 WAV 錄音"
          })
        });
        job = { uploadId: started.uploadId, uploadToken: started.uploadToken, chunkSizeBytes: started.chunkSizeBytes };
        jobs[recording.id] = job;
        saveStoredJson(uploadJobKey, jobs);
        offset = started.nextOffset || 0;
      }

      while (offset < recording.fileSizeBytes) {
        const chunk = await plugin.readChunk({ id: recording.id, offset, length: job.chunkSizeBytes || 1_048_576 });
        const bytes = base64ArrayBuffer(chunk.data || "");
        if (!bytes.byteLength) throw new Error("手機原檔在完成前提早結束。");
        const uploaded = await requestJson<{ nextOffset: number }>(`/api/mobile/recordings/uploads/${job.uploadId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Offset": String(offset),
            "X-Upload-Token": job.uploadToken
          },
          body: bytes
        }, 30_000);
        offset = uploaded.nextOffset;
        const progress = Math.round(Math.min(1, offset / recording.fileSizeBytes) * 100);
        setSyncProgress(progress);
        setStatus({ state: "syncing", title: "正在驗證並同步", message: `${destination.songTitle} · ${progress}%` });
      }

      const completed = await requestJson<{ audioFileId: string }>(`/api/mobile/recordings/uploads/${job.uploadId}/complete`, {
        method: "POST",
        headers: { "X-Upload-Token": job.uploadToken }
      }, 120_000);
      await plugin.markUploaded({ id: recording.id, serverAudioFileId: completed.audioFileId });
      delete jobs[recording.id];
      saveStoredJson(uploadJobKey, jobs);
      setStatus({ state: "ready", title: "同步與完整性驗證完成", message: `${destination.songTitle} 已建立 take、DAW 片段與 Audio QA；手機原檔仍保留。` });
      setHostOnline(true);
      await refreshRecordings();
      router.refresh();
    } catch (error) {
      setHostOnline(false);
      setStatus({ state: "error", title: "同步尚未完成", message: `${errorMessage(error)}。手機 WAV 原檔仍在，可稍後續傳。` });
    } finally {
      setSyncingId("");
      setSyncProgress(0);
    }
  }

  function returnToLauncher() {
    const launcher = validLauncher(window.localStorage.getItem(launcherKey) || "");
    if (launcher) {
      window.location.assign(launcher);
      return;
    }
    window.history.back();
  }

  if (!enabled) return null;

  return (
    <>
      {authorizationLost ? (
        <aside className="mobile-native-auth-alert" role="alert">
          <Link2Off size={18} />
          <span><strong>裝置授權已撤銷</strong><small>回到手機連線頁重新輸入配對碼。</small></span>
          <button type="button" onClick={returnToLauncher}>重新配對</button>
        </aside>
      ) : null}

      <button className="mobile-native-recorder-launcher" type="button" onClick={() => setOpen(true)} aria-label="開啟手機原生錄音室">
        <Mic size={17} />
        <span>錄音</span>
        {pendingCount ? <b>{pendingCount}</b> : null}
      </button>

      {open ? (
        <div className="mobile-native-recorder-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileRecorderTitle">
          <button className="mobile-native-recorder-scrim" type="button" aria-label="關閉手機錄音室" onClick={() => !activeRecordingId && setOpen(false)} />
          <section className="mobile-native-recorder-panel">
            <header className="mobile-native-recorder-header">
              <span className="mobile-native-recorder-icon"><Smartphone size={19} /></span>
              <div>
                <small>手機原生錄音</small>
                <h2 id="mobileRecorderTitle">隨身錄音室</h2>
              </div>
              <span className="mobile-native-host-state" data-online={hostOnline}>{hostOnline ? "主機可同步" : "離線可錄"}</span>
              <button className="mobile-native-icon-button" type="button" aria-label="關閉" onClick={() => !activeRecordingId && setOpen(false)} disabled={Boolean(activeRecordingId)}>
                <X size={20} />
              </button>
            </header>

            <div className="mobile-native-recorder-scroll">
              <div className="mobile-native-status" data-state={status.state} role="status" aria-live="polite">
                {status.state === "ready" ? <ShieldCheck size={18} /> : status.state === "syncing" ? <CloudUpload size={18} /> : status.state === "error" ? <Link2Off size={18} /> : <Mic size={18} />}
                <span><strong>{status.title}</strong><small>{status.message}</small></span>
              </div>

              <section className="mobile-native-capture" aria-label="錄音狀態">
                <div className="mobile-native-clock">
                  <span>{activeRecordingId ? "正在錄音" : "準備錄音"}</span>
                  <strong>{formatDuration(elapsedSeconds, true)}</strong>
                  <small>{recordingFormat}</small>
                </div>
                <div className="mobile-native-meter" aria-label="即時輸入音量">
                  <span style={{ width: `${Math.round(inputLevel * 100)}%` }} />
                  <i />
                </div>
                <div className="mobile-native-capture-meta">
                  <span>輸入 <b>{inputDevice}</b></span>
                  <span>峰值 <b>{formatDb(inputPeakDb)}</b></span>
                </div>
                <button
                  className="mobile-native-record-button"
                  data-recording={Boolean(activeRecordingId)}
                  type="button"
                  onClick={() => void toggleRecording()}
                  disabled={!capabilities?.inputAvailable}
                >
                  <span />
                  <strong>{activeRecordingId ? "停止並保存" : "開始錄音"}</strong>
                </button>
              </section>

              <section className="mobile-native-destination" aria-labelledby="mobileDestinationTitle">
                <div className="mobile-native-section-heading">
                  <div><small>歸檔位置</small><h3 id="mobileDestinationTitle">錄完要放在哪裡</h3></div>
                  <FolderInput size={19} />
                </div>
                <div className="mobile-native-field-grid">
                  <label><span>歌曲</span><select value={songId} onChange={(event) => setSongId(event.target.value)}><option value="">選擇歌曲</option>{context.songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>
                  <label><span>DAW 音軌</span><select value={trackId} onChange={(event) => setTrackId(event.target.value)}><option value="">只建立 take，稍後放入音軌</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name} · {track.trackType}</option>)}</select></label>
                  <label><span>錄音內容</span><select value={instrument} onChange={(event) => setInstrument(event.target.value as RecordingDestination["targetInstrument"])}><option value="vocal">人聲</option><option value="guitar">吉他</option><option value="piano">鋼琴</option><option value="bass">Bass</option><option value="drums">鼓與節奏</option><option value="other">其他</option></select></label>
                  <label><span>Take 名稱</span><input value={label} maxLength={48} onChange={(event) => setLabel(event.target.value)} /></label>
                </div>
                <p>錄音不依賴主機；24-bit WAV 先留在手機，連回 Mac 後才分段同步並驗證 SHA-256。</p>
              </section>

              <section className="mobile-native-recordings" aria-labelledby="mobilePendingTitle">
                <div className="mobile-native-section-heading">
                  <div><small>裝置原檔</small><h3 id="mobilePendingTitle">待同步錄音</h3></div>
                  <button type="button" onClick={() => void refreshRecordings()} aria-label="重新整理手機錄音"><RefreshCw size={18} /></button>
                </div>
                {!recordings.length ? <p className="mobile-native-empty">目前沒有手機錄音。錄下第一段後，WAV 原檔會出現在這裡。</p> : null}
                <div className="mobile-native-recording-list">
                  {recordings.map((recording) => {
                    const drafts = readStoredJson<Record<string, RecordingDestination>>(recordingDraftKey, {});
                    const destination = drafts[recording.id];
                    const syncing = syncingId === recording.id;
                    return (
                      <article className="mobile-native-recording-item" key={recording.id}>
                        <div className="mobile-native-recording-main">
                          <span>WAV</span>
                          <div><strong>{recording.label || recording.fileName}</strong><small>{formatDuration(recording.durationSeconds)} · {formatBytes(recording.fileSizeBytes)} · {recording.sampleRate} Hz / {recording.bitDepth}-bit</small><small>歸檔：{destination?.songTitle || "尚未指定歌曲"} · SHA {recording.sha256.slice(0, 10)}</small></div>
                          <b data-state={recording.uploaded ? "done" : syncing ? "syncing" : "pending"}>{recording.uploaded ? "已同步" : syncing ? `${syncProgress}%` : "待同步"}</b>
                        </div>
                        {syncing ? <div className="mobile-native-sync-progress"><span style={{ width: `${syncProgress}%` }} /></div> : null}
                        <div className="mobile-native-recording-actions">
                          <button type="button" onClick={() => assignRecording(recording.id)} disabled={recording.uploaded || syncing}>套用目前歸檔</button>
                          <button type="button" className="primary" onClick={() => void syncRecording(recording)} disabled={recording.uploaded || syncing}>{recording.uploaded ? <><CheckCircle2 size={16} /> 已驗證</> : <><CloudUpload size={16} /> 同步到 Mac</>}</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <button className="mobile-native-host-button" type="button" onClick={returnToLauncher}>更換或重新配對主機</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
