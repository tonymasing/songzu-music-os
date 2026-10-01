export type PerformanceInstrument = "vocal" | "guitar" | "piano" | "bass" | "drums" | "other";

export type LocalPerformanceIssue = {
  timestampSeconds: number;
  issueType: "timing" | "pitch" | "level" | "clipping";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  suggestion?: string;
  measuredValue?: number | null;
  expectedValue?: number | null;
};

export type TunerReading = {
  frequencyHz: number;
  note: string;
  octave: number;
  midi: number;
  cents: number;
  confidence: number;
};

export type LocalPerformanceAnalysis = {
  overallScore: number;
  timingScore: number | null;
  pitchScore: number | null;
  levelScore: number;
  durationSeconds: number;
  peak: number;
  rms: number;
  tempoDriftMs: number | null;
  pitchDriftCents: number | null;
  summary: string;
  recommendations: string[];
  metrics: Record<string, unknown>;
  issues: LocalPerformanceIssue[];
};

type AnalyzeOptions = {
  detectionMode: string;
  targetBpm: number | null;
  targetInstrument: PerformanceInstrument;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], amount: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * amount), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function buildBars(data: Float32Array, count: number) {
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((data.length / count) * index);
    const end = Math.max(start + 1, Math.floor((data.length / count) * (index + 1)));
    const stride = Math.max(1, Math.floor((end - start) / 700));
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += stride) {
      peak = Math.max(peak, Math.abs(data[sampleIndex] ?? 0));
    }
    bars.push(round(peak));
  }
  return bars;
}

function pitchRange(instrument: PerformanceInstrument) {
  if (instrument === "bass") return { minHz: 35, maxHz: 350 };
  if (instrument === "guitar") return { minHz: 65, maxHz: 780 };
  if (instrument === "vocal") return { minHz: 65, maxHz: 1_100 };
  if (instrument === "piano") return { minHz: 45, maxHz: 1_200 };
  return { minHz: 55, maxHz: 1_000 };
}

export function tunerReadingFromFrequency(frequencyHz: number, confidence = 1): TunerReading | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const exactMidi = 69 + 12 * Math.log2(frequencyHz / 440);
  const midi = Math.round(exactMidi);
  const noteIndex = ((midi % 12) + 12) % 12;
  return {
    frequencyHz: round(frequencyHz, 2),
    note: NOTE_NAMES[noteIndex] ?? "-",
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: round((exactMidi - midi) * 100, 1),
    confidence: round(clamp(confidence, 0, 1), 3)
  };
}

export function detectTunerReading(
  samples: Float32Array,
  sampleRate: number,
  instrument: PerformanceInstrument = "vocal"
): TunerReading | null {
  if (samples.length < 256 || sampleRate <= 0 || instrument === "drums") return null;
  const { minHz, maxHz } = pitchRange(instrument);
  const downsampleStep = Math.max(1, Math.floor(sampleRate / 12_000));
  const effectiveRate = sampleRate / downsampleStep;
  const sampleCount = Math.floor(samples.length / downsampleStep);
  const minLag = Math.max(2, Math.floor(effectiveRate / maxHz));
  const maxLag = Math.min(sampleCount - 3, Math.ceil(effectiveRate / minHz));
  if (maxLag <= minLag) return null;

  let mean = 0;
  for (let index = 0; index < sampleCount; index += 1) mean += samples[index * downsampleStep] ?? 0;
  mean /= sampleCount;
  let energy = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const centered = (samples[index * downsampleStep] ?? 0) - mean;
    energy += centered * centered;
  }
  const rms = Math.sqrt(energy / sampleCount);
  if (rms < 0.006) return null;

  const correlations = new Float32Array(maxLag + 1);
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = sampleCount - lag;
    for (let index = 0; index < limit; index += 1) {
      const a = (samples[index * downsampleStep] ?? 0) - mean;
      const b = (samples[(index + lag) * downsampleStep] ?? 0) - mean;
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const correlation = numerator / Math.sqrt(Math.max(1e-12, energyA * energyB));
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestCorrelation < 0.58) return null;
  for (let lag = minLag + 1; lag < bestLag; lag += 1) {
    if (
      correlations[lag] >= bestCorrelation * 0.94 &&
      correlations[lag] > correlations[lag - 1] &&
      correlations[lag] >= correlations[lag + 1]
    ) {
      bestLag = lag;
      bestCorrelation = correlations[lag];
      break;
    }
  }

  const left = correlations[Math.max(minLag, bestLag - 1)] ?? bestCorrelation;
  const center = correlations[bestLag] ?? bestCorrelation;
  const right = correlations[Math.min(maxLag, bestLag + 1)] ?? bestCorrelation;
  const denominator = left - 2 * center + right;
  const adjustment = Math.abs(denominator) > 1e-8 ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5) : 0;
  return tunerReadingFromFrequency(effectiveRate / (bestLag + adjustment), bestCorrelation);
}

