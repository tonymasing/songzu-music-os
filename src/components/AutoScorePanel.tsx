"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import {
  Check,
  CheckCircle2,
  Download,
  Drum,
  FileMusic,
  Guitar,
  LoaderCircle,
  LockKeyhole,
  LockOpen,
  Music2,
  Pause,
  Piano,
  Play,
  Repeat2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AUTO_SCORE_STRUMMING_SUBDIVISIONS,
  applyAutoScoreReferenceChart,
  autoScoreReviewMeasures,
  autoScoreReviewableMeasures,
  autoScoreSheetSections,
  autoScoreSheetTokens,
  buildAutoScoreDeliveryCertification,
  buildAutoScoreStrummingVariant,
  isAutoScoreBeatExplicitlyConfirmed,
  setAutoScoreBeatConfirmation,
  updateAutoScoreReviewBeatChord,
  verifyAutoScoreResult,
  type AutoScoreBar,
  type AutoScoreIndependentReview,
  type AutoScoreResult,
  type AutoScoreReferenceVerification,
  type AutoScoreReviewBeat,
  type AutoScoreStrumStroke,
  type AutoScoreStrummingAnalysis,
  type AutoScoreStrummingPattern,
  type AutoScoreStrummingSubdivision,
  type AutoScoreStrummingVariant,
  type AutoScoreTarget
} from "@/lib/auto-score";
import type { DawProjectDto } from "@/lib/daw";

type ScoreAudioFile = {
  id: string;
  fileName: string;
  fileType: string;
  versionName: string | null;
  durationSeconds: number | null;
  qualityStatus: string;
  storageProvider: string;
  sourceKind?: string | null;
  isProtectedOriginal?: boolean;
  mimeType?: string | null;
  codecName?: string | null;
  parentAudioFileId?: string | null;
};

