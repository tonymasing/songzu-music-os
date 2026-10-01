import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import {
  AUTO_SCORE_STRUMMING_SUBDIVISIONS,
  autoScoreReviewableMeasures,
  autoScoreSheetSections,
  buildAutoScoreStrummingGuide,
  type AutoScoreResult,
  type AutoScoreStrumStroke,
  type AutoScoreStrummingGuide,
  type AutoScoreStrummingPattern,
  type AutoScoreStrummingSubdivision,
  type AutoScoreStrummingSubdivisionOption
} from "@/lib/auto-score";

const SAMPLE_RATE = 8_000;
const MAX_AUDIO_SECONDS = 60 * 20;
const ffmpegPath = existsSync(process.env.SONGZU_FFMPEG_PATH || "")
  ? process.env.SONGZU_FFMPEG_PATH!
  : existsSync("/opt/homebrew/bin/ffmpeg")
    ? "/opt/homebrew/bin/ffmpeg"
    : existsSync("/usr/local/bin/ffmpeg")
      ? "/usr/local/bin/ffmpeg"
      : "ffmpeg";

type Onset = { time: number; strength: number; sharpness: number };
type BarEvidence = {
  index: number;
  start: number;
  end: number;
  energy: number;
  slotStrengths: number[];
  slotSharpness: number[];
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))] ?? 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function decodeProtectedAudio(filePath: string) {
  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-v", "error",
      "-i", filePath,
      "-t", String(MAX_AUDIO_SECONDS),
      "-map", "0:a:0",
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-f", "f32le",
      "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let byteCount = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      byteCount += chunk.length;
      if (byteCount > SAMPLE_RATE * MAX_AUDIO_SECONDS * 4 + 4096) {
        child.kill("SIGTERM");
        reject(new Error("刷法分析音訊超過本機安全上限"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `ffmpeg ${code}`));
        return;
      }
      const pcm = Buffer.concat(chunks);
      const aligned = pcm.subarray(0, pcm.length - (pcm.length % 4));
      const copied = aligned.buffer.slice(aligned.byteOffset, aligned.byteOffset + aligned.byteLength);
      const samples = new Float32Array(copied);
      if (!samples.length) reject(new Error("受保護音檔沒有可分析的 PCM 內容"));
      else resolve(samples);
    });
  });
}

function detectOnsets(samples: Float32Array) {
  const hop = Math.round(SAMPLE_RATE * 0.01);
  const windowSize = Math.round(SAMPLE_RATE * 0.025);
  const energies: number[] = [];
  const transients: number[] = [];
  for (let start = 0; start + windowSize < samples.length; start += hop) {
    let sum = 0;
    let difference = 0;
    let previous = samples[start] ?? 0;
    for (let index = start; index < start + windowSize; index += 1) {
      const sample = samples[index] ?? 0;
      sum += sample * sample;
      const delta = sample - previous;
      difference += delta * delta;
      previous = sample;
    }
    energies.push(Math.log1p(Math.sqrt(sum / windowSize) * 180));
    transients.push(Math.log1p(Math.sqrt(difference / windowSize) * 120));
  }

  const novelty = energies.map((energy, index) => {
    const baseline = average(energies.slice(Math.max(0, index - 24), index));
    const previous = energies[Math.max(0, index - 2)] ?? energy;
    const energyRise = Math.max(0, energy - Math.max(previous * 0.92, baseline * 0.94));
    const transientRise = Math.max(0, (transients[index] ?? 0) - average(transients.slice(Math.max(0, index - 12), index)) * 0.9);
    return energyRise * 0.7 + transientRise * 0.3;
  });
  const threshold = Math.max(0.018, percentile(novelty, 0.76) * 0.72);
  const normalization = Math.max(threshold, percentile(novelty, 0.94));
  const onsets: Onset[] = [];
  let lastFrame = -10;
  for (let index = 2; index < novelty.length - 2; index += 1) {
    const value = novelty[index] ?? 0;
    if (value < threshold || value < (novelty[index - 1] ?? 0) || value < (novelty[index + 1] ?? 0)) continue;
    if (index - lastFrame < 4) {
      if (onsets.length && value > (novelty[lastFrame] ?? 0)) {
        onsets.pop();
      } else {
        continue;
      }
    }
    const attackEnergy = energies[index] ?? 0;
    const tailEnergy = average(energies.slice(index + 4, index + 12));
    onsets.push({
      time: (index * hop + windowSize / 2) / SAMPLE_RATE,
      strength: clamp(value / normalization, 0.05, 1),
      sharpness: clamp((attackEnergy - tailEnergy + 0.3) / 0.9, 0, 1)
    });
    lastFrame = index;
  }
  return { onsets, energies, hopSeconds: hop / SAMPLE_RATE };
}