function analyzeLevel(data: Float32Array, sampleRate: number) {
  let peak = 0;
  let sumSquares = 0;
  let clippingSamples = 0;
  let loudestIndex = 0;
  for (let index = 0; index < data.length; index += 1) {
    const sample = data[index] ?? 0;
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) {
      peak = absolute;
      loudestIndex = index;
    }
    if (absolute >= 0.985) clippingSamples += 1;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, data.length));
  const issues: LocalPerformanceIssue[] = [];
  let score = 100;
  if (clippingSamples > 0 || peak >= 0.985) {
    score -= 34;
    issues.push({
      timestampSeconds: loudestIndex / sampleRate,
      issueType: "clipping",
      severity: "high",
      title: "疑似爆音或 clipping",
      detail: `Peak 約 ${round(peak, 3)}，有 ${clippingSamples} 個 sample 接近滿刻度。`,
      suggestion: "回聽確認是否失真；若需重錄，調低錄音介面實體增益，不是軟體監聽音量。",
      measuredValue: peak,
      expectedValue: 0.89
    });
  }
  if (rms < 0.018) {
    score -= 18;
    issues.push({
      timestampSeconds: 0,
      issueType: "level",
      severity: "medium",
      title: "錄音音量偏小",
      detail: `RMS 約 ${round(rms, 3)}，後製拉大時可能帶出底噪。`,
      suggestion: "靠近麥克風或提高輸入增益，但仍避免 peak 超過 0.9。",
      measuredValue: rms,
      expectedValue: 0.04
    });
  }
  if (rms > 0.24 && peak > 0.92) {
    score -= 12;
    issues.push({
      timestampSeconds: loudestIndex / sampleRate,
      issueType: "level",
      severity: "medium",
      title: "輸入音量偏熱",
      detail: "整體能量偏高，後面混音可調空間比較小。",
      suggestion: "下一次把輸入或演奏力度稍微降低一點。",
      measuredValue: rms,
      expectedValue: 0.16
    });
  }
  return { peak, rms, clippingSamples, score: clamp(Math.round(score), 0, 100), issues };
}

