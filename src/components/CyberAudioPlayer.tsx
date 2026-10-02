"use client";

import { AudioLines, Disc3, Download, Maximize, Minimize, Pause, Play, Repeat2, Settings, Volume2, VolumeX, X } from "lucide-react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type AudioHTMLAttributes, type CSSProperties, type ReactNode } from "react";

import styles from "./CyberAudioPlayer.module.css";
import { usePlayerLoop } from "./usePlayerLoop";
import { useSyncedReferenceVideo } from "./useSyncedReferenceVideo";
import { useFullscreenPlayerControls } from "./useFullscreenPlayerControls";
import { PlayerPitch } from "@/lib/player-pitch";

type PlayerProps = Omit<AudioHTMLAttributes<HTMLAudioElement>, "src"> & {
  src?: string;
  visual?: ReactNode;
  videoSrc?: string;
  trackInfo?: { fileName: string; duration: string; size: string; format: string };
};
type MediaState = { playing: boolean; time: number; duration: number; volume: number; muted: boolean; rate: number; waiting: boolean; error: string };
const initialState: MediaState = { playing: false, time: 0, duration: 0, volume: 1, muted: false, rate: 1, waiting: false, error: "" };

function timestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60).toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

function loopTimestamp(seconds: number) {
  const tenths = Math.round(seconds * 10);
  return `${timestamp(tenths / 10)}.${tenths % 10}`;
}

