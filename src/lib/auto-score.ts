export type AutoScoreTarget = "guitar" | "piano" | "drums";

export type AutoScoreNote = {
  startSeconds: number;
  durationSeconds: number;
  midi: number;
  noteName: string;
  velocity: number;
  confidence: number;
};

export type AutoScoreChord = {
  startSeconds: number;
  durationSeconds: number;
  name: string;
  initialHarmonyName?: string;
  root: string;
  quality: string;
  bass?: string | null;
  confidence: number;
  reviewStatus?: "likely" | "review" | "confirmed";
  alternateNames?: string[];
  theoryDegree?: string;
  rootSearchRank?: number;
  qualitySearchRank?: number;
  relativeKeyContext?: string;
  rawTonalCenter?: string;
  localKeyConfidence?: number;
  candidateAlternatives?: Array<{
    name: string;
    degree: string;
    score: number;
  }>;
  evidence?: AutoScoreChordEvidence[];
  boundaryConfidence?: number;
  harmonicChangeConfidence?: number;
  subBeatAgreement?: number;
  noChordProbability?: number;
  bassPitch?: string | null;
  bassPitchConfidence?: number | null;
  bassPitchStability?: number | null;
  isolatedBassEvidence?: boolean;
  notePitchClasses?: number[];
  noteMidiWeights?: Array<{ midi: number; pitchClass: number; weight: number }>;
  repeatedSectionSupport?: number;
  personalPriorSupport?: number;
  rootConfidence?: number;
  qualityConfidence?: number;
  independentSourceCount?: number;
  evidenceConflict?: boolean;
  acousticDetailName?: string;
  structuralDecision?: "unchanged" | "simplified_color" | "context_consensus";
  structuralConfidence?: number;
  pitches: number[];
  guitarFrets?: number[];
};

export type AutoScoreChordEvidence = {
  source: string;
  name: string;
  confidence: number;
  weight: number;
  support: "supports" | "alternate" | "neutral";
  detail?: string;
};

export type AutoScoreHarmonyAnalysis = {
  pipeline: "songzu_harmony_v5" | "songzu_harmony_v6" | "songzu_harmony_v7" | "songzu_harmony_v8" | "songzu_harmony_v9" | "songzu_harmony_v10" | "songzu_harmony_v11" | "songzu_harmony_v12";
  methods: Array<{
    id: string;
    label: string;
    available: boolean;
    participated: boolean;
    note: string;
  }>;
  personalBaselineSongCount: number;
  repeatedGroupCount: number;
  boundaryCandidateCount: number;
  explicitNoChordBeatCount: number;
  structuralSimplifiedBeatCount?: number;
  structuralChordChangeCount?: number;
  qualityGate?: {
    status: "pass" | "review" | "degraded";
    beatCount: number;
    highConfidenceBeatCount: number;
    reviewBeatCount: number;
    conflictBeatCount: number;
    rootConfidence: number;
    qualityConfidence: number;
    boundaryConfidence: number;
    independentFamilyAverage: number;
    reasons: string[];
  };
  sourceQuality?: {
    verdict: string;
    analysisSuitability: "good" | "limited" | "unknown";
    codecName: string | null;
    sampleRate: number | null;
    bitDepth: number | null;
    bitRate: number | null;
    clippingRisk: boolean;
    lowQualityRisk: boolean;
    warnings: string[];
    checkedAt: string;
  };
  generatedAt: string;
};

export type AutoScoreDrumHit = {
  startSeconds: number;
  kind: "kick" | "snare" | "hihat";
  velocity: number;
  confidence: number;
};

export type AutoScoreBar = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  chords: string[];
  notes: AutoScoreNote[];
  drumHits: AutoScoreDrumHit[];
};

export type AutoScoreRhythmCalibration = {
  engine: "madmom_rnn_beat_grid_v1";
  bpm: number;
  displayBpm: number;
  beatsPerBar: number;
  confidence: number;
  firstBeatSeconds: number;
  firstDownbeatSeconds: number;
  beatTimesSeconds: number[];
  beatNumbers: number[];
  downbeatTimesSeconds: number[];
  tempoMap: Array<{ startSeconds: number; bpm: number }>;
  warnings: string[];
};

export type AutoScoreBeatConfirmation = {
  beatId?: string;
  startSeconds: number;
  endSeconds: number;
  name: string;
};

export type AutoScoreBenchmarkMetric = {
  correct: number;
  total: number;
  accuracy: number | null;
};

export type AutoScoreBenchmarkEvidencePrediction = {
  engineId: string;
  source: string;
  name: string;
};

export type AutoScoreBenchmarkBeat = {
  measure: number;
  beat: number;
  startSeconds: number;
  endSeconds: number;
  name: string;
  evidence: AutoScoreBenchmarkEvidencePrediction[];
};

export type AutoScoreBenchmarkBaseline = {
  standard: "songzu_human_benchmark_baseline_v1";
  pipelineVersion: string;
  capturedAt: string;
  beats: AutoScoreBenchmarkBeat[];
};

export type AutoScoreHumanBenchmark = {
  standard: "songzu_human_benchmark_v1";
  pipelineVersion: string;
  benchmarkedAt: string;
  beatCount: number;
  metrics: {
    exactChord: AutoScoreBenchmarkMetric;
    root: AutoScoreBenchmarkMetric;
    quality: AutoScoreBenchmarkMetric;
    inversion: AutoScoreBenchmarkMetric;
    noChord: AutoScoreBenchmarkMetric;
    boundary: AutoScoreBenchmarkMetric;
  };
  engines: Array<{
    engineId: string;
    sampleCount: number;
    exactChord: AutoScoreBenchmarkMetric;
    root: AutoScoreBenchmarkMetric;
    quality: AutoScoreBenchmarkMetric;
  }>;
};

export type AutoScoreReview = {
  status: "in_progress" | "finalized";
  revision: number;
  finalizedAt?: string;
  finalizedBy?: string;
  verificationMethod?: "manual" | "multi_evidence_system";
  confirmedBeatCount?: number;
  totalBeatCount?: number;
};

export type AutoScoreVerificationCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type AutoScoreChordVerification = {
  status: "verified" | "conflicts";
  method: "multi_evidence_consensus_v1";
  verifiedAt: string;
  totalChordCount: number;
  verifiedChordCount: number;
  totalBeatCount: number;
  verifiedBeatCount: number;
  conflictCount: number;
  conflicts: string[];
  checks: AutoScoreVerificationCheck[];
};

export type AutoScoreStrumStroke = "down" | "up" | "mute" | "rest";

export type AutoScoreStrummingSubdivision =
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "quarter_triplet"
  | "beat_triplet"
  | "beat_sextuplet";

export type AutoScoreStrummingSubdivisionOption = {
  id: AutoScoreStrummingSubdivision;
  label: string;
  shortLabel: string;
  detail: string;
  slotDurationBeats: number;
};

export type AutoScoreStrummingPatternVariant = {
  count: string[];
  strokes: AutoScoreStrumStroke[];
  accents: number[];
  source: "auto_audio_analysis" | "manual";
  confidence: number;
  updatedAt: string;
  updatedBy?: string;
};

export const AUTO_SCORE_STRUMMING_SUBDIVISIONS: readonly AutoScoreStrummingSubdivisionOption[] = [
  { id: "quarter", label: "四分音符", shortLabel: "四分", detail: "每拍 1 格", slotDurationBeats: 1 },
  { id: "eighth", label: "八分音符", shortLabel: "八分", detail: "每拍 2 格", slotDurationBeats: 0.5 },
  { id: "sixteenth", label: "十六分音符", shortLabel: "十六分", detail: "每拍 4 格", slotDurationBeats: 0.25 },
  { id: "quarter_triplet", label: "大三連音", shortLabel: "大三連", detail: "3 個音跨 2 拍", slotDurationBeats: 2 / 3 },
  { id: "beat_triplet", label: "一拍三連音", shortLabel: "一拍三連", detail: "每拍 3 格", slotDurationBeats: 1 / 3 },
  { id: "beat_sextuplet", label: "一拍六連音", shortLabel: "一拍六連", detail: "每拍 6 格", slotDurationBeats: 1 / 6 }
] as const;

export type AutoScoreStrummingPattern = {
  id: string;
  label: string;
  difficulty: "入門" | "標準" | "進階";
  subdivision: AutoScoreStrummingSubdivision;
  count: string[];
  strokes: AutoScoreStrumStroke[];
  accents: number[];
  feel: string;
  instruction: string;
  variants?: Partial<Record<AutoScoreStrummingSubdivision, AutoScoreStrummingPatternVariant>>;
};

export type AutoScoreStrummingAnalysis = {
  engine: "songzu_local_audio_strumming_v1";
  source: "protected_audio_transients_and_beat_grid";
  detectedSubdivision: AutoScoreStrummingSubdivision;
  confidence: number;
  onsetCount: number;
  analyzedBarCount: number;
  manualExampleCount: number;
  generatedAt: string;
  evidence: string[];
};

export type AutoScoreStrummingGuide = {
  purpose: "teaching_accompaniment";
  meter: string;
  bpm: number;
  unit: string;
  defaultSubdivision?: AutoScoreStrummingSubdivision;
  availableSubdivisions?: AutoScoreStrummingSubdivision[];
  analysis?: AutoScoreStrummingAnalysis;
  note: string;
  patterns: AutoScoreStrummingPattern[];
  sections: Array<{
    label: string;
    firstMeasure: number;
    lastMeasure: number;
    patternId: string;
    dynamics: string;
    instruction: string;
  }>;
};

export type AutoScoreStrummingVariantGroup = {
  label: string;
  detail: string;
  cells: Array<{
    index: number;
    count: string;
    stroke: AutoScoreStrumStroke;
    accent: boolean;
  }>;
};

export type AutoScoreStrummingVariant = {
  subdivision: AutoScoreStrummingSubdivision;
  label: string;
  shortLabel: string;
  detail: string;
  slotDurationBeats: number;
  groups: AutoScoreStrummingVariantGroup[];
  count: string[];
  strokes: AutoScoreStrumStroke[];
  accents: number[];
  source: "derived_template" | "auto_audio_analysis" | "manual";
  confidence: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type AutoScoreReferenceVerification = {
  sourceType: "licensed_sheet_music" | "editor_reference" | "public_chord_reference";
  sourceTitle: string;
  publisher: string;
  productId?: string;
  startMeasure: number;
  measureCount: number;
  coveredBeatCount: number;
  totalBeatCount: number;
  matchedBeatCount: number;
  changedBeatCount: number;
  coveragePercent: number;
  status: "partial" | "complete";
  importedAt: string;
};

export type AutoScoreReferenceSource = {
  id: string;
  sourceType: "licensed_band_score" | "licensed_chord_sheet" | "editor_reference" | "public_chord_reference" | "audio_analysis";
  sourceTitle: string;
  publisher: string;
  url?: string;
  productId?: string;
  authority: "licensed_publisher" | "editor" | "community_reference" | "protected_audio";
  accessStatus: "metadata_only" | "licensed_private_copy" | "private_editor_copy" | "public_reference_checked" | "analyzed_locally";
  reliabilityTier: "anchor" | "supporting" | "candidate";
  claims?: {
    bpm?: number;
    meter?: string;
    concertKey?: string;
    keySegments?: string[];
    notes?: string[];
  };
  checkedAt: string;
};

export type AutoScoreIndependentReview = {
  reviewer: string;
  role: "musician" | "teacher" | "arranger";
  confirmedBeatCount: number;
  totalBeatCount: number;
  reviewedAt: string;
  notes?: string;
};

export function applyAutoScoreIndependentReview(
  result: AutoScoreResult,
  review: AutoScoreIndependentReview
) {
  if (result.targetInstrument !== "guitar") {
    throw new Error("獨立全曲複核目前只支援吉他和弦譜。");
  }
  const progress = autoScoreReviewProgress(result);
  if (
    result.review?.status !== "finalized" ||
    result.review.verificationMethod !== "manual" ||
    !result.review.finalizedBy?.trim() ||
    progress.total <= 0 ||
    progress.confirmed !== progress.total
  ) {
    throw new Error("必須先由 本機創作者 完成全曲逐拍人工定稿，才能登記第二位樂手複核。");
  }

  const reviewer = review.reviewer.normalize("NFC").trim();
  if (!reviewer || reviewer.toLocaleLowerCase() === result.review.finalizedBy.normalize("NFC").trim().toLocaleLowerCase()) {
    throw new Error("獨立複核者必須是 本機創作者 以外的第二位樂手、老師或編曲者。");
  }
  const reviewedAt = new Date(review.reviewedAt);
  if (!Number.isFinite(reviewedAt.getTime()) || reviewedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new Error("獨立複核時間不正確。");
  }
  if (review.totalBeatCount !== progress.total || review.confirmedBeatCount !== progress.total) {
    throw new Error(`第二位複核者必須完整確認 ${progress.total}/${progress.total} 拍。`);
  }

  const notes = review.notes?.normalize("NFC").trim();
  const next: AutoScoreResult = {
    ...result,
    independentReview: {
      reviewer,
      role: review.role,
      confirmedBeatCount: progress.total,
      totalBeatCount: progress.total,
      reviewedAt: reviewedAt.toISOString(),
      ...(notes ? { notes } : {})
    }
  };
  return { ...next, certification: buildAutoScoreDeliveryCertification(next) };
}

export type AutoScoreDeliveryCertificationCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  requiredFor: "formal" | "performance" | "teaching";
};

export type AutoScoreDeliveryCertification = {
  standard: "songzu_score_delivery_v1";
  status: "draft" | "system_checked" | "editor_confirmed" | "performance_ready" | "teaching_ready";
  label: string;
  generatedAt: string;
  unresolvedCount: number;
  checks: AutoScoreDeliveryCertificationCheck[];
};

export type AutoScoreReviewBeat = {
  id: string;
  measure: number;
  beat: number;
  startSeconds: number;
  endSeconds: number;
  name: string;
  sourceMeasure: number | null;
  insertionId?: string;
  notationOnly?: boolean;
};

export type AutoScoreReviewMeasure = {
  number: number;
  sourceMeasure: number | null;
  startSeconds: number;
  endSeconds: number;
  beats: AutoScoreReviewBeat[];
  inserted: boolean;
  insertionId?: string;
  sectionLabel?: string;
  notationOnly?: boolean;
};

export type AutoScoreSheetInsertion = {
  id: string;
  type: "insert_measure";
  beforeSourceMeasure: number;
  sectionLabel: string;
  beats: string[];
  insertedBy: string;
  insertedAt: string;
  note?: string;
};

export type AutoScoreSheetDeletion = {
  id: string;
  type: "delete_measure";
  sourceMeasure: number;
  deletedBy: string;
  deletedAt: string;
  note?: string;
};

export type AutoScoreSheetArrangement = {
  version: 1;
  updatedAt: string;
  updatedBy: string;
  insertions: AutoScoreSheetInsertion[];
  deletions?: AutoScoreSheetDeletion[];
};

export type AutoScoreSheetMeasure = {
  number: number;
  sourceMeasure: number | null;
  beats: string[];
  inserted: boolean;
  insertionId?: string;
  insertedBy?: string;
};

export type AutoScoreSheetSection = {
  label: string;
  firstMeasure: number;
  lastMeasure: number;
  measures: AutoScoreSheetMeasure[];
};