function detectOnsets(data: Float32Array, sampleRate: number) {
  const hopSize = Math.max(128, Math.round(sampleRate * 0.012));
  const envelope: number[] = [];
  for (let start = 0; start < data.length; start += hopSize) {
    let sum = 0;
    const end = Math.min(data.length, start + hopSize);
    for (let index = start; index < end; index += 1) sum += (data[index] ?? 0) ** 2;
    envelope.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const floor = percentile(envelope, 0.35);
  const loud = percentile(envelope, 0.88);
  const threshold = Math.max(0.009, floor + Math.max(0.006, loud - floor) * 0.34);
  const onsets: number[] = [];
  const refractoryBins = Math.max(2, Math.round(0.09 * sampleRate / hopSize));
  for (let index = 2; index < envelope.length - 2; index += 1) {
    const current = envelope[index] ?? 0;
    const previous = envelope[index - 1] ?? 0;
    const localPeak = current >= (envelope[index + 1] ?? 0) && current >= (envelope[index + 2] ?? 0);
    const enoughRise = current - previous > Math.max(0.0025, (loud - floor) * 0.08);
    if (current < threshold || !localPeak || !enoughRise) continue;
    if (onsets.length && index - (onsets.at(-1) ?? 0) < refractoryBins) continue;
    onsets.push(index);
  }
  return {
    onsetSeconds: onsets.map((bin) => (bin * hopSize) / sampleRate),
    envelope: envelope.map((value) => round(value))
  };
}

function analyzeTiming(data: Float32Array, sampleRate: number, bpm: number | null) {
  if (!bpm || bpm < 20 || bpm > 300) {
    return { score: null, driftMs: null, issues: [] as LocalPerformanceIssue[], onsetSeconds: [], offsetsMs: [] as number[] };
  }
  const detected = detectOnsets(data, sampleRate);
  if (detected.onsetSeconds.length < 3) {
    return { score: null, driftMs: null, issues: [] as LocalPerformanceIssue[], ...detected, offsetsMs: [] as number[] };
  }
  const gridSeconds = 30 / bpm;
  let bestPhase = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 48; step += 1) {
    const phase = (step / 48) * gridSeconds;
    const error = detected.onsetSeconds.reduce((total, onset) => {
      const nearest = Math.round((onset - phase) / gridSeconds) * gridSeconds + phase;
      return total + Math.abs(onset - nearest);
    }, 0);
    if (error < bestError) {
      bestError = error;
      bestPhase = phase;
    }
  }
  const offsetsMs = detected.onsetSeconds.map((onset) => {
    const nearest = Math.round((onset - bestPhase) / gridSeconds) * gridSeconds + bestPhase;
    return (onset - nearest) * 1_000;
  });
  const meanAbsoluteMs = offsetsMs.reduce((sum, value) => sum + Math.abs(value), 0) / offsetsMs.length;
  const driftMs = offsetsMs.reduce((sum, value) => sum + value, 0) / offsetsMs.length;
  const score = clamp(Math.round(100 - Math.max(0, meanAbsoluteMs - 14) * 1.55), 0, 100);
  const issues: LocalPerformanceIssue[] = [];
  for (let index = 0; index < offsetsMs.length && issues.length < 8; index += 1) {
    const offset = offsetsMs[index] ?? 0;
    if (Math.abs(offset) < 62) continue;
    issues.push({
      timestampSeconds: detected.onsetSeconds[index] ?? 0,
      issueType: "timing",
      severity: "medium",
      title: offset > 0 ? "疑似起音偏晚" : "疑似起音偏早",
      detail: `這個起音相對最近的八分音符格線約${offset > 0 ? "晚" : "早"} ${Math.round(Math.abs(offset))}ms。`,
      suggestion: "先回聽確認是否為切分、三連音或刻意律動；沒有標準節奏，不能判定漏拍。",
      measuredValue: round(offset, 1),
      expectedValue: 0
    });
  }
  return { score, driftMs: round(driftMs, 1), issues, onsetSeconds: detected.onsetSeconds.map((value) => round(value)), offsetsMs: offsetsMs.map((value) => round(value, 1)) };
}

function analyzePitch(data: Float32Array, sampleRate: number, instrument: PerformanceInstrument) {
  if (instrument === "drums") return { score: null, driftCents: null, issues: [] as LocalPerformanceIssue[], points: [] };
  const frameSize = Math.min(4_096, data.length);
  if (frameSize < 512) return { score: null, driftCents: null, issues: [] as LocalPerformanceIssue[], points: [] };
  const maxPoints = 180;
  const hopSize = Math.max(Math.floor(sampleRate * 0.12), Math.floor((data.length - frameSize) / maxPoints));
  const points: Array<TunerReading & { timestampSeconds: number }> = [];
  for (let start = 0; start + frameSize <= data.length; start += Math.max(1, hopSize)) {
    const reading = detectTunerReading(data.subarray(start, start + frameSize), sampleRate, instrument);
    if (!reading || reading.confidence < 0.64) continue;
    points.push({ ...reading, timestampSeconds: round((start + frameSize / 2) / sampleRate) });
  }
  if (points.length < 3) return { score: null, driftCents: null, issues: [] as LocalPerformanceIssue[], points };
  const averageAbsolute = points.reduce((sum, point) => sum + Math.abs(point.cents), 0) / points.length;
  const driftCents = points.reduce((sum, point) => sum + point.cents, 0) / points.length;
  const score = clamp(Math.round(100 - Math.max(0, averageAbsolute - 6) * 1.85), 0, 100);
  const issues: LocalPerformanceIssue[] = [];
  let lastIssueAt = -10;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (Math.abs(point.cents) < 28 || point.timestampSeconds - lastIssueAt < 0.45 || issues.length >= 8) continue;
    // Isolated frames commonly capture attacks, vibrato or pitch transitions.
    const sustained = points.slice(index, index + 3);
    if (sustained.length < 3 || sustained[2].timestampSeconds - point.timestampSeconds > 0.6 || !sustained.every(item =>
      item.note === point.note && item.octave === point.octave && Math.sign(item.cents) === Math.sign(point.cents) && Math.abs(item.cents) >= 28
    )) continue;
    issues.push({
      timestampSeconds: point.timestampSeconds,
      issueType: "pitch",
      severity: "medium",
      title: point.cents > 0 ? `${point.note}${point.octave} 疑似持續偏高` : `${point.note}${point.octave} 疑似持續偏低`,
      detail: `相對十二平均律最近半音約${point.cents > 0 ? "高" : "低"} ${Math.round(Math.abs(point.cents))} cents（可信度 ${Math.round(point.confidence * 100)}%）。`,
      suggestion: "回聽確認是否為滑音或刻意表情；最近半音不是標準旋律，不能單憑此判定唱錯。",
      measuredValue: point.cents,
      expectedValue: 0
    });
    lastIssueAt = point.timestampSeconds;
  }
  return { score, driftCents: round(driftCents, 1), issues, points };
}

