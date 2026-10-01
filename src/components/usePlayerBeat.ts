"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { beatPulse, gridPulse, parseBeatGrid, playbackBeatTime, regularizeBeats, tappedTempo, type BeatGrid } from "@/lib/player-beat";
import { requestPlayerBeats } from "@/lib/player-beat-request";

type Status = "idle" | "loading" | "ready" | "error";
export function usePlayerBeat(audioRef: RefObject<HTMLAudioElement | null>, buttonRef: RefObject<HTMLButtonElement | null>, latencyRef?: RefObject<{ readonly visualLatency: number } | null>) {
  const config = useRef<{ bpm: number | null; anchor: number; grid: BeatGrid | null; automatic: boolean; offset: number }>({ bpm: null, anchor: 0, grid: null, automatic: true, offset: 0 });
  const request = useRef<{ source: string; controller: AbortController | null; status: Status }>({ source: "", controller: null, status: "idle" });
  const alive = useRef(false);
  const tapTimes = useRef<number[]>([]);
  const [draft, setDraft] = useState("");
  const [taps, setTaps] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [offset, setOffset] = useState(0);

  async function analyze(force = false) {
    const audio = audioRef.current;
    const source = audio?.currentSrc || audio?.src;
    if (!source || (!config.current.automatic && !force)) return;
    if (!force && request.current.source === source && request.current.status !== "idle") return;
    request.current.controller?.abort();
    if (request.current.source !== source) { config.current.grid = null; if (config.current.automatic) { config.current.bpm = null; setDraft(""); } }
    const controller = new AbortController();
    request.current = { source, controller, status: "loading" };
    setStatus("loading");
    // At most six queued jobs, each bounded by a 10 s probe + 120 s analysis.
    // Restart the watchdog when waiting outside that queue. Newly added songs
    // must not lose their analysis budget while other recordings are admitted.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const renewTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 6 * 130000 + 30000); };
    renewTimeout();
    try {
      const local = new URL(source, location.href);
      if (local.origin !== location.origin || !/^https?:$/.test(local.protocol)) throw new Error("external_source");
      const response = await requestPlayerBeats(local.pathname + local.search, controller.signal, renewTimeout);
      const parsed = parseBeatGrid(await response.json());
      if (!parsed) throw new Error("invalid_grid");
      const grid = { ...parsed, beats: regularizeBeats(parsed.beats) };
      if (!alive.current || request.current.controller !== controller || (audio.currentSrc || audio.src) !== source) return;
      config.current.grid = grid;
      if (config.current.automatic) {
        config.current.bpm = grid.bpm; config.current.anchor = grid.beats[0]; setDraft(String(grid.bpm));
      }
      request.current.status = "ready"; setStatus("ready");
    } catch {
      if (alive.current && request.current.controller === controller) { request.current.status = "error"; setStatus("error"); }
    } finally { clearTimeout(timeout); }
  }

  function setTempo(value: string) {
    setDraft(value);
    const bpm = Number(value);
    if (value.trim() && Number.isFinite(bpm) && bpm >= 30 && bpm <= 300) {
      config.current.bpm = bpm; config.current.automatic = false; setAutomatic(false);
      tapTimes.current = []; setTaps(0);
    }
  }
  function commitTempo() { setDraft(config.current.bpm === null ? "" : String(config.current.bpm)); }
  function tap() {
    const audio = audioRef.current;
    if (!audio || audio.paused || audio.seeking) return;
    const time = playbackBeatTime(audio.currentTime, audio.playbackRate, latencyRef?.current?.visualLatency ?? 0, config.current.offset);
    const previous = tapTimes.current.at(-1);
    if (previous !== undefined && (time - previous > 2 || time - previous < 0.2)) tapTimes.current = [];
    tapTimes.current = [...tapTimes.current.slice(-7), time];
    config.current.automatic = false; config.current.anchor = time; setAutomatic(false);
    const bpm = tappedTempo(tapTimes.current);
    if (bpm !== null) { config.current.bpm = bpm; setDraft(String(bpm)); }
    setTaps(tapTimes.current.length);
  }
  function autoSync() {
    config.current.automatic = true; setAutomatic(true); tapTimes.current = []; setTaps(0);
    if (config.current.grid) { config.current.bpm = config.current.grid.bpm; setDraft(String(config.current.grid.bpm)); }
    else void analyze(true);
  }
  function shift(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(-500, Math.min(500, Math.round(value / 10) * 10));
    config.current.offset = next; setOffset(next);
  }

  useEffect(() => {
    const audio = audioRef.current, button = buttonRef.current;
    if (!audio || !button) return;
    alive.current = true;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false, stalled = false, frame = 0;
    const write = (value: number) => button.style.setProperty("--beat", value.toFixed(3));
    const stop = () => { cancelAnimationFrame(frame); frame = 0; write(0); };
    const eligible = () => visible && !document.hidden && !reduced.matches && !stalled && !audio.paused && !audio.ended && !audio.seeking;
    const tick = () => {
      if (!eligible()) { stop(); return; }
      const { bpm, anchor, grid, automatic: auto, offset: correction } = config.current;
      const time = playbackBeatTime(audio.currentTime, audio.playbackRate, latencyRef?.current?.visualLatency ?? 0, correction);
      write(auto ? grid ? gridPulse(time, grid.beats, audio.playbackRate) : 0 : bpm === null ? 0 : beatPulse(time, bpm, anchor, audio.playbackRate));
      frame = requestAnimationFrame(tick);
    };
    const update = () => {
      // Pre-analyse only visible players; no audio graph or change to playback.
      if (visible && !document.hidden && !reduced.matches && audio.readyState >= 1) void analyze();
      if (!eligible()) { stop(); return; }
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onEvent = (event: Event) => {
      // A failed earlier attempt must not permanently exclude this song.
      if (event.type === "play" && request.current.status === "error") request.current.status = "idle";
      if (["waiting", "seeking", "emptied", "error"].includes(event.type)) stalled = true;
      if (["playing", "seeked", "canplay"].includes(event.type)) stalled = false;
      if (["seeking", "ratechange"].includes(event.type)) { tapTimes.current = []; setTaps(0); stop(); }
      update();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(button);
    const events = ["loadedmetadata", "play", "playing", "pause", "ended", "waiting", "seeking", "seeked", "canplay", "emptied", "error", "ratechange"];
    events.forEach(event => audio.addEventListener(event, onEvent));
    document.addEventListener("visibilitychange", update); reduced.addEventListener("change", update);
    return () => {
      alive.current = false; request.current.controller?.abort(); request.current = { source: "", controller: null, status: "idle" };
      stop(); observer.disconnect();
      events.forEach(event => audio.removeEventListener(event, onEvent));
      document.removeEventListener("visibilitychange", update); reduced.removeEventListener("change", update);
    };
    // Every event reads mutable current configuration; analysis cannot overwrite manual mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRef, buttonRef, latencyRef]);

  const message = !automatic ? "手動節拍 · 跟著歌曲連按四下校正" : status === "ready" ? "已依這首音檔的逐拍拍點同步" : status === "loading" ? "正在排程與分析這首歌的拍點，完成後自動同步…" : status === "error" ? "暫時無法自動對拍，再次播放會重試，也可跟拍校正" : "播放前會自動分析這首歌的拍點";
  return { draft, setTempo, commitTempo, tap, taps, automatic, status, message, autoSync, offset, shift };
}