function optionSlotCount(option: AutoScoreStrummingSubdivisionOption) {
  return Math.max(1, Math.round(4 / option.slotDurationBeats));
}

function slotTimes(start: number, end: number, option: AutoScoreStrummingSubdivisionOption) {
  const count = optionSlotCount(option);
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / count);
}

function scoreSubdivision(
  measures: ReturnType<typeof autoScoreReviewableMeasures>,
  onsets: Onset[],
  option: AutoScoreStrummingSubdivisionOption
) {
  let weightedFit = 0;
  let totalWeight = 0;
  let covered = 0;
  for (const onset of onsets) {
    const measure = measures.find((candidate) => onset.time >= candidate.startSeconds && onset.time < candidate.endSeconds);
    if (!measure) continue;
    const times = slotTimes(measure.startSeconds, measure.endSeconds, option);
    const slotDuration = (measure.endSeconds - measure.startSeconds) / Math.max(1, times.length);
    const distance = Math.min(...times.map((time) => Math.abs(time - onset.time)));
    const tolerance = Math.min(0.09, Math.max(0.035, slotDuration * 0.38));
    const fit = Math.exp(-((distance / tolerance) ** 2));
    weightedFit += fit * onset.strength;
    totalWeight += onset.strength;
    if (distance <= tolerance) covered += 1;
  }
  const fit = totalWeight ? weightedFit / totalWeight : 0;
  const coverage = onsets.length ? covered / onsets.length : 0;
  const complexityPenalty: Record<AutoScoreStrummingSubdivision, number> = {
    quarter: 0,
    eighth: 0.015,
    sixteenth: 0.055,
    quarter_triplet: 0.025,
    beat_triplet: 0.045,
    beat_sextuplet: 0.085
  };
  return fit * 0.72 + coverage * 0.28 - complexityPenalty[option.id];
}

function chooseSubdivision(measures: ReturnType<typeof autoScoreReviewableMeasures>, onsets: Onset[]) {
  const candidates = AUTO_SCORE_STRUMMING_SUBDIVISIONS.map((option) => ({
    option,
    score: scoreSubdivision(measures, onsets, option)
  })).sort((left, right) => right.score - left.score);
  const best = candidates[0] ?? { option: AUTO_SCORE_STRUMMING_SUBDIVISIONS[1], score: 0 };
  const simpler = candidates
    .filter((candidate) => candidate.score >= best.score - 0.025)
    .sort((left, right) => optionSlotCount(left.option) - optionSlotCount(right.option))[0];
  return { option: simpler?.option ?? best.option, score: clamp(best.score, 0, 1), candidates };
}