// Keep a real media element: existing waveform, timestamp and score controls use its ref/events.
const PlayerSession = forwardRef<HTMLAudioElement, PlayerProps>(function PlayerSession(props, forwardedRef) {
  const { trackInfo, visual, videoSrc, ...audioProps } = props;
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const lastVolume = useRef(1);
  const pitchRef = useRef<PlayerPitch | null>(null);
  const [semitones, setSemitones] = useState(0);
  const [pitchBusy, setPitchBusy] = useState(false);
  const [pitchError, setPitchError] = useState("");
  const [media, setMedia] = useState(initialState);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [videoError, setVideoError] = useState("");
  const optionsId = useId();
  const loop = usePlayerLoop(audioRef);
  const hasVisual = Boolean(visual);
  const chrome = useFullscreenPlayerControls(playerRef, chromeRef, fullscreen, optionsOpen);
  useSyncedReferenceVideo(audioRef, videoRef, videoSrc, hasVisual, setVideoError);
  useImperativeHandle(forwardedRef, () => audioRef.current!, []);

  useEffect(() => {
    if (!hasVisual) return;
    let wasFullscreen = false;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === playerRef.current;
      setFullscreen(active);
      if (wasFullscreen && !active) fullscreenButtonRef.current?.focus({ preventScroll: true });
      wasFullscreen = active;
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, [hasVisual]);

  async function toggleFullscreen() {
    setScreenError("");
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current!.requestFullscreen();
    } catch {
      setScreenError("目前無法進入全螢幕，請再試一次；仍可使用一般大小繼續播放。");
    }
  }

  useEffect(() => {
    const controller = new PlayerPitch(audioRef.current!, message => { setPitchError(message); setSemitones(0); });
    pitchRef.current = controller;
    return () => { controller.dispose(); pitchRef.current = null; };
  }, []);

  async function changePitch(value: number) {
    const audio = audioRef.current, controller = pitchRef.current;
    if (!audio || !controller) return;
    setPitchBusy(true); setPitchError("");
    try {
      await controller.setSemitones(value);
      if (audio.isConnected) setSemitones(value);
    } catch (error) {
      if (audio.isConnected) { setSemitones(0); setPitchError(error instanceof Error ? error.message : "暫時無法移調，仍可使用原調播放。"); }
    } finally { if (audio.isConnected) setPitchBusy(false); }
  }

  useEffect(() => {
    const audio = audioRef.current!;
    let waiting = false;
    const sync = (event?: Event) => {
      if (event?.type === "waiting" || event?.type === "seeking") waiting = true;
      if (["playing", "canplay", "seeked", "pause", "ended", "error", "emptied"].includes(event?.type ?? "")) waiting = false;
      if (audio.volume > 0) lastVolume.current = audio.volume;
      setMedia({
        playing: !audio.paused && !audio.ended,
        time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: audio.duration,
        volume: audio.volume,
        muted: audio.muted,
        rate: audio.playbackRate,
        waiting,
        error: audio.error ? "音檔無法播放，請確認檔案是否可用。" : ""
      });
    };
    const events = ["loadedmetadata", "durationchange", "timeupdate", "play", "playing", "pause", "ended", "volumechange", "ratechange", "emptied", "loadstart", "error", "waiting", "canplay", "seeking", "seeked"];
    events.forEach(event => audio.addEventListener(event, sync));
    sync();
    return () => {
      events.forEach(event => audio.removeEventListener(event, sync));
      audio.pause();
    };
  }, []);

  useEffect(() => {
    if (!optionsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!playerRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOptionsOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [optionsOpen]);

  async function togglePlayback() {
    const audio = audioRef.current!;
    if (!audio.paused) { audio.pause(); return; }
    try { await pitchRef.current?.resume(); await audio.play(); }
    catch (error) {
      if (!audio.isConnected || (error instanceof DOMException && error.name === "AbortError")) return;
      setMedia(current => ({ ...current, playing: false, waiting: false, error: "暫時無法播放，請再試一次。" }));
    }
  }

  function toggleMute() {
    const audio = audioRef.current!;
    if (audio.muted || audio.volume === 0) {
      if (audio.volume === 0) audio.volume = lastVolume.current;
      audio.muted = false;
    } else audio.muted = true;
  }

  function changeVolume(value: number) {
    const audio = audioRef.current!;
    audio.volume = value; audio.muted = false;
    setMedia(current => ({ ...current, volume: value, muted: false }));
  }

  const canSeek = Number.isFinite(media.duration) && media.duration > 0;
  const progress = canSeek ? Math.min(100, media.time / media.duration * 100) : 0;
  const silent = media.muted || media.volume === 0;
  const controlsList = props.controlsList?.split(/\s+/) ?? [];
  const allowRate = !controlsList.includes("noplaybackrate");
  const allowDownload = Boolean(props.src) && !controlsList.includes("nodownload");
  return (
    <div ref={playerRef} className={styles.player} role="group" aria-label={props["aria-label"] ?? "音樂播放器"} data-playing={media.playing} data-controls-visible={chrome.visible}>
      <audio {...audioProps} ref={audioRef} controls={false} hidden />
      {visual ? <div className={styles.visualFrame}>
        {visual}
        {videoSrc ? <video ref={videoRef} className={styles.video} src={videoSrc} muted loop playsInline preload="metadata" controls={false} disablePictureInPicture aria-label="歌曲 MV" onLoadedData={() => setVideoError("")} onError={() => setVideoError("MV 目前無法讀取，歌曲仍可正常播放。")} /> : null}
        <div className={styles.screenControls} aria-label="影片顯示模式">
          <button ref={fullscreenButtonRef} type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "退出全螢幕" : "全螢幕"} title={fullscreen ? "退出全螢幕（Esc）" : "全螢幕"}>{fullscreen ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}</button>
        </div>
      </div> : null}
      {fullscreen ? <button type="button" className={styles.revealControls} onPointerEnter={chrome.reveal} onFocus={chrome.reveal} onClick={chrome.reveal} aria-label="顯示播放控制">顯示播放控制</button> : null}
      <div ref={chromeRef} className={styles.chrome} data-fullscreen-controls="true" inert={fullscreen && !chrome.visible} aria-hidden={fullscreen && !chrome.visible ? true : undefined}>
      <div className={`${styles.hud} ${trackInfo ? styles.trackHud : ""}`}>
        {trackInfo ? (
          <div className={styles.trackInfo}>
            <span className={styles.trackIcon} aria-hidden="true"><Disc3 size={18} /></span>
            <div className={styles.trackText}>
              <strong>{trackInfo.fileName}</strong>
              <span className={styles.trackStats}>
                <span className={styles.trackDuration}>音樂長度 <b>{trackInfo.duration}</b></span>
                <span>{trackInfo.size}</span>
                <span>{trackInfo.format}</span>
              </span>
            </div>
          </div>
        ) : <span className={styles.hudTitle}><AudioLines size={13} aria-hidden="true" />AUDIO<span>PLAYER</span></span>}
        <span className={styles.hudState}><i aria-hidden="true" />{media.playing ? "播放中" : "待機"}<span>{media.rate}×</span><span>{semitones === 0 ? "原調" : `${semitones > 0 ? "+" : ""}${semitones} 半音`}</span></span>
      </div>
      <div className={styles.controls}>
        <button type="button" className={`${styles.control} ${styles.play}`} onClick={() => void togglePlayback()} aria-label={media.playing ? "暫停" : "播放"} title={media.playing ? "暫停" : "播放"}>
          <span className={styles.playFace} aria-hidden="true">
            {media.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </span>
        </button>
        <div className={styles.seek}>
          <div className={styles.progressLight} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          {canSeek && loop.start !== null ? <div className={styles.loopMarkers} aria-hidden="true">
            {loop.end !== null ? <span className={styles.loopBand} data-enabled={loop.enabled} style={{ left: `${loop.start / media.duration * 100}%`, width: `${(loop.end - loop.start) / media.duration * 100}%` }} /> : null}
            <span className={styles.loopMarker} style={{ left: `${loop.start / media.duration * 100}%` }}>A</span>
            {loop.end !== null ? <span className={styles.loopMarker} style={{ left: `${loop.end / media.duration * 100}%` }}>B</span> : null}
          </div> : null}
          <input className={styles.range} type="range" min={0} max={canSeek ? media.duration : 1} step={0.1} value={canSeek ? Math.min(media.time, media.duration) : 0} disabled={!canSeek} aria-label="播放進度" aria-valuetext={`${timestamp(media.time)} / ${canSeek ? timestamp(media.duration) : "未知"}`} style={{ "--fill": `${progress}%` } as CSSProperties} onChange={event => { const time = Number(event.currentTarget.value); audioRef.current!.currentTime = time; setMedia(current => ({ ...current, time })); }} />
        </div>
        <div className={styles.volume}>
          <button type="button" className={styles.control} onClick={toggleMute} aria-label={silent ? "取消靜音" : "靜音"} aria-pressed={silent} title={silent ? "取消靜音" : "靜音"}>
            {silent ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
          </button>
          <input className={styles.range} type="range" min={0} max={1} step={0.01} value={silent ? 0 : media.volume} aria-label="音量" aria-valuetext={`${Math.round((silent ? 0 : media.volume) * 100)}%`} style={{ "--fill": `${silent ? 0 : media.volume * 100}%` } as CSSProperties} onChange={event => changeVolume(Number(event.currentTarget.value))} />
        </div>
        <div className={styles.time} aria-label={`已播放 ${timestamp(media.time)}，總長 ${canSeek ? timestamp(media.duration) : "未知"}`}>
          <span>{timestamp(media.time)}</span><span className={styles.divider}>/</span><span className={styles.duration}>{canSeek ? timestamp(media.duration) : "--:--"}</span>
        </div>
        <button ref={moreRef} type="button" className={`${styles.control} ${styles.settings}`} onClick={() => setOptionsOpen(open => !open)} aria-label="播放選項" aria-expanded={optionsOpen} aria-controls={optionsId} title="播放選項"><Settings size={20} aria-hidden="true" /></button>
      </div>
      <div className={styles.loopControls} aria-label="段落循環">
        <button type="button" disabled={!canSeek || media.duration < 0.25} onClick={loop.markStart} title="將目前播放位置設為起點 A" aria-label="設定循環起點 A"><b>A</b><span>{loop.start === null ? "設定起點" : loopTimestamp(loop.start)}</span></button>
        <button type="button" disabled={!canSeek || loop.start === null} onClick={loop.markEnd} title="將目前播放位置設為終點 B，開始循環" aria-label="設定循環終點 B"><b>B</b><span>{loop.end === null ? "設定終點" : loopTimestamp(loop.end)}</span></button>
        <button type="button" disabled={!loop.ready} onClick={loop.toggle} aria-label="A–B 循環" aria-pressed={loop.enabled}><Repeat2 size={15} aria-hidden="true" />{loop.enabled ? "循環中" : "循環"}</button>
        {loop.start !== null ? <button type="button" className={styles.clearLoop} onClick={loop.clear} aria-label="清除 A–B 段落" title="清除段落"><X size={14} aria-hidden="true" /></button> : null}
      </div>
      {optionsOpen ? <div ref={optionsRef} id={optionsId} className={styles.options}>
        <label className={styles.optionVolume}>音量<input className={styles.range} type="range" min={0} max={1} step={0.01} value={silent ? 0 : media.volume} aria-label="音量設定" aria-valuetext={`${Math.round((silent ? 0 : media.volume) * 100)}%`} style={{ "--fill": `${silent ? 0 : media.volume * 100}%` } as CSSProperties} onChange={event => changeVolume(Number(event.currentTarget.value))} /></label>
        {allowRate ? <label>播放速度<select aria-label="播放速度" value={media.rate} onChange={event => { audioRef.current!.preservesPitch = true; audioRef.current!.playbackRate = Number(event.currentTarget.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}{![0.5, 0.75, 1, 1.25, 1.5, 2].includes(media.rate) ? <option value={media.rate}>{media.rate}×</option> : null}</select></label> : null}
        <label>調性<select aria-label="調性升降半音" value={semitones} disabled={pitchBusy} onChange={event => void changePitch(Number(event.currentTarget.value))}>{Array.from({ length: 25 }, (_, index) => index - 12).map(value => <option key={value} value={value}>{value === 0 ? "原調" : `${value > 0 ? "+" : ""}${value} 半音`}</option>)}</select></label>
        {allowDownload ? <a href={props.src} download title="下載原始音檔，不套用試聽速度與移調"><Download size={15} aria-hidden="true" />下載原檔</a> : null}
        <span className={styles.practiceNote}>{pitchBusy ? "移調載入中…" : "速度與調性獨立調整 · 僅套用試聽"}</span>
      </div> : null}
      {media.error || (media.waiting && media.playing) ? <p className={styles.status} role="status">{media.error || "音檔載入中…"}</p> : null}
      {loop.message ? <p className={styles.status} role="status">{loop.message}</p> : null}
      {pitchError ? <p className={styles.status} role="status">{pitchError}</p> : null}
      {screenError ? <p className={styles.status} role="status">{screenError}</p> : null}
      {hasVisual && videoError ? <p className={styles.status} role="status">{videoError}</p> : null}
      </div>
    </div>
  );
});

export const CyberAudioPlayer = forwardRef<HTMLAudioElement, PlayerProps>(function CyberAudioPlayer(props, ref) {
  // A new source gets a clean media session; no time/play state leaks between tracks.
  return <PlayerSession key={props.src ?? "sources"} {...props} ref={ref} />;
});
