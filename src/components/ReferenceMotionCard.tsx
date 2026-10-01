"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./ReferenceMotionCard.module.css";

/** Decoration only. Keep audio, favorites and the reference's content in the parent. */
export function ReferenceMotionCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    let visible = false;
    const update = () => { card.dataset.motion = visible && !document.hidden ? "running" : "paused"; };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }, { rootMargin: "40px 0px" });
    observer.observe(card);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return <article ref={ref} className={`reference-card ${styles.card}`} data-motion="paused">{children}</article>;
}