function buildBarEvidence(
  measures: ReturnType<typeof autoScoreReviewableMeasures>,
  onsets: Onset[],
  energies: number[],
  hopSeconds: number,
  option: AutoScoreStrummingSubdivisionOption
) {
  const rawBars: BarEvidence[] = measures.map((measure) => {
    const times = slotTimes(measure.startSeconds, measure.endSeconds, option);
    const slotDuration = (measure.endSeconds - measure.startSeconds) / Math.max(1, times.length);
    const slotStrengths = times.map((time) => {
      const nearby = onsets.filter((onset) => Math.abs(onset.time - time) <= Math.min(0.085, slotDuration * 0.42));
      return nearby.length ? Math.max(...nearby.map((onset) => onset.strength)) : 0;
    });
    const slotSharpness = times.map((time) => {
      const nearby = onsets.filter((onset) => Math.abs(onset.time - time) <= Math.min(0.07, slotDuration * 0.35));
      return nearby.length ? average(nearby.map((onset) => onset.sharpness)) : 0;
    });
    const from = clamp(Math.floor(measure.startSeconds / hopSeconds), 0, energies.length);
    const to = clamp(Math.ceil(measure.endSeconds / hopSeconds), from + 1, energies.length);
    return {
      index: measure.number,
      start: measure.startSeconds,
      end: measure.endSeconds,
      energy: average(energies.slice(from, to)),
      slotStrengths,
      slotSharpness
    };
  });
  const low = percentile(rawBars.map((bar) => bar.energy), 0.12);
  const high = percentile(rawBars.map((bar) => bar.energy), 0.88);
  const range = Math.max(0.01, high - low);
  return rawBars.map((bar) => ({ ...bar, energy: clamp((bar.energy - low) / range, 0, 1) }));
}

function manualPreference(
  guides: AutoScoreStrummingGuide[],
  patternId: string,
  subdivision: AutoScoreStrummingSubdivision,
  slotCount: number
) {
  const variants = guides.flatMap((guide) => guide.patterns
    .filter((pattern) => pattern.id === patternId)
    .flatMap((pattern) => {
      const variant = pattern.variants?.[subdivision];
      return variant?.source === "manual" && variant.strokes.length === slotCount ? [variant] : [];
    }));
  if (!variants.length) return null;
  const strokes = Array.from({ length: slotCount }, (_, index) => {
    const votes = new Map<AutoScoreStrumStroke, number>();
    for (const variant of variants) votes.set(variant.strokes[index], (votes.get(variant.strokes[index]) ?? 0) + 1);
    return [...votes].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "rest";
  });
  const accents = Array.from({ length: slotCount }, (_, index) => variants.filter((variant) => variant.accents.includes(index)).length >= Math.ceil(variants.length / 2) ? index : -1).filter((index) => index >= 0);
  return { strokes, accents, exampleCount: variants.length };
}

function strumDirection(index: number, subdivision: AutoScoreStrummingSubdivision): AutoScoreStrumStroke {
  if (subdivision === "quarter") return "down";
  return index % 2 === 0 ? "down" : "up";
}

function generatedPattern(input: {
  id: string;
  label: string;
  difficulty: AutoScoreStrummingPattern["difficulty"];
  feel: string;
  instruction: string;
  bars: BarEvidence[];
  allBars: BarEvidence[];
  subdivision: AutoScoreStrummingSubdivision;
  count: string[];
  confidence: number;
  personalGuides: AutoScoreStrummingGuide[];
  threshold: number;
  allowMute?: boolean;
}) {
  const sampleBars = input.bars.length ? input.bars : input.allBars;
  const slotCount = input.count.length;
  const slotStrengths = Array.from({ length: slotCount }, (_, index) => average(sampleBars.map((bar) => bar.slotStrengths[index] ?? 0)));
  const slotSharpness = Array.from({ length: slotCount }, (_, index) => average(sampleBars.map((bar) => bar.slotSharpness[index] ?? 0)));
  const strengthFloor = Math.max(0.12, percentile(slotStrengths.filter((value) => value > 0), input.threshold));
  const preference = manualPreference(input.personalGuides, input.id, input.subdivision, slotCount);
  const strokes = slotStrengths.map((strength, index): AutoScoreStrumStroke => {
    const nearThreshold = Math.abs(strength - strengthFloor) <= 0.08;
    if (preference && nearThreshold && preference.strokes[index] !== "rest") return preference.strokes[index];
    if (strength < strengthFloor) return "rest";
    if (input.allowMute && slotSharpness[index] >= 0.7 && strength < percentile(slotStrengths, 0.78)) return "mute";
    return strumDirection(index, input.subdivision);
  });
  if (!strokes.some((stroke) => stroke !== "rest")) strokes[0] = "down";
  if (strokes[0] === "rest") strokes[0] = "down";
  const accentFloor = percentile(slotStrengths, 0.78);
  let accents = slotStrengths.flatMap((strength, index) => strength >= accentFloor && strokes[index] !== "rest" ? [index] : []);
  if (!accents.includes(0)) accents = [0, ...accents];
  if (preference) accents = Array.from(new Set([...accents, ...preference.accents])).sort((left, right) => left - right);
  const now = new Date().toISOString();
  return {
    id: input.id,
    label: input.label,
    difficulty: input.difficulty,
    subdivision: input.subdivision,
    count: input.count,
    strokes,
    accents,
    feel: input.feel,
    instruction: input.instruction,
    variants: {
      [input.subdivision]: {
        count: input.count,
        strokes,
        accents,
        source: "auto_audio_analysis" as const,
        confidence: Math.round(input.confidence),
        updatedAt: now,
        updatedBy: "本機節奏分析器"
      }
    }
  } satisfies AutoScoreStrummingPattern;
}

