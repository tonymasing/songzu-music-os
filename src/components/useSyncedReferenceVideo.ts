"use client";

import { useEffect, type RefObject } from "react";

/** Audio is the clock; a shorter, muted MV repeats without restarting the song. */
export function useSyncedReferenceVideo(
  audioRef: RefObject<HTMLAudioElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  source: string | undefined,
  enabled: boolean,
  onError: (message: string) => void
) {
  useEffect(() => {
    const audio = audioRef.current, video = videoRef.current;
    if (!enabled || !source || !audio || !video) return;
    let disposed = false, playPending = false, playFailed = false, buffering = false;
    let frame = 0;

    function sync(force = false) {
      if (disposed || !audio || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      video.muted = true;
      video.playbackRate = audio.playbackRate;
      const target = Math.max(0, audio.currentTime) % video.duration;
      if (Math.abs(video.currentTime - target) > (force ? 0.025 : 0.2) && !video.seeking) video.currentTime = target;
      if (audio.paused || audio.ended || audio.seeking || buffering) {
        video.pause();
      } else if (video.paused && !playPending && !playFailed) {
        playPending = true;
        void video.play().catch(error => {
          if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
          playFailed = true;
          onError("MV 暫時無法播放，歌曲仍可正常播放；可收起 MV 後再展開重試。");
        }).finally(() => { playPending = false; });
      }
    }

    function tick() {
      frame = 0;
      sync();
      if (!disposed && audio && !audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
    }
    function update(event?: Event) {
      if (event?.target === audio && event.type === "waiting") buffering = true;
      if (event?.target === audio && ["playing", "canplay", "seeked", "pause", "ended"].includes(event.type)) buffering = false;
      // A completed video seek must resume playback instead of repeatedly seeking to
      // the advancing audio clock (especially with inline + background decoders).
      const force = event?.type === "loadedmetadata" || (event?.target === audio && ["seeked", "seeking", "ratechange", "ended"].includes(event?.type ?? ""));
      sync(force);
      if (!audio?.paused && !audio?.ended && !frame) frame = requestAnimationFrame(tick);
      if (audio?.paused || audio?.ended) { cancelAnimationFrame(frame); frame = 0; }
    }
    const events = ["play", "playing", "pause", "ended", "seeking", "seeked", "ratechange", "timeupdate", "waiting", "canplay"];
    events.forEach(name => audio.addEventListener(name, update));
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("canplay", update);
    video.addEventListener("seeked", update);
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      events.forEach(name => audio.removeEventListener(name, update));
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("canplay", update);
      video.removeEventListener("seeked", update);
      video.pause();
    };
  }, [audioRef, videoRef, source, enabled, onError]);
}
