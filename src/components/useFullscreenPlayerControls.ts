"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/** Fullscreen-only chrome; audio/video elements stay mounted while controls slide away. */
export function useFullscreenPlayerControls(
  playerRef: RefObject<HTMLDivElement | null>,
  controlsRef: RefObject<HTMLDivElement | null>,
  fullscreen: boolean,
  optionsOpen: boolean
) {
  const [visible, setVisible] = useState(true);
  const reveal = useCallback(() => setVisible(true), []);

  useEffect(() => {
    if (!fullscreen) return;
    const player = playerRef.current, controls = controlsRef.current;
    if (!player || !controls) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovering = false, dragging = false;
    const clear = () => { clearTimeout(timer); timer = undefined; };
    const keyboardFocus = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && player.contains(active) && active.matches(":focus-visible");
    };
    const schedule = (delay = 650) => {
      clear();
      if (hovering || dragging || optionsOpen || keyboardFocus()) return;
      timer = setTimeout(() => setVisible(false), delay);
    };
    const show = () => { clear(); setVisible(true); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = player.getBoundingClientRect();
      const panel = controls.getBoundingClientRect();
      // Range dragging may capture the pointer; use its position, not captured target.
      hovering = (event.clientX >= panel.left && event.clientX <= panel.right && event.clientY >= panel.top && event.clientY <= panel.bottom) || event.clientY >= bounds.bottom - 64;
      if (hovering || dragging) show();
      // Keep the original deadline while the pointer keeps moving over the movie.
      else if (timer === undefined) schedule();
    };
    const leave = () => { hovering = false; schedule(); };
    const down = (event: PointerEvent) => {
      if (controls.contains(event.target as Node)) { dragging = true; show(); }
      else if (event.pointerType === "touch") { show(); schedule(2500); }
    };
    const up = (event: PointerEvent) => { dragging = false; schedule(event.pointerType === "touch" ? 2500 : 650); };
    const focus = () => { if (keyboardFocus()) show(); else schedule(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Tab") show(); };
    player.addEventListener("pointermove", move);
    player.addEventListener("pointerleave", leave);
    player.addEventListener("pointerdown", down);
    player.addEventListener("focusin", focus);
    player.addEventListener("focusout", focus);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key);
    show();
    schedule(1800);
    return () => {
      clear();
      player.removeEventListener("pointermove", move);
      player.removeEventListener("pointerleave", leave);
      player.removeEventListener("pointerdown", down);
      player.removeEventListener("focusin", focus);
      player.removeEventListener("focusout", focus);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key);
    };
  }, [playerRef, controlsRef, fullscreen, optionsOpen]);

  return { visible: !fullscreen || visible, reveal };
}