function mergeManualVariants(generated: AutoScoreStrummingGuide, previous?: AutoScoreStrummingGuide) {
  if (!previous) return generated;
  return {
    ...generated,
    patterns: generated.patterns.map((pattern) => {
      const previousPattern = previous.patterns.find((candidate) => candidate.id === pattern.id);
      const manualVariants = Object.fromEntries(Object.entries(previousPattern?.variants ?? {})
        .filter(([, variant]) => variant?.source === "manual"));
      return Object.keys(manualVariants).length
        ? { ...pattern, variants: { ...(pattern.variants ?? {}), ...manualVariants } }
        : pattern;
    })
  };
}

export async function analyzeAudioStrummingGuide(input: {
  result: AutoScoreResult;
  filePath: string;
  personalGuides?: AutoScoreStrummingGuide[];
}) {
  if (!existsSync(input.filePath)) throw new Error("找不到刷法分析的受保護來源音檔");
  const samples = await decodeProtectedAudio(input.filePath);
  const { onsets, energies, hopSeconds } = detectOnsets(samples);
  const measures = autoScoreReviewableMeasures(input.result).filter((measure) => measure.startSeconds < samples.length / SAMPLE_RATE);
  if (!measures.length) throw new Error("草譜沒有可用的小節時間格");
  if (onsets.length < 4) throw new Error("音檔起音太少，無法可靠建立刷法");

  const chosen = chooseSubdivision(measures, onsets);
  const barEvidence = buildBarEvidence(measures, onsets, energies, hopSeconds, chosen.option);
  const energiesSorted = barEvidence.map((bar) => bar.energy);
  const lowCut = percentile(energiesSorted, 0.34);
  const highCut = percentile(energiesSorted, 0.7);
  const risingBars = barEvidence.filter((bar, index) => bar.energy - (barEvidence[index - 1]?.energy ?? bar.energy) > 0.08 || bar.energy >= highCut);
  const groupSeeds = chosen.option.id === "quarter_triplet"
    ? [["1", "2", "3"], ["1", "2", "3"]]
    : Array.from({ length: 4 }, () => chosen.option.id === "quarter"
      ? ["拍"]
      : chosen.option.id === "eighth"
        ? ["正", "&"]
        : chosen.option.id === "sixteenth"
          ? ["正", "e", "&", "a"]
          : chosen.option.id === "beat_triplet"
            ? ["1", "2", "3"]
            : ["1", "2", "3", "4", "5", "6"]);
  const count = groupSeeds.flat();
  const confidence = clamp((chosen.score * 72) + ((input.result.rhythm?.confidence ?? 50) * 0.28), 25, 96);
  const personalGuides = input.personalGuides ?? [];
  const patterns = [
    generatedPattern({ id: "steady_quarters", label: "音檔低密度骨架", difficulty: "入門", feel: "保留歌曲的主要拍點，適合先把和弦與速度彈穩。", instruction: "依原音檔低能量小節的起音統計產生；方向按右手連續擺動推算。", bars: barEvidence.filter((bar) => bar.energy <= lowCut), allBars: barEvidence, subdivision: chosen.option.id, count, confidence, personalGuides, threshold: 0.6 }),
    generatedPattern({ id: "open_ballad", label: "音檔主刷法", difficulty: "標準", feel: "取全曲最常出現的拍內起音位置，作為立即可用的主要伴奏。", instruction: "拍點來自受保護原音檔；下上刷方向是依連續右手運動的人體工學推算。", bars: barEvidence, allBars: barEvidence, subdivision: chosen.option.id, count, confidence, personalGuides, threshold: 0.52 }),
    generatedPattern({ id: "lifted_eighths", label: "音檔高能量推進", difficulty: "標準", feel: "依較飽滿段落的起音密度保留更多刷弦位置。", instruction: "適合副歌或推進段；重音位置依瞬態強度與小節拍點產生。", bars: barEvidence.filter((bar) => bar.energy >= highCut), allBars: barEvidence, subdivision: chosen.option.id, count, confidence, personalGuides, threshold: 0.42 }),
    generatedPattern({ id: "muted_build", label: "音檔短音與漸強", difficulty: "進階", feel: "優先取能量上升與短促瞬態，建立進段前的張力。", instruction: "只有在起音後快速衰減時才推測悶音；不確定的位置保留一般刷弦。", bars: risingBars, allBars: barEvidence, subdivision: chosen.option.id, count, confidence, personalGuides, threshold: 0.48, allowMute: true })
  ];
  const fallback = buildAutoScoreStrummingGuide(input.result);
  const formalSections = autoScoreSheetSections(input.result);
  const sections = formalSections.map((section, sectionIndex) => {
    const sourceMeasures = new Set(section.measures.flatMap((measure) => measure.sourceMeasure === null ? [] : [measure.sourceMeasure]));
    const bars = barEvidence.filter((bar) => sourceMeasures.has(bar.index));
    const energy = average(bars.map((bar) => bar.energy));
    const rising = average(bars.map((bar, index) => Math.max(0, bar.energy - (bars[index - 1]?.energy ?? bar.energy))));
    const patternId = rising > 0.09 ? "muted_build" : energy >= highCut ? "lifted_eighths" : energy <= lowCut ? "steady_quarters" : "open_ballad";
    const pattern = patterns.find((candidate) => candidate.id === patternId) ?? patterns[1];
    return {
      label: section.label || `第 ${sectionIndex + 1} 段`,
      firstMeasure: section.firstMeasure,
      lastMeasure: section.lastMeasure,
      patternId,
      dynamics: energy >= 0.72 ? "mf–f" : energy <= 0.32 ? "p–mp" : rising > 0.09 ? "mp 漸強至 mf" : "mp–mf",
      instruction: `${pattern.label}；${pattern.instruction}`
    };
  });
  const manualExampleCount = personalGuides.reduce((total, guide) => total + guide.patterns.reduce((patternTotal, pattern) => patternTotal + Object.values(pattern.variants ?? {}).filter((variant) => variant?.source === "manual").length, 0), 0);
  const guide: AutoScoreStrummingGuide = {
    ...fallback,
    unit: "音檔起音與拍格分析",
    defaultSubdivision: chosen.option.id,
    analysis: {
      engine: "songzu_local_audio_strumming_v1",
      source: "protected_audio_transients_and_beat_grid",
      detectedSubdivision: chosen.option.id,
      confidence: Math.round(confidence),
      onsetCount: onsets.length,
      analyzedBarCount: barEvidence.length,
      manualExampleCount,
      generatedAt: new Date().toISOString(),
      evidence: [
        `${onsets.length} 個音訊起音`,
        `${barEvidence.length} 小節逐拍格`,
        `${chosen.option.label}量化最符合`,
        personalGuides.length ? `${manualExampleCount} 組 本機創作者 修訂偏好參與邊界判斷` : "尚無人工刷法樣本"
      ]
    },
    note: "本機分析器會從受保護原音檔偵測起音、重拍、短音與段落能量，先產生可立即使用的伴奏刷法。下刷／上刷方向屬人體工學推算；你的一次儲存修訂會永久覆蓋該細分版本，並成為後續個人化參考。",
    patterns,
    sections
  };
  return mergeManualVariants(guide, input.result.strummingGuide);
}
