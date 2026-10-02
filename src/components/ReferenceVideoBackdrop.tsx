"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSyncedReferenceVideo } from "./useSyncedReferenceVideo";
import styles from "./ReferenceVideoBackdrop.module.css";

type Selection = { audio: HTMLAudioElement; src: string };

function BackdropVideo({ selection, playing }: { selection: Selection; playing: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useMemo(() => ({ current: selection.audio }), [selection.audio]);
  const [ready, setReady] = useState(false);
  const failed = useCallback(() => setReady(false), []);
  useSyncedReferenceVideo(audioRef, videoRef, selection.src, playing, failed);

  return (
    <div className={styles.backdrop} data-reference-video-background="true" data-visible={playing && ready} aria-hidden="true">
      <video ref={videoRef} src={selection.src} muted loop playsInline preload="metadata" controls={false} disablePictureInPicture tabIndex={-1} onLoadedData={() => setReady(true)} onError={failed} />
    </div>
  );
}

/** Lives behind this page's content; the original shell scenery stays underneath. */
export function ReferenceVideoBackdrop({ items }: { items: Array<{ id: string; videoUrl: string | null }> }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const sources = useMemo(() => new Map(items.map(item => [item.id, item.videoUrl])), [items]);
  const attach = useCallback((node: HTMLSpanElement | null) => {
    setHost(node?.closest<HTMLElement>(".app-shell") ?? null);
  }, []);

  useEffect(() => {
    const scope = host?.querySelector("main");
    if (!scope) return;
    const select = (event: Event) => {
      const audio = event.target;
      if (!(audio instanceof HTMLAudioElement) || !audio.dataset.referenceId) return;
      if (event.type === "play") activeAudio.current = audio;
      else if (activeAudio.current !== audio) return;
      const src = sources.get(audio.dataset.referenceId);
      if (src) setSelection(current => current?.audio === audio && current.src === src ? current : { audio, src });
      setPlaying(Boolean(src) && !audio.paused && !audio.ended);
    };
    const pause = (event: Event) => { if (event.target === activeAudio.current) setPlaying(false); };
    const stopEvents = ["pause", "ended", "emptied"];
    scope.addEventListener("play", select, true);
    scope.addEventListener("playing", select, true);
    stopEvents.forEach(name => scope.addEventListener(name, pause, true));
    return () => {
      scope.removeEventListener("play", select, true);
      scope.removeEventListener("playing", select, true);
      stopEvents.forEach(name => scope.removeEventListener(name, pause, true));
    };
  }, [host, sources]);

  useEffect(() => {
    if (!selection) return;
    const pause = () => { if (activeAudio.current === selection.audio) setPlaying(false); };
    const events = ["pause", "ended", "emptied"];
    events.forEach(name => selection.audio.addEventListener(name, pause));
    return () => events.forEach(name => selection.audio.removeEventListener(name, pause));
  }, [selection]);

  return <>
    <span ref={attach} hidden aria-hidden="true" />
    {host && selection ? createPortal(<BackdropVideo key={selection.src} selection={selection} playing={playing} />, host) : null}
  </>;
}