export type AutoScoreResult = {
  format: "songzu-auto-score";
  version: 1;
  analyzer: "songzu_local_dsp_v1" | "songzu_harmony_v2" | "songzu_harmony_v3" | "songzu_harmony_v4" | "songzu_harmony_v5" | "songzu_harmony_v6" | "songzu_harmony_v7" | "songzu_harmony_v8" | "songzu_harmony_v9" | "songzu_harmony_v10" | "songzu_harmony_v11" | "songzu_harmony_v12";
  targetInstrument: AutoScoreTarget;
  bpm: number;
  musicalKey: string;
  timeSignature: string;
  durationSeconds: number;
  confidence: number;
  sourceProfile: "single_instrument" | "mixed_audio";
  analysisMode?: "quick_dsp" | "cqt" | "consensus";
  harmonyAnalysis?: AutoScoreHarmonyAnalysis;
  rhythm?: AutoScoreRhythmCalibration;
  beatConfirmations?: AutoScoreBeatConfirmation[];
  benchmarkBaseline?: AutoScoreBenchmarkBaseline;
  humanBenchmark?: AutoScoreHumanBenchmark;
  review?: AutoScoreReview;
  referenceVerification?: AutoScoreReferenceVerification;
  referenceSources?: AutoScoreReferenceSource[];
  independentReview?: AutoScoreIndependentReview;
  certification?: AutoScoreDeliveryCertification;
  notes: AutoScoreNote[];
  chords: AutoScoreChord[];
  drumHits: AutoScoreDrumHit[];
  bars: AutoScoreBar[];
  warnings: string[];
  sectionMap?: Array<{
    label: string;
    firstMeasure: number;
    lastMeasure: number;
    startSeconds: number;
    endSeconds: number;
  }>;
  rhythmChanges?: Array<{
    firstMeasure: number;
    lastMeasure: number;
    label: string;
  }>;
  sheetArrangement?: AutoScoreSheetArrangement;
  strummingGuide?: AutoScoreStrummingGuide;
  verification?: {
    status: "triangulated_review" | "system_verified" | "human_verified";
    humanConfirmed: boolean;
    systemConfirmed?: boolean;
    sourceMatchSha256?: string;
    officialMetadata?: {
      title: string;
      artist: string;
      key: string;
      publishedTempoBpm?: number;
    };
    recordingGrid?: {
      bpm: number;
      meter: string;
      measures: number;
    };
    evidence?: string[];
    chordVerification?: AutoScoreChordVerification;
  };
};

export type AutoScoreAnalysisOptions = {
  targetInstrument: AutoScoreTarget;
  bpm?: number | null;
  musicalKey?: string | null;
  timeSignature?: string | null;
  sourceProfileHint?: "isolated_stem" | "mixed_audio";
  onProgress?: (progress: number, label: string) => void;
};

export type AutoScorePcmInput = {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
};

export type AutoScoreHarmonyEvent = Pick<
  AutoScoreChord,
  | "startSeconds"
  | "durationSeconds"
  | "name"
  | "root"
  | "quality"
  | "bass"
  | "confidence"
  | "reviewStatus"
  | "alternateNames"
  | "theoryDegree"
  | "rootSearchRank"
  | "qualitySearchRank"
  | "relativeKeyContext"
  | "rawTonalCenter"
  | "localKeyConfidence"
  | "candidateAlternatives"
  | "evidence"
  | "boundaryConfidence"
  | "harmonicChangeConfidence"
  | "subBeatAgreement"
  | "noChordProbability"
  | "notePitchClasses"
  | "noteMidiWeights"
  | "initialHarmonyName"
  | "repeatedSectionSupport"
  | "personalPriorSupport"
  | "rootConfidence"
  | "qualityConfidence"
  | "independentSourceCount"
  | "evidenceConflict"
  | "acousticDetailName"
  | "structuralDecision"
  | "structuralConfidence"
>;

export type AutoScoreHarmonyInput = {
  targetInstrument: Exclude<AutoScoreTarget, "drums">;
  bpm: number;
  musicalKey: string;
  timeSignature: string;
  durationSeconds: number;
  confidence: number;
  sourceProfile: AutoScoreResult["sourceProfile"];
  analysisMode?: AutoScoreResult["analysisMode"];
  analyzer?: AutoScoreResult["analyzer"];
  harmonyAnalysis?: AutoScoreHarmonyAnalysis;
  rhythm?: AutoScoreRhythmCalibration;
  events: AutoScoreHarmonyEvent[];
  warnings?: string[];
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const CHORD_TEMPLATES = [
  { quality: "", suffix: "", intervals: [0, 4, 7] },
  { quality: "m", suffix: "m", intervals: [0, 3, 7] },
  { quality: "7", suffix: "7", intervals: [0, 4, 7, 10] },
  { quality: "maj7", suffix: "maj7", intervals: [0, 4, 7, 11] },
  { quality: "m7", suffix: "m7", intervals: [0, 3, 7, 10] },
  { quality: "mMaj7", suffix: "mMaj7", intervals: [0, 3, 7, 11] },
  { quality: "sus2", suffix: "sus2", intervals: [0, 2, 7] },
  { quality: "sus4", suffix: "sus4", intervals: [0, 5, 7] },
  { quality: "dim", suffix: "dim", intervals: [0, 3, 6] },
  { quality: "aug", suffix: "aug", intervals: [0, 4, 8] },
  { quality: "6", suffix: "6", intervals: [0, 4, 7, 9] },
  { quality: "m6", suffix: "m6", intervals: [0, 3, 7, 9] },
  { quality: "6/9", suffix: "6/9", intervals: [0, 4, 7, 9, 14] },
  { quality: "9", suffix: "9", intervals: [0, 4, 7, 10, 14] },
  { quality: "maj9", suffix: "maj9", intervals: [0, 4, 7, 11, 14] },
  { quality: "m9", suffix: "m9", intervals: [0, 3, 7, 10, 14] },
  { quality: "add9", suffix: "add9", intervals: [0, 4, 7, 14] },
  { quality: "m7b5", suffix: "m7b5", intervals: [0, 3, 6, 10] },
  { quality: "dim7", suffix: "dim7", intervals: [0, 3, 6, 9] },
  { quality: "7sus4", suffix: "7sus4", intervals: [0, 5, 7, 10] }
] as const;

const OPEN_GUITAR_SHAPES: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  Cm: [-1, 3, 5, 5, 4, 3],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fm: [1, 3, 3, 1, 1, 1],
  G: [3, 2, 0, 0, 0, 3],
  Gm: [3, 5, 5, 3, 3, 3],
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  B: [-1, 2, 4, 4, 4, 2],
  Bm: [-1, 2, 4, 4, 3, 2],
  "C#": [-1, 4, 6, 6, 6, 4],
  "C#m": [-1, 4, 6, 6, 5, 4],
  "D#": [-1, 6, 8, 8, 8, 6],
  "D#m": [-1, 6, 8, 8, 7, 6],
  "F#": [2, 4, 4, 3, 2, 2],
  "F#m": [2, 4, 4, 2, 2, 2],
  "G#": [4, 6, 6, 5, 4, 4],
  "G#m": [4, 6, 6, 4, 4, 4],
  "A#": [-1, 1, 3, 3, 3, 1],
  "A#m": [-1, 1, 3, 3, 2, 1]
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function midiFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiName(midi: number) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function pitchClassIndex(root: string) {
  return NOTE_NAMES.indexOf(FLAT_TO_SHARP[root] ?? root);
}

function parseMeter(value: string | null | undefined) {
  const [beats, unit] = String(value || "4/4").split("/").map(Number);
  return {
    beats: clamp(Number.isFinite(beats) ? Math.round(beats) : 4, 1, 12),
    unit: [2, 4, 8, 16].includes(unit) ? unit : 4
  };
}

export function prepareAutoScorePcm(buffer: AudioBuffer, targetRate = 8000): AutoScorePcmInput {
  const sourceLength = buffer.length;
  const sourceRate = buffer.sampleRate;
  const outputLength = Math.max(1, Math.floor((sourceLength / sourceRate) * targetRate));
  const output = new Float32Array(outputLength);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(sourceLength - 1, Math.floor((index / targetRate) * sourceRate));
    let sample = 0;
    for (const channel of channels) sample += channel[sourceIndex] ?? 0;
    output[index] = sample / Math.max(1, channels.length);
  }

  return { samples: output, sampleRate: targetRate, durationSeconds: Math.max(0.1, buffer.duration) };
}

function goertzelPower(samples: Float32Array, start: number, length: number, sampleRate: number, frequency: number) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  const end = Math.min(samples.length, start + length);
  const actualLength = Math.max(1, end - start);

  for (let index = start; index < end; index += 2) {
    const position = (index - start) / actualLength;
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * position);
    q0 = samples[index] * window + coefficient * q1 - q2;
    q2 = q1;
    q1 = q0;
  }

  return Math.max(0, q1 * q1 + q2 * q2 - coefficient * q1 * q2) / actualLength;
}

function spectralBeat(
  samples: Float32Array,
  sampleRate: number,
  startSeconds: number,
  durationSeconds: number,
  minMidi: number,
  maxMidi: number
) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const length = Math.max(256, Math.floor(durationSeconds * sampleRate));
  const powers: Array<{ midi: number; power: number }> = [];
  const chroma = new Array<number>(12).fill(0);
  let total = 0;

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const power = goertzelPower(samples, start, length, sampleRate, midiFrequency(midi));
    powers.push({ midi, power });
    chroma[midi % 12] += power;
    total += power;
  }

  if (total > 0) {
    for (let index = 0; index < chroma.length; index += 1) chroma[index] /= total;
  }

  return { powers, chroma, total };
}