type ScoreDraftDto = {
  id: string;
  projectId: string;
  sourceAudioFileId: string | null;
  title: string;
  targetInstrument: AutoScoreTarget;
  analyzer: string;
  status: string;
  confidence: number;
  bpm: number | null;
  musicalKey: string | null;
  timeSignature: string;
  durationSeconds: number | null;
  result: AutoScoreResult;
  sourceAudioFile: {
    id: string;
    fileName: string;
    versionName: string | null;
    fileType: string;
    durationSeconds: number | null;
    qualityStatus: string;
    isProtectedOriginal: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type AudioJobDto = {
  id: string;
  status: string;
  resultJson: string | null;
  errorMessage: string | null;
};

type AutoScorePanelProps = {
  project: DawProjectDto;
  audioFiles: ScoreAudioFile[];
  onProjectChange: (project: DawProjectDto) => void;
};

const TARGETS: Array<{ id: AutoScoreTarget; label: string; detail: string; icon: typeof Guitar }> = [
  { id: "guitar", label: "吉他和弦", detail: "只顯示和弦與切換時間", icon: Guitar },
  { id: "piano", label: "鋼琴和聲", detail: "和弦段落與建議音域", icon: Piano },
  { id: "drums", label: "鼓手譜", detail: "大鼓、軍鼓與 hi-hat", icon: Drum }
];

const CHORD_OPTIONS = [
  "N.C.",
  "C", "Cm", "C7", "Cmaj7", "Cm7", "C#", "C#m", "Db", "Dbm",
  "D", "Dm", "D7", "Dmaj7", "Dm7", "D#", "D#m", "Eb", "Ebm",
  "E", "Em", "E7", "Emaj7", "Em7",
  "F", "Fm", "F7", "Fmaj7", "Fm7", "F#", "F#m", "Gb", "Gbm",
  "G", "Gm", "G7", "Gmaj7", "Gm7", "G#", "G#m", "Ab", "Abm",
  "A", "Am", "A7", "Amaj7", "Am7", "A#", "A#m", "Bb", "Bbm",
  "B", "Bm", "B7", "Bmaj7", "Bm7"
];

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function chunkItems<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function targetLabel(target: AutoScoreTarget) {
  return target === "guitar" ? "吉他和弦" : target === "piano" ? "鋼琴和聲" : "鼓手譜";
}

function sourceDescription(file: ScoreAudioFile) {
  return `${file.fileType} ${file.versionName ?? ""} ${file.fileName}`.toLocaleLowerCase();
}

function sourceSuitability(file: ScoreAudioFile, target: AutoScoreTarget) {
  const description = sourceDescription(file);
  const isDrumStem = file.fileType === "drum_stem" || /\b(drums?|鼓)\b/.test(description);
  const isBassStem = file.fileType === "bass_stem" || /\b(bass|貝斯)\b/.test(description);
  const isVocalStem = file.fileType === "vocal_stem" || /\b(vocals?|人聲)\b/.test(description);
  const isInstrumentalStem = file.fileType === "instrumental_stem";
  const isGuitarStem = /\b(guitars?|吉他)\b/.test(description);
  const isPianoStem = /\b(piano|keys?|鋼琴|鍵盤)\b/.test(description);

  if (target === "drums") {
    if (isDrumStem) return "recommended" as const;
    if (isGuitarStem || isPianoStem || isBassStem || isVocalStem || isInstrumentalStem) return "incompatible" as const;
    return "usable" as const;
  }
  if (target === "guitar") {
    if (isGuitarStem) return "recommended" as const;
    if (isDrumStem || isBassStem || isVocalStem || isPianoStem) return "incompatible" as const;
    return isInstrumentalStem ? "recommended" as const : "usable" as const;
  }
  if (isPianoStem) return "recommended" as const;
  if (isDrumStem || isBassStem || isVocalStem || isGuitarStem) return "incompatible" as const;
  return isInstrumentalStem ? "recommended" as const : "usable" as const;
}

function bestScoreSource(files: ScoreAudioFile[], target: AutoScoreTarget) {
  const ranked = files
    .map((file, index) => ({ file, index, suitability: sourceSuitability(file, target) }))
    .sort((left, right) => {
      const weight = { recommended: 0, usable: 1, incompatible: 2 } as const;
      return weight[left.suitability] - weight[right.suitability] || left.index - right.index;
    });
  return ranked[0]?.file ?? null;
}

function isSeparatedStem(file: ScoreAudioFile) {
  return file.sourceKind === "derived_stem" || Boolean(file.parentAudioFileId) || file.fileType.endsWith("_stem");
}

function bestReviewSource(files: ScoreAudioFile[], draft: ScoreDraftDto | null) {
  const expectedDuration = draft?.durationSeconds ?? draft?.result.durationSeconds ?? null;
  return [...files].sort((left, right) => {
    const score = (file: ScoreAudioFile) => {
      const durationDifference = expectedDuration && file.durationSeconds
        ? Math.abs(expectedDuration - file.durationSeconds)
        : 0;
      return (isSeparatedStem(file) ? 1_000 : 0)
        + (durationDifference > 2 ? 500 + durationDifference : durationDifference)
        + (file.isProtectedOriginal ? -80 : 0)
        + (file.sourceKind === "upload" ? -40 : 0)
        + (["reference", "mix", "master", "demo"].includes(file.fileType) ? -20 : 0);
    };
    return score(left) - score(right);
  })[0] ?? null;
}

function reviewSourceLabel(file: ScoreAudioFile, recommendedId: string | null) {
  const quality = isSeparatedStem(file) ? "分析 Stem" : "原曲直通";
  const recommended = file.id === recommendedId ? " · 推薦試聽" : "";
  return `${file.versionName ?? file.fileName} · ${formatDuration(file.durationSeconds)} · ${quality}${recommended}`;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`${fallbackMessage}：伺服器回應中斷（HTTP ${response.status || "未知"}）`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${fallbackMessage}：伺服器回應格式不完整（HTTP ${response.status}）`);
  }
}

function requestErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "無法連接本機音樂核心。請確認頌祖音樂 OS 正在執行，重新載入頁面後再試一次。";
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

async function recoverTranscriptionJob(audioFileId: string, target: AutoScoreTarget, since: string) {
  const query = new URLSearchParams({ recoverJob: "1", audioFileId, jobType: "TRANSCRIPTION", target, since });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 350));
    try {
      const response = await fetch(`/api/music-intelligence?${query}`, { cache: "no-store" });
      const data = await readJsonResponse<{ job: AudioJobDto | null; error?: string }>(response, "無法復原採譜工作");
      if (!response.ok) throw new Error(data.error ?? "無法復原採譜工作");
      if (data.job) return data.job;
    } catch {
      // A short service reload can interrupt both calls. Retry without duplicating the audio job.
    }
  }
  return null;
}

function confidenceLabel(value: number) {
  if (value >= 68) return "較穩定，仍需聽感確認";
  if (value >= 48) return "待逐段校對";
  return "不可直接採用";
}

function isChordConfirmed(reviewStatus: AutoScoreResult["chords"][number]["reviewStatus"]) {
  return reviewStatus === "confirmed";
}

type ChordMeasure = ReturnType<typeof autoScoreReviewMeasures>[number];

function scoreBeatKey(beat: AutoScoreReviewBeat) {
  return beat.id;
}

function chordMeasureTokens(measure: ChordMeasure, edits?: Record<string, string>) {
  return measure.beats.map((beat, index) => {
    const chordName = edits?.[scoreBeatKey(beat)]?.trim() || beat.name;
    const previousBeat = index > 0 ? measure.beats[index - 1] : null;
    const previousName = previousBeat ? edits?.[scoreBeatKey(previousBeat)]?.trim() || previousBeat.name : null;
    return index > 0 && chordName === previousName ? "_" : chordName;
  });
}

function strumStrokeLabel(stroke: AutoScoreStrummingPattern["strokes"][number]) {
  return stroke === "down" ? "↓" : stroke === "up" ? "↑" : stroke === "mute" ? "×" : "–";
}

function strumStrokeName(stroke: AutoScoreStrummingPattern["strokes"][number]) {
  return stroke === "down" ? "下刷" : stroke === "up" ? "上刷" : stroke === "mute" ? "悶音" : "空刷";
}

type PendingStrummingEdit = {
  patternId: string;
  subdivision: AutoScoreStrummingSubdivision;
  strokes: AutoScoreStrumStroke[];
  accents: number[];
};

type SelectedStrummingCell = {
  patternId: string;
  subdivision: AutoScoreStrummingSubdivision;
  index: number;
};

function strummingEditKey(patternId: string, subdivision: AutoScoreStrummingSubdivision) {
  return `${patternId}:${subdivision}`;
}

function withPendingStrummingEdit(variant: AutoScoreStrummingVariant, edit?: PendingStrummingEdit) {
  if (!edit) return variant;
  const accents = [...edit.accents];
  return {
    ...variant,
    strokes: edit.strokes,
    accents,
    source: "manual" as const,
    groups: variant.groups.map((group) => ({
      ...group,
      cells: group.cells.map((cell) => ({
        ...cell,
        stroke: edit.strokes[cell.index] ?? "rest",
        accent: accents.includes(cell.index)
      }))
    }))
  };
}

function notifyScoreTimelineChanged(projectId: string) {
  window.dispatchEvent(new CustomEvent("songzu:score-drafts-changed", { detail: { projectId } }));
}

function drumPattern(bar: AutoScoreBar, kind: "kick" | "snare" | "hihat", bpm: number) {
  const stepDuration = (60 / bpm) / 4;
  return Array.from({ length: 16 }, (_, index) => {
    const time = bar.startSeconds + index * stepDuration;
    return bar.drumHits.some((hit) => hit.kind === kind && Math.abs(hit.startSeconds - time) <= stepDuration * 0.35);
  });
}

function pitchTop(midi: number) {
  return Math.max(4, Math.min(84, 82 - (midi - 48) * 2.15));
}

export function AutoScorePanel({ project, audioFiles, onProjectChange }: AutoScorePanelProps) {
  const [localAudioFiles, setLocalAudioFiles] = useState(audioFiles);
  const [drafts, setDrafts] = useState<ScoreDraftDto[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [sourceAudioFileId, setSourceAudioFileId] = useState(bestScoreSource(audioFiles, "guitar")?.id ?? "");
  const [target, setTarget] = useState<AutoScoreTarget>("guitar");
  const [busy, setBusy] = useState<"loading" | "uploading" | "analyzing" | "saving" | "reference" | "independent-review" | "finalizing" | "unlocking" | "applying" | "strumming" | "strumming-analysis" | null>("loading");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [chordEdits, setChordEdits] = useState<Record<string, string>>({});
  const [confirmationEdits, setConfirmationEdits] = useState<Record<string, boolean>>({});
  const [focusedBeatKey, setFocusedBeatKey] = useState("");
  const [loopMeasure, setLoopMeasure] = useState(true);
  const [referenceChart, setReferenceChart] = useState("");
  const [referenceSourceType, setReferenceSourceType] = useState<AutoScoreReferenceVerification["sourceType"]>("editor_reference");
  const [referenceTitle, setReferenceTitle] = useState("");
  const [referencePublisher, setReferencePublisher] = useState("本機創作者");
  const [referenceProductId, setReferenceProductId] = useState("");
  const [referenceStartMeasure, setReferenceStartMeasure] = useState(1);
  const [independentReviewer, setIndependentReviewer] = useState("");
  const [independentReviewerRole, setIndependentReviewerRole] = useState<AutoScoreIndependentReview["role"]>("musician");
  const [independentReviewNotes, setIndependentReviewNotes] = useState("");
  const [independentReviewAttested, setIndependentReviewAttested] = useState(false);
  const [playbackRange, setPlaybackRange] = useState<{ startSeconds: number; endSeconds: number; measure: number } | null>(null);
  const [isReviewPlaying, setIsReviewPlaying] = useState(false);
  const [reviewAudioFileId, setReviewAudioFileId] = useState("");
  const [previewPatternId, setPreviewPatternId] = useState("");
  const [strummingSubdivision, setStrummingSubdivision] = useState<AutoScoreStrummingSubdivision>("sixteenth");
  const [strummingEdits, setStrummingEdits] = useState<Record<string, PendingStrummingEdit>>({});
  const [selectedStrummingCell, setSelectedStrummingCell] = useState<SelectedStrummingCell | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const strumAudioContextRef = useRef<AudioContext | null>(null);
  const strumPreviewSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const strumPreviewTimerRef = useRef<number | null>(null);
  const measureRefs = useRef(new Map<number, HTMLElement>());
  const beatInputRefs = useRef(new Map<string, HTMLInputElement>());

  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null;
  const sourceFile = localAudioFiles.find((file) => file.id === sourceAudioFileId) ?? null;
  const recommendedReviewSource = useMemo(
    () => bestReviewSource(localAudioFiles, selectedDraft),
    [localAudioFiles, selectedDraft]
  );
  const defaultReviewSourceId = recommendedReviewSource?.id ?? selectedDraft?.sourceAudioFile?.id ?? "";
  const reviewAudioFile = localAudioFiles.find((file) => file.id === reviewAudioFileId)
    ?? recommendedReviewSource
    ?? null;
  const chordMeasures = useMemo(
    () => selectedDraft?.targetInstrument === "guitar" ? autoScoreReviewableMeasures(selectedDraft.result) : [],
    [selectedDraft]
  );
  const scoreStats = useMemo(() => {
    if (!selectedDraft) return null;
    return {
      bars: selectedDraft.result.bars.length,
      chords: selectedDraft.result.chords.length,
      notes: selectedDraft.result.notes.length,
      hits: selectedDraft.result.drumHits.length,
      likely: selectedDraft.result.chords.filter((chord) => chord.reviewStatus === "likely" || chord.confidence >= 68).length,
      confirmed: selectedDraft.result.chords.filter((chord) => isChordConfirmed(chord.reviewStatus)).length
    };
  }, [selectedDraft]);
  const verifiedScorePreview = useMemo(
    () => selectedDraft?.targetInstrument === "guitar" ? verifyAutoScoreResult(selectedDraft.result) : null,
    [selectedDraft]
  );
  const chordVerification = verifiedScorePreview?.verification?.chordVerification ?? null;
  const systemVerified = chordVerification?.status === "verified" && chordVerification.conflictCount === 0;
  const deliveryCertification = useMemo(
    () => selectedDraft?.targetInstrument === "guitar"
      ? buildAutoScoreDeliveryCertification(verifiedScorePreview ?? selectedDraft.result)
      : null,
    [selectedDraft, verifiedScorePreview]
  );
  const strummingGuide = verifiedScorePreview?.strummingGuide ?? null;
  const strummingSubdivisionOption = AUTO_SCORE_STRUMMING_SUBDIVISIONS.find((option) => option.id === strummingSubdivision)
    ?? AUTO_SCORE_STRUMMING_SUBDIVISIONS[2];
  const pendingStrummingEdits = useMemo(() => Object.values(strummingEdits), [strummingEdits]);
  const pendingStrummingCellCount = useMemo(() => pendingStrummingEdits.reduce((total, edit) => {
    const pattern = strummingGuide?.patterns.find((candidate) => candidate.id === edit.patternId);
    if (!pattern) return total;
    const stored = buildAutoScoreStrummingVariant(pattern, edit.subdivision);
    const strokeChanges = edit.strokes.filter((stroke, index) => stroke !== stored.strokes[index]).length;
    const accentChanges = Array.from({ length: edit.strokes.length }, (_, index) => index)
      .filter((index) => edit.accents.includes(index) !== stored.accents.includes(index)).length;
    return total + strokeChanges + accentChanges;
  }, 0), [pendingStrummingEdits, strummingGuide]);
  const guitarBeatStats = {
    total: chordVerification?.totalBeatCount ?? chordMeasures.flatMap((measure) => measure.beats).length,
    verified: chordVerification?.verifiedBeatCount ?? 0
  };
  const allReviewBeats = useMemo(() => chordMeasures.flatMap((measure) => measure.beats), [chordMeasures]);
  const reviewSections = useMemo(() => {
    if (!chordMeasures.length) return [];
    if (selectedDraft?.result.sectionMap?.length) {
      return selectedDraft.result.sectionMap.flatMap((section) => {
        const measures = chordMeasures.filter((measure) =>
          measure.number >= section.firstMeasure && measure.number <= section.lastMeasure
        );
        if (!measures.length) return [];
        return [{
          ...section,
          firstMeasure: measures[0].number,
          lastMeasure: measures.at(-1)!.number,
          startSeconds: measures[0].startSeconds,
          endSeconds: measures.at(-1)!.endSeconds
        }];
      });
    }
    const markerSections = project.markers.flatMap((marker) => {
      if (marker.markerType !== "section") return [];
      const match = /^(.+?)\s*·\s*第\s*(\d+)(?:-(\d+))?\s*小節$/.exec(marker.label);
      if (!match) return [];
      const firstMeasure = Math.max(1, Number(match[2]));
      const lastMeasure = Math.min(chordMeasures.length, Number(match[3] ?? match[2]));
      const first = chordMeasures.find((measure) => measure.number === firstMeasure);
      const last = chordMeasures.find((measure) => measure.number === lastMeasure);
      if (!first || !last || lastMeasure < firstMeasure) return [];
      return [{
        label: match[1].trim(),
        firstMeasure,
        lastMeasure,
        startSeconds: first.startSeconds,
        endSeconds: last.endSeconds
      }];
    });
    if (markerSections.length) return markerSections;
    return Array.from({ length: Math.ceil(chordMeasures.length / 8) }, (_, index) => {
      const measures = chordMeasures.slice(index * 8, index * 8 + 8);
      return {
        label: `校對段落 ${index + 1}`,
        firstMeasure: measures[0].number,
        lastMeasure: measures.at(-1)!.number,
        startSeconds: measures[0].startSeconds,
        endSeconds: measures.at(-1)!.endSeconds
      };
    });
  }, [chordMeasures, project.markers, selectedDraft?.result.sectionMap]);
  const completeGuitarSections = useMemo(() => {
    if (selectedDraft?.targetInstrument !== "guitar") return [];
    return autoScoreSheetSections(selectedDraft.result);
  }, [selectedDraft]);
  const pendingChordEdits = useMemo(() => allReviewBeats.flatMap((beat) => {
    const key = scoreBeatKey(beat);
    const editedName = chordEdits[key];
    return editedName !== undefined && editedName.trim() !== beat.name
      ? [{ beat, name: editedName }]
      : [];
  }), [allReviewBeats, chordEdits]);
  const pendingChordEditCount = pendingChordEdits.length;
  const pendingConfirmationEdits = useMemo(() => allReviewBeats.flatMap((beat) => {
    const key = scoreBeatKey(beat);
    const desired = confirmationEdits[key];
    if (desired === undefined || !selectedDraft) return [];
    const changedChord = (chordEdits[key]?.trim() ?? beat.name) !== beat.name;
    const defaultAfterChord = changedChord || isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, beat);
    return desired !== defaultAfterChord ? [{ beat, confirmed: desired }] : [];
  }), [allReviewBeats, chordEdits, confirmationEdits, selectedDraft]);
  const pendingReviewBeatKeys = useMemo(() => new Set([
    ...pendingChordEdits.map((edit) => scoreBeatKey(edit.beat)),
    ...pendingConfirmationEdits.map((edit) => scoreBeatKey(edit.beat))
  ]), [pendingChordEdits, pendingConfirmationEdits]);
  const pendingReviewChangeCount = pendingReviewBeatKeys.size;
  const effectiveConfirmedCount = useMemo(() => allReviewBeats.filter((beat) => {
    if (!selectedDraft) return false;
    const key = scoreBeatKey(beat);
    const changedChord = (chordEdits[key]?.trim() ?? beat.name) !== beat.name;
    return confirmationEdits[key] ?? (changedChord || isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, beat));
  }).length, [allReviewBeats, chordEdits, confirmationEdits, selectedDraft]);
  const focusedBeat = allReviewBeats.find((beat) => scoreBeatKey(beat) === focusedBeatKey) ?? allReviewBeats[0] ?? null;
  const focusedMeasure = focusedBeat ? chordMeasures.find((measure) => measure.number === focusedBeat.measure) ?? null : null;
  const isFinalized = selectedDraft?.result.review?.status === "finalized" && selectedDraft.result.review.verificationMethod === "manual";
  const isLegacySystemFinalized = selectedDraft?.result.review?.status === "finalized" && selectedDraft.result.review.verificationMethod === "multi_evidence_system";
  const isScoreLocked = isFinalized || isLegacySystemFinalized;
  const finalizedVerificationLabel = isFinalized ? "人工確認" : "舊版系統鎖定，待人工複核";

  useEffect(() => {
    setChordEdits({});
    setConfirmationEdits({});
    setStrummingEdits({});
    setSelectedStrummingCell(null);
    setFocusedBeatKey((current) => {
      if (allReviewBeats.some((beat) => scoreBeatKey(beat) === current)) return current;
      return scoreBeatKey(allReviewBeats[0] ?? {
        id: "empty:0:0",
        measure: 0,
        beat: 0,
        startSeconds: 0,
        endSeconds: 0,
        name: "N.C.",
        sourceMeasure: null
      });
    });
  }, [allReviewBeats, selectedDraftId]);

  useEffect(() => {
    if (!pendingReviewChangeCount && !pendingStrummingCellCount) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalExit);
    return () => window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [pendingReviewChangeCount, pendingStrummingCellCount]);

  useEffect(() => () => {
    for (const source of strumPreviewSourcesRef.current) {
      try { source.stop(); } catch { /* Source may already be stopped. */ }
    }
    if (strumPreviewTimerRef.current !== null) window.clearTimeout(strumPreviewTimerRef.current);
    void strumAudioContextRef.current?.close();
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("songzu:strumming-subdivision");
    if (AUTO_SCORE_STRUMMING_SUBDIVISIONS.some((option) => option.id === stored)) {
      setStrummingSubdivision(stored as AutoScoreStrummingSubdivision);
    }
  }, []);

  useEffect(() => {
    setLocalAudioFiles(audioFiles);
    const current = audioFiles.find((file) => file.id === sourceAudioFileId);
    const preferred = bestScoreSource(audioFiles, target);
    if ((!current || sourceSuitability(current, target) === "incompatible") && preferred && preferred.id !== current?.id) {
      setSourceAudioFileId(preferred.id);
    }
  }, [audioFiles, sourceAudioFileId, target]);

  useEffect(() => {
    setReviewAudioFileId(defaultReviewSourceId);
    reviewAudioRef.current?.pause();
    setIsReviewPlaying(false);
    setPlaybackRange(null);
  }, [localAudioFiles, selectedDraft?.id, defaultReviewSourceId]);

  useEffect(() => {
    setIndependentReviewer("");
    setIndependentReviewerRole("musician");
    setIndependentReviewNotes("");
    setIndependentReviewAttested(false);
  }, [selectedDraftId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/daw-projects/${project.id}/score-drafts`);
        const data = await readJsonResponse<{ drafts?: ScoreDraftDto[]; error?: string }>(response, "無法讀取採譜草稿");
        if (!response.ok) throw new Error(data.error ?? "無法讀取採譜草稿");
        if (cancelled) return;
        const loadedDrafts = data.drafts ?? [];
        setDrafts(loadedDrafts);
        setSelectedDraftId((current) => {
          const currentDraft = loadedDrafts.find((draft) => draft.id === current);
          if (currentDraft?.targetInstrument === target) return current;
          return loadedDrafts.find((draft) => draft.targetInstrument === target)?.id || loadedDrafts[0]?.id || "";
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "無法讀取採譜草稿");
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => { cancelled = true; };
  }, [project.id, target]);

  async function uploadReference(file: File) {
    setBusy("uploading");
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("fileType", "demo");
      form.set("versionName", `採譜參考 · ${file.name.replace(/\.[^.]+$/, "")}`);
      form.set("notes", "自動採譜來源；原始音檔受保護、不轉檔。 ");
      form.set("isPrimary", "false");
      const response = await fetch(`/api/songs/${project.songId}/upload`, { method: "POST", body: form });
      const song = await readJsonResponse<{ audioFiles?: Array<ScoreAudioFile & { archivedAt?: string | null }>; error?: string }>(response, "音檔上傳失敗");
      if (!response.ok) throw new Error(song.error ?? "音檔上傳失敗");
      const nextFiles = (song.audioFiles ?? []).filter((item: { archivedAt?: string | null }) => !item.archivedAt).map((item: ScoreAudioFile) => ({
        id: item.id,
        fileName: item.fileName,
        fileType: item.fileType,
        versionName: item.versionName,
        durationSeconds: item.durationSeconds,
        qualityStatus: item.qualityStatus,
        storageProvider: item.storageProvider,
        sourceKind: item.sourceKind,
        isProtectedOriginal: item.isProtectedOriginal,
        mimeType: item.mimeType,
        codecName: item.codecName,
        parentAudioFileId: item.parentAudioFileId
      }));
      setLocalAudioFiles(nextFiles);
      const uploaded = nextFiles.find((item: ScoreAudioFile) => item.fileName === file.name) ?? nextFiles.at(-1);
      if (uploaded) setSourceAudioFileId(uploaded.id);
      setMessage("音檔已保存為受保護來源，可以開始採譜。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "音檔上傳失敗");
    } finally {
      setBusy(null);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function runTranscription() {
    const pendingCount = pendingReviewChangeCount + pendingStrummingCellCount;
    if (pendingCount && !window.confirm(`目前有 ${pendingCount} 項和弦或刷法變更尚未儲存。放棄修改並重新採譜？`)) return;
    if (pendingCount) {
      setChordEdits({});
      setConfirmationEdits({});
      setStrummingEdits({});
      setSelectedStrummingCell(null);
    }
    let transcriptionSource = sourceFile;
    if (!transcriptionSource) {
      setError("請先選擇或上傳來源音檔。");
      return;
    }
    if (sourceSuitability(transcriptionSource, target) === "incompatible") {
      const preferred = bestScoreSource(localAudioFiles, target);
      if (!preferred || sourceSuitability(preferred, target) === "incompatible") {
        setError(`${transcriptionSource.versionName ?? transcriptionSource.fileName} 不含適合${targetLabel(target)}的聲音，請改選原曲或對應樂器 Stem。`);
        return;
      }
      transcriptionSource = preferred;
      setSourceAudioFileId(preferred.id);
    }
    setBusy("analyzing");
    setError("");
    setMessage("");
    setProgress(0.02);
    setProgressLabel("讀取受保護音檔");
    const requestedAt = new Date(Date.now() - 1_000).toISOString();
    try {
      setProgress(0.12);
      setProgressLabel("本機 ffmpeg 解碼與節拍校正");
      let payload: { job?: AudioJobDto; error?: string };
      try {
        const response = await fetch("/api/music-intelligence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "run_audio_job",
            audioFileId: transcriptionSource.id,
            jobType: "TRANSCRIPTION",
            target
          })
        });
        payload = await readJsonResponse<{ job?: AudioJobDto; error?: string }>(response, "本機採譜工作失敗");
        if (!response.ok) throw new Error(payload.error ?? "本機採譜工作失敗");
      } catch (requestError) {
        setProgress(0.82);
        setProgressLabel("重新連接已完成的採譜工作");
        const recoveredJob = await recoverTranscriptionJob(transcriptionSource.id, target, requestedAt);
        if (!recoveredJob) throw requestError;
        payload = { job: recoveredJob };
      }
      const jobResult = JSON.parse(payload.job?.resultJson || "{}");
      if (payload.job?.status !== "COMPLETED" || !jobResult.draftId) {
        throw new Error(payload.job?.errorMessage || "採譜工作沒有產生可校對草譜");
      }
      setProgress(0.9);
      setProgressLabel("讀取完整草譜");
      const draftResponse = await fetch(`/api/daw-score-drafts/${jobResult.draftId}`);
      const saved = await readJsonResponse<{ draft: ScoreDraftDto; error?: string }>(draftResponse, "草譜保存後無法讀取");
      if (!draftResponse.ok) throw new Error(saved.error ?? "草譜保存後無法讀取");
      setDrafts((current) => [
        saved.draft,
        ...current.filter((draft) =>
          draft.id !== saved.draft.id && !(
            (["songzu_harmony_v2", "songzu_harmony_v3", "songzu_harmony_v4", "songzu_harmony_v5", "songzu_harmony_v6", "songzu_harmony_v7", "songzu_harmony_v8", "songzu_harmony_v9", "songzu_harmony_v10", "songzu_harmony_v11", "songzu_harmony_v12"].includes(saved.draft.analyzer)) &&
            draft.analyzer === "songzu_local_dsp_v1" &&
            draft.sourceAudioFileId === saved.draft.sourceAudioFileId &&
            draft.targetInstrument === saved.draft.targetInstrument
          )
        )
      ]);
      setSelectedDraftId(saved.draft.id);
      notifyScoreTimelineChanged(project.id);
      setProgress(1);
      setProgressLabel("草譜已保存");
      setMessage(`${targetLabel(target)}完成，共 ${saved.draft.result.chords.length || saved.draft.result.drumHits.length} 個可定位段落；請從待確認段落開始校對。`);
    } catch (analysisError) {
      setError(requestErrorMessage(analysisError, "自動採譜失敗"));
    } finally {
      setBusy(null);
    }
  }

  async function persistReviewResult(nextResult: AutoScoreResult, successMessage: string) {
    if (!selectedDraft) return;
    setBusy("saving");
    setError("");
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: nextResult,
          confidence: Math.max(selectedDraft.confidence, nextResult.confidence)
        })
      });
      const data = await readJsonResponse<{ draft: ScoreDraftDto; error?: string }>(response, "和弦修正保存失敗");
      if (!response.ok) throw new Error(data.error ?? "和弦修正保存失敗");
      setDrafts((current) => current.map((draft) => draft.id === data.draft.id ? data.draft : draft));
      notifyScoreTimelineChanged(project.id);
      setMessage(successMessage);
      return data.draft;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "和弦修正保存失敗");
    } finally {
      setBusy(null);
    }
  }

  function beatHasChordEdit(beat: AutoScoreReviewBeat) {
    const editedName = chordEdits[scoreBeatKey(beat)];
    return editedName !== undefined && editedName.trim() !== beat.name;
  }

  function isBeatEffectivelyConfirmed(beat: AutoScoreReviewBeat) {
    if (!selectedDraft) return false;
    const key = scoreBeatKey(beat);
    return confirmationEdits[key] ?? (
      beatHasChordEdit(beat) || isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, beat)
    );
  }

  function stageBeatGroupConfirmation(beats: AutoScoreReviewBeat[], confirmed: boolean) {
    if (!selectedDraft || isScoreLocked || !beats.length) return;
    setConfirmationEdits((current) => {
      const next = { ...current };
      for (const beat of beats) {
        const key = scoreBeatKey(beat);
        const defaultAfterChord = beatHasChordEdit(beat) || isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, beat);
        if (confirmed === defaultAfterChord) delete next[key];
        else next[key] = confirmed;
      }
      return next;
    });
    setError("");
  }

  async function saveAllReviewProgress(confirmWholeSong = false) {
    if (!selectedDraft || isScoreLocked || (!pendingReviewChangeCount && !confirmWholeSong)) return;
    let nextResult = selectedDraft.result;
    const invalidBeats: string[] = [];
    for (const edit of pendingChordEdits) {
      const updated = updateAutoScoreReviewBeatChord(nextResult, edit.beat, edit.name);
      if (updated === nextResult) {
        invalidBeats.push(`第 ${edit.beat.measure} 小節第 ${edit.beat.beat} 拍「${edit.name || "空白"}」`);
        continue;
      }
      nextResult = updated;
    }
    if (invalidBeats.length) {
      setError(`以下和弦格式無法辨識：${invalidBeats.slice(0, 4).join("、")}${invalidBeats.length > 4 ? `，另有 ${invalidBeats.length - 4} 拍` : ""}。請使用 N.C.、C、Am、G7、Fmaj7、F/C、Dm9 等格式。`);
      return;
    }

    const chordEditKeys = new Set(pendingChordEdits.map((edit) => scoreBeatKey(edit.beat)));
    for (const beat of autoScoreReviewableMeasures(nextResult).flatMap((measure) => measure.beats)) {
      const key = scoreBeatKey(beat);
      const originalBeat = allReviewBeats.find((candidate) => scoreBeatKey(candidate) === key) ?? beat;
      const defaultAfterChord = chordEditKeys.has(key) || isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, originalBeat);
      const desired = confirmWholeSong ? true : confirmationEdits[key] ?? defaultAfterChord;
      nextResult = setAutoScoreBeatConfirmation(nextResult, beat, desired);
    }

    const progress = autoScoreReviewableMeasures(nextResult).flatMap((measure) => measure.beats);
    const confirmedCount = progress.filter((beat) => isAutoScoreBeatExplicitlyConfirmed(nextResult, beat)).length;
    const saved = await persistReviewResult(
      nextResult,
      confirmWholeSong
        ? `已確認整首並一次儲存 ${confirmedCount}/${progress.length} 拍。`
        : `已一次儲存 ${pendingReviewChangeCount} 拍進度，其中修改和弦 ${pendingChordEditCount} 拍、人工確認 ${confirmedCount}/${progress.length} 拍。`
    );
    if (saved) {
      setChordEdits({});
      setConfirmationEdits({});
    }
  }

  function discardAllReviewChanges() {
    if (!pendingReviewChangeCount) return;
    setChordEdits({});
    setConfirmationEdits({});
    setError("");
    setMessage("已放棄這次尚未儲存的和弦與確認變更。");
  }

  function discardBeatChanges(beat: AutoScoreReviewBeat) {
    const key = scoreBeatKey(beat);
    setChordEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setConfirmationEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function moveToNextBeatEditor(beat: AutoScoreReviewBeat) {
    const currentIndex = allReviewBeats.findIndex((candidate) => scoreBeatKey(candidate) === scoreBeatKey(beat));
    const nextBeat = allReviewBeats[currentIndex + 1];
    if (!nextBeat) return;
    focusReviewBeat(nextBeat);
    window.requestAnimationFrame(() => beatInputRefs.current.get(scoreBeatKey(nextBeat))?.select());
  }

  function selectDraft(draftId: string) {
    if (draftId === selectedDraft?.id) return;
    const pendingCount = pendingReviewChangeCount + pendingStrummingCellCount;
    if (pendingCount && !window.confirm(`目前有 ${pendingCount} 項和弦或刷法變更尚未儲存。放棄修改並切換草譜？`)) return;
    setChordEdits({});
    setConfirmationEdits({});
    setStrummingEdits({});
    setSelectedStrummingCell(null);
    setSelectedDraftId(draftId);
  }

  function selectTarget(nextTarget: AutoScoreTarget) {
    if (nextTarget === target) return;
    const pendingCount = pendingReviewChangeCount + pendingStrummingCellCount;
    if (pendingCount && !window.confirm(`目前有 ${pendingCount} 項和弦或刷法變更尚未儲存。放棄修改並切換採譜類型？`)) return;
    setChordEdits({});
    setConfirmationEdits({});
    setStrummingEdits({});
    setSelectedStrummingCell(null);
    setTarget(nextTarget);
  }

  async function applyLicensedReference() {
    if (!selectedDraft || selectedDraft.targetInstrument === "drums" || isScoreLocked) return;
    setError("");
    setMessage("");
    try {
      const nextResult = applyAutoScoreReferenceChart(selectedDraft.result, referenceChart, {
        sourceType: referenceSourceType,
        sourceTitle: referenceTitle,
        publisher: referencePublisher,
        productId: referenceProductId,
        startMeasure: referenceStartMeasure
      });
      setBusy("reference");
      const verification = nextResult.referenceVerification;
      await persistReviewResult(
        nextResult,
        `授權譜已覆蓋 ${verification?.coveredBeatCount ?? 0} 拍，修正 ${verification?.changedBeatCount ?? 0} 拍；請重新執行系統驗證。`
      );
    } catch (referenceError) {
      setError(referenceError instanceof Error ? referenceError.message : "授權譜校對失敗");
      setBusy(null);
    }
  }

  async function saveIndependentReview() {
    if (!selectedDraft || !isFinalized || selectedDraft.result.independentReview) return;
    setBusy("independent-review");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/independent-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer: independentReviewer,
          role: independentReviewerRole,
          attestedComplete: independentReviewAttested,
          ...(independentReviewNotes.trim() ? { notes: independentReviewNotes.trim() } : {})
        })
      });
      const data = await readJsonResponse<{
        draft: ScoreDraftDto;
        release: { id: string; revision: number };
        noOp: boolean;
        error?: string;
      }>(response, "無法保存獨立複核");
      if (!response.ok) throw new Error(data.error ?? "無法保存獨立複核");
      setDrafts((current) => current.map((draft) => draft.id === data.draft.id ? data.draft : draft));
      setIndependentReviewAttested(false);
      notifyScoreTimelineChanged(project.id);
      setMessage(data.noOp
        ? `這份正式譜已完成獨立複核，維持 v${data.release.revision}。`
        : `已建立不改動譜面的證據修訂版 v${data.release.revision}；獨立複核 ${data.draft.result.independentReview?.confirmedBeatCount ?? 0}/${data.draft.result.independentReview?.totalBeatCount ?? 0} 拍。`);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "無法保存獨立複核");
    } finally {
      setBusy(null);
    }
  }

  function focusReviewBeat(beat: AutoScoreReviewBeat) {
    setFocusedBeatKey(scoreBeatKey(beat));
    reviewAudioRef.current && (reviewAudioRef.current.currentTime = Math.max(0, beat.startSeconds));
    window.requestAnimationFrame(() => measureRefs.current.get(beat.measure)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }));
  }

  function moveReviewMeasure(direction: -1 | 1) {
    if (!chordMeasures.length) return;
    const currentIndex = focusedMeasure ? chordMeasures.findIndex((measure) => measure.number === focusedMeasure.number) : -1;
    const fallbackIndex = direction > 0 ? 0 : chordMeasures.length - 1;
    const nextIndex = currentIndex < 0 ? fallbackIndex : (currentIndex + direction + chordMeasures.length) % chordMeasures.length;
    focusReviewBeat(chordMeasures[nextIndex].beats[0]);
  }

  function stopStrummingPreview() {
    for (const source of strumPreviewSourcesRef.current) {
      try { source.stop(); } catch { /* Source may already be stopped. */ }
      source.disconnect();
    }
    strumPreviewSourcesRef.current = [];
    if (strumPreviewTimerRef.current !== null) {
      window.clearTimeout(strumPreviewTimerRef.current);
      strumPreviewTimerRef.current = null;
    }
    setPreviewPatternId("");
  }

  function changeStrummingSubdivision(next: AutoScoreStrummingSubdivision) {
    stopStrummingPreview();
    setStrummingSubdivision(next);
    setSelectedStrummingCell(null);
    window.localStorage.setItem("songzu:strumming-subdivision", next);
  }

  function selectStrummingCell(patternId: string, index: number) {
    setSelectedStrummingCell({ patternId, subdivision: strummingSubdivision, index });
  }

  function stageStrummingCell(pattern: AutoScoreStrummingPattern, index: number, patch: { stroke?: AutoScoreStrumStroke; toggleAccent?: boolean }) {
    const key = strummingEditKey(pattern.id, strummingSubdivision);
    const stored = buildAutoScoreStrummingVariant(pattern, strummingSubdivision);
    setStrummingEdits((current) => {
      const currentEdit = current[key] ?? {
        patternId: pattern.id,
        subdivision: strummingSubdivision,
        strokes: [...stored.strokes],
        accents: [...stored.accents]
      };
      const strokes = [...currentEdit.strokes];
      let accents = [...currentEdit.accents];
      if (patch.stroke) strokes[index] = patch.stroke;
      if (patch.toggleAccent) {
        accents = accents.includes(index) ? accents.filter((candidate) => candidate !== index) : [...accents, index].sort((left, right) => left - right);
      }
      const unchanged = strokes.every((stroke, strokeIndex) => stroke === stored.strokes[strokeIndex]) &&
        accents.length === stored.accents.length && accents.every((accent, accentIndex) => accent === stored.accents[accentIndex]);
      const next = { ...current };
      if (unchanged) delete next[key];
      else next[key] = { ...currentEdit, strokes, accents };
      return next;
    });
    setSelectedStrummingCell({ patternId: pattern.id, subdivision: strummingSubdivision, index });
    setError("");
  }

  function discardStrummingEdits() {
    setStrummingEdits({});
    setSelectedStrummingCell(null);
    setError("");
    setMessage("已放棄尚未儲存的刷法修改。");
  }

  async function saveAllStrummingEdits() {
    if (!selectedDraft || !pendingStrummingEdits.length) return;
    setBusy("strumming");
    setError("");
    setMessage("");
    try {
      let savedDraft: ScoreDraftDto | null = null;
      for (const subdivision of AUTO_SCORE_STRUMMING_SUBDIVISIONS.map((option) => option.id)) {
        const patterns = pendingStrummingEdits.filter((edit) => edit.subdivision === subdivision);
        if (!patterns.length) continue;
        const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/strumming`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdivision, patterns, updatedBy: "本機創作者" })
        });
        const data = await readJsonResponse<{ draft: ScoreDraftDto; error?: string }>(response, "刷法儲存失敗");
        if (!response.ok) throw new Error(data.error ?? "刷法儲存失敗");
        savedDraft = data.draft;
      }
      if (savedDraft) {
        setDrafts((current) => current.map((draft) => draft.id === savedDraft!.id ? savedDraft! : draft));
        notifyScoreTimelineChanged(project.id);
      }
      setStrummingEdits({});
      setSelectedStrummingCell(null);
      setMessage(`已一次儲存 ${pendingStrummingCellCount} 個刷法變更；正式和弦譜與原音檔都沒有改動。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "刷法儲存失敗");
    } finally {
      setBusy(null);
    }
  }

  async function analyzeStrummingFromAudio() {
    if (!selectedDraft) return;
    if (pendingStrummingEdits.length && !window.confirm(`目前有 ${pendingStrummingCellCount} 個刷法變更尚未儲存。放棄修改並重新分析音檔？`)) return;
    setBusy("strumming-analysis");
    setError("");
    setMessage("");
    stopStrummingPreview();
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/strumming`, { method: "POST" });
      const data = await readJsonResponse<{ draft: ScoreDraftDto; analysis?: AutoScoreStrummingAnalysis; error?: string }>(response, "音檔刷法分析失敗");
      if (!response.ok) throw new Error(data.error ?? "音檔刷法分析失敗");
      setDrafts((current) => current.map((draft) => draft.id === data.draft.id ? data.draft : draft));
      setStrummingEdits({});
      setSelectedStrummingCell(null);
      const detectedSubdivision = data.analysis?.detectedSubdivision;
      if (detectedSubdivision) changeStrummingSubdivision(detectedSubdivision);
      notifyScoreTimelineChanged(project.id);
      setMessage(`已從受保護原音檔分析 ${data.analysis?.onsetCount ?? 0} 個起音與 ${data.analysis?.analyzedBarCount ?? 0} 小節，刷法符合度 ${Math.round(data.analysis?.confidence ?? 0)}%。`);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "音檔刷法分析失敗");
    } finally {
      setBusy(null);
    }
  }

  async function previewStrummingPattern(pattern: AutoScoreStrummingPattern) {
    const previewId = `${pattern.id}:${strummingSubdivision}`;
    if (previewPatternId === previewId) {
      stopStrummingPreview();
      return;
    }
    stopStrummingPreview();
    const context = strumAudioContextRef.current ?? new AudioContext();
    strumAudioContextRef.current = context;
    await context.resume();
    const variant = withPendingStrummingEdit(
      buildAutoScoreStrummingVariant(pattern, strummingSubdivision),
      strummingEdits[strummingEditKey(pattern.id, strummingSubdivision)]
    );
    const quarterSeconds = 60 / Math.max(40, strummingGuide?.bpm ?? selectedDraft?.result.bpm ?? 75);
    const slotSeconds = quarterSeconds * variant.slotDurationBeats;
    const startAt = context.currentTime + 0.04;
    const bars = 2;
    const sources: AudioBufferSourceNode[] = [];
    for (let bar = 0; bar < bars; bar += 1) {
      variant.strokes.forEach((stroke, index) => {
        if (stroke === "rest") return;
        const length = stroke === "mute" ? 0.028 : 0.055;
        const frameCount = Math.max(1, Math.floor(context.sampleRate * length));
        const buffer = context.createBuffer(1, frameCount, context.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const envelope = (1 - frame / frameCount) ** (stroke === "mute" ? 5 : 2.7);
          channel[frame] = (Math.random() * 2 - 1) * envelope;
        }
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        filter.type = "bandpass";
        filter.frequency.value = stroke === "down" ? 1_350 : stroke === "up" ? 2_450 : 780;
        filter.Q.value = stroke === "mute" ? 1.8 : 0.9;
        const accented = variant.accents.includes(index);
        gain.gain.value = stroke === "mute" ? 0.08 : accented ? 0.2 : stroke === "down" ? 0.13 : 0.1;
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(context.destination);
        source.start(startAt + (bar * variant.strokes.length + index) * slotSeconds);
        sources.push(source);
      });
    }
    strumPreviewSourcesRef.current = sources;
    setPreviewPatternId(previewId);
    strumPreviewTimerRef.current = window.setTimeout(
      () => stopStrummingPreview(),
      Math.ceil((bars * variant.strokes.length * slotSeconds + 0.2) * 1_000)
    );
  }

  function changeReviewAudioSource(audioFileId: string) {
    reviewAudioRef.current?.pause();
    setReviewAudioFileId(audioFileId);
    setPlaybackRange(null);
    setIsReviewPlaying(false);
  }

  async function toggleMeasurePlayback(measure: ChordMeasure) {
    if (measure.notationOnly) {
      setError("這是譜面編排小節，沒有重複綁定來源音訊；相鄰來源小節仍可正常試聽。");
      return;
    }
    const audio = reviewAudioRef.current;
    if (!audio) {
      setError("這份草譜找不到可試聽的來源音檔。");
      return;
    }
    if (isReviewPlaying && playbackRange?.measure === measure.number) {
      audio.pause();
      setIsReviewPlaying(false);
      return;
    }
    setError("");
    setPlaybackRange({ startSeconds: measure.startSeconds, endSeconds: measure.endSeconds, measure: measure.number });
    audio.currentTime = Math.max(0, measure.startSeconds);
    try {
      await audio.play();
      setIsReviewPlaying(true);
    } catch {
      setError("瀏覽器暫時阻擋播放，請先點一下播放器再試一次。");
    }
  }

  function handleReviewTimeUpdate() {
    const audio = reviewAudioRef.current;
    if (!audio || !playbackRange || audio.currentTime < playbackRange.endSeconds - 0.035) return;
    if (loopMeasure) {
      audio.currentTime = playbackRange.startSeconds;
      void audio.play();
    } else {
      audio.pause();
      setIsReviewPlaying(false);
    }
  }

  async function finalizeReview() {
    if (!selectedDraft || isScoreLocked) return;
    setBusy("finalizing");
    setError("");
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/finalize`, { method: "POST" });
      const data = await readJsonResponse<{ draft: ScoreDraftDto; error?: string }>(response, "正式鎖譜失敗");
      if (!response.ok) throw new Error(data.error ?? "正式鎖譜失敗");
      setDrafts((current) => current.map((draft) => draft.id === data.draft.id ? data.draft : draft));
      const verification = data.draft.result.verification?.chordVerification;
      const manualReview = data.draft.result.review?.verificationMethod === "manual";
      setMessage(manualReview
        ? `第一次人工確認完成：${data.draft.result.review?.confirmedBeatCount ?? 0}/${data.draft.result.review?.totalBeatCount ?? 0} 拍已保存為正式吉他和弦譜 v${data.draft.result.review?.revision ?? 1}。`
        : `正式吉他和弦譜 v${data.draft.result.review?.revision ?? 1} 已鎖定：${verification?.verifiedChordCount ?? 0} 個和弦事件、${verification?.verifiedBeatCount ?? 0} 拍、${verification?.conflictCount ?? 0} 個衝突。`);
      notifyScoreTimelineChanged(project.id);
    } catch (finalizeError) {
      setError(finalizeError instanceof Error ? finalizeError.message : "正式鎖譜失敗");
    } finally {
      setBusy(null);
    }
  }

  async function unlockReview() {
    if (!selectedDraft || !isScoreLocked) return;
    setBusy("unlocking");
    setError("");
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/unlock`, { method: "POST" });
      const data = await readJsonResponse<{ draft: ScoreDraftDto; error?: string }>(response, "無法建立修訂版");
      if (!response.ok) throw new Error(data.error ?? "無法建立修訂版");
      setDrafts((current) => current.map((draft) => draft.id === data.draft.id ? data.draft : draft));
      setMessage(`已建立修訂版 v${data.draft.result.review?.revision ?? 1}，修改後需要重新鎖定。`);
      notifyScoreTimelineChanged(project.id);
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "無法建立修訂版");
    } finally {
      setBusy(null);
    }
  }

  async function applyToDaw() {
    if (!selectedDraft) return;
    setBusy("applying");
    setError("");
    try {
      const response = await fetch(`/api/daw-score-drafts/${selectedDraft.id}/apply`, { method: "POST" });
      const data = await readJsonResponse<{ project?: DawProjectDto; markerCount: number; error?: string }>(response, "無法加入 DAW");
      if (!response.ok) throw new Error(data.error ?? "無法加入 DAW");
      if (data.project) onProjectChange(data.project);
      setDrafts((current) => current.map((draft) => draft.id === selectedDraft.id ? { ...draft, status: "APPLIED" } : draft));
      setMessage(`已加入 DAW，建立 ${data.markerCount} 個可定位標記。`);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "無法加入 DAW");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="daw-auto-score">
      <header className="daw-score-head">
        <div>
          <span className="eyebrow">本機自動採譜</span>
          <h3>音檔轉成可校對的和聲草稿</h3>
          <p>分析全部留在裝置內；原始音檔不轉檔、不覆蓋。</p>
        </div>
        <span className="daw-score-engine"><Sparkles size={14} /> {selectedDraft?.analyzer === "songzu_harmony_v12" ? "正式譜結構和聲 v12" : selectedDraft?.analyzer === "songzu_harmony_v11" ? "延伸音與邊界和聲 v11" : selectedDraft?.analyzer === "songzu_harmony_v10" ? "高精細跨家族和聲 v10" : selectedDraft?.analyzer === "songzu_harmony_v9" ? "十三層 Bass 根音和聲 v9" : selectedDraft?.analyzer === "songzu_harmony_v8" ? "十二層轉位和聲 v8" : selectedDraft?.analyzer === "songzu_harmony_v7" ? "十一層深度和聲 v7" : selectedDraft?.analyzer === "songzu_harmony_v6" ? "十層深度和聲 v6" : selectedDraft?.analyzer === "songzu_harmony_v5" ? "十層融合和聲 v5" : selectedDraft?.analyzer === "songzu_harmony_v4" ? "多尺度三重和聲 v4" : selectedDraft?.analyzer === "songzu_harmony_v3" ? "逐拍雙引擎和聲 v3" : selectedDraft?.result.analysisMode === "consensus" ? "雙引擎和聲 v2" : selectedDraft?.analyzer === "songzu_harmony_v2" ? "CQT 和聲 v2" : "快速 DSP 參考"} · 本機運算</span>
      </header>

      {selectedDraft?.result.harmonyAnalysis ? (
        <details className="daw-harmony-audit">
          <summary>
            <span><ShieldCheck size={15} /> 和聲證據鏈</span>
            <strong>{selectedDraft.result.harmonyAnalysis.methods.filter((item) => item.participated).length}/{selectedDraft.result.harmonyAnalysis.methods.length} 已參與</strong>
          </summary>
          {selectedDraft.result.harmonyAnalysis.qualityGate ? (
            <div className={`daw-harmony-quality ${selectedDraft.result.harmonyAnalysis.qualityGate.status}`}>
              <header>
                <strong>{selectedDraft.result.harmonyAnalysis.qualityGate.status === "pass" ? "品質閘門通過" : selectedDraft.result.harmonyAnalysis.qualityGate.status === "degraded" ? "主管線已降級" : "部分拍點需複核"}</strong>
                <span>證據強度，不代表人工正確率</span>
              </header>
              <div>
                <span><small>根音證據</small><b>{Math.round(selectedDraft.result.harmonyAnalysis.qualityGate.rootConfidence * 100)}%</b></span>
                <span><small>性質證據</small><b>{Math.round(selectedDraft.result.harmonyAnalysis.qualityGate.qualityConfidence * 100)}%</b></span>
                <span><small>高可信拍</small><b>{selectedDraft.result.harmonyAnalysis.qualityGate.highConfidenceBeatCount}/{selectedDraft.result.harmonyAnalysis.qualityGate.beatCount}</b></span>
                <span><small>衝突拍</small><b>{selectedDraft.result.harmonyAnalysis.qualityGate.conflictBeatCount}</b></span>
                <span><small>平均獨立家族</small><b>{selectedDraft.result.harmonyAnalysis.qualityGate.independentFamilyAverage.toFixed(1)}</b></span>
              </div>
              <p>{selectedDraft.result.harmonyAnalysis.qualityGate.reasons.join(" · ")}</p>
              {selectedDraft.result.harmonyAnalysis.sourceQuality ? (
                <p className="daw-harmony-source-quality">
                  <b>來源預檢</b>
                  {selectedDraft.result.harmonyAnalysis.sourceQuality.analysisSuitability === "good" ? "適合分析" : selectedDraft.result.harmonyAnalysis.sourceQuality.analysisSuitability === "limited" ? "細節受限" : "規格未確認"}
                  {selectedDraft.result.harmonyAnalysis.sourceQuality.codecName ? ` · ${selectedDraft.result.harmonyAnalysis.sourceQuality.codecName}` : ""}
                  {selectedDraft.result.harmonyAnalysis.sourceQuality.sampleRate ? ` · ${(selectedDraft.result.harmonyAnalysis.sourceQuality.sampleRate / 1000).toFixed(1)} kHz` : ""}
                  {selectedDraft.result.harmonyAnalysis.sourceQuality.bitDepth ? ` · ${selectedDraft.result.harmonyAnalysis.sourceQuality.bitDepth}-bit` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="daw-harmony-methods">
            {selectedDraft.result.harmonyAnalysis.methods.map((item, index) => (
              <div className={item.participated ? "active" : item.available ? "standby" : "missing"} key={item.id}>
                <span>{index + 1}</span>
                <p><strong>{item.label}</strong><small>{item.note}</small></p>
                <em>{item.participated ? "已參與" : item.available ? "待命" : "未就緒"}</em>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="daw-score-source">
        <label className="field">
          <span>來源音檔</span>
          <select className="input" value={sourceAudioFileId} onChange={(event) => setSourceAudioFileId(event.target.value)} disabled={Boolean(busy)}>
            {!localAudioFiles.length ? <option value="">尚未上傳音檔</option> : null}
            {localAudioFiles.map((file) => (
              <option key={file.id} value={file.id}>
                {file.versionName ?? file.fileName} · {formatDuration(file.durationSeconds)}{sourceSuitability(file, target) === "recommended" ? " · 建議" : sourceSuitability(file, target) === "incompatible" ? ` · 不適合${targetLabel(target)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={uploadRef}
          hidden
          type="file"
          accept="audio/*,.wav,.aiff,.aif,.mp3,.m4a,.flac"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadReference(file);
          }}
        />
        <button className="daw-score-upload" type="button" onClick={() => uploadRef.current?.click()} disabled={Boolean(busy)}>
          {busy === "uploading" ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
          上傳歌曲
        </button>
      </div>

      <div className="daw-score-targets" role="group" aria-label="選擇採譜類型">
        {TARGETS.map((item) => {
          const Icon = item.icon;
          return (
            <button className={target === item.id ? "active" : ""} key={item.id} type="button" onClick={() => selectTarget(item.id)} disabled={Boolean(busy)}>
              <Icon size={20} />
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          );
        })}
      </div>

      <button
        className={busy === "analyzing" ? "button daw-score-run" : "button primary daw-score-run"}
        type="button"
        onClick={() => void runTranscription()}
        disabled={Boolean(busy) || !sourceAudioFileId}
      >
        {busy === "analyzing" || busy === "saving" ? <LoaderCircle className="spin" size={17} /> : <FileMusic size={17} />}
        {busy === "analyzing" ? progressLabel || "本機全曲分析中" : busy === "saving" ? "保存草譜" : `產生${targetLabel(target)}`}
      </button>

      {busy === "analyzing" || busy === "saving" ? (
        <div className="daw-score-progress" aria-label={`採譜進度 ${Math.round(progress * 100)}%`}>
          <i style={{ width: `${Math.max(3, progress * 100)}%` }} />
          <span>{Math.round(progress * 100)}%</span>
        </div>
      ) : null}
      {message ? <p className="daw-score-message"><Check size={14} />{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {drafts.length ? (
        <div className="daw-score-drafts">
          <label>
            <span>已保存草譜</span>
            <select className="input" value={selectedDraft?.id ?? ""} onChange={(event) => selectDraft(event.target.value)}>
              {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title}</option>)}
            </select>
          </label>
          {selectedDraft ? (
            selectedDraft.targetInstrument === "guitar" && scoreStats
              ? <span className={`daw-score-confidence confidence-${isFinalized ? "high" : "medium"}`}>{isFinalized ? `正式譜 v${selectedDraft.result.review?.revision ?? 1} · ${finalizedVerificationLabel}` : isLegacySystemFinalized ? "舊版系統鎖定 · 必須人工複核" : systemVerified ? `${chordVerification?.checks.filter((check) => check.passed).length ?? 0}/${chordVerification?.checks.length ?? 0} 項通過 · 可進入人工校對` : `${chordVerification?.conflictCount ?? 0} 項待修正`}</span>
              : <span className={`daw-score-confidence confidence-${selectedDraft.confidence >= 68 ? "high" : selectedDraft.confidence >= 48 ? "medium" : "low"}`}>{Math.round(selectedDraft.confidence)}% · {confidenceLabel(selectedDraft.confidence)}</span>
          ) : null}
        </div>
      ) : null}

      {selectedDraft && scoreStats ? (
        <section className="daw-score-sheet" aria-label={selectedDraft.title}>
          <div className="daw-score-sheet-head">
            <div>
              <span>{targetLabel(selectedDraft.targetInstrument)} · {selectedDraft.targetInstrument === "guitar" && isFinalized ? `正式鎖定 v${selectedDraft.result.review?.revision ?? 1}` : selectedDraft.status === "APPLIED" ? "已加入 DAW" : selectedDraft.targetInstrument === "guitar" ? "多證據驗證" : "待校對"}</span>
              <h3>{selectedDraft.title}</h3>
              <p>{selectedDraft.result.bpm} BPM · {selectedDraft.result.musicalKey} · {selectedDraft.result.timeSignature}</p>
            </div>
            <div className="daw-score-counts">
              <span><strong>{selectedDraft.targetInstrument === "guitar" ? chordMeasures.length : scoreStats.bars}</strong>小節</span>
              <span><strong>{selectedDraft.targetInstrument === "guitar" ? guitarBeatStats.total : selectedDraft.targetInstrument === "drums" ? scoreStats.hits : scoreStats.chords}</strong>{selectedDraft.targetInstrument === "guitar" ? "逐拍格" : selectedDraft.targetInstrument === "drums" ? "鼓點" : "和弦段"}</span>
              <span><strong>{selectedDraft.targetInstrument === "drums" ? scoreStats.notes : selectedDraft.targetInstrument === "guitar" ? chordVerification?.verifiedChordCount ?? 0 : scoreStats.likely}</strong>{selectedDraft.targetInstrument === "drums" ? "音符" : selectedDraft.targetInstrument === "guitar" ? "和弦已驗證" : "較穩定"}</span>
            </div>
          </div>

          {selectedDraft.result.verification?.officialMetadata ? (
            <div className="daw-score-identity" aria-label="歌曲與採譜基準">
              <div>
                <span>歌曲</span>
                <strong>{selectedDraft.result.verification.officialMetadata.title}</strong>
              </div>
              <div>
                <span>歌手</span>
                <strong>{selectedDraft.result.verification.officialMetadata.artist}</strong>
              </div>
              <div>
                <span>調性</span>
                <strong>{selectedDraft.result.verification.officialMetadata.key}</strong>
              </div>
              <div>
                <span>錄音拍速</span>
                <strong>{selectedDraft.result.verification.recordingGrid?.bpm ?? selectedDraft.result.bpm} BPM</strong>
              </div>
              <div>
                <span>拍號</span>
                <strong>{selectedDraft.result.verification.recordingGrid?.meter ?? selectedDraft.result.timeSignature}</strong>
              </div>
              <div>
                <span>狀態</span>
                <strong>{deliveryCertification?.label ?? (systemVerified ? "系統檢查完成" : "等待處理衝突")}</strong>
              </div>
            </div>
          ) : null}

          {selectedDraft.targetInstrument === "guitar" && reviewSections.length ? (
            <div className="daw-score-structure" aria-label="歌曲段落與小節範圍">
              <header><strong>段落確認</strong><span>先聽段落，再一次確認其中全部拍子</span></header>
              <div>
                {reviewSections.map((section) => {
                  const sectionBeats = chordMeasures
                    .filter((measure) => measure.number >= section.firstMeasure && measure.number <= section.lastMeasure)
                    .flatMap((measure) => measure.beats);
                  const confirmed = sectionBeats.length > 0 && sectionBeats.every(isBeatEffectivelyConfirmed);
                  return (
                    <article className={confirmed ? "confirmed" : ""} key={`${section.label}-${section.firstMeasure}`}>
                      <button
                        className="daw-score-section-jump"
                        type="button"
                        onClick={() => {
                          const measure = chordMeasures.find((item) => item.number === section.firstMeasure);
                          if (measure) focusReviewBeat(measure.beats[0]);
                        }}
                      >
                        <strong>{section.label}</strong>
                        <span>{section.firstMeasure === section.lastMeasure ? `第 ${section.firstMeasure} 小節` : `${section.firstMeasure}-${section.lastMeasure} 小節`}</span>
                      </button>
                      <button
                        className="daw-score-section-confirm"
                        type="button"
                        onClick={() => stageBeatGroupConfirmation(sectionBeats, !confirmed)}
                        disabled={Boolean(busy) || isScoreLocked}
                      >
                        <CheckCircle2 size={12} />{confirmed ? "已確認段落" : `確認段落（${sectionBeats.length} 拍）`}
                      </button>
                    </article>
                  );
                })}
              </div>
              {selectedDraft.result.rhythmChanges?.length ? (
                <ul>
                  {selectedDraft.result.rhythmChanges.map((change) => (
                    <li key={`${change.firstMeasure}-${change.lastMeasure}-${change.label}`}>
                      <strong>{change.firstMeasure === change.lastMeasure ? `第 ${change.firstMeasure} 小節` : `${change.firstMeasure}-${change.lastMeasure} 小節`}</strong>
                      <span>{change.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {selectedDraft.targetInstrument === "guitar" && selectedDraft.result.verification?.officialMetadata && completeGuitarSections.length ? (
            <section className="daw-complete-guitar-score" aria-label="完整吉他譜">
              <header>
                <div>
                  <span>完整吉他譜</span>
                  <h4>{selectedDraft.result.verification.officialMetadata.title}</h4>
                  <p>{selectedDraft.result.verification.officialMetadata.artist}</p>
                </div>
                <dl>
                  <div><dt>調性</dt><dd>{selectedDraft.result.verification.officialMetadata.key}</dd></div>
                  <div><dt>速度</dt><dd>{selectedDraft.result.verification.recordingGrid?.bpm ?? selectedDraft.result.bpm} BPM</dd></div>
                  <div><dt>拍號</dt><dd>{selectedDraft.result.verification.recordingGrid?.meter ?? selectedDraft.result.timeSignature}</dd></div>
                  <div><dt>篇幅</dt><dd>{completeGuitarSections.reduce((total, section) => total + section.measures.length, 0)} 小節</dd></div>
                </dl>
                <div className="daw-complete-guitar-actions">
                  <a className="button ghost" href={`/api/daw-score-drafts/${selectedDraft.id}/export?format=pdf`} target="_blank" rel="noreferrer">
                    <FileMusic size={14} />開啟正式 PDF
                  </a>
                  <a className="button ghost" href={`/api/daw-score-drafts/${selectedDraft.id}/export?format=txt`} download>
                    <Download size={14} />TXT 備份
                  </a>
                </div>
              </header>
              <div className="daw-complete-guitar-sections">
                {completeGuitarSections.map((section) => (
                  <article key={`${section.label}-${section.firstMeasure}`}>
                    <header>
                      <strong>[{section.label}]</strong>
                      <span>{section.firstMeasure === section.lastMeasure ? `第 ${section.firstMeasure} 小節` : `${section.firstMeasure}-${section.lastMeasure} 小節`}</span>
                    </header>
                    <div className="daw-complete-guitar-lines">
                      {chunkItems(section.measures, 4).map((line) => (
                        <div className="daw-complete-guitar-line" key={`${section.label}-${line[0].number}`}>
                          {line.map((measure) => {
                            const tokens = autoScoreSheetTokens(measure.beats);
                            const notation = `| ${tokens.join(" ")} |`;
                            return (
                              <span
                                className="daw-complete-guitar-measure"
                                key={`${section.label}-${measure.number}`}
                                aria-label={`第 ${measure.number} 小節，${notation}`}
                              >
                                <small>{measure.number}</small>
                                <b>{notation}</b>
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {strummingGuide?.patterns.length ? (
                <footer>
                  <strong>本曲正式刷法</strong>
                  <div>
                    {strummingGuide.patterns.map((pattern) => {
                      const subdivision = strummingGuide.defaultSubdivision ?? pattern.subdivision;
                      const variant = buildAutoScoreStrummingVariant(pattern, subdivision);
                      const rhythmText = `${variant.groups.map((group) => `| ${group.cells.map((cell) => strumStrokeLabel(cell.stroke)).join(" ")} `).join("")}|`;
                      return (
                        <article key={pattern.id}>
                          <div><b>{pattern.label}</b><em>{variant.source === "manual" ? `${variant.updatedBy ?? "本機創作者"} 已修訂` : "音檔分析"}</em></div>
                          <code aria-label={`${pattern.label}正式刷法`}>{rhythmText}</code>
                        </article>
                      );
                    })}
                  </div>
                </footer>
              ) : null}
            </section>
          ) : null}

          {selectedDraft.targetInstrument === "guitar" ? (
            <div className="daw-chord-review">
              <details className="daw-score-reference" open={Boolean(selectedDraft.result.referenceVerification)}>
                <summary><ShieldCheck size={15} /><span><strong>參考譜交叉校對</strong><small>分清 本機創作者 編輯稿、授權譜與公開參考，不讓來源層級混在一起</small></span></summary>
                <div className="daw-score-reference-fields">
                  <label><span>來源類型</span><select value={referenceSourceType} onChange={(event) => {
                    const nextType = event.target.value as AutoScoreReferenceVerification["sourceType"];
                    setReferenceSourceType(nextType);
                    setReferencePublisher((current) => {
                      if (current.trim() && current !== "本機創作者" && current !== "Hal Leonard") return current;
                      return nextType === "editor_reference" ? "本機創作者" : "";
                    });
                  }} disabled={Boolean(busy) || isScoreLocked}><option value="editor_reference">本機創作者 編輯標準譜</option><option value="licensed_sheet_music">合法授權譜</option><option value="public_chord_reference">公開和弦參考</option></select></label>
                  <label><span>譜面名稱</span><input value={referenceTitle} onChange={(event) => setReferenceTitle(event.target.value)} placeholder="例如：It Will Rain – Guitar Chords/Lyrics" disabled={Boolean(busy) || isScoreLocked} /></label>
                  <label><span>{referenceSourceType === "editor_reference" ? "整理者" : "出版社／來源"}</span><input value={referencePublisher} onChange={(event) => setReferencePublisher(event.target.value)} placeholder={referenceSourceType === "editor_reference" ? "本機創作者" : "Hal Leonard"} disabled={Boolean(busy) || isScoreLocked} /></label>
                  <label><span>產品編號</span><input value={referenceProductId} onChange={(event) => setReferenceProductId(event.target.value)} placeholder="例如 HL 1000186080" disabled={Boolean(busy) || isScoreLocked} /></label>
                  <label><span>從第幾小節</span><input type="number" min="1" max={Math.max(1, chordMeasures.length)} value={referenceStartMeasure} onChange={(event) => setReferenceStartMeasure(Math.max(1, Number(event.target.value) || 1))} disabled={Boolean(busy) || isScoreLocked} /></label>
                </div>
                <label className="daw-score-reference-chart">
                  <span>每格一拍的參考和弦</span>
                  <textarea value={referenceChart} onChange={(event) => setReferenceChart(event.target.value)} placeholder={'| D _ Bm _ |\n| G _ A _ |'} disabled={Boolean(busy) || isScoreLocked} />
                </label>
                <div className="daw-score-reference-actions">
                  <p>「_」延續前一拍。匯入會保留來源層級並使舊驗證失效；本機創作者 編輯稿不會被冒充成出版社授權譜或獨立樂手複核。</p>
                  <button type="button" onClick={() => void applyLicensedReference()} disabled={Boolean(busy) || isScoreLocked || !referenceChart.trim()}>
                    {busy === "reference" ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                    比對並套用參考譜
                  </button>
                </div>
                {selectedDraft.result.referenceVerification ? (
                  <div className="daw-score-reference-result">
                    <strong>{selectedDraft.result.referenceVerification.status === "complete" ? "全曲參考已覆蓋" : "部分參考已覆蓋"}</strong>
                    <span>{selectedDraft.result.referenceVerification.publisher} · {selectedDraft.result.referenceVerification.sourceTitle}</span>
                    <span>{selectedDraft.result.referenceVerification.coveredBeatCount}/{selectedDraft.result.referenceVerification.totalBeatCount} 拍 · 原本相符 {selectedDraft.result.referenceVerification.matchedBeatCount} 拍 · 修正 {selectedDraft.result.referenceVerification.changedBeatCount} 拍</span>
                  </div>
                ) : null}
              </details>
              <div className="daw-chord-review-summary">
                <div>
                  <strong>{guitarBeatStats.total ? Math.round((guitarBeatStats.verified / guitarBeatStats.total) * 100) : 0}%</strong>
                  <span>{isFinalized ? "正式譜已人工鎖定" : "系統證據覆蓋度"}</span>
                </div>
                <p>系統會找出可能的衝突並縮小校對範圍，但不會自行宣稱 100%。正式譜仍須逐拍人工確認；演出與教學交付另需完整段落、獨立複核與已確認刷法。</p>
                <i aria-hidden="true"><b style={{ width: `${guitarBeatStats.total ? (guitarBeatStats.verified / guitarBeatStats.total) * 100 : 0}%` }} /></i>
              </div>
              {deliveryCertification ? (
                <div className="daw-score-certification" aria-label="吉他譜交付認證">
                  <header>
                    <div><span>交付標準</span><strong>{deliveryCertification.label}</strong></div>
                    <small>{deliveryCertification.unresolvedCount ? `還有 ${deliveryCertification.unresolvedCount} 項未完成` : "正式、演出與教學條件全部通過"}</small>
                  </header>
                  <ul className="daw-score-verification-list">
                    {deliveryCertification.checks.map((check) => (
                      <li className={check.passed ? "passed" : "failed"} key={check.id}>
                        <CheckCircle2 size={13} />
                        <span><strong>{check.label} · {check.requiredFor === "formal" ? "正式譜" : check.requiredFor === "performance" ? "演出譜" : "教學譜"}</strong><small>{check.detail}</small></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {isFinalized && !selectedDraft.result.independentReview ? (
                <details className="daw-score-reference daw-score-independent-review" open>
                  <summary>
                    <ShieldCheck size={15} />
                    <span><strong>第二位樂手全曲複核</strong><small>建立獨立證據修訂版，不改動正式譜內容</small></span>
                  </summary>
                  <div className="daw-score-reference-fields">
                    <label>
                      <span>複核者</span>
                      <input value={independentReviewer} onChange={(event) => setIndependentReviewer(event.target.value)} placeholder="第二位樂手姓名" disabled={Boolean(busy)} />
                    </label>
                    <label>
                      <span>身分</span>
                      <select value={independentReviewerRole} onChange={(event) => setIndependentReviewerRole(event.target.value as AutoScoreIndependentReview["role"])} disabled={Boolean(busy)}>
                        <option value="musician">樂手</option>
                        <option value="teacher">音樂老師</option>
                        <option value="arranger">編曲者</option>
                      </select>
                    </label>
                  </div>
                  <label className="daw-score-reference-chart">
                    <span>複核備註</span>
                    <textarea value={independentReviewNotes} onChange={(event) => setIndependentReviewNotes(event.target.value)} placeholder="可記錄爭議拍點、使用的樂器或比對方式" disabled={Boolean(busy)} />
                  </label>
                  <div className="daw-score-reference-actions daw-score-independent-actions">
                    <label className="daw-score-independent-attestation">
                      <input type="checkbox" checked={independentReviewAttested} onChange={(event) => setIndependentReviewAttested(event.target.checked)} disabled={Boolean(busy)} />
                      <span>複核者已依原曲完整確認 {allReviewBeats.length}/{allReviewBeats.length} 拍</span>
                    </label>
                    <button type="button" onClick={() => void saveIndependentReview()} disabled={Boolean(busy) || independentReviewer.trim().length < 2 || !independentReviewAttested}>
                      {busy === "independent-review" ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                      保存獨立複核
                    </button>
                  </div>
                </details>
              ) : selectedDraft.result.independentReview ? (
                <div className="daw-score-independent-complete">
                  <ShieldCheck size={16} />
                  <span>
                    <strong>{selectedDraft.result.independentReview.reviewer} 已完成全曲獨立複核</strong>
                    <small>{selectedDraft.result.independentReview.confirmedBeatCount}/{selectedDraft.result.independentReview.totalBeatCount} 拍 · {selectedDraft.result.independentReview.role === "musician" ? "樂手" : selectedDraft.result.independentReview.role === "teacher" ? "音樂老師" : "編曲者"}</small>
                  </span>
                </div>
              ) : null}
              {selectedDraft.result.referenceSources?.length ? (
                <details className="daw-score-reference-sources">
                  <summary>交叉比對來源（{selectedDraft.result.referenceSources.length}）</summary>
                  <p>只登記來源身份、調性／拍速主張與差異；未授權的完整譜不會被複製進系統。</p>
                  <div>
                    {selectedDraft.result.referenceSources.map((source) => (
                      <article key={source.id}>
                        <span>{source.reliabilityTier === "anchor" ? "錨點" : source.reliabilityTier === "supporting" ? "輔助" : "候選"}</span>
                        <strong>{source.sourceTitle}</strong>
                        <small>{source.publisher} · {source.accessStatus === "licensed_private_copy" ? "合法私有副本" : source.accessStatus === "private_editor_copy" ? "私人編輯參考" : source.accessStatus === "analyzed_locally" ? "本機音訊分析" : source.accessStatus === "public_reference_checked" ? "公開來源已檢視" : "僅產品資料，尚未取得完整譜"}</small>
                        {source.url ? <a href={source.url} target="_blank" rel="noreferrer">查看來源</a> : null}
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
              {chordVerification ? (
                <ul className="daw-score-verification-list" aria-label="和弦系統驗證明細">
                  {chordVerification.checks.map((check) => (
                    <li className={check.passed ? "passed" : "failed"} key={check.id}>
                      <CheckCircle2 size={13} />
                      <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="daw-score-review-player">
                <div className="daw-score-review-source">
                  <div>
                    <span>逐小節聽音校對</span>
                    <strong>{focusedMeasure ? focusedMeasure.notationOnly
                      ? `第 ${focusedMeasure.number} 小節 · 譜面編排拍`
                      : `第 ${focusedMeasure.number} 小節 · ${formatDuration(focusedMeasure.startSeconds)}–${formatDuration(focusedMeasure.endSeconds)}`
                      : "尚無可校對小節"}</strong>
                  </div>
                  <label>
                    <span>試聽音源</span>
                    <select value={reviewAudioFile?.id ?? ""} onChange={(event) => changeReviewAudioSource(event.target.value)}>
                      {localAudioFiles.map((file) => (
                        <option key={file.id} value={file.id}>
                          {reviewSourceLabel(file, recommendedReviewSource?.id ?? null)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {reviewAudioFile ? (
                  <>
                  <CyberAudioPlayer
                    key={reviewAudioFile.id}
                    ref={reviewAudioRef}
                    controls
                    preload="metadata"
                    src={`/api/files/${reviewAudioFile.id}`}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate = 1;
                      event.currentTarget.defaultPlaybackRate = 1;
                      event.currentTarget.preservesPitch = true;
                    }}
                    onTimeUpdate={handleReviewTimeUpdate}
                    onPause={() => setIsReviewPlaying(false)}
                    onPlay={() => setIsReviewPlaying(true)}
                  />
                  <p className={`daw-score-monitor-note${isSeparatedStem(reviewAudioFile) ? " stem" : " direct"}`}>
                    {isSeparatedStem(reviewAudioFile)
                      ? "分析 Stem：方便辨認樂器，但分離演算法可能產生水聲、相位與高頻破碎感。"
                      : "原曲直通：不套用 EQ、壓縮、增益或變速；播放的是受保護來源音檔。"}
                  </p>
                  </>
                ) : <span className="daw-score-audio-missing">來源音檔遺失，請重新上傳後再校對。</span>}
                <div className="daw-score-review-tools">
                  <button type="button" title="上一個小節" onClick={() => moveReviewMeasure(-1)} disabled={!chordMeasures.length}><SkipBack size={14} />上一小節</button>
                  <button type="button" title={focusedMeasure?.notationOnly ? "譜面編排小節沒有獨立音訊範圍" : "播放或暫停目前小節"} onClick={() => focusedMeasure && void toggleMeasurePlayback(focusedMeasure)} disabled={!focusedMeasure || !reviewAudioFile || focusedMeasure.notationOnly}>
                    {isReviewPlaying && playbackRange?.measure === focusedMeasure?.number ? <Pause size={14} /> : <Play size={14} />}
                    {isReviewPlaying && playbackRange?.measure === focusedMeasure?.number ? "暫停" : "播放此小節"}
                  </button>
                  <button className={loopMeasure ? "active" : ""} type="button" title="循環播放目前小節" onClick={() => setLoopMeasure((current) => !current)}><Repeat2 size={14} />小節循環</button>
                  <button type="button" title="下一個小節" onClick={() => moveReviewMeasure(1)} disabled={!chordMeasures.length}>下一小節<SkipForward size={14} /></button>
                  {isFinalized || isLegacySystemFinalized ? (
                    <button className="revision" type="button" onClick={() => void unlockReview()} disabled={Boolean(busy)}><LockOpen size={14} />建立修訂版</button>
                  ) : (
                    <button className="finalize" type="button" title={pendingReviewChangeCount ? "請先一次儲存全部修改與確認" : effectiveConfirmedCount === allReviewBeats.length ? "保存為人工確認正式譜" : `尚有 ${allReviewBeats.length - effectiveConfirmedCount} 拍未人工確認`} onClick={() => void finalizeReview()} disabled={Boolean(busy) || !guitarBeatStats.total || Boolean(pendingReviewChangeCount) || effectiveConfirmedCount !== allReviewBeats.length}><LockKeyhole size={14} />完成人工確認並鎖定</button>
                  )}
                </div>
              </div>
              <datalist id="songzu-chord-options">
                {CHORD_OPTIONS.map((name) => <option key={name} value={name} />)}
              </datalist>
              <div className={`daw-score-batch-save${pendingReviewChangeCount ? " dirty" : ""}`} aria-live="polite">
                <div>
                  <strong>{pendingReviewChangeCount ? `有 ${pendingReviewChangeCount} 拍尚未儲存` : `人工確認 ${effectiveConfirmedCount}/${allReviewBeats.length} 拍`}</strong>
                  <span>{pendingReviewChangeCount ? `和弦修改 ${pendingChordEditCount} 拍；完成整首校對後只需儲存一次。` : "可逐拍、逐小節、逐段落確認，也可以直接確認整首。"}</span>
                </div>
                <div>
                  <button type="button" onClick={discardAllReviewChanges} disabled={Boolean(busy) || !pendingReviewChangeCount}><RotateCcw size={14} />放棄本次</button>
                  <button className="save-all" type="button" onClick={() => void saveAllReviewProgress()} disabled={Boolean(busy) || isScoreLocked || !pendingReviewChangeCount}>
                    {busy === "saving" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
                    {busy === "saving" ? "正在儲存" : `儲存全部進度${pendingReviewChangeCount ? `（${pendingReviewChangeCount}）` : ""}`}
                  </button>
                  <button className="confirm-song" type="button" onClick={() => void saveAllReviewProgress(true)} disabled={Boolean(busy) || isScoreLocked || (!pendingReviewChangeCount && effectiveConfirmedCount === allReviewBeats.length)}>
                    <CheckCircle2 size={14} />確認整首並儲存
                  </button>
                </div>
              </div>
              <div className="daw-chord-chart" aria-label="吉他和弦小節譜">
                {chordMeasures.map((measure) => {
                  const measureConfirmed = measure.beats.every(isBeatEffectivelyConfirmed);
                  const tokens = chordMeasureTokens(measure, chordEdits);
                  return (
                    <article
                      className={`daw-chord-measure${focusedMeasure?.number === measure.number ? " focused" : ""}${measureConfirmed ? " completed" : ""}${systemVerified ? " system-verified" : ""}`}
                      key={measure.number}
                      ref={(node) => { if (node) measureRefs.current.set(measure.number, node); else measureRefs.current.delete(measure.number); }}
                    >
                      <header aria-label={`第 ${measure.number} 小節`}>
                        <button className="measure-play" type="button" title={`試聽第 ${measure.number} 小節`} onClick={() => void toggleMeasurePlayback(measure)}>
                          <Play size={12} />
                          <span>第 <strong>{measure.number}</strong> 小節</span>
                        </button>
                        <button
                          className={`measure-confirm${measureConfirmed ? " active" : ""}`}
                          type="button"
                          aria-pressed={measureConfirmed}
                          title={measureConfirmed ? "取消這一小節的人工確認" : "確認這一小節全部拍子"}
                          onClick={() => stageBeatGroupConfirmation(measure.beats, !measureConfirmed)}
                          disabled={Boolean(busy) || isScoreLocked}
                        >
                          <CheckCircle2 size={13} /><span>{measureConfirmed ? "小節已確認" : "確認整個小節"}</span>
                        </button>
                      </header>
                      <div className="daw-chord-notation" style={{ gridTemplateColumns: `auto repeat(${measure.beats.length}, minmax(0, 1fr)) auto` }} aria-label={`第 ${measure.number} 小節和弦：${tokens.join(" ")}`}>
                        <span aria-hidden="true">|</span>
                        {tokens.map((token, index) => (
                          <strong className={token === "_" ? "hold" : ""} key={`${measure.number}-${index}`}>{token}</strong>
                        ))}
                        <span aria-hidden="true">|</span>
                      </div>
                      <div className="daw-chord-beats" style={{ gridTemplateColumns: `repeat(${measure.beats.length}, minmax(0, 1fr))` }}>
                        {measure.beats.map((beat) => {
                          const key = scoreBeatKey(beat);
                          const chordName = beat.name;
                          const editedName = chordEdits[key] ?? chordName;
                          const changed = editedName.trim() !== chordName;
                          const storedConfirmed = isAutoScoreBeatExplicitlyConfirmed(selectedDraft.result, beat);
                          const defaultAfterChord = changed || storedConfirmed;
                          const confirmed = confirmationEdits[key] ?? defaultAfterChord;
                          const confirmationChanged = confirmationEdits[key] !== undefined && confirmationEdits[key] !== defaultAfterChord;
                          const pending = changed || confirmationChanged;
                          return (
                            <div className={`daw-chord-beat${confirmed ? " confirmed" : ""}${pending ? " pending" : ""}${focusedBeat && scoreBeatKey(focusedBeat) === key ? " focused" : ""}`} key={beat.beat} aria-label={`第 ${measure.number} 小節第 ${beat.beat} 拍`}>
                              <span>{beat.beat}</span>
                              <div className="daw-chord-cell-editor">
                                <input
                                  list="songzu-chord-options"
                                  title="修改這一拍的和弦，也可以直接輸入延伸和弦或轉位"
                                  aria-label={`第 ${measure.number} 小節第 ${beat.beat} 拍和弦`}
                                  value={editedName}
                                  ref={(node) => { if (node) beatInputRefs.current.set(key, node); else beatInputRefs.current.delete(key); }}
                                  onFocus={() => focusReviewBeat(beat)}
                                  onChange={(event) => setChordEdits((current) => {
                                    const next = { ...current };
                                    if (event.target.value.trim() === chordName) delete next[key];
                                    else next[key] = event.target.value;
                                    return next;
                                  })}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    moveToNextBeatEditor(beat);
                                  }}
                                  disabled={Boolean(busy) || isScoreLocked}
                                />
                                <div className="daw-chord-cell-actions">
                                  <button className={confirmed ? "confirm active" : "confirm"} type="button" aria-pressed={confirmed} title={confirmed ? "取消這一拍的人工確認" : "確認這一拍"} onClick={() => stageBeatGroupConfirmation([beat], !confirmed)} disabled={Boolean(busy) || isScoreLocked}>
                                    <CheckCircle2 size={12} /><span>{confirmed ? "已確認" : "確認"}</span>
                                  </button>
                                  {pending ? (
                                    <button className="undo" type="button" title="復原這一拍尚未儲存的變更" aria-label={`復原第 ${measure.number} 小節第 ${beat.beat} 拍的變更`} onClick={() => discardBeatChanges(beat)} disabled={Boolean(busy) || isScoreLocked}>
                                      <RotateCcw size={12} /><span>復原</span>
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
              {strummingGuide ? (
                <section className="daw-strumming-guide" aria-label="吉他刷法與節奏教學">
                  <header>
                    <div><strong>吉他刷法與節奏</strong><span>{strummingGuide.bpm} BPM · {strummingGuide.meter} · {strummingSubdivisionOption.label} · {strummingSubdivisionOption.detail}</span></div>
                    <div className="daw-strumming-header-actions">
                      <button type="button" onClick={() => void analyzeStrummingFromAudio()} disabled={Boolean(busy)}>
                        {busy === "strumming-analysis" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                        {strummingGuide.analysis ? "重新分析音檔" : "從音檔產生刷法"}
                      </button>
                    </div>
                  </header>
                  <div className={`daw-strumming-analysis${strummingGuide.analysis ? " ready" : " template"}`}>
                    <Sparkles size={16} />
                    {strummingGuide.analysis ? (
                      <div>
                        <strong>本機音檔分析完成 · {strummingGuide.analysis.confidence}% 符合度</strong>
                        <span>{strummingGuide.analysis.onsetCount} 個起音 · {strummingGuide.analysis.analyzedBarCount} 小節 · 建議 {AUTO_SCORE_STRUMMING_SUBDIVISIONS.find((option) => option.id === strummingGuide.analysis?.detectedSubdivision)?.label ?? strummingGuide.analysis.detectedSubdivision} · {strummingGuide.analysis.manualExampleCount} 組人工修訂參考</span>
                      </div>
                    ) : (
                      <div><strong>目前顯示通用模板</strong><span>按「從音檔產生刷法」，系統才會真正讀取拍點、起音、短音與段落能量。</span></div>
                    )}
                  </div>
                  <div className="daw-strumming-subdivision" role="radiogroup" aria-label="選擇刷法節奏細分">
                    {AUTO_SCORE_STRUMMING_SUBDIVISIONS.map((option) => (
                      <button
                        className={strummingSubdivision === option.id ? "active" : ""}
                        type="button"
                        role="radio"
                        aria-checked={strummingSubdivision === option.id}
                        title={`${option.label}：${option.detail}`}
                        onClick={() => changeStrummingSubdivision(option.id)}
                        key={option.id}
                      >
                        <strong>{option.shortLabel}</strong>
                        <small>{option.detail}</small>
                      </button>
                    ))}
                  </div>
                  <div className="daw-strumming-legend" aria-label="刷法符號說明">
                    <span><b>↓</b>下刷</span><span><b>↑</b>上刷</span><span><b>×</b>悶音</span><span><b>–</b>空刷</span><em>點選任一格即可人工修改</em>
                  </div>
                  <div className={`daw-strumming-batch-save${pendingStrummingEdits.length ? " dirty" : ""}`} aria-live="polite">
                    <div>
                      <strong>{pendingStrummingEdits.length ? `有 ${pendingStrummingCellCount} 個刷法變更尚未儲存` : "刷法已同步"}</strong>
                      <span>{pendingStrummingEdits.length ? "可以跨不同細分與刷法一起修改，最後只儲存一次。" : "自動結果可直接使用；本機創作者 的修訂會覆蓋該版本並保留來源。"}</span>
                    </div>
                    <div>
                      <button type="button" onClick={discardStrummingEdits} disabled={Boolean(busy) || !pendingStrummingEdits.length}><RotateCcw size={14} />放棄修改</button>
                      <button className="save-all" type="button" onClick={() => void saveAllStrummingEdits()} disabled={Boolean(busy) || !pendingStrummingEdits.length}>
                        {busy === "strumming" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
                        {busy === "strumming" ? "正在儲存" : "儲存全部刷法"}
                      </button>
                    </div>
                  </div>
                  <div className={`daw-strumming-patterns${strummingSubdivision === "sixteenth" || strummingSubdivision === "beat_sextuplet" ? " high-density" : ""}`}>
                    {strummingGuide.patterns.map((pattern) => {
                      const editKey = strummingEditKey(pattern.id, strummingSubdivision);
                      const pendingEdit = strummingEdits[editKey];
                      const variant = withPendingStrummingEdit(buildAutoScoreStrummingVariant(pattern, strummingSubdivision), pendingEdit);
                      const previewId = `${pattern.id}:${strummingSubdivision}`;
                      const selectedCell = selectedStrummingCell?.patternId === pattern.id && selectedStrummingCell.subdivision === strummingSubdivision
                        ? variant.groups.flatMap((group) => group.cells.map((cell) => ({ ...cell, groupLabel: group.label }))).find((cell) => cell.index === selectedStrummingCell.index)
                        : null;
                      const sourceLabel = pendingEdit ? "尚未儲存" : variant.source === "manual" ? `${variant.updatedBy ?? "本機創作者"} 已修訂` : variant.source === "auto_audio_analysis" ? "音檔自動分析" : "通用模板";
                      return (
                        <article className={`${previewPatternId === previewId ? "playing " : ""}${pendingEdit ? "editing" : ""}`} key={pattern.id}>
                          <header>
                            <span>{pattern.difficulty}</span><strong>{pattern.label}</strong><em className={`daw-strumming-source ${variant.source}`}>{sourceLabel}</em>
                            <button type="button" title={`以${variant.label}預聽 ${pattern.label} 兩小節`} onClick={() => void previewStrummingPattern(pattern)}>{previewPatternId === previewId ? <Pause size={13} /> : <Play size={13} />}{previewPatternId === previewId ? "停止" : "預聽"}</button>
                          </header>
                          <div
                            className={`daw-strumming-grid subdivision-${variant.subdivision}`}
                            style={{ gridTemplateColumns: `repeat(${variant.groups.length}, minmax(0, 1fr))` }}
                            aria-label={`${pattern.label}，${variant.label}刷法`}
                          >
                            {variant.groups.map((group) => (
                              <div className="daw-strumming-beat-group" key={`${pattern.id}-${variant.subdivision}-${group.label}`}>
                                <header><strong>{group.label}</strong>{group.detail ? <small>{group.detail}</small> : null}</header>
                                <div style={{ gridTemplateColumns: `repeat(${group.cells.length}, minmax(0, 1fr))` }}>
                                  {group.cells.map((cell) => (
                                    <button
                                      className={`${cell.accent ? "accent " : ""}${selectedCell?.index === cell.index ? "selected" : ""}`}
                                      title={`${group.label}第 ${cell.count} 格：${strumStrokeName(cell.stroke)}${cell.accent ? "，重音" : ""}`}
                                      type="button"
                                      aria-pressed={selectedCell?.index === cell.index}
                                      onClick={() => selectStrummingCell(pattern.id, cell.index)}
                                      key={`${pattern.id}-${variant.subdivision}-${cell.index}`}
                                    >
                                      <small>{cell.count}</small>
                                      <b>{strumStrokeLabel(cell.stroke)}</b>
                                      {cell.accent ? <i>重</i> : null}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          {selectedCell ? (
                            <div className="daw-strumming-cell-editor" aria-label={`編輯 ${pattern.label} ${selectedCell.groupLabel}第 ${selectedCell.count} 格`}>
                              <div><strong>{selectedCell.groupLabel} · {selectedCell.count}</strong><span>選擇這一格的右手動作</span></div>
                              <div className="daw-strumming-stroke-options">
                                {(["down", "up", "mute", "rest"] as const).map((stroke) => (
                                  <button className={selectedCell.stroke === stroke ? "active" : ""} type="button" onClick={() => stageStrummingCell(pattern, selectedCell.index, { stroke })} key={stroke}>
                                    <b>{strumStrokeLabel(stroke)}</b><span>{strumStrokeName(stroke)}</span>
                                  </button>
                                ))}
                                <button className={selectedCell.accent ? "accent active" : "accent"} type="button" onClick={() => stageStrummingCell(pattern, selectedCell.index, { toggleAccent: true })}>
                                  <b>●</b><span>{selectedCell.accent ? "取消重音" : "設為重音"}</span>
                                </button>
                              </div>
                            </div>
                          ) : null}
                          <p>{pattern.feel}</p>
                          <small>{pattern.instruction}</small>
                        </article>
                      );
                    })}
                  </div>
                  <div className="daw-strumming-sections">
                    {strummingGuide.sections.map((section) => {
                      const pattern = strummingGuide.patterns.find((candidate) => candidate.id === section.patternId);
                      return <span key={`${section.label}-${section.firstMeasure}`}><strong>{section.label}</strong><b>{section.firstMeasure}-{section.lastMeasure} 小節</b><em>{pattern?.label ?? section.patternId} · {section.dynamics}</em></span>;
                    })}
                  </div>
                  <p className="daw-strumming-note">{strummingGuide.note}</p>
                </section>
              ) : null}
            </div>
          ) : null}

          {selectedDraft.targetInstrument === "piano" ? (
            <div className="daw-piano-score">
              {selectedDraft.result.bars.slice(0, 32).map((bar) => (
                <article key={bar.index}>
                  <header><strong>{bar.index}</strong><span>{bar.chords.join(" · ") || "N.C."}</span></header>
                  <div className="daw-staff" aria-label={`第 ${bar.index} 小節`}>
                    {bar.notes.slice(0, 18).map((note, index) => (
                      <i key={`${note.startSeconds}-${note.midi}-${index}`} title={`${note.noteName} · ${Math.round(note.confidence)}%`} style={{ left: `${8 + (index / Math.max(1, bar.notes.length - 1)) * 84}%`, top: `${pitchTop(note.midi)}%` }} />
                    ))}
                  </div>
                  <small>{bar.notes.map((note) => note.noteName).slice(0, 12).join(" ") || "休止"}</small>
                </article>
              ))}
            </div>
          ) : null}

          {selectedDraft.targetInstrument === "drums" ? (
            <div className="daw-drum-score">
              {selectedDraft.result.bars.slice(0, 48).map((bar) => (
                <article key={bar.index}>
                  <strong>{bar.index}</strong>
                  {(["hihat", "snare", "kick"] as const).map((kind) => (
                    <div key={kind}>
                      <span>{kind === "hihat" ? "HH" : kind === "snare" ? "SD" : "BD"}</span>
                      {drumPattern(bar, kind, selectedDraft.result.bpm).map((hit, index) => <i className={hit ? "hit" : ""} key={index}>{hit ? "×" : "·"}</i>)}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          ) : null}

          <div className="daw-score-warnings">
            {selectedDraft.result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
          <div className="daw-score-actions">
            <button className="button" type="button" onClick={() => void applyToDaw()} disabled={Boolean(busy) || (selectedDraft.targetInstrument === "guitar" && !isFinalized)}>
              {busy === "applying" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
              加入 DAW 標記
            </button>
            {(selectedDraft.targetInstrument === "guitar" && !isFinalized
              ? [["json&draft=1", "下載草稿備份"]]
              : selectedDraft.targetInstrument === "guitar"
              ? [["pdf&download=1", "正式吉他譜 PDF"], ["json", "和弦資料"]]
              : [["musicxml", "MusicXML"], ["midi", "MIDI"], ["txt", "文字譜"], ["json", "JSON"]]
            ).map(([format, label]) => (
              <a className="button ghost" href={`/api/daw-score-drafts/${selectedDraft.id}/export?format=${format}`} key={format} download>
                <Download size={14} />{label}
              </a>
            ))}
            {selectedDraft.targetInstrument === "guitar" && !isFinalized ? <span className="daw-score-action-note">正式匯出與加入 DAW 只會在全部逐拍人工確認並鎖定後開放；系統檢查不會自動替你定稿。</span> : null}
          </div>
        </section>
      ) : busy !== "loading" ? (
        <div className="daw-score-empty"><Music2 size={24} /><p>選一個音檔與樂器，第一份草譜會出現在這裡。</p></div>
      ) : null}
    </div>
  );
}
