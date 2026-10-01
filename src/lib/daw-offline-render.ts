import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createDawChannelGraph } from "@/lib/daw-channel-graph";
import { createDawMasterGraph } from "@/lib/daw-master-graph";
import { createDawTrackGraph } from "@/lib/daw-track-graph";
import { DAW_MASTER } from "@/lib/daw-mix-contract";
import type { StudioSettings } from "@/lib/daw-dsp";
import { offlineMain, offlinePreload, offlineRenderer } from "@/lib/daw-offline-program";

// Input buffers share one graph and use bounded IPC chunks. State and source
// lifetimes must survive the full render; resetting each track changes tails.
export const DAW_OFFLINE_MAX_PCM_BYTES = 256 * 1024 * 1024;
export const DAW_OFFLINE_TIMEOUT_MS = 180_000;

export async function dawOfflineExecutable() {
  const relative = process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32" ? "electron.exe" : "electron";
  const path = process.env.SONGZU_DSP_ELECTRON_PATH || join(process.cwd(), "node_modules/electron/dist", relative);
  try {
    if (!(await stat(path)).isFile()) throw new Error("Not an executable file");
    await access(path, constants.X_OK);
    return resolve(path);
  } catch {
    throw new Error("找不到本機離線音訊引擎，已停止效果匯出；不會改用聲音不同的替代效果。請確認 Electron 音訊執行環境。");
  }
}

function runRenderer(executable: string, entry: string, timeoutMs: number) {
  return new Promise<void>((resolveJob, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const child = spawn(executable, [entry], { cwd: dirname(entry), env, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
    let error: Error | null = null;
    let stderr = "";
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    };
    child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-4000); });
    const timer = setTimeout(() => { error = new Error("離線音訊處理逾時，已停止匯出。"); kill(); }, timeoutMs + 5000);
    child.on("error", value => { error = value; });
    child.on("close", code => {
      clearTimeout(timer);
      kill();
      if (error || code !== 0) reject(error ?? new Error(`離線音訊引擎失敗 (${code})：${stderr}`));
      else resolveJob();
    });
  });
}

export type DawOfflineTrack = {
  path: string; settings: StudioSettings; volume: number; pan: number;
  ranges?: Array<{ start: number; end: number }>;
};

export async function renderDawOfflinePcm(inputPath: string, outputPath: string, sampleRate: number,
  options: { settings: StudioSettings; master?: boolean; timeoutMs?: number }) {
  const source = await stat(inputPath);
  return renderDawOfflineMix([{ path: inputPath, settings: options.settings, volume: 1, pan: 0 }], outputPath, sampleRate,
    { frames: source.size / 8, master: Boolean(options.master), masterOnly: Boolean(options.master), channelOnly: true, timeoutMs: options.timeoutMs });
}

export async function renderDawOfflineMix(tracks: DawOfflineTrack[], outputPath: string, sampleRate: number,
  options: { frames: number; master: boolean; masterOnly?: boolean; channelOnly?: boolean; rejectClipping?: boolean; timeoutMs?: number }) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("離線音訊取樣率無效。");
  if (!tracks.length || tracks.length > 64 || !Number.isSafeInteger(options.frames) || options.frames <= 0) throw new Error("離線音訊 PCM 長度無效。");
  const sources = await Promise.all(tracks.map(track => stat(track.path)));
  if (sources.some(source => !source.isFile() || source.size === 0 || source.size % 8)) throw new Error("離線音訊 PCM 長度無效。");
  if (options.frames * 8 > DAW_OFFLINE_MAX_PCM_BYTES || sources.reduce((sum, source) => sum + source.size, 0) > 2 * DAW_OFFLINE_MAX_PCM_BYTES) {
    throw new Error("此音訊超過單次高精度離線處理上限，已停止匯出；不會截短或降低品質。");
  }
  const prepared = tracks.map((track, index) => {
    const frames = sources[index]!.size / 8;
    const ranges = track.ranges ?? [{ start: 0, end: Math.min(frames, options.frames) }];
    if (!ranges.length || ranges.some(range => !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > frames || range.end > options.frames)) {
      throw new Error("離線音訊有效片段範圍無效。");
    }
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    return { path: resolve(track.path), settings: track.settings, volume: track.volume, pan: track.pan, frames, ranges: merged };
  });
  const timeoutMs = options.timeoutMs ?? DAW_OFFLINE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > DAW_OFFLINE_TIMEOUT_MS) throw new Error("Invalid offline timeout");
  const executable = await dawOfflineExecutable();
  const directory = await mkdtemp(join(dirname(outputPath), ".offline-dsp-"));
  try {
    const script = offlineRenderer(createDawChannelGraph.toString(), createDawTrackGraph.toString(), createDawMasterGraph.toString(), DAW_MASTER);
    const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-bounce\'; connect-src \'none\'"><script nonce="bounce">' + script.replaceAll("</script", "<\\/script") + "</script>";
    await writeFile(join(directory, "job.json"), JSON.stringify({ tracks: prepared, frames: options.frames, sampleRate, master: options.master, masterOnly: Boolean(options.masterOnly), channelOnly: Boolean(options.channelOnly), parentPid: process.pid, timeoutMs, url: "data:text/html;base64," + Buffer.from(html).toString("base64") }), { mode: 0o600 });
    await writeFile(join(directory, "main.cjs"), offlineMain, { mode: 0o600 });
    await writeFile(join(directory, "preload.cjs"), offlinePreload, { mode: 0o600 });
    try { await runRenderer(executable, join(directory, "main.cjs"), timeoutMs); }
    catch (error) {
      const detail = await readFile(join(directory, "result.json"), "utf8").catch(() => "");
      throw new Error(`效果匯出未完成：${detail || (error instanceof Error ? error.message : String(error))}`);
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8")) as { frames: number; sampleRate: number; peak: number; requests: number; chromium: string; electron: string; error?: string };
    const pending = join(directory, "output.f32");
    if (result.error || result.frames !== options.frames || result.sampleRate !== sampleRate || !Number.isFinite(result.peak) || result.peak < 0 || result.requests !== 0 || (await stat(pending)).size !== options.frames * 8) {
      throw new Error("離線音訊驗證失敗，未發布輸出。");
    }
    if (options.rejectClipping && result.peak > 1) {
      throw new Error(`效果輸出峰值超過 0 dBFS（${(20 * Math.log10(result.peak)).toFixed(2)} dBFS），已停止匯出以避免削波。請降低音軌音量後再試；不會自動改動混音。`);
    }
    for (const [index, track] of tracks.entries()) {
      const after = await stat(track.path), before = sources[index]!;
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error("離線音訊來源在處理中變更，未發布輸出。");
    }
    await rename(pending, outputPath);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