export function analyzePerformanceSamples(
  data: Float32Array,
  sampleRate: number,
  options: AnalyzeOptions
): LocalPerformanceAnalysis {
  const level = analyzeLevel(data, sampleRate);
  const timingEnabled = options.detectionMode.includes("timing");
  const pitchEnabled = options.detectionMode.includes("pitch");
  const timing = timingEnabled
    ? analyzeTiming(data, sampleRate, options.targetBpm)
    : { score: null, driftMs: null, issues: [] as LocalPerformanceIssue[], onsetSeconds: [], offsetsMs: [] as number[] };
  const monophonicPitch = options.targetInstrument === "vocal" || options.targetInstrument === "bass";
  const pitch = pitchEnabled && monophonicPitch
    ? analyzePitch(data, sampleRate, options.targetInstrument)
    : { score: null, driftCents: null, issues: [] as LocalPerformanceIssue[], points: [] };
  const availableScores = [level.score, timing.score, pitch.score].filter((value): value is number => value !== null);
  const overallScore = Math.round(availableScores.reduce((sum, value) => sum + value, 0) / Math.max(1, availableScores.length));
  const issues = [...level.issues, ...timing.issues, ...pitch.issues]
    .sort((a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) || a.timestampSeconds - b.timestampSeconds)
    .slice(0, 16)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const recommendations = [
    level.issues.some((issue) => issue.issueType === "clipping") ? "先降低輸入增益再重錄。" : "錄音峰值保有可用空間。",
    timingEnabled
      ? timing.score === null
        ? "可辨識起音不足，拍點結果暫不評分；可錄一段較清楚的刷弦、彈奏或節奏句。"
        : timing.score >= 82
          ? "主要起音與節拍格線穩定。"
          : "先回聽標記區段，確認是否與預期節奏不符；不自動建議重錄。"
      : null,
    pitchEnabled
      ? pitch.score === null
        ? options.targetInstrument === "drums"
          ? "鼓軌不做音高評分。"
          : !monophonicPitch ? "此樂器可能含和弦；單音偵測不提供音準分數。" : "沒有足夠穩定單音可判讀。"
        : pitch.score >= 82
          ? "可辨識單音大多接近十二平均律中心。"
          : "用調音器先確認長音，再處理標記的音準區段。"
      : null
  ].filter((value): value is string => Boolean(value));
  const summary = issues.length
    ? `技術掃描找到 ${issues.length} 個待回聽疑點；是否重錄由製作人確認。`
    : "此技術掃描未標出疑點；不代表沒有漏拍、錯音或其他演奏問題。";

  return {
    overallScore,
    timingScore: timing.score,
    pitchScore: pitch.score,
    levelScore: level.score,
    durationSeconds: round(data.length / Math.max(1, sampleRate)),
    peak: round(level.peak),
    rms: round(level.rms),
    tempoDriftMs: timing.driftMs,
    pitchDriftCents: pitch.driftCents,
    summary,
    recommendations,
    metrics: {
      waveform: buildBars(data, 96),
      energy: buildBars(data, 24),
      clippingSamples: level.clippingSamples,
      sampleRate,
      onsetSeconds: timing.onsetSeconds,
      timingOffsetsMs: timing.offsetsMs,
      pitchPoints: pitch.points.map((point) => ({
        timestampSeconds: point.timestampSeconds,
        note: `${point.note}${point.octave}`,
        cents: point.cents,
        frequencyHz: point.frequencyHz,
        confidence: point.confidence
      })),
      analyzer: "songzu_local_performance_v3",
      assessment: "technical_screening_not_performance_grade",
      missingNotesAssessed: false,
      wrongNotesAssessed: false,
      polyphonicPitchAssessed: false,
      timingBasis: "auto_fitted_eighth_note_grid",
      pitchBasis: "nearest_12tet_semitone"
    },
    issues
  };
}
