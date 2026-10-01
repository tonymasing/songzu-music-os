"use client";

import { Drum, Guitar, LockKeyhole, Piano } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import type { AutoScoreTarget } from "@/lib/auto-score";

type ScoreTimelineNote = {
  startSeconds: number;
  durationSeconds: number;
  midi: number;
  noteName: string;
  confidence: number;
};

type ScoreTimelineChord = {
  startSeconds: number;
  durationSeconds: number;
  name: string;
  confidence: number;
};

type ScoreTimelineDrumHit = {
  startSeconds: number;
  kind: "kick" | "snare" | "hihat";
  confidence: number;
};

type ScoreTimelineDraft = {
  id: string;
  title: string;
  targetInstrument: AutoScoreTarget;
  status: string;
  confidence: number;
  bpm: number | null;
  musicalKey: string | null;
  timeSignature: string;
  durationSeconds: number | null;
  sourceAudioFile: {
    id: string;
    fileName: string;
    versionName: string | null;
  } | null;
  result: {
    notes: ScoreTimelineNote[];
    chords: ScoreTimelineChord[];
    drumHits: ScoreTimelineDrumHit[];
  };
  updatedAt: string;
};

type DawScoreTimelineTracksProps = {
  projectId: string;
  timelineDuration: number;
  onSeek: (seconds: number) => void;
};

const SCORE_TRACKS: Record<
  AutoScoreTarget,
  { label: string; shortLabel: string; color: string; icon: typeof Guitar }
> = {
  guitar: { label: "吉他採譜", shortLabel: "簡明和弦導引", color: "#d6a24d", icon: Guitar },
  piano: { label: "鋼琴採譜", shortLabel: "音高 / 和聲導引", color: "#7899df", icon: Piano },
  drums: { label: "鼓手採譜", shortLabel: "節奏 / 鼓點導引", color: "#d9655e", icon: Drum }
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percent(seconds: number, duration: number) {
  return clamp((seconds * 100) / Math.max(0.1, duration), 0, 100);
}

function noteTop(midi: number) {
  return clamp(68 - (midi - 48) * 0.85, 38, 69);
}

function drumTop(kind: ScoreTimelineDrumHit["kind"]) {
  return kind === "hihat" ? 18 : kind === "snare" ? 42 : 65;
}

export function DawScoreTimelineTracks({ projectId, timelineDuration, onSeek }: DawScoreTimelineTracksProps) {
  const [drafts, setDrafts] = useState<ScoreTimelineDraft[]>([]);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  useEffect(() => {
    let mounted = true;

    async function loadTimelineDrafts() {
      const sequence = ++requestSequence.current;
      try {
        const response = await fetch(`/api/daw-projects/${projectId}/score-drafts?view=timeline`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "無法讀取採譜導引軌");
        if (!mounted || sequence !== requestSequence.current) return;
        setDrafts(data.drafts ?? []);
        setError("");
      } catch (loadError) {
        if (!mounted || sequence !== requestSequence.current) return;
        setError(loadError instanceof Error ? loadError.message : "無法讀取採譜導引軌");
      }
    }

    function handleScoreChange(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === projectId) void loadTimelineDrafts();
    }

    void loadTimelineDrafts();
    window.addEventListener("songzu:score-drafts-changed", handleScoreChange);
    return () => {
      mounted = false;
      window.removeEventListener("songzu:score-drafts-changed", handleScoreChange);
    };
  }, [projectId]);

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    onSeek(ratio * timelineDuration);
  }

  if (error) {
    return (
      <div className="daw-track-row daw-score-track-row is-error">
        <div className="daw-track-label daw-score-track-label">
          <strong>採譜導引</strong>
          <span>載入失敗</span>
        </div>
        <div className="daw-clip-lane daw-score-timeline-lane">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return drafts.map((draft) => {
    const config = SCORE_TRACKS[draft.targetInstrument];
    const Icon = config.icon;
    const sourceLabel = draft.sourceAudioFile?.versionName ?? draft.sourceAudioFile?.fileName ?? "採譜來源";
    const style = { "--score-track-color": config.color } as CSSProperties;
    return (
      <div className="daw-track-row daw-score-track-row" key={draft.id} style={style}>
        <div className="daw-track-label daw-score-track-label">
          <div className="daw-score-track-heading">
            <span className="daw-score-track-icon"><Icon size={15} /></span>
            <div>
              <strong>{config.label}</strong>
              <span>{config.shortLabel}</span>
            </div>
            <span className="daw-score-track-lock" title="採譜導引軌只供比對，不會修改原始音檔">
              <LockKeyhole size={11} /> 只讀
            </span>
          </div>
          <div className="daw-score-track-meta">
            <span>{Math.round(draft.confidence)}% 草稿</span>
            <span title={sourceLabel}>{sourceLabel}</span>
          </div>
        </div>
        <div
          className="daw-clip-lane daw-score-timeline-lane"
          aria-label={`${config.label}，點擊可跳到對應時間`}
          onPointerDown={seekFromPointer}
        >
          <div className="daw-lane-playhead" />
          {draft.targetInstrument !== "drums"
            ? draft.result.chords.map((chord, index) => (
                <span
                  className="daw-score-chord"
                  key={`${draft.id}-chord-${index}`}
                  style={{
                    left: `${percent(chord.startSeconds, timelineDuration)}%`,
                    width: `${Math.max(0.45, percent(chord.durationSeconds, timelineDuration))}%`
                  }}
                  title={`${chord.name} · ${Math.round(chord.confidence)}%`}
                >
                  {chord.name}
                </span>
              ))
            : null}
          {draft.targetInstrument !== "drums"
            ? draft.result.notes.map((note, index) => (
                <span
                  className="daw-score-note"
                  key={`${draft.id}-note-${index}`}
                  style={{
                    left: `${percent(note.startSeconds, timelineDuration)}%`,
                    top: `${noteTop(note.midi)}%`,
                    width: `${Math.max(0.18, percent(note.durationSeconds, timelineDuration))}%`
                  }}
                  title={`${note.noteName} · ${Math.round(note.confidence)}%`}
                />
              ))
            : null}
          {draft.targetInstrument === "drums" ? (
            <>
              {(["HH", "SD", "BD"] as const).map((label, index) => (
                <span className="daw-score-drum-guide" key={label} style={{ top: `${18 + index * 24}%` }}>
                  {label}
                </span>
              ))}
              {draft.result.drumHits.map((hit, index) => (
                <span
                  className={`daw-score-drum-hit ${hit.kind}`}
                  key={`${draft.id}-hit-${index}`}
                  style={{ left: `${percent(hit.startSeconds, timelineDuration)}%`, top: `${drumTop(hit.kind)}%` }}
                  title={`${hit.kind} · ${Math.round(hit.confidence)}%`}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
    );
  });
}