function normalizedKey(value: string | null | undefined) {
  const homeKey = String(value || "").replace("→", "->").split("->", 1)[0].trim();
  const match = /^([A-G](?:#|b)?)(m)?$/i.exec(homeKey);
  if (!match) return null;
  const flatToSharp: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  const rawRoot = `${match[1][0].toUpperCase()}${match[1].slice(1)}`;
  const root = flatToSharp[rawRoot] ?? rawRoot;
  const rootIndex = NOTE_NAMES.indexOf(root);
  return rootIndex < 0 ? null : { rootIndex, minor: Boolean(match[2]) };
}

function chordFitsKey(rootIndex: number, quality: string, musicalKey: string | null | undefined) {
  const key = normalizedKey(musicalKey);
  if (!key) return null;
  const intervals = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const qualities = key.minor ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  const relative = (rootIndex - key.rootIndex + 12) % 12;
  const degree = intervals.indexOf(relative);
  if (degree < 0) return false;
  const simpleQuality = quality === "dim" ? "dim" : quality.startsWith("m") && quality !== "maj7" ? "m" : "";
  if (key.minor && relative === 7 && simpleQuality === "") return true;
  return qualities[degree] === simpleQuality;
}

function identifyChord(chroma: number[], musicalKey?: string | null) {
  const candidates: Array<{
    score: number;
    rootIndex: number;
    quality: string;
    suffix: string;
    intervals: readonly number[];
  }> = [];

  for (let rootIndex = 0; rootIndex < 12; rootIndex += 1) {
    for (const template of CHORD_TEMPLATES) {
      const included = template.intervals.reduce<number>((sum, interval) => sum + chroma[(rootIndex + interval) % 12], 0);
      const outside = chroma.reduce(
        (sum, value, pitchClass) => (template.intervals.some((interval) => (rootIndex + interval) % 12 === pitchClass) ? sum : sum + value),
        0
      );
      const rootEnergy = chroma[rootIndex] ?? 0;
      const extensionEnergy = template.intervals.length > 3
        ? chroma[(rootIndex + template.intervals.at(-1)!) % 12] ?? 0
        : 0;
      const complexityPenalty = template.intervals.length > 3 ? Math.max(0, 0.075 - extensionEnergy) * 1.15 : 0;
      const colorPenalty = template.quality === "sus2" || template.quality === "sus4"
        ? 0.055
        : template.quality === "7" || template.quality === "maj7" || template.quality === "m7"
          ? 0.035
          : 0;
      const keyFit = chordFitsKey(rootIndex, template.quality, musicalKey);
      const keyWeight = keyFit === null ? 0 : keyFit ? 0.1 : -0.075;
      candidates.push({
        score: included * (3 / template.intervals.length) + rootEnergy * 0.28 - outside * 0.34 - complexityPenalty - colorPenalty + keyWeight,
        rootIndex,
        quality: template.quality,
        suffix: template.suffix,
        intervals: template.intervals
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1];
  const margin = Math.max(0, best.score - second.score);
  const confidence = clamp((best.score * 0.78 + margin * 2.4) * 100, 18, 96);
  const root = NOTE_NAMES[best.rootIndex];
  return {
    name: `${root}${best.suffix}`,
    root,
    quality: best.quality,
    intervals: [...best.intervals],
    confidence: round(confidence, 1)
  };
}

function estimateKey(chroma: number[]) {
  let best = { score: -Infinity, name: "C" };
  for (let root = 0; root < 12; root += 1) {
    for (const [mode, profile] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]] as const) {
      const score = profile.reduce((sum, weight, pitchClass) => sum + weight * (chroma[(pitchClass + root) % 12] ?? 0), 0);
      if (score > best.score) best = { score, name: `${NOTE_NAMES[root]}${mode === "minor" ? "m" : ""}` };
    }
  }
  return best.name;
}

function chordPitches(root: string, quality: string, target: AutoScoreTarget, bass?: string | null) {
  if (root === "N.C." || quality === "none") return [];
  const rootIndex = Math.max(0, pitchClassIndex(root));
  const exactTemplate = CHORD_TEMPLATES.find((item) => item.quality === quality);
  const intervals = exactTemplate?.intervals ?? (
    quality.startsWith("dim") ? [0, 3, 6] :
      quality.startsWith("aug") ? [0, 4, 8] :
        quality.startsWith("sus2") || quality.endsWith("sus2") ? [0, 2, 7] :
          quality.startsWith("sus4") || quality.endsWith("sus4") ? [0, 5, 7] :
            quality.startsWith("m") && !quality.startsWith("maj") ? [0, 3, 7] : [0, 4, 7]
  );
  const base = target === "guitar" ? 40 : 48;
  const rootMidi = base + ((rootIndex - (base % 12) + 12) % 12);
  const pitches = intervals.map((interval) => rootMidi + interval);
  if (target === "piano") {
    if (bass) {
      const bassIndex = pitchClassIndex(bass);
      if (bassIndex >= 0) {
        let bassMidi = 36 + ((bassIndex - (36 % 12) + 12) % 12);
        while (bassMidi >= rootMidi) bassMidi -= 12;
        if (bassMidi >= 21) pitches.unshift(bassMidi);
      }
    }
    pitches.push(rootMidi + 12);
  }
  return pitches;
}

function guitarShape(name: string, root: string, quality: string) {
  if (name === "N.C." || root === "N.C." || quality === "none") return [-1, -1, -1, -1, -1, -1];
  const canonicalRoot = FLAT_TO_SHARP[root] ?? root;
  const simpleName = `${canonicalRoot}${quality.startsWith("m") && quality !== "maj7" ? "m" : ""}`;
  return [...(OPEN_GUITAR_SHAPES[simpleName] ?? OPEN_GUITAR_SHAPES[canonicalRoot] ?? [-1, -1, -1, -1, -1, -1])];
}

function frameBandEnergy(samples: Float32Array, sampleRate: number, startSeconds: number, durationSeconds: number) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, start + Math.max(64, Math.floor(durationSeconds * sampleRate)));
  let slow = 0;
  let fast = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  const slowAlpha = Math.min(1, (2 * Math.PI * 180) / sampleRate);
  const fastAlpha = Math.min(1, (2 * Math.PI * 2200) / sampleRate);

  for (let index = start; index < end; index += 1) {
    const sample = samples[index];
    slow += slowAlpha * (sample - slow);
    fast += fastAlpha * (sample - fast);
    const lowSample = slow;
    const highSample = sample - fast;
    const midSample = sample - lowSample - highSample;
    low += lowSample * lowSample;
    mid += midSample * midSample;
    high += highSample * highSample;
  }

  const length = Math.max(1, end - start);
  return {
    low: Math.sqrt(low / length),
    mid: Math.sqrt(mid / length),
    high: Math.sqrt(high / length)
  };
}

function mergeChordEvents(events: AutoScoreChord[], beatDuration: number) {
  const merged: AutoScoreChord[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (previous && previous.name === event.name && Math.abs(previous.startSeconds + previous.durationSeconds - event.startSeconds) < beatDuration * 0.2) {
      previous.durationSeconds = round(previous.durationSeconds + event.durationSeconds);
      previous.confidence = round((previous.confidence + event.confidence) / 2, 1);
    } else {
      merged.push({ ...event });
    }
  }
  return merged;
}

function buildBars(result: Omit<AutoScoreResult, "bars">) {
  const meter = parseMeter(result.timeSignature);
  const beatDuration = 60 / result.bpm;
  const barDuration = beatDuration * meter.beats;
  const barCount = Math.max(1, Math.ceil(result.durationSeconds / barDuration));
  return Array.from({ length: barCount }, (_, index): AutoScoreBar => {
    const startSeconds = index * barDuration;
    const endSeconds = Math.min(result.durationSeconds, startSeconds + barDuration);
    return {
      index: index + 1,
      startSeconds: round(startSeconds),
      endSeconds: round(endSeconds),
      chords: result.chords.filter((chord) => chord.startSeconds < endSeconds && chord.startSeconds + chord.durationSeconds > startSeconds).map((chord) => chord.name),
      notes: result.notes.filter((note) => note.startSeconds >= startSeconds && note.startSeconds < endSeconds),
      drumHits: result.drumHits.filter((hit) => hit.startSeconds >= startSeconds && hit.startSeconds < endSeconds)
    };
  });
}

export function buildAutoScoreFromHarmony(input: AutoScoreHarmonyInput): AutoScoreResult {
  const bpm = clamp(Math.round(input.bpm), 40, 240);
  const target = input.targetInstrument;
  const chords = input.events
    .filter((event) => event.durationSeconds > 0 && event.startSeconds < input.durationSeconds)
    .map((event): AutoScoreChord => ({
      ...event,
      startSeconds: round(Math.max(0, event.startSeconds)),
      durationSeconds: round(Math.min(event.durationSeconds, input.durationSeconds - Math.max(0, event.startSeconds))),
      confidence: round(clamp(event.confidence, 0, 100), 1),
      pitches: chordPitches(event.root, event.quality, target, event.bass),
      ...(target === "guitar" ? { guitarFrets: guitarShape(event.name, event.root, event.quality) } : {})
    }));
  const notes: AutoScoreNote[] = target === "piano"
    ? chords.flatMap((chord) => chord.pitches.map((midi) => ({
        startSeconds: chord.startSeconds,
        durationSeconds: chord.durationSeconds,
        midi,
        noteName: midiName(midi),
        velocity: 82,
        confidence: chord.confidence
      })))
    : [];
  const baseResult: Omit<AutoScoreResult, "bars"> = {
    format: "songzu-auto-score",
    version: 1,
    analyzer: input.analyzer ?? (input.rhythm ? "songzu_harmony_v4" : "songzu_harmony_v2"),
    targetInstrument: target,
    bpm,
    musicalKey: input.musicalKey,
    timeSignature: input.timeSignature,
    durationSeconds: round(input.durationSeconds),
    confidence: round(clamp(input.confidence, 0, 100), 1),
    sourceProfile: input.sourceProfile,
    analysisMode: input.analysisMode ?? "cqt",
    harmonyAnalysis: input.harmonyAnalysis,
    rhythm: input.rhythm,
    notes,
    chords,
    drumHits: [],
    warnings: [
      "這是完整混音的本機和聲草稿；發布、演奏或交付樂手前仍需用耳朵逐段確認。",
      "系統以穩定 Bass 提出根音，再由吉他、鍵盤與其他和聲樂器決定和弦性質；原曲只作複核，轉位與衝突仍保留待確認。",
      "畫面百分比代表該段和聲證據的一致程度，不是實際正確率。",
      ...(input.warnings ?? [])
    ]
  };
  return { ...baseResult, bars: buildBars(baseResult) };
}

function likelyMixedAudio(chromaFrames: number[][], drumHits: AutoScoreDrumHit[], durationSeconds: number) {
  const persistentPercussion = drumHits.length > Math.max(8, durationSeconds * 0.32);
  if (!chromaFrames.length) return durationSeconds > 45 && persistentPercussion;
  const denseFrames = chromaFrames.filter((frame) => frame.filter((value) => value > 0.055).length >= 4).length;
  const denseRatio = denseFrames / chromaFrames.length;
  return persistentPercussion && (denseRatio > 0.14 || (durationSeconds > 45 && denseRatio > 0.08));
}

export async function analyzeAutoScorePcm(input: AutoScorePcmInput, options: AutoScoreAnalysisOptions): Promise<AutoScoreResult> {
  const bpm = clamp(Math.round(options.bpm || 120), 40, 240);
  const timeSignature = options.timeSignature || "4/4";
  const meter = parseMeter(timeSignature);
  const beatDuration = 60 / bpm;
  const durationSeconds = Math.max(0.1, input.durationSeconds);
  const beatCount = Math.max(1, Math.ceil(durationSeconds / beatDuration));
  const { samples, sampleRate } = input;
  const target = options.targetInstrument;
  const minMidi = target === "guitar" ? 40 : 36;
  const maxMidi = target === "guitar" ? 88 : 96;
  const rawChords: AutoScoreChord[] = [];
  const notes: AutoScoreNote[] = [];
  const chromaFrames: number[][] = [];
  const aggregateChroma = new Array<number>(12).fill(0);

  options.onProgress?.(0.04, "整理音訊與拍格");
  if (target !== "drums") {
    for (let beat = 0; beat < beatCount; beat += 1) {
      const startSeconds = beat * beatDuration;
      const analysisDuration = Math.min(beatDuration, Math.max(0.12, durationSeconds - startSeconds));
      const spectrum = spectralBeat(samples, sampleRate, startSeconds, analysisDuration, minMidi, maxMidi);
      const chord = identifyChord(spectrum.chroma, options.musicalKey);
      chromaFrames.push(spectrum.chroma);
      spectrum.chroma.forEach((value, index) => { aggregateChroma[index] += value; });

      const strongest = spectrum.powers
        .filter((entry) => entry.power > 0)
        .sort((left, right) => right.power - left.power)
        .filter((entry, index, all) => index === 0 || all.slice(0, index).every((candidate) => Math.abs(candidate.midi - entry.midi) > 1))
        .slice(0, target === "piano" ? 5 : 4);
      const maxPower = strongest[0]?.power || 1;
      for (const entry of strongest) {
        const confidence = clamp((entry.power / maxPower) * chord.confidence, 16, 96);
        if (confidence < 24) continue;
        notes.push({
          startSeconds: round(startSeconds),
          durationSeconds: round(Math.min(beatDuration * 0.92, durationSeconds - startSeconds)),
          midi: entry.midi,
          noteName: midiName(entry.midi),
          velocity: Math.round(clamp(45 + (entry.power / maxPower) * 70, 1, 127)),
          confidence: round(confidence, 1)
        });
      }

      if (beat % 8 === 0) {
        options.onProgress?.(0.08 + (beat / beatCount) * 0.56, "辨識音符與和弦");
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      }
    }

    const estimatedKey = options.musicalKey || (aggregateChroma.some(Boolean) ? estimateKey(aggregateChroma) : "待確認");
    const chordSpanBeats = durationSeconds > 20 ? 2 : 1;
    for (let beat = 0; beat < chromaFrames.length; beat += chordSpanBeats) {
      const grouped = new Array<number>(12).fill(0);
      const frames = chromaFrames.slice(beat, beat + chordSpanBeats);
      for (const frame of frames) frame.forEach((value, index) => { grouped[index] += value; });
      const total = grouped.reduce((sum, value) => sum + value, 0);
      if (total > 0) grouped.forEach((value, index) => { grouped[index] = value / total; });
      const chord = identifyChord(grouped, estimatedKey);
      const startSeconds = beat * beatDuration;
      const duration = Math.min(beatDuration * Math.max(1, frames.length), durationSeconds - startSeconds);
      rawChords.push({
        startSeconds: round(startSeconds),
        durationSeconds: round(duration),
        name: chord.name,
        root: chord.root,
        quality: chord.quality,
        confidence: chord.confidence,
        pitches: chordPitches(chord.root, chord.quality, target),
        ...(target === "guitar" ? { guitarFrets: guitarShape(chord.name, chord.root, chord.quality) } : {})
      });
    }
  }

  const drumHits: AutoScoreDrumHit[] = [];
  const stepDuration = beatDuration / 4;
  const stepCount = Math.max(1, Math.ceil(durationSeconds / stepDuration));
  const energies = Array.from({ length: stepCount }, (_, index) => frameBandEnergy(samples, sampleRate, index * stepDuration, Math.min(stepDuration, 0.1)));
  const average = energies.reduce(
    (sum, item) => ({ low: sum.low + item.low, mid: sum.mid + item.mid, high: sum.high + item.high }),
    { low: 0, mid: 0, high: 0 }
  );
  average.low /= stepCount;
  average.mid /= stepCount;
  average.high /= stepCount;

  energies.forEach((energy, index) => {
    const startSeconds = index * stepDuration;
    const previous = energies[Math.max(0, index - 1)] ?? energy;
    const lowRatio = energy.low / Math.max(0.00001, average.low);
    const midRatio = energy.mid / Math.max(0.00001, average.mid);
    const highRatio = energy.high / Math.max(0.00001, average.high);
    const lowAttack = energy.low / Math.max(0.00001, previous.low);
    const midAttack = energy.mid / Math.max(0.00001, previous.mid);
    const highAttack = energy.high / Math.max(0.00001, previous.high);
    const beatStep = index % 4;
    if (lowRatio > 1.18 && lowAttack > 1.03 && energy.low > energy.high * 0.48) {
      drumHits.push({ startSeconds: round(startSeconds), kind: "kick", velocity: Math.round(clamp(lowRatio * 58, 30, 127)), confidence: round(clamp(lowRatio * 42, 20, 96), 1) });
    }
    if (midRatio > 1.14 && midAttack > 1.05 && (index % (meter.beats * 4) === 4 || index % (meter.beats * 4) === 12 || midRatio > 1.62)) {
      drumHits.push({ startSeconds: round(startSeconds), kind: "snare", velocity: Math.round(clamp(midRatio * 52, 30, 127)), confidence: round(clamp(midRatio * 39, 20, 95), 1) });
    }
    if (highRatio > 0.94 && highAttack > 1.07 && (beatStep === 0 || beatStep === 2 || highRatio > 1.42)) {
      drumHits.push({ startSeconds: round(startSeconds), kind: "hihat", velocity: Math.round(clamp(highRatio * 48, 24, 118)), confidence: round(clamp(highRatio * 36, 18, 92), 1) });
    }
  });

  options.onProgress?.(0.75, "整理小節與演奏提示");
  const chords = target === "drums" ? [] : mergeChordEvents(rawChords, beatDuration);
  const estimatedKey = options.musicalKey || (aggregateChroma.some(Boolean) ? estimateKey(aggregateChroma) : "待確認");
  const mixed = options.sourceProfileHint === "mixed_audio"
    ? true
    : options.sourceProfileHint === "isolated_stem"
      ? false
      : likelyMixedAudio(chromaFrames, drumHits, durationSeconds);
  const evidence = target === "drums" ? drumHits.map((item) => item.confidence) : chords.map((item) => item.confidence);
  const baseConfidence = evidence.length ? evidence.reduce((sum, value) => sum + value, 0) / evidence.length : 25;
  const confidence = round(clamp(baseConfidence * (mixed ? 0.72 : 0.94), 18, 94), 1);
  const warnings = [
    "這是本機自動分析草譜，發布或演奏前請人工校對。",
    options.sourceProfileHint === "isolated_stem"
      ? "來源是已分離 Stem；其他樂器干擾較少，但分軌殘留與瞬態誤判仍需人工校對。"
      : mixed
      ? "偵測到混合音訊特徵；鼓、人聲與殘響可能互相干擾，可信度已自動下修。"
      : "音訊較接近單一樂器，仍可能漏掉裝飾音、轉位或延音。",
    target === "guitar"
      ? "吉他指法是依和弦名稱配置的建議位置，不保證與原演奏把位完全相同。"
      : target === "piano"
        ? "鋼琴譜會保留主要音高與和聲，左右手分配仍需要演奏者確認。"
        : options.sourceProfileHint === "isolated_stem"
          ? "鼓譜依低、中、高頻瞬態判讀；分軌殘留、疊擊與細微鈸聲仍可能漏判。"
          : "鼓譜依低、中、高頻瞬態判讀；混音成品可能把 Bass 或銅鈸誤認為鼓點。"
  ];
  const baseResult: Omit<AutoScoreResult, "bars"> = {
    format: "songzu-auto-score",
    version: 1,
    analyzer: "songzu_local_dsp_v1",
    targetInstrument: target,
    bpm,
    musicalKey: estimatedKey,
    timeSignature,
    durationSeconds: round(durationSeconds),
    confidence,
    sourceProfile: mixed ? "mixed_audio" : "single_instrument",
    analysisMode: "quick_dsp",
    notes,
    chords,
    drumHits,
    warnings
  };

  options.onProgress?.(1, "草譜完成");
  return { ...baseResult, bars: buildBars(baseResult) };
}

export async function analyzeAutoScoreBuffer(buffer: AudioBuffer, options: AutoScoreAnalysisOptions): Promise<AutoScoreResult> {
  return analyzeAutoScorePcm(prepareAutoScorePcm(buffer), options);
}

export function updateAutoScoreChord(result: AutoScoreResult, chordIndex: number, nextName: string) {
  const normalizedName = nextName.trim();
  const match = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/.exec(normalizedName);
  if (!match) return result;
  const root = match[1];
  const quality = match[2] ?? "";
  const bass = match[3] ?? null;
  const target = result.targetInstrument;
  const chords = result.chords.map((chord, index) =>
    index === chordIndex
      ? {
          ...chord,
          name: normalizedName,
          root,
          quality,
          bass,
          pitches: chordPitches(root, quality, target, bass),
          confidence: 100,
          reviewStatus: "confirmed" as const,
          alternateNames: [],
          ...(target === "guitar" ? { guitarFrets: guitarShape(normalizedName, root, quality) } : {})
        }
      : chord
  );
  const next = { ...result, chords };
  return { ...next, bars: buildBars(next) };
}

function mergeManualChordEvents(events: AutoScoreChord[]) {
  const merged: AutoScoreChord[] = [];
  for (const event of [...events].sort((left, right) => left.startSeconds - right.startSeconds)) {
    if (event.durationSeconds <= 0.01) continue;
    const previous = merged.at(-1);
    const sameReview = previous?.reviewStatus === event.reviewStatus;
    const sameAlternates = JSON.stringify(previous?.alternateNames ?? []) === JSON.stringify(event.alternateNames ?? []);
    if (
      previous &&
      previous.name === event.name &&
      sameReview &&
      previous.confidence === event.confidence &&
      sameAlternates &&
      Math.abs(previous.startSeconds + previous.durationSeconds - event.startSeconds) <= 0.02
    ) {
      previous.durationSeconds = round(previous.durationSeconds + event.durationSeconds);
    } else {
      merged.push({ ...event });
    }
  }
  return merged;
}

export function updateAutoScoreBeatChord(
  result: AutoScoreResult,
  beatStartSeconds: number,
  beatEndSeconds: number,
  nextName: string
) {
  const startSeconds = round(clamp(beatStartSeconds, 0, result.durationSeconds));
  const endSeconds = round(clamp(beatEndSeconds, startSeconds, result.durationSeconds));
  if (endSeconds - startSeconds <= 0.04) return result;

  const normalizedName = nextName.trim();
  const noChord = normalizedName === "N.C." || normalizedName.toUpperCase() === "NC";
  const match = noChord
    ? null
    : /^([A-G](?:#|b)?)(|m|min|maj|dim|aug|sus2|sus4|add2|add4|add6|add9|add11|add13|6|6\/9|7|9|11|13|maj6|maj7|maj9|maj11|maj13|m6|m7|m9|mMaj7|m11|m13|m7b5|dim7|aug7|7sus2|7sus4)?(?:\/([A-G](?:#|b)?))?$/i.exec(normalizedName);
  if (!noChord && !match) return result;

  const chords: AutoScoreChord[] = [];
  for (const chord of result.chords) {
    const chordStart = chord.startSeconds;
    const chordEnd = chord.startSeconds + chord.durationSeconds;
    if (chordEnd <= startSeconds + 0.01 || chordStart >= endSeconds - 0.01) {
      chords.push({ ...chord });
      continue;
    }
    if (chordStart < startSeconds - 0.01) {
      chords.push({ ...chord, durationSeconds: round(startSeconds - chordStart) });
    }
    if (chordEnd > endSeconds + 0.01) {
      chords.push({ ...chord, startSeconds: endSeconds, durationSeconds: round(chordEnd - endSeconds) });
    }
  }

  if (match) {
    const root = `${match[1][0].toUpperCase()}${match[1].slice(1)}`;
    const quality = (match[2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, "");
    const bass = match[3] ? `${match[3][0].toUpperCase()}${match[3].slice(1)}` : null;
    const canonicalName = `${root}${quality}${bass ? `/${bass}` : ""}`;
    chords.push({
      startSeconds,
      durationSeconds: round(endSeconds - startSeconds),
      name: canonicalName,
      root,
      quality,
      bass,
      confidence: 100,
      reviewStatus: "confirmed",
      alternateNames: [],
      pitches: chordPitches(root, quality, result.targetInstrument, bass),
      ...(result.targetInstrument === "guitar" ? { guitarFrets: guitarShape(canonicalName, root, quality) } : {})
    });
  }

  const beatConfirmations = [
    ...(result.beatConfirmations ?? []).filter((confirmation) =>
      confirmation.endSeconds <= startSeconds + 0.01 || confirmation.startSeconds >= endSeconds - 0.01
    ),
    { startSeconds, endSeconds, name: noChord ? "N.C." : chords.find((chord) => chord.startSeconds === startSeconds && chord.durationSeconds === round(endSeconds - startSeconds))?.name ?? normalizedName }
  ].sort((left, right) => left.startSeconds - right.startSeconds);
  const previousVerification = result.verification;
  const verification = previousVerification ? {
    ...previousVerification,
    status: "triangulated_review" as const,
    systemConfirmed: false,
    chordVerification: undefined
  } : undefined;
  const next = {
    ...result,
    chords: mergeManualChordEvents(chords),
    beatConfirmations,
    ...(verification ? { verification } : {}),
    ...(result.review ? { review: { status: "in_progress" as const, revision: result.review.revision } } : {})
  };
  return { ...next, bars: buildBars(next) };
}

export function updateAutoScoreReviewBeatChord(
  result: AutoScoreResult,
  beat: AutoScoreReviewBeat,
  nextName: string,
  updatedBy = "本機創作者"
) {
  if (!beat.insertionId) {
    const updated = updateAutoScoreBeatChord(result, beat.startSeconds, beat.endSeconds, nextName);
    if (updated === result) return result;
    const updatedBeat = autoScoreReviewableMeasures(updated)
      .flatMap((measure) => measure.beats)
      .find((candidate) => candidate.id === beat.id);
    return updatedBeat ? setAutoScoreBeatConfirmation(updated, updatedBeat, true) : updated;
  }

  const normalizedName = nextName.trim();
  const noChord = normalizedName === "N.C." || normalizedName.toUpperCase() === "NC";
  const match = noChord
    ? null
    : /^([A-G](?:#|b)?)(|m|min|maj|dim|aug|sus2|sus4|add2|add4|add6|add9|add11|add13|6|6\/9|7|9|11|13|maj6|maj7|maj9|maj11|maj13|m6|m7|m9|mMaj7|m11|m13|m7b5|dim7|aug7|7sus2|7sus4)?(?:\/([A-G](?:#|b)?))?$/i.exec(normalizedName);
  if (!noChord && !match) return result;
  const canonicalName = noChord
    ? "N.C."
    : `${match![1][0].toUpperCase()}${match![1].slice(1)}${(match![2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, "")}${match![3] ? `/${match![3][0].toUpperCase()}${match![3].slice(1)}` : ""}`;
  const insertion = result.sheetArrangement?.insertions.find((item) => item.id === beat.insertionId);
  if (!insertion || beat.beat < 1 || beat.beat > insertion.beats.length) return result;

  const now = new Date().toISOString();
  const insertions = (result.sheetArrangement?.insertions ?? []).map((item) => item.id === insertion.id
    ? { ...item, beats: item.beats.map((name, index) => index === beat.beat - 1 ? canonicalName : name) }
    : item
  );
  const beatConfirmations = (result.beatConfirmations ?? []).filter((confirmation) => confirmation.beatId !== beat.id);
  const previousVerification = result.verification;
  const next: AutoScoreResult = {
    ...result,
    beatConfirmations,
    sheetArrangement: {
      version: 1,
      updatedAt: now,
      updatedBy,
      insertions,
      deletions: result.sheetArrangement?.deletions ?? []
    },
    ...(previousVerification ? {
      verification: {
        ...previousVerification,
        status: "triangulated_review",
        systemConfirmed: false,
        chordVerification: undefined
      }
    } : {}),
    ...(result.review ? { review: { status: "in_progress", revision: result.review.revision } } : {})
  };
  const updatedBeat = autoScoreReviewableMeasures(next)
    .flatMap((measure) => measure.beats)
    .find((candidate) => candidate.id === beat.id);
  return updatedBeat ? setAutoScoreBeatConfirmation(next, updatedBeat, true) : next;
}

function reviewChordAt(result: AutoScoreResult, seconds: number) {
  const probe = seconds + 0.04;
  return result.chords.find((chord) => chord.startSeconds <= probe && chord.startSeconds + chord.durationSeconds > probe);
}

export function autoScoreReviewMeasures(result: AutoScoreResult): AutoScoreReviewMeasure[] {
  const beatCount = parseMeter(result.timeSignature).beats;
  const rhythm = result.rhythm;
  const downbeats = rhythm?.downbeatTimesSeconds.filter((time) => time >= rhythm.firstDownbeatSeconds - 0.05) ?? [];

  if (rhythm?.beatTimesSeconds.length && downbeats.length) {
    return downbeats.map((measureStart, measureIndex) => {
      const measureEnd = downbeats[measureIndex + 1] ?? result.durationSeconds;
      const detectedBeats = rhythm.beatTimesSeconds
        .filter((time) => time >= measureStart - 0.05 && time < measureEnd - 0.05)
        .slice(0, beatCount);
      const beats = Array.from({ length: beatCount }, (_, beatIndex): AutoScoreReviewBeat => {
        const fallback = measureStart + ((measureEnd - measureStart) * beatIndex) / beatCount;
        const startSeconds = detectedBeats[beatIndex] ?? fallback;
        const endSeconds = Math.max(startSeconds + 0.05, detectedBeats[beatIndex + 1] ?? measureEnd);
        return {
          id: `source:${measureIndex + 1}:${beatIndex + 1}`,
          measure: measureIndex + 1,
          beat: beatIndex + 1,
          startSeconds,
          endSeconds,
          name: reviewChordAt(result, startSeconds)?.name ?? "N.C.",
          sourceMeasure: measureIndex + 1,
          notationOnly: false
        };
      });
      return {
        number: measureIndex + 1,
        sourceMeasure: measureIndex + 1,
        startSeconds: measureStart,
        endSeconds: measureEnd,
        beats,
        inserted: false,
        notationOnly: false
      };
    });
  }

  return result.bars.map((bar) => {
    const beats = Array.from({ length: beatCount }, (_, beatIndex): AutoScoreReviewBeat => {
      const beatDuration = Math.max(0.05, (bar.endSeconds - bar.startSeconds) / beatCount);
      const startSeconds = bar.startSeconds + beatDuration * beatIndex;
      const endSeconds = beatIndex === beatCount - 1 ? bar.endSeconds : startSeconds + beatDuration;
      return {
        id: `source:${bar.index}:${beatIndex + 1}`,
        measure: bar.index,
        beat: beatIndex + 1,
        startSeconds,
        endSeconds,
        name: reviewChordAt(result, startSeconds)?.name ?? "N.C.",
        sourceMeasure: bar.index,
        notationOnly: false
      };
    });
    return {
      number: bar.index,
      sourceMeasure: bar.index,
      startSeconds: bar.startSeconds,
      endSeconds: bar.endSeconds,
      beats,
      inserted: false,
      notationOnly: false
    };
  });
}

export function autoScoreSheetTokens(beats: string[]) {
  return beats.map((name, index) => index > 0 && name === beats[index - 1] ? "_" : name);
}

function autoScoreFormalReviewSections(result: AutoScoreResult) {
  const sourceMeasures = autoScoreReviewMeasures(result);
  if (!sourceMeasures.length) return [];
  const beatCount = parseMeter(result.timeSignature).beats;
  const sectionSource = result.sectionMap?.length ? result.sectionMap : [{
    label: "全曲",
    firstMeasure: sourceMeasures[0].number,
    lastMeasure: sourceMeasures.at(-1)!.number,
    startSeconds: sourceMeasures[0].startSeconds,
    endSeconds: sourceMeasures.at(-1)!.endSeconds
  }];
  const insertions = [...(result.sheetArrangement?.insertions ?? [])]
    .filter((insertion) => insertion.type === "insert_measure" && insertion.beats.length > 0)
    .sort((left, right) => left.beforeSourceMeasure - right.beforeSourceMeasure || left.insertedAt.localeCompare(right.insertedAt));
  const deletedSourceMeasures = new Set(
    (result.sheetArrangement?.deletions ?? [])
      .filter((deletion) => deletion.type === "delete_measure")
      .map((deletion) => deletion.sourceMeasure)
  );
  let displayMeasure = 1;

  return sectionSource.flatMap((section) => {
    const measures: AutoScoreReviewMeasure[] = [];
    const appendInsertion = (insertion: AutoScoreSheetInsertion, anchorSeconds: number) => {
      const beats = Array.from({ length: beatCount }, (_, index) => insertion.beats[index] ?? insertion.beats.at(-1) ?? "N.C.");
      const number = displayMeasure++;
      measures.push({
        number,
        sourceMeasure: null,
        startSeconds: anchorSeconds,
        endSeconds: anchorSeconds,
        beats: beats.map((name, index) => ({
          id: `insertion:${insertion.id}:${index + 1}`,
          measure: number,
          beat: index + 1,
          startSeconds: anchorSeconds,
          endSeconds: anchorSeconds,
          name,
          sourceMeasure: null,
          insertionId: insertion.id,
          notationOnly: true
        })),
        inserted: true,
        insertionId: insertion.id,
        sectionLabel: section.label,
        notationOnly: true
      });
    };
    const sectionMeasures = sourceMeasures.filter((measure) => measure.number >= section.firstMeasure && measure.number <= section.lastMeasure);
    for (const measure of sectionMeasures) {
      for (const insertion of insertions.filter((item) => item.beforeSourceMeasure === measure.number)) {
        appendInsertion(insertion, measure.startSeconds);
      }
      if (deletedSourceMeasures.has(measure.number)) continue;
      const number = displayMeasure++;
      measures.push({
        number,
        sourceMeasure: measure.number,
        startSeconds: measure.startSeconds,
        endSeconds: measure.endSeconds,
        beats: measure.beats.map((beat) => ({
          ...beat,
          measure: number,
          sourceMeasure: measure.number,
          notationOnly: false
        })),
        inserted: false,
        sectionLabel: section.label,
        notationOnly: false
      });
    }
    if (!measures.length) return [];
    return [{
      label: section.label,
      firstMeasure: measures[0].number,
      lastMeasure: measures.at(-1)!.number,
      measures
    }];
  });
}

export function autoScoreReviewableMeasures(result: AutoScoreResult): AutoScoreReviewMeasure[] {
  return autoScoreFormalReviewSections(result).flatMap((section) => section.measures);
}

export function autoScoreSheetSections(result: AutoScoreResult): AutoScoreSheetSection[] {
  return autoScoreFormalReviewSections(result).map((section) => ({
    label: section.label,
    firstMeasure: section.firstMeasure,
    lastMeasure: section.lastMeasure,
    measures: section.measures.map((measure) => ({
      number: measure.number,
      sourceMeasure: measure.sourceMeasure,
      beats: measure.beats.map((beat) => beat.name),
      inserted: measure.inserted,
      ...(measure.insertionId ? { insertionId: measure.insertionId } : {}),
      ...(measure.insertionId
        ? { insertedBy: result.sheetArrangement?.insertions.find((item) => item.id === measure.insertionId)?.insertedBy }
        : {})
    }))
  }));
}

export function isAutoScoreBeatExplicitlyConfirmed(result: AutoScoreResult, beat: AutoScoreReviewBeat) {
  return Boolean(result.beatConfirmations?.some((confirmation) => {
    if (confirmation.beatId) return confirmation.beatId === beat.id && confirmation.name === beat.name;
    if (beat.notationOnly) return false;
    return Math.abs(confirmation.startSeconds - beat.startSeconds) <= 0.06 &&
      Math.abs(confirmation.endSeconds - beat.endSeconds) <= 0.08 &&
      confirmation.name === beat.name;
  }));
}

export function setAutoScoreBeatConfirmation(
  result: AutoScoreResult,
  beat: AutoScoreReviewBeat,
  confirmed: boolean
) {
  const startSeconds = round(clamp(beat.startSeconds, 0, result.durationSeconds));
  const endSeconds = round(clamp(beat.endSeconds, startSeconds, result.durationSeconds));
  if (!beat.notationOnly && endSeconds - startSeconds <= 0.04) return result;

  const name = beat.name;
  const retained = (result.beatConfirmations ?? []).filter((confirmation) => {
    if (confirmation.beatId) return confirmation.beatId !== beat.id;
    if (beat.notationOnly) return true;
    return !(
      Math.abs(confirmation.startSeconds - startSeconds) <= 0.06 &&
      Math.abs(confirmation.endSeconds - endSeconds) <= 0.08
    );
  });
  const beatConfirmations = confirmed
    ? [...retained, { beatId: beat.id, startSeconds, endSeconds, name }].sort((left, right) =>
        left.startSeconds - right.startSeconds || String(left.beatId ?? "").localeCompare(String(right.beatId ?? ""))
      )
    : retained;
  const unchanged = JSON.stringify(result.beatConfirmations ?? []) === JSON.stringify(beatConfirmations);
  if (unchanged) return result;

  const previousVerification = result.verification;
  return {
    ...result,
    beatConfirmations,
    ...(previousVerification ? {
      verification: {
        ...previousVerification,
        status: "triangulated_review" as const,
        systemConfirmed: false,
        chordVerification: undefined
      }
    } : {}),
    ...(result.review ? { review: { status: "in_progress" as const, revision: result.review.revision } } : {})
  };
}

export function autoScoreReviewProgress(result: AutoScoreResult) {
  const beats = autoScoreReviewableMeasures(result).flatMap((measure) => measure.beats);
  return {
    total: beats.length,
    confirmed: beats.filter((beat) => isAutoScoreBeatExplicitlyConfirmed(result, beat)).length
  };
}

const REFERENCE_CHORD_PATTERN = /^([A-G](?:#|b)?)(|m|min|maj|dim|aug|sus2|sus4|add2|add4|add6|add9|add11|add13|6|6\/9|7|9|11|13|maj6|maj7|maj9|maj11|maj13|m6|m7|m9|mMaj7|m11|m13|m7b5|dim7|aug7|7sus2|7sus4)?(?:\/([A-G](?:#|b)?))?$/i;

function normalizeReferenceChord(value: string) {
  const trimmed = value.trim();
  if (trimmed === "N.C." || trimmed.toUpperCase() === "NC") return "N.C.";
  const match = REFERENCE_CHORD_PATTERN.exec(trimmed);
  if (!match) return null;
  const root = `${match[1][0].toUpperCase()}${match[1].slice(1)}`;
  const quality = (match[2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, "");
  const bass = match[3] ? `${match[3][0].toUpperCase()}${match[3].slice(1)}` : "";
  return `${root}${quality}${bass ? `/${bass}` : ""}`;
}

function benchmarkEngineId(source: string) {
  if (source.startsWith("cqt_")) return "songzu_harmony_v2";
  if (source.startsWith("madmom_crf_")) return "madmom_cnn_crf";
  if (source === "btc_long_context") return "btc_ismir19";
  if (source === "basic_pitch_notes") return "basic_pitch";
  if (source === "bass_root_anchor" || source === "tony_root_first_consensus") return "bass_root_anchor";
  if (source === "tony_confirmed_prior") return "tony_confirmed_prior";
  return source;
}

function benchmarkChordParts(value: string) {
  const normalized = normalizeReferenceChord(value);
  if (!normalized || normalized === "N.C.") {
    return { normalized: "N.C.", noChord: true, root: null, quality: null, bass: null };
  }
  const match = REFERENCE_CHORD_PATTERN.exec(normalized);
  if (!match) return { normalized, noChord: false, root: null, quality: null, bass: null };
  const pitchIdentity = (note: string | undefined) => {
    if (!note) return null;
    const flatToSharp: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
    return flatToSharp[note] ?? note;
  };
  return {
    normalized,
    noChord: false,
    root: pitchIdentity(match[1]),
    quality: (match[2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, ""),
    bass: pitchIdentity(match[3])
  };
}

function benchmarkMetric(correct: number, total: number): AutoScoreBenchmarkMetric {
  return { correct, total, accuracy: total ? Math.round(correct / total * 10_000) / 10_000 : null };
}

export function createAutoScoreBenchmarkBaseline(result: AutoScoreResult): AutoScoreBenchmarkBaseline {
  const beats = autoScoreReviewMeasures(result).flatMap((measure) => measure.beats.map((beat) => {
    const chord = reviewChordAt(result, beat.startSeconds);
    const evidenceByEngine = new Map<string, AutoScoreBenchmarkEvidencePrediction>();
    for (const item of [...(chord?.evidence ?? [])]
      .filter((item) => item.name && item.support !== "neutral")
      .sort((left, right) => right.weight - left.weight)) {
      const engineId = benchmarkEngineId(item.source);
      if (!evidenceByEngine.has(engineId)) evidenceByEngine.set(engineId, { engineId, source: item.source, name: item.name });
    }
    return {
      measure: measure.number,
      beat: beat.beat,
      startSeconds: beat.startSeconds,
      endSeconds: beat.endSeconds,
      name: beat.name,
      evidence: [
        { engineId: result.analyzer, source: "pipeline_decision", name: beat.name },
        ...evidenceByEngine.values()
      ]
    };
  }));
  return {
    standard: "songzu_human_benchmark_baseline_v1",
    pipelineVersion: result.analyzer,
    capturedAt: new Date().toISOString(),
    beats
  };
}

export function withAutoScoreBenchmarkBaseline(result: AutoScoreResult): AutoScoreResult {
  return result.benchmarkBaseline ? result : { ...result, benchmarkBaseline: createAutoScoreBenchmarkBaseline(result) };
}

export function buildAutoScoreHumanBenchmark(result: AutoScoreResult): AutoScoreHumanBenchmark | null {
  const baseline = result.benchmarkBaseline;
  if (!baseline?.beats.length) return null;
  const confirmedBeats = autoScoreReviewMeasures(result).flatMap((measure) => measure.beats);
  const pairs = baseline.beats.flatMap((predicted) => {
    const expected = confirmedBeats.find((beat) =>
      Math.abs(beat.startSeconds - predicted.startSeconds) <= 0.08 &&
      Math.abs(beat.endSeconds - predicted.endSeconds) <= 0.12
    );
    return expected ? [{ predicted, expected }] : [];
  });
  if (!pairs.length) return null;

  let exactChordCorrect = 0;
  let rootCorrect = 0;
  let rootTotal = 0;
  let qualityCorrect = 0;
  let qualityTotal = 0;
  let inversionCorrect = 0;
  let inversionTotal = 0;
  let noChordCorrect = 0;
  let boundaryCorrect = 0;
  let boundaryTotal = 0;
  const engineCounters = new Map<string, {
    sampleCount: number;
    exactCorrect: number;
    rootCorrect: number;
    rootTotal: number;
    qualityCorrect: number;
    qualityTotal: number;
  }>();

  for (let index = 0; index < pairs.length; index += 1) {
    const { predicted, expected } = pairs[index];
    const predictedParts = benchmarkChordParts(predicted.name);
    const expectedParts = benchmarkChordParts(expected.name);
    if (predictedParts.normalized === expectedParts.normalized) exactChordCorrect += 1;
    if (!expectedParts.noChord) {
      rootTotal += 1;
      qualityTotal += 1;
      if (predictedParts.root === expectedParts.root) rootCorrect += 1;
      if (predictedParts.quality === expectedParts.quality) qualityCorrect += 1;
    }
    if (predictedParts.bass || expectedParts.bass) {
      inversionTotal += 1;
      if (predictedParts.bass === expectedParts.bass && predictedParts.root === expectedParts.root) inversionCorrect += 1;
    }
    if (predictedParts.noChord === expectedParts.noChord) noChordCorrect += 1;
    if (index > 0) {
      const previous = pairs[index - 1];
      const predictedChanged = benchmarkChordParts(previous.predicted.name).normalized !== predictedParts.normalized;
      const expectedChanged = benchmarkChordParts(previous.expected.name).normalized !== expectedParts.normalized;
      boundaryTotal += 1;
      if (predictedChanged === expectedChanged) boundaryCorrect += 1;
    }

    for (const evidence of predicted.evidence) {
      const counters = engineCounters.get(evidence.engineId) ?? {
        sampleCount: 0,
        exactCorrect: 0,
        rootCorrect: 0,
        rootTotal: 0,
        qualityCorrect: 0,
        qualityTotal: 0
      };
      const evidenceParts = benchmarkChordParts(evidence.name);
      counters.sampleCount += 1;
      if (evidenceParts.normalized === expectedParts.normalized) counters.exactCorrect += 1;
      if (!expectedParts.noChord) {
        counters.rootTotal += 1;
        counters.qualityTotal += 1;
        if (evidenceParts.root === expectedParts.root) counters.rootCorrect += 1;
        if (evidenceParts.quality === expectedParts.quality) counters.qualityCorrect += 1;
      }
      engineCounters.set(evidence.engineId, counters);
    }
  }

  return {
    standard: "songzu_human_benchmark_v1",
    pipelineVersion: baseline.pipelineVersion,
    benchmarkedAt: new Date().toISOString(),
    beatCount: pairs.length,
    metrics: {
      exactChord: benchmarkMetric(exactChordCorrect, pairs.length),
      root: benchmarkMetric(rootCorrect, rootTotal),
      quality: benchmarkMetric(qualityCorrect, qualityTotal),
      inversion: benchmarkMetric(inversionCorrect, inversionTotal),
      noChord: benchmarkMetric(noChordCorrect, pairs.length),
      boundary: benchmarkMetric(boundaryCorrect, boundaryTotal)
    },
    engines: [...engineCounters.entries()]
      .map(([engineId, counters]) => ({
        engineId,
        sampleCount: counters.sampleCount,
        exactChord: benchmarkMetric(counters.exactCorrect, counters.sampleCount),
        root: benchmarkMetric(counters.rootCorrect, counters.rootTotal),
        quality: benchmarkMetric(counters.qualityCorrect, counters.qualityTotal)
      }))
      .sort((left, right) => right.sampleCount - left.sampleCount)
  };
}

export function parseAutoScoreReferenceChart(chart: string, beatsPerBar: number) {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 16) {
    throw new Error("拍號無法用於授權譜逐拍校對。");
  }
  const pipeMeasures = [...chart.matchAll(/\|([^|]*)\|/g)].map((match) => match[1].trim());
  const rawMeasures = pipeMeasures.length
    ? pipeMeasures
    : chart.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("//") && !line.startsWith(";"));
  if (!rawMeasures.length) throw new Error("請輸入至少一小節，例如：| D _ Bm _ |");

  const measures: string[][] = [];
  let previousChord: string | null = null;
  rawMeasures.forEach((rawMeasure, measureIndex) => {
    const withoutNumber = rawMeasure.replace(/^\s*\d+\s*[:.)-]\s*/, "");
    const tokens = withoutNumber.split(/[\s,]+/).filter(Boolean);
    if (tokens.length !== beatsPerBar) {
      throw new Error(`第 ${measureIndex + 1} 小節需要 ${beatsPerBar} 拍，目前有 ${tokens.length} 格。`);
    }
    const beats = tokens.map((token, beatIndex) => {
      if (token === "_" || token === "-") {
        if (!previousChord) throw new Error(`第 ${measureIndex + 1} 小節第 ${beatIndex + 1} 拍沒有可延續的前一個和弦。`);
        return previousChord;
      }
      const normalized = normalizeReferenceChord(token);
      if (!normalized) throw new Error(`第 ${measureIndex + 1} 小節第 ${beatIndex + 1} 拍不是可辨識的和弦：${token}`);
      previousChord = normalized;
      return normalized;
    });
    measures.push(beats);
  });
  return measures;
}

function parsedReferenceChord(name: string) {
  const normalized = normalizeReferenceChord(name);
  if (!normalized || normalized === "N.C.") return null;
  const match = REFERENCE_CHORD_PATTERN.exec(normalized);
  if (!match) return null;
  return {
    name: normalized,
    root: `${match[1][0].toUpperCase()}${match[1].slice(1)}`,
    quality: (match[2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, ""),
    bass: match[3] ? `${match[3][0].toUpperCase()}${match[3].slice(1)}` : null
  };
}

function chordIntervalsForQuality(quality: string) {
  return CHORD_TEMPLATES.find((template) => template.quality === quality)?.intervals ?? (
    quality.startsWith("dim") ? [0, 3, 6] :
      quality.startsWith("aug") ? [0, 4, 8] :
        quality.startsWith("sus2") || quality.endsWith("sus2") ? [0, 2, 7] :
          quality.startsWith("sus4") || quality.endsWith("sus4") ? [0, 5, 7] :
            quality.startsWith("m") && !quality.startsWith("maj") ? [0, 3, 7] : [0, 4, 7]
  );
}

function publicReferenceGuidedChordName(current: AutoScoreChord | undefined, expectedName: string) {
  const expected = parsedReferenceChord(expectedName);
  if (!expected) return "N.C.";
  if (expected.bass) return expected.name;

  const bass = current?.isolatedBassEvidence &&
    (current.bassPitchConfidence ?? 0) >= 80 &&
    (current.bassPitchStability ?? 0) >= 0.75
    ? current.bassPitch
    : null;
  if (!bass || bass === expected.root) return `${expected.root}${expected.quality}`;

  const rootPitchClass = pitchClassIndex(expected.root);
  const bassPitchClass = pitchClassIndex(bass);
  const chordPitchClasses = new Set(
    chordIntervalsForQuality(expected.quality).map((interval) => (rootPitchClass + interval) % 12)
  );
  return bassPitchClass >= 0 && chordPitchClasses.has(bassPitchClass)
    ? `${expected.root}${expected.quality}/${bass}`
    : `${expected.root}${expected.quality}`;
}

function applyPublicReferenceStructure(
  result: AutoScoreResult,
  referenceMeasures: string[][],
  startMeasure: number,
  sourceTitle: string
) {
  const measures = autoScoreReviewableMeasures(result);
  const guidedBeats = measures.flatMap((measure) => measure.beats.map((beat) => {
    const referenceIndex = measure.number - startMeasure;
    const expectedName = referenceMeasures[referenceIndex]?.[beat.beat - 1];
    const current = reviewChordAt(result, beat.startSeconds);
    const manuallyConfirmed = isAutoScoreBeatExplicitlyConfirmed(result, beat);
    const name = expectedName && !manuallyConfirmed
      ? publicReferenceGuidedChordName(current, expectedName)
      : current?.name ?? "N.C.";
    return {
      beat,
      current,
      name,
      expectedName: expectedName ?? null,
      manuallyConfirmed,
      tailContinuation: false
    };
  }));
  if (!guidedBeats.length) return result;

  for (let index = 1; index < guidedBeats.length - 1; index += 1) {
    const previous = guidedBeats[index - 1];
    const current = guidedBeats[index];
    const next = guidedBeats[index + 1];
    const previousFormal = parsedReferenceChord(previous.name);
    const activePitchClasses = current.current?.notePitchClasses
      ?.filter((value) => value >= 0.04).length ?? 12;
    const stableBass = (current.current?.bassPitchConfidence ?? 0) >= 80 &&
      (current.current?.bassPitchStability ?? 0) >= 0.75
      ? current.current?.bassPitch
      : null;
    if (
      !current.expectedName &&
      previous.expectedName &&
      !current.manuallyConfirmed &&
      activePitchClasses <= 1 &&
      stableBass === previousFormal?.root &&
      (next.current?.name === "N.C." || !next.current)
    ) {
      current.name = previous.name;
      current.tailContinuation = true;
    }
  }

  const firstBeatStart = guidedBeats[0].beat.startSeconds;
  const preRoll = result.chords
    .filter((chord) => chord.startSeconds + chord.durationSeconds <= firstBeatStart + 0.01)
    .map((chord) => ({ ...chord }));
  const chords: AutoScoreChord[] = [...preRoll];
  let index = 0;
  while (index < guidedBeats.length) {
    const first = guidedBeats[index];
    let endIndex = index + 1;
    while (
      endIndex < guidedBeats.length &&
      guidedBeats[endIndex].name === first.name &&
      guidedBeats[endIndex].current === first.current &&
      Math.abs(guidedBeats[endIndex - 1].beat.endSeconds - guidedBeats[endIndex].beat.startSeconds) <= 0.06
    ) endIndex += 1;

    const endSeconds = guidedBeats[endIndex - 1].beat.endSeconds;
    const formal = parsedReferenceChord(first.name);
    const current = first.current;
    const changed = Boolean(current && current.name !== first.name);
    const currentFormal = current ? parsedReferenceChord(current.name) : null;
    const referenceFormal = first.expectedName ? parsedReferenceChord(first.expectedName) : null;
    const rootConflict = Boolean(currentFormal && referenceFormal && currentFormal.root !== referenceFormal.root);
    const referenceEvidence: AutoScoreChordEvidence | null = (first.expectedName || first.tailContinuation) && !first.manuallyConfirmed ? {
      source: first.tailContinuation ? "sparse_tail_harmonic_hold" : "public_reference_structure",
      name: first.name,
      confidence: first.tailContinuation ? 76 : rootConflict ? 58 : 72,
      weight: first.tailContinuation ? 0.46 : 0.32,
      support: "supports",
      detail: first.tailContinuation
        ? "下一拍進入 N.C.；本拍只有單一延音，穩定 Bass 仍落在前一結構和弦根音"
        : `${sourceTitle}只錨定正式譜骨架；音訊色彩與 Bass 證據仍保留待人工複核`
    } : null;

    if (formal) {
      const acousticNames = changed && current
        ? [current.name, current.acousticDetailName, ...(current.alternateNames ?? [])].filter((name): name is string => Boolean(name))
        : current?.alternateNames ?? [];
      chords.push({
        ...(current ?? {
          confidence: 50,
          pitches: []
        }),
        startSeconds: round(first.beat.startSeconds),
        durationSeconds: round(endSeconds - first.beat.startSeconds),
        name: first.name,
        root: formal.root,
        quality: formal.quality,
        bass: formal.bass,
        reviewStatus: changed ? "review" : current?.reviewStatus,
        alternateNames: [...new Set(acousticNames)].filter((name) => name !== first.name).slice(0, 4),
        ...(changed && current ? { acousticDetailName: current.name } : {}),
        ...(changed ? { structuralDecision: "context_consensus" as const } : {}),
        ...(rootConflict ? { evidenceConflict: true } : {}),
        evidence: referenceEvidence ? [...(current?.evidence ?? []), referenceEvidence] : current?.evidence,
        pitches: chordPitches(formal.root, formal.quality, result.targetInstrument, formal.bass),
        ...(result.targetInstrument === "guitar" ? { guitarFrets: guitarShape(first.name, formal.root, formal.quality) } : {})
      });
    } else {
      chords.push({
        ...(current ?? { confidence: 50, pitches: [] }),
        startSeconds: round(first.beat.startSeconds),
        durationSeconds: round(endSeconds - first.beat.startSeconds),
        name: "N.C.",
        root: "N.C.",
        quality: "none",
        bass: null,
        reviewStatus: changed ? "review" : current?.reviewStatus,
        ...(changed && current ? { acousticDetailName: current.name, structuralDecision: "context_consensus" as const } : {}),
        evidence: referenceEvidence ? [...(current?.evidence ?? []), referenceEvidence] : current?.evidence,
        pitches: [],
        ...(result.targetInstrument === "guitar" ? { guitarFrets: [-1, -1, -1, -1, -1, -1] } : {})
      });
    }
    index = endIndex;
  }

  const next = { ...result, chords };
  return { ...next, bars: buildBars(next) };
}

export function applyAutoScoreReferenceChart(
  result: AutoScoreResult,
  chart: string,
  source: {
    sourceType?: AutoScoreReferenceVerification["sourceType"];
    sourceTitle: string;
    publisher: string;
    productId?: string;
    startMeasure?: number;
  }
) {
  if (result.targetInstrument === "drums") throw new Error("授權和弦譜只能套用在吉他或鋼琴草譜。");
  if (result.review?.status === "finalized") throw new Error("正式譜已鎖定，請先建立修訂版再匯入授權譜。");
  const sourceTitle = source.sourceTitle.trim();
  const publisher = source.publisher.trim();
  if (!sourceTitle || !publisher) throw new Error("請填寫授權譜名稱與出版社，保留校對來源。");
  const measures = autoScoreReviewableMeasures(result);
  const beatsPerBar = parseMeter(result.timeSignature).beats;
  const referenceMeasures = parseAutoScoreReferenceChart(chart, beatsPerBar);
  const startMeasure = Math.max(1, Math.floor(source.startMeasure ?? 1));
  if (startMeasure > measures.length || startMeasure - 1 + referenceMeasures.length > measures.length) {
    throw new Error(`授權譜範圍超出草譜；目前只有 ${measures.length} 小節。`);
  }

  const originalConfirmations = result.beatConfirmations ?? [];
  const sourceType = source.sourceType ?? "licensed_sheet_music";
  let next = sourceType === "public_chord_reference"
    ? applyPublicReferenceStructure(result, referenceMeasures, startMeasure, sourceTitle)
    : result;
  let matchedBeatCount = 0;
  let changedBeatCount = 0;
  referenceMeasures.forEach((referenceBeats, referenceIndex) => {
    const measure = measures[startMeasure - 1 + referenceIndex];
    measure.beats.forEach((beat, beatIndex) => {
      const expected = referenceBeats[beatIndex];
      if (beat.name === expected) matchedBeatCount += 1;
      else changedBeatCount += 1;
      if (sourceType !== "public_chord_reference") {
        next = updateAutoScoreReviewBeatChord(next, beat, expected, "reference-import");
      }
    });
  });

  const finalBeats = autoScoreReviewableMeasures(next).flatMap((measure) => measure.beats);
  const preservedConfirmations = originalConfirmations.filter((confirmation) => finalBeats.some((beat) =>
    confirmation.name === beat.name && (
      confirmation.beatId
        ? confirmation.beatId === beat.id
        : !beat.notationOnly &&
          Math.abs(confirmation.startSeconds - beat.startSeconds) <= 0.06 &&
          Math.abs(confirmation.endSeconds - beat.endSeconds) <= 0.08
    )
  ));
  const coveredBeatCount = referenceMeasures.length * beatsPerBar;
  const totalBeatCount = measures.reduce((total, measure) => total + measure.beats.length, 0);
  const status = startMeasure === 1 && referenceMeasures.length === measures.length ? "complete" as const : "partial" as const;
  const verification: AutoScoreReferenceVerification = {
    sourceType,
    sourceTitle,
    publisher,
    ...(source.productId?.trim() ? { productId: source.productId.trim() } : {}),
    startMeasure,
    measureCount: referenceMeasures.length,
    coveredBeatCount,
    totalBeatCount,
    matchedBeatCount,
    changedBeatCount,
    coveragePercent: Math.round((coveredBeatCount / Math.max(1, totalBeatCount)) * 1000) / 10,
    status,
    importedAt: new Date().toISOString()
  };
  const sourceLabel = sourceType === "editor_reference"
    ? "編輯標準譜"
    : sourceType === "public_chord_reference"
      ? "公開參考譜"
      : "授權譜";
  const referenceWarning = `已用${sourceLabel}「${sourceTitle}」校對 ${coveredBeatCount} 拍；仍需逐小節確認音檔強拍與譜面小節對齊。`;
  return {
    ...next,
    beatConfirmations: preservedConfirmations,
    referenceVerification: verification,
    warnings: [...next.warnings.filter((warning) => !/^已用(?:授權譜|編輯標準譜|公開參考譜)「/.test(warning)), referenceWarning]
  };
}

export function confirmAutoScoreMeasure(result: AutoScoreResult, measureNumber: number) {
  const measure = autoScoreReviewableMeasures(result).find((item) => item.number === measureNumber);
  if (!measure) return result;
  return measure.beats.reduce(
    (current, beat) => setAutoScoreBeatConfirmation(current, beat, true),
    result
  );
}

function sectionVerificationFamily(label: string) {
  if (label.includes("主歌")) return "主歌";
  if (label.includes("副歌")) return "副歌";
  if (label.includes("過門")) return "過門";
  return null;
}

function repeatedSectionConflicts(result: AutoScoreResult, measures: ReturnType<typeof autoScoreReviewMeasures>) {
  const groups = new Map<string, NonNullable<AutoScoreResult["sectionMap"]>>();
  for (const section of result.sectionMap ?? []) {
    const family = sectionVerificationFamily(section.label);
    if (!family) continue;
    groups.set(family, [...(groups.get(family) ?? []), section]);
  }
  const conflicts: string[] = [];
  for (const [family, sections] of groups) {
    if (sections.length < 2) continue;
    const signature = (firstMeasure: number, lastMeasure: number) => measures
      .slice(firstMeasure - 1, lastMeasure)
      .map((measure) => measure.beats.map((beat) => beat.name).join(","))
      .join("|");
    const reference = sections[0];
    const referenceLength = reference.lastMeasure - reference.firstMeasure + 1;
    const referenceSignature = signature(reference.firstMeasure, reference.lastMeasure);
    for (const section of sections.slice(1)) {
      const length = section.lastMeasure - section.firstMeasure + 1;
      if (length !== referenceLength || signature(section.firstMeasure, section.lastMeasure) !== referenceSignature) {
        conflicts.push(`${family}重複段落不一致：${reference.firstMeasure}-${reference.lastMeasure} 與 ${section.firstMeasure}-${section.lastMeasure} 小節`);
      }
    }
  }
  return conflicts;
}

function strummingSubdivisionOption(subdivision: AutoScoreStrummingSubdivision) {
  return AUTO_SCORE_STRUMMING_SUBDIVISIONS.find((option) => option.id === subdivision)
    ?? AUTO_SCORE_STRUMMING_SUBDIVISIONS[1];
}

function strummingGroupSeeds(subdivision: AutoScoreStrummingSubdivision) {
  if (subdivision === "quarter_triplet") {
    return [
      { label: "第 1–2 拍", detail: "3:2", count: ["1", "2", "3"] },
      { label: "第 3–4 拍", detail: "3:2", count: ["1", "2", "3"] }
    ];
  }
  const slotLabels = subdivision === "quarter"
    ? ["拍"]
    : subdivision === "eighth"
      ? ["正", "&"]
      : subdivision === "sixteenth"
        ? ["正", "e", "&", "a"]
        : subdivision === "beat_triplet"
          ? ["1", "2", "3"]
          : ["1", "2", "3", "4", "5", "6"];
  return Array.from({ length: 4 }, (_, index) => ({
    label: `第 ${index + 1} 拍`,
    detail: subdivision === "beat_triplet" ? "三連音" : subdivision === "beat_sextuplet" ? "六連音" : "",
    count: slotLabels
  }));
}

export function buildAutoScoreStrummingVariant(
  pattern: AutoScoreStrummingPattern,
  subdivision: AutoScoreStrummingSubdivision
): AutoScoreStrummingVariant {
  const option = strummingSubdivisionOption(subdivision);
  const sourceOption = strummingSubdivisionOption(pattern.subdivision);
  const groupSeeds = strummingGroupSeeds(subdivision);
  const slotCount = groupSeeds.reduce((total, group) => total + group.count.length, 0);
  const savedVariant = pattern.variants?.[subdivision];
  const validSavedVariant = Boolean(
    savedVariant &&
    savedVariant.strokes.length === slotCount &&
    savedVariant.strokes.every((stroke) => ["down", "up", "mute", "rest"].includes(stroke))
  );
  const strokes: AutoScoreStrumStroke[] = validSavedVariant
    ? [...savedVariant!.strokes]
    : Array.from({ length: slotCount }, () => "rest");

  if (!validSavedVariant && pattern.id === "lifted_eighths") {
    for (let index = 0; index < slotCount; index += 1) {
      strokes[index] = subdivision === "quarter" ? "down" : index % 2 === 0 ? "down" : "up";
    }
  } else if (!validSavedVariant) {
    pattern.strokes.forEach((stroke, index) => {
      if (stroke === "rest") return;
      const sourceBeat = index * sourceOption.slotDurationBeats;
      const targetIndex = Math.min(slotCount - 1, Math.max(0, Math.round(sourceBeat / option.slotDurationBeats)));
      if (strokes[targetIndex] === "rest" || stroke === "mute") strokes[targetIndex] = stroke;
    });
  }

  const accents = validSavedVariant
    ? Array.from(new Set(savedVariant!.accents.filter((index) => Number.isInteger(index) && index >= 0 && index < slotCount))).sort((left, right) => left - right)
    : Array.from(new Set(pattern.accents.map((index) => {
        const sourceBeat = index * sourceOption.slotDurationBeats;
        return Math.min(slotCount - 1, Math.max(0, Math.round(sourceBeat / option.slotDurationBeats)));
      }))).sort((left, right) => left - right);
  let cellIndex = 0;
  const groups = groupSeeds.map((group) => ({
    label: group.label,
    detail: group.detail,
    cells: group.count.map((defaultCount) => {
      const index = cellIndex;
      cellIndex += 1;
      const count = validSavedVariant ? savedVariant!.count[index] ?? defaultCount : defaultCount;
      return { index, count, stroke: strokes[index], accent: accents.includes(index) };
    })
  }));

  return {
    subdivision,
    label: option.label,
    shortLabel: option.shortLabel,
    detail: option.detail,
    slotDurationBeats: option.slotDurationBeats,
    groups,
    count: groups.flatMap((group) => group.cells.map((cell) => cell.count)),
    strokes,
    accents,
    source: validSavedVariant ? savedVariant!.source : "derived_template",
    confidence: validSavedVariant ? savedVariant!.confidence : 0,
    updatedAt: validSavedVariant ? savedVariant!.updatedAt : undefined,
    updatedBy: validSavedVariant ? savedVariant!.updatedBy : undefined
  };
}

export function buildAutoScoreStrummingGuide(result: AutoScoreResult): AutoScoreStrummingGuide {
  const patterns: AutoScoreStrummingPattern[] = [
    {
      id: "steady_quarters",
      label: "穩定拍點",
      difficulty: "入門",
      subdivision: "eighth",
      count: ["1", "&", "2", "&", "3", "&", "4", "&"],
      strokes: ["down", "rest", "down", "rest", "down", "rest", "down", "rest"],
      accents: [0, 4],
      feel: "每拍一下，先把和弦切換與拍點彈穩。",
      instruction: "第 1、3 拍稍重，其餘保持放鬆；每次下刷都落在拍點上。"
    },
    {
      id: "open_ballad",
      label: "抒情留白",
      difficulty: "標準",
      subdivision: "eighth",
      count: ["1", "&", "2", "&", "3", "&", "4", "&"],
      strokes: ["down", "rest", "down", "up", "rest", "up", "down", "up"],
      accents: [0, 4],
      feel: "流動但留有空間，適合主歌與慢歌伴奏。",
      instruction: "右手維持上下擺動；空拍仍要移動，只是不碰弦。"
    },
    {
      id: "lifted_eighths",
      label: "連續推進",
      difficulty: "標準",
      subdivision: "eighth",
      count: ["1", "&", "2", "&", "3", "&", "4", "&"],
      strokes: ["down", "up", "down", "up", "down", "up", "down", "up"],
      accents: [0, 4],
      feel: "連續刷弦，讓副歌更飽滿、更有前進感。",
      instruction: "下刷略重、上刷略輕；第 1、3 拍做動態支點，不要每一下都一樣大聲。"
    },
    {
      id: "muted_build",
      label: "悶音漸強",
      difficulty: "進階",
      subdivision: "eighth",
      count: ["1", "&", "2", "&", "3", "&", "4", "&"],
      strokes: ["down", "rest", "mute", "up", "rest", "up", "down", "up"],
      accents: [0, 6],
      feel: "用悶音與後半拍建立張力，適合進副歌前。",
      instruction: "第 2 拍下刷用左手放鬆形成短促悶音；第 4 拍開始打開音量。"
    }
  ];
  const choosePattern = (label: string) => {
    const normalized = label.toLocaleLowerCase();
    if (/前奏|intro|尾奏|outro/.test(normalized)) return "steady_quarters";
    if (/預副歌|pre.?chorus|橋|bridge|漸強/.test(normalized)) return "muted_build";
    if (/副歌|chorus|過門|interlude/.test(normalized)) return "lifted_eighths";
    return "open_ballad";
  };
  const dynamicsFor = (patternId: string) => patternId === "steady_quarters"
    ? "p–mp"
    : patternId === "open_ballad"
      ? "mp"
      : patternId === "muted_build"
        ? "mp 漸強至 mf"
        : "mf–f";
  const measureCount = autoScoreReviewableMeasures(result).length;
  const formalSections = autoScoreSheetSections(result);
  const sectionSource = formalSections.length ? formalSections.map((section) => ({
    label: section.label,
    firstMeasure: section.firstMeasure,
    lastMeasure: section.lastMeasure
  })) : [{
    label: "全曲",
    firstMeasure: 1,
    lastMeasure: Math.max(1, measureCount),
  }];
  const sections = sectionSource.map((section) => {
    const patternId = choosePattern(section.label);
    const pattern = patterns.find((candidate) => candidate.id === patternId) ?? patterns[1];
    return {
      label: section.label,
      firstMeasure: section.firstMeasure,
      lastMeasure: section.lastMeasure,
      patternId,
      dynamics: dynamicsFor(patternId),
      instruction: `${pattern.label}；${pattern.instruction}`
    };
  });
  return {
    purpose: "teaching_accompaniment",
    meter: result.timeSignature,
    bpm: result.bpm,
    unit: "可切換節奏細分",
    defaultSubdivision: "sixteenth",
    availableSubdivisions: AUTO_SCORE_STRUMMING_SUBDIVISIONS.map((option) => option.id),
    note: "這是依歌曲速度、拍號與段落動態編排的教學伴奏刷法；可切換四分、八分、十六分與連音格，重點是讓學生看懂拍內位置並穩定伴奏，不冒充原錄音的逐刷法還原。",
    patterns,
    sections
  };
}

function manualStrummingVariantCount(guide: AutoScoreStrummingGuide) {
  return guide.patterns.reduce((total, pattern) => total + Object.values(pattern.variants ?? {})
    .filter((variant) => variant?.source === "manual").length, 0);
}

export function resolveAutoScoreStrummingGuide(result: AutoScoreResult): AutoScoreStrummingGuide {
  const fallback = buildAutoScoreStrummingGuide(result);
  const existing = result.strummingGuide;
  if (!existing) return fallback;

  const sourceGuide = existing.analysis?.engine === "songzu_local_audio_strumming_v1" ? existing : fallback;
  const patterns = sourceGuide.patterns.map((pattern) => {
    const previous = existing.patterns.find((candidate) => candidate.id === pattern.id);
    return previous?.variants ? { ...pattern, variants: previous.variants } : pattern;
  });
  for (const previous of existing.patterns) {
    if (!patterns.some((pattern) => pattern.id === previous.id)) patterns.push(previous);
  }
  const guide = {
    ...sourceGuide,
    meter: result.timeSignature,
    bpm: result.bpm,
    availableSubdivisions: AUTO_SCORE_STRUMMING_SUBDIVISIONS.map((option) => option.id),
    patterns
  };
  return guide.analysis
    ? { ...guide, analysis: { ...guide.analysis, manualExampleCount: manualStrummingVariantCount(guide) } }
    : guide;
}

export type AutoScoreStrummingPatternEdit = {
  patternId: string;
  strokes: AutoScoreStrumStroke[];
  accents: number[];
};

export function applyAutoScoreStrummingEdits(
  result: AutoScoreResult,
  subdivision: AutoScoreStrummingSubdivision,
  edits: AutoScoreStrummingPatternEdit[],
  updatedBy = "本機創作者"
) {
  const guide = resolveAutoScoreStrummingGuide(result);
  const now = new Date().toISOString();
  const patterns = guide.patterns.map((pattern) => {
    const edit = edits.find((candidate) => candidate.patternId === pattern.id);
    if (!edit) return pattern;
    const expected = buildAutoScoreStrummingVariant(pattern, subdivision);
    if (edit.strokes.length !== expected.strokes.length) {
      throw new Error(`${pattern.label} 的刷法格數不正確`);
    }
    const accents = Array.from(new Set(edit.accents
      .filter((index) => Number.isInteger(index) && index >= 0 && index < edit.strokes.length)))
      .sort((left, right) => left - right);
    return {
      ...pattern,
      variants: {
        ...(pattern.variants ?? {}),
        [subdivision]: {
          count: expected.count,
          strokes: [...edit.strokes],
          accents,
          source: "manual" as const,
          confidence: 100,
          updatedAt: now,
          updatedBy
        }
      }
    };
  });
  const nextGuide: AutoScoreStrummingGuide = {
    ...guide,
    patterns,
    ...(guide.analysis ? {
      analysis: {
        ...guide.analysis,
        manualExampleCount: manualStrummingVariantCount({ ...guide, patterns })
      }
    } : {})
  };
  return { ...result, strummingGuide: nextGuide };
}

function scoreSectionMapIsContiguous(result: AutoScoreResult, measureCount: number) {
  const sections = [...(result.sectionMap ?? [])].sort((left, right) => left.firstMeasure - right.firstMeasure);
  if (!sections.length || sections[0].firstMeasure !== 1 || sections.at(-1)?.lastMeasure !== measureCount) return false;
  return sections.every((section, index) =>
    section.firstMeasure <= section.lastMeasure &&
    (index === 0 || section.firstMeasure === sections[index - 1].lastMeasure + 1)
  );
}

function scoreHasIndependentCrossCheck(result: AutoScoreResult, totalBeatCount: number) {
  const licensedReferenceComplete = Boolean(
    result.referenceVerification?.sourceType === "licensed_sheet_music" &&
    result.referenceVerification?.status === "complete" &&
    result.referenceVerification.coveredBeatCount >= totalBeatCount &&
    result.referenceVerification.totalBeatCount === totalBeatCount
  );
  const independentReviewComplete = Boolean(
    result.independentReview?.totalBeatCount === totalBeatCount &&
    result.independentReview.confirmedBeatCount === totalBeatCount
  );
  return { licensedReferenceComplete, independentReviewComplete };
}

function scoreTeachingPatternsAreConfirmed(result: AutoScoreResult) {
  const guide = result.strummingGuide;
  if (!guide?.sections.length) return false;
  const usedPatternIds = new Set(guide.sections.map((section) => section.patternId));
  return [...usedPatternIds].every((patternId) => {
    const pattern = guide.patterns.find((candidate) => candidate.id === patternId);
    return Boolean(pattern && Object.values(pattern.variants ?? {}).some((variant) => variant?.source === "manual"));
  });
}

export function buildAutoScoreDeliveryCertification(result: AutoScoreResult): AutoScoreDeliveryCertification {
  const sourceMeasures = autoScoreReviewMeasures(result);
  const measures = autoScoreReviewableMeasures(result);
  const progress = autoScoreReviewProgress(result);
  const metadata = result.verification?.officialMetadata;
  const grid = result.verification?.recordingGrid;
  const rhythm = result.rhythm;
  const beatCount = parseMeter(result.timeSignature).beats;
  const { licensedReferenceComplete, independentReviewComplete } = scoreHasIndependentCrossCheck(result, progress.total);
  const manuallyFinalized = Boolean(
    result.review?.status === "finalized" &&
    result.review.verificationMethod === "manual" &&
    Boolean(result.review.finalizedBy?.trim()) &&
    progress.total > 0 &&
    progress.confirmed === progress.total
  );
  const timingGridAligned = Boolean(
    rhythm?.engine === "madmom_rnn_beat_grid_v1" &&
    rhythm.confidence >= 60 &&
    rhythm.beatsPerBar === beatCount &&
    rhythm.downbeatTimesSeconds.length === sourceMeasures.length &&
    rhythm.beatTimesSeconds.length >= Math.max(1, (sourceMeasures.length - 1) * beatCount) &&
    grid?.measures === sourceMeasures.length &&
    grid.meter === result.timeSignature &&
    Math.abs(grid.bpm - result.bpm) <= 1
  );
  const checks: AutoScoreDeliveryCertificationCheck[] = [
    {
      id: "protected_source",
      label: "受保護原曲身分",
      passed: /^[a-f0-9]{64}$/i.test(result.verification?.sourceMatchSha256 ?? ""),
      detail: "正式譜必須能追溯到未被改寫的來源音檔 SHA-256。",
      requiredFor: "formal"
    },
    {
      id: "song_identity",
      label: "歌曲資料基準",
      passed: Boolean(metadata?.title && metadata.artist && metadata.key),
      detail: metadata ? `${metadata.artist} · ${metadata.title} · ${metadata.key}` : "缺少歌名、歌手或調性基準。",
      requiredFor: "formal"
    },
    {
      id: "timing_grid",
      label: "節拍與小節格校準",
      passed: timingGridAligned,
      detail: timingGridAligned
        ? `${measures.length} 小節、${progress.total} 拍與來源音訊一致。`
        : "小節、downbeat、逐拍格、BPM 或尾音範圍仍有不一致。",
      requiredFor: "formal"
    },
    {
      id: "manual_editorial_review",
      label: "本機創作者 逐拍人工定稿",
      passed: manuallyFinalized,
      detail: `${progress.confirmed}/${progress.total} 拍已明確確認；系統分數不能代替這一步。`,
      requiredFor: "formal"
    },
    {
      id: "section_map",
      label: "完整段落與小節範圍",
      passed: scoreSectionMapIsContiguous(result, sourceMeasures.length),
      detail: "演出譜必須從第 1 小節到最後一小節無缺口、無重疊。",
      requiredFor: "performance"
    },
    {
      id: "independent_cross_check",
      label: "獨立來源交叉複核",
      passed: licensedReferenceComplete || independentReviewComplete,
      detail: licensedReferenceComplete
        ? "已用合法取得的完整參考譜逐拍交叉比對。"
        : independentReviewComplete
          ? `${result.independentReview?.reviewer ?? "第二位樂手"} 已完成全曲獨立複核。`
          : "尚需合法完整參考譜或第二位樂手逐拍複核。",
      requiredFor: "performance"
    },
    {
      id: "teaching_rhythm",
      label: "可教學刷法已人工確認",
      passed: scoreTeachingPatternsAreConfirmed(result),
      detail: "每個實際使用的段落刷法都要有人工確認版本，不能只用通用範本。",
      requiredFor: "teaching"
    }
  ];
  const formalReady = checks.filter((check) => check.requiredFor === "formal").every((check) => check.passed);
  const performanceReady = formalReady && checks.filter((check) => check.requiredFor === "performance").every((check) => check.passed);
  const teachingReady = performanceReady && checks.filter((check) => check.requiredFor === "teaching").every((check) => check.passed);
  const systemChecked = Boolean(
    result.verification?.chordVerification?.status === "verified" &&
    result.verification.chordVerification.conflictCount === 0
  );
  const status: AutoScoreDeliveryCertification["status"] = teachingReady
    ? "teaching_ready"
    : performanceReady
      ? "performance_ready"
      : formalReady
        ? "editor_confirmed"
        : systemChecked
          ? "system_checked"
          : "draft";
  const labels: Record<AutoScoreDeliveryCertification["status"], string> = {
    draft: "分析草稿",
    system_checked: "系統檢查完成，待人工校對",
    editor_confirmed: "人工定稿",
    performance_ready: "演出可用",
    teaching_ready: "教學可用"
  };
  return {
    standard: "songzu_score_delivery_v1",
    status,
    label: labels[status],
    generatedAt: new Date().toISOString(),
    unresolvedCount: checks.filter((check) => !check.passed).length,
    checks
  };
}

export function verifyAutoScoreResult(result: AutoScoreResult) {
  const sourceMeasures = autoScoreReviewMeasures(result);
  const measures = autoScoreReviewableMeasures(result);
  const beats = measures.flatMap((measure) => measure.beats);
  const evidence = result.verification?.evidence ?? [];
  const recordingGrid = result.verification?.recordingGrid;
  const officialMetadata = result.verification?.officialMetadata;
  const rhythm = result.rhythm;
  const repeatedConflicts = repeatedSectionConflicts(result, sourceMeasures);
  const chordIsSupported = (chord: AutoScoreChord) =>
    REFERENCE_CHORD_PATTERN.test(chord.name) &&
    chord.confidence >= 88 &&
    chord.reviewStatus !== "review";
  const verifiedChordCount = result.chords.filter(chordIsSupported).length;
  const beatConflicts = beats.flatMap((beat) => {
    if (beat.notationOnly) return [];
    const chord = reviewChordAt(result, beat.startSeconds);
    if (beat.name === "N.C." && !chord) return [];
    if (!chord) return [`第 ${beat.measure} 小節第 ${beat.beat} 拍沒有和弦證據`];
    if (chord.name !== beat.name) return [`第 ${beat.measure} 小節第 ${beat.beat} 拍的顯示與和弦事件不一致`];
    if (!chordIsSupported(chord)) return [`第 ${beat.measure} 小節第 ${beat.beat} 拍 ${beat.name} 的證據不足`];
    return [];
  });
  const checks: AutoScoreVerificationCheck[] = [
    {
      id: "source_identity",
      label: "來源身分與完整性",
      passed: /^[a-f0-9]{64}$/i.test(result.verification?.sourceMatchSha256 ?? ""),
      detail: "完整來源需有 SHA-256 或聲紋身分證據。"
    },
    {
      id: "official_metadata",
      label: "歌名、歌手與調性基準",
      passed: Boolean(officialMetadata?.title && officialMetadata.artist && officialMetadata.key),
      detail: officialMetadata ? `${officialMetadata.artist} · ${officialMetadata.title} · ${officialMetadata.key}` : "缺少權威 metadata 基準。"
    },
    {
      id: "rhythm_grid",
      label: "逐拍與小節時間格",
      passed: Boolean(
        rhythm?.engine === "madmom_rnn_beat_grid_v1" &&
        rhythm.beatsPerBar === parseMeter(result.timeSignature).beats &&
        rhythm.downbeatTimesSeconds.length === sourceMeasures.length &&
        rhythm.beatTimesSeconds.length >= Math.max(1, (sourceMeasures.length - 1) * parseMeter(result.timeSignature).beats) &&
        recordingGrid?.measures === sourceMeasures.length &&
        recordingGrid.meter === result.timeSignature &&
        Math.abs(recordingGrid.bpm - result.bpm) <= 1
      ),
      detail: `${measures.length} 小節 · ${beats.length} 拍 · ${result.bpm} BPM · ${result.timeSignature}`
    },
    {
      id: "engine_consensus",
      label: "多引擎和聲共識",
      passed: ["songzu_harmony_v12", "songzu_harmony_v11", "songzu_harmony_v10", "songzu_harmony_v9", "songzu_harmony_v8", "songzu_harmony_v7", "songzu_harmony_v6", "songzu_harmony_v5", "songzu_harmony_v4"].includes(result.analyzer) && result.analysisMode === "consensus" && evidence.length >= 4,
      detail: `${evidence.length} 組獨立證據：${evidence.join("、") || "尚無"}`
    },
    {
      id: "chord_events",
      label: "每個和弦事件",
      passed: result.chords.length > 0 && verifiedChordCount === result.chords.length,
      detail: `${verifiedChordCount}/${result.chords.length} 個和弦事件達到驗證門檻。`
    },
    {
      id: "beat_coverage",
      label: "每拍和弦覆蓋",
      passed: beats.length > 0 && beatConflicts.length === 0,
      detail: `${beats.length - beatConflicts.length}/${beats.length} 拍有一致和弦證據。`
    },
    {
      id: "repeated_form",
      label: "重複段落結構",
      passed: repeatedConflicts.length === 0,
      detail: repeatedConflicts.length ? repeatedConflicts.join("；") : "主歌、副歌與過門重複段落一致。"
    }
  ];
  const failedChecks = checks.filter((check) => !check.passed).map((check) => `${check.label}未通過`);
  const conflicts = [...failedChecks, ...repeatedConflicts, ...beatConflicts].slice(0, 32);
  const systemVerified = checks.every((check) => check.passed) && conflicts.length === 0;
  const chordVerification: AutoScoreChordVerification = {
    status: systemVerified ? "verified" : "conflicts",
    method: "multi_evidence_consensus_v1",
    verifiedAt: new Date().toISOString(),
    totalChordCount: result.chords.length,
    verifiedChordCount,
    totalBeatCount: beats.length,
    verifiedBeatCount: Math.max(0, beats.length - beatConflicts.length),
    conflictCount: conflicts.length,
    conflicts,
    checks
  };
  const verifiedResult: AutoScoreResult = {
    ...result,
    ...(result.targetInstrument === "guitar" ? { strummingGuide: resolveAutoScoreStrummingGuide(result) } : {}),
    verification: {
      ...(result.verification ?? {}),
      status: result.review?.status === "finalized" && result.review.verificationMethod === "manual"
        ? "human_verified" as const
        : systemVerified
          ? "system_verified" as const
          : "triangulated_review" as const,
      humanConfirmed: result.review?.status === "finalized" && result.review.verificationMethod === "manual",
      systemConfirmed: systemVerified,
      chordVerification
    }
  };
  return { ...verifiedResult, certification: buildAutoScoreDeliveryCertification(verifiedResult) };
}

export function finalizeAutoScoreResult(result: AutoScoreResult, finalizedBy?: string) {
  const progress = autoScoreReviewProgress(result);
  const systemVerification = result.verification?.chordVerification;
  const manuallyVerified = Boolean(progress.total && progress.confirmed === progress.total);
  if (!manuallyVerified) {
    const conflictMessage = systemVerification?.conflicts[0];
    throw new Error(conflictMessage
      ? `系統檢查仍有衝突：${conflictMessage}；正式譜仍須完成逐拍人工確認。`
      : `目前只確認 ${progress.confirmed}/${progress.total} 拍；請先完成逐拍人工確認，才能鎖定正式譜。`);
  }
  const finalizedResult: AutoScoreResult = {
    ...result,
    verification: {
      ...(result.verification ?? { status: "triangulated_review" as const, humanConfirmed: false }),
      status: "human_verified" as const,
      humanConfirmed: true,
      systemConfirmed: result.verification?.systemConfirmed ?? false
    },
    review: {
      status: "finalized" as const,
      revision: Math.max(1, result.review?.revision ?? 1),
      finalizedAt: new Date().toISOString(),
      finalizedBy: finalizedBy?.normalize("NFC").trim() || "本機創作者",
      verificationMethod: "manual" as const,
      confirmedBeatCount: progress.confirmed,
      totalBeatCount: progress.total
    }
  };
  const humanBenchmark = buildAutoScoreHumanBenchmark(finalizedResult);
  const completed = humanBenchmark ? { ...finalizedResult, humanBenchmark } : finalizedResult;
  return { ...completed, certification: buildAutoScoreDeliveryCertification(completed) };
}

export function unlockAutoScoreResult(result: AutoScoreResult) {
  const previousVerification = result.verification;
  const unlockedResult: AutoScoreResult = {
    ...result,
    ...(previousVerification ? {
      verification: {
        ...previousVerification,
        status: "triangulated_review" as const,
        systemConfirmed: false,
        chordVerification: undefined
      }
    } : {}),
    review: {
      status: "in_progress" as const,
      revision: Math.max(1, (result.review?.revision ?? 0) + 1)
    }
  };
  return { ...unlockedResult, certification: buildAutoScoreDeliveryCertification(unlockedResult) };
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function noteXml(midi: number, duration: number, chord = false) {
  const pitchClass = ((midi % 12) + 12) % 12;
  const names = [
    ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
    ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]
  ] as const;
  const [step, alter] = names[pitchClass];
  const octave = Math.floor(midi / 12) - 1;
  return `<note>${chord ? "<chord/>" : ""}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`;
}

function scoreChordParts(name: string) {
  const canonicalName = normalizeReferenceChord(name);
  if (!canonicalName || canonicalName === "N.C.") return null;
  const match = REFERENCE_CHORD_PATTERN.exec(canonicalName);
  if (!match) return null;
  return {
    name: canonicalName,
    root: `${match[1][0].toUpperCase()}${match[1].slice(1)}`,
    quality: (match[2] ?? "").replace(/^min$/i, "m").replace(/^maj$/i, ""),
    bass: match[3] ? `${match[3][0].toUpperCase()}${match[3].slice(1)}` : null
  };
}

function musicXmlChordKind(quality: string) {
  return ({
    "": "major",
    m: "minor",
    "6": "major-sixth",
    m6: "minor-sixth",
    "7": "dominant",
    maj7: "major-seventh",
    m7: "minor-seventh",
    mMaj7: "major-minor",
    "9": "dominant-ninth",
    maj9: "major-ninth",
    m9: "minor-ninth",
    "11": "dominant-11th",
    maj11: "major-11th",
    m11: "minor-11th",
    "13": "dominant-13th",
    maj13: "major-13th",
    m13: "minor-13th",
    m7b5: "half-diminished",
    dim: "diminished",
    dim7: "diminished-seventh",
    aug: "augmented",
    aug7: "augmented-seventh",
    sus2: "suspended-second",
    sus4: "suspended-fourth",
    "7sus2": "suspended-second",
    "7sus4": "suspended-fourth",
    add2: "added-second",
    add4: "added-fourth",
    add9: "added-ninth"
  } as Record<string, string>)[quality] ?? "other";
}

function musicXmlHarmony(name: string, target: AutoScoreTarget) {
  const chord = scoreChordParts(name);
  if (!chord) return "<note><rest/><duration>1</duration><type>quarter</type></note>";
  const rootAlter = chord.root.includes("#") ? 1 : chord.root.includes("b") ? -1 : 0;
  const bassAlter = chord.bass?.includes("#") ? 1 : chord.bass?.includes("b") ? -1 : 0;
  const bass = chord.bass
    ? `<bass><bass-step>${xmlEscape(chord.bass.replace(/[b#]/g, ""))}</bass-step>${bassAlter ? `<bass-alter>${bassAlter}</bass-alter>` : ""}</bass>`
    : "";
  const harmony = `<harmony><root><root-step>${xmlEscape(chord.root.replace(/[b#]/g, ""))}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ""}</root>${bass}<kind text="${xmlEscape(chord.name)}">${musicXmlChordKind(chord.quality)}</kind></harmony>`;
  const pitches = chordPitches(chord.root, chord.quality, target, chord.bass);
  return pitches.length
    ? `${harmony}${pitches.map((midi, pitchIndex) => noteXml(midi, 1, pitchIndex > 0)).join("")}`
    : "<note><rest/><duration>1</duration><type>quarter</type></note>";
}

export function autoScoreToMusicXml(result: AutoScoreResult, title: string) {
  const meter = parseMeter(result.timeSignature);
  if (result.targetInstrument === "guitar") {
    const formalMeasures = autoScoreSheetSections(result).flatMap((section) => section.measures);
    const measures = formalMeasures.map((measure, index) => {
      const attributes = index === 0
        ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>${meter.beats}</beats><beat-type>${meter.unit}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
        : "";
      return `<measure number="${measure.number}">${attributes}${measure.beats.map((name) => musicXmlHarmony(name, result.targetInstrument)).join("")}</measure>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>${xmlEscape(title)}</work-title></work><identification><creator type="software">頌祖音樂 OS 本機自動採譜</creator></identification><part-list><score-part id="P1"><part-name>${result.targetInstrument}</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
  }
  const measures = result.bars.map((bar, index) => {
    const attributes = index === 0
      ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>${meter.beats}</beats><beat-type>${meter.unit}</beat-type></time><clef><sign>${result.targetInstrument === "drums" ? "percussion" : "G"}</sign><line>2</line></clef></attributes>`
      : "";
    const beatDuration = 60 / result.bpm;
    const beats = Array.from({ length: meter.beats }, (_, beatIndex) => {
      const beatStart = bar.startSeconds + beatIndex * beatDuration;
      if (result.targetInstrument === "drums") {
        const hits = bar.drumHits.filter((hit) => Math.abs(hit.startSeconds - beatStart) < beatDuration * 0.5);
        if (!hits.length) return "<note><rest/><duration>1</duration><type>quarter</type></note>";
        const midi = hits.some((hit) => hit.kind === "snare") ? 38 : hits.some((hit) => hit.kind === "kick") ? 36 : 42;
        return noteXml(midi, 1);
      }
      const chord = result.chords.find((item) => item.startSeconds <= beatStart + 0.01 && item.startSeconds + item.durationSeconds > beatStart);
      if (!chord) return "<note><rest/><duration>1</duration><type>quarter</type></note>";
      const rootAlter = chord.root.includes("#") ? 1 : chord.root.includes("b") ? -1 : 0;
      const kind = ({
        "": "major",
        m: "minor",
        "7": "dominant",
        maj7: "major-seventh",
        m7: "minor-seventh",
        sus2: "suspended-second",
        sus4: "suspended-fourth",
        dim: "diminished"
      } as Record<string, string>)[chord.quality] ?? "major";
      const bassAlter = chord.bass?.includes("#") ? 1 : chord.bass?.includes("b") ? -1 : 0;
      const bass = chord.bass
        ? `<bass><bass-step>${xmlEscape(chord.bass.replace(/[b#]/g, ""))}</bass-step>${bassAlter ? `<bass-alter>${bassAlter}</bass-alter>` : ""}</bass>`
        : "";
      const harmony = `<harmony><root><root-step>${xmlEscape(chord.root.replace(/[b#]/g, ""))}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ""}</root>${bass}<kind text="${xmlEscape(chord.name)}">${kind}</kind></harmony>`;
      return `${harmony}${chord.pitches.map((midi, pitchIndex) => noteXml(midi, 1, pitchIndex > 0)).join("")}`;
    }).join("");
    return `<measure number="${bar.index}">${attributes}${beats}</measure>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>${xmlEscape(title)}</work-title></work><identification><creator type="software">頌祖音樂 OS 本機自動採譜</creator></identification><part-list><score-part id="P1"><part-name>${result.targetInstrument}</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function variableLength(value: number) {
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
}

function uint32(value: number) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

export function autoScoreToMidi(result: AutoScoreResult, title: string) {
  const ticksPerBeat = 480;
  const secondsPerBeat = 60 / result.bpm;
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [];
  const tempo = Math.round(60_000_000 / result.bpm);
  const titleBytes = Array.from(new TextEncoder().encode(title.slice(0, 96)));
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(titleBytes.length), ...titleBytes] });
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255] });
  if (result.targetInstrument === "guitar") {
    events.push({ tick: 0, order: 0, bytes: [0xc0, 25] });
    let beatCursor = 0;
    for (const measure of autoScoreSheetSections(result).flatMap((section) => section.measures)) {
      for (const name of measure.beats) {
        const chord = scoreChordParts(name);
        if (chord) {
          const startTick = beatCursor * ticksPerBeat;
          const endTick = startTick + ticksPerBeat;
          for (const midi of chordPitches(chord.root, chord.quality, result.targetInstrument, chord.bass)) {
            events.push({ tick: startTick, order: 1, bytes: [0x90, clamp(Math.round(midi), 0, 127), 82] });
            events.push({ tick: endTick, order: 0, bytes: [0x80, clamp(Math.round(midi), 0, 127), 0] });
          }
        }
        beatCursor += 1;
      }
    }
  } else if (result.targetInstrument !== "drums") {
    events.push({ tick: 0, order: 0, bytes: [0xc0, 0] });
    const sourceNotes = result.notes.length
      ? result.notes
      : result.chords.flatMap((chord) => chord.pitches.map((midi) => ({ startSeconds: chord.startSeconds, durationSeconds: chord.durationSeconds, midi, velocity: 82 })));
    for (const note of sourceNotes) {
      const startTick = Math.max(0, Math.round((note.startSeconds / secondsPerBeat) * ticksPerBeat));
      const endTick = Math.max(startTick + 30, Math.round(((note.startSeconds + note.durationSeconds) / secondsPerBeat) * ticksPerBeat));
      events.push({ tick: startTick, order: 1, bytes: [0x90, clamp(Math.round(note.midi), 0, 127), clamp(Math.round(note.velocity), 1, 127)] });
      events.push({ tick: endTick, order: 0, bytes: [0x80, clamp(Math.round(note.midi), 0, 127), 0] });
    }
  } else {
    const noteByKind = { kick: 36, snare: 38, hihat: 42 } as const;
    for (const hit of result.drumHits) {
      const startTick = Math.max(0, Math.round((hit.startSeconds / secondsPerBeat) * ticksPerBeat));
      events.push({ tick: startTick, order: 1, bytes: [0x99, noteByKind[hit.kind], clamp(Math.round(hit.velocity), 1, 127)] });
      events.push({ tick: startTick + 45, order: 0, bytes: [0x89, noteByKind[hit.kind], 0] });
    }
  }
  events.sort((left, right) => left.tick - right.tick || left.order - right.order);

  const track: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerBeat >>> 8) & 255, ticksPerBeat & 255];
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track]);
}

export function autoScoreToText(result: AutoScoreResult, title: string) {
  const officialMetadata = result.verification?.officialMetadata;
  const lines = [
    officialMetadata?.title ?? title,
    ...(officialMetadata?.artist ? [`歌手：${officialMetadata.artist}`] : []),
    `調性：${officialMetadata?.key ?? result.musicalKey} · ${result.bpm} BPM · ${result.timeSignature}`,
    ""
  ];
  if (result.targetInstrument === "drums") {
    for (const bar of result.bars) {
      const step = (kind: AutoScoreDrumHit["kind"]) => Array.from({ length: 16 }, (_, index) => {
        const time = bar.startSeconds + index * ((60 / result.bpm) / 4);
        return bar.drumHits.some((hit) => hit.kind === kind && Math.abs(hit.startSeconds - time) < 0.04) ? "x" : "-";
      }).join("");
      lines.push(`小節 ${bar.index}`, `HH ${step("hihat")}`, `SD ${step("snare")}`, `BD ${step("kick")}`, "");
    }
  } else {
    if (result.targetInstrument === "guitar") {
      lines.push(
        result.review?.status === "finalized" && result.review.verificationMethod === "manual"
          ? `正式譜 v${result.review.revision} · ${result.review.confirmedBeatCount ?? 0}/${result.review.totalBeatCount ?? 0} 拍由 ${result.review.finalizedBy ?? "本機創作者"} 確認`
          : "人工校對草稿 · 尚未鎖定",
        "記譜法：每格一拍；_ 代表延續前一拍；| 代表小節線。",
        ""
      );
      const sheetSections = autoScoreSheetSections(result);
      for (const section of sheetSections) {
        lines.push(`[${section.label}] ${section.firstMeasure === section.lastMeasure ? `第 ${section.firstMeasure} 小節` : `${section.firstMeasure}-${section.lastMeasure} 小節`}`);
        const notation = section.measures.map((measure) => {
          const tokens = autoScoreSheetTokens(measure.beats);
          return { number: measure.number, text: `| ${tokens.join(" ")} |` };
        });
        for (let index = 0; index < notation.length; index += 4) {
          const row = notation.slice(index, index + 4);
          const firstMeasure = row[0].number;
          const lastMeasure = row.at(-1)!.number;
          lines.push(
            `小節 ${String(firstMeasure).padStart(2, "0")}${firstMeasure === lastMeasure ? "" : `-${String(lastMeasure).padStart(2, "0")}`}`,
            row.map((measure) => measure.text).join("  ")
          );
        }
        lines.push("");
      }
      if (result.strummingGuide) {
        const strokeLabel: Record<AutoScoreStrumStroke, string> = { down: "↓", up: "↑", mute: "×", rest: "–" };
        lines.push("", "本曲正式刷法");
        for (const pattern of result.strummingGuide.patterns) {
          const subdivision = result.strummingGuide.defaultSubdivision ?? pattern.subdivision;
          const variant = buildAutoScoreStrummingVariant(pattern, subdivision);
          lines.push(
            `${pattern.label}（${pattern.difficulty}）`,
            `節奏：${variant.label} · ${variant.detail}`,
            `拍點：${variant.count.join(" ")}`,
            `刷法：${variant.strokes.map((stroke) => strokeLabel[stroke]).join(" ")}`,
            `來源：${variant.source === "manual" ? `${variant.updatedBy ?? "本機創作者"} 人工修訂` : "本機音檔分析"}`,
            pattern.instruction,
            ""
          );
        }
        lines.push("段落建議");
        for (const section of result.strummingGuide.sections) {
          const pattern = result.strummingGuide.patterns.find((candidate) => candidate.id === section.patternId);
          lines.push(`${section.label}（${section.firstMeasure}-${section.lastMeasure} 小節）：${pattern?.label ?? section.patternId} · ${section.dynamics}`);
        }
        lines.push("", result.strummingGuide.note);
      }
      const verificationMethod = result.review?.verificationMethod;
      lines.push(result.review?.status === "finalized" && verificationMethod === "manual"
        ? `本譜已完成逐拍人工確認並鎖定。交付狀態：${buildAutoScoreDeliveryCertification(result).label}。`
        : verificationMethod === "multi_evidence_system"
          ? "注意：這是舊版系統鎖定譜，尚未完成逐拍人工複核，不可標示為演出或教學認證譜。"
          : "注意：本檔仍是自動分析草稿，可直接修正任何一拍後重新執行系統檢查。");
      return lines.join("\n");
    }
    for (const bar of result.bars) {
      lines.push(`小節 ${bar.index}: ${bar.chords.join(" | ") || "N.C."}`);
      const notes = bar.notes.map((note) => note.noteName).join(" ");
      lines.push(`音符提示: ${notes || "休止"}`);
      lines.push("");
    }
  }
  lines.push("注意：本檔為頌祖音樂 OS 本機自動分析草譜，請人工校對。");
  return lines.join("\n");
}
