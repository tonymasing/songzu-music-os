"use client";

import { useEffect, useState, type RefObject } from "react";

const minimumSpan = 0.25;
export function usePlayerLoop(audioRef: RefObject<HTMLAudioElement | null>) {
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const ready = start !== null && end !== null && end - start >= minimumSpan;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !enabled || start === null || end === null) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const boundary = () => {
      if (audio.seeking || audio.paused) return;
      if (audio.currentTime >= end || audio.currentTime < start) audio.currentTime = start;
    };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const run = () => { stop(); boundary(); timer = setInterval(boundary, 25); };
    const ended = () => {
      audio.currentTime = start;
      void audio.play().catch(() => { if (!disposed) setMessage("按播放即可繼續 A–B 循環。"); });
    };
    const invalidated = () => {
      if (!Number.isFinite(audio.duration) || end > audio.duration + 0.01) {
        stop(); setEnabled(false); setMessage("音檔長度已改變，請重新設定 A／B。");
      }
    };
    audio.addEventListener("play", run);
    audio.addEventListener("pause", stop);
    audio.addEventListener("timeupdate", boundary);
    audio.addEventListener("seeked", boundary);
    audio.addEventListener("ended", ended);
    audio.addEventListener("durationchange", invalidated);
    if (!audio.paused) run();
    return () => {
      disposed = true; stop();
      audio.removeEventListener("play", run);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("timeupdate", boundary);
      audio.removeEventListener("seeked", boundary);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("durationchange", invalidated);
    };
  }, [audioRef, enabled, start, end]);

  function markStart() {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration < minimumSpan) return;
    const value = Math.max(0, Math.min(audio.currentTime, audio.duration - minimumSpan));
    setStart(value); setEnabled(false); setMessage("");
    if (end !== null && end - value < minimumSpan) setEnd(null);
  }
  function markEnd() {
    const audio = audioRef.current;
    if (!audio || start === null) return;
    const value = Math.min(audio.currentTime, audio.duration);
    if (!Number.isFinite(value) || value - start < minimumSpan) {
      setMessage("B 終點需比 A 起點晚至少 0.25 秒。"); return;
    }
    setEnd(value); setEnabled(true); setMessage("");
  }
  function toggle() {
    if (!ready) return;
    setEnabled(value => !value); setMessage("");
  }
  function clear() { setEnabled(false); setStart(null); setEnd(null); setMessage(""); }
  return { start, end, enabled, ready, message, markStart, markEnd, toggle, clear };
}
