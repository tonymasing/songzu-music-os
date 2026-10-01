export type HarmonyEvidenceFamily =
  | "harmonic_cqt"
  | "protected_reference"
  | "neural_harmony"
  | "long_context"
  | "note_events"
  | "bass_root"
  | "other";

export type HarmonyEvidenceCalibrationInput = {
  source: string;
  identity: string;
  baseWeight: number;
  confidence: number;
  overlapRatio?: number;
  tonalConcentration?: number;
  reliabilityMultiplier?: number;
};

export type CalibratedHarmonyEvidence = HarmonyEvidenceCalibrationInput & {
  family: HarmonyEvidenceFamily;
  reliability: number;
  familyConflict: number;
  effectiveWeight: number;
};

export type HarmonyVoteQuality = {
  share: number;
  margin: number;
  supportingFamilyCount: number;
  confidence: number;
};

export type HarmonyBeatQuality = {
  rootConfidence: number;
  qualityConfidence: number;
  independentFamilyCount: number;
  boundaryConfidence: number;
  conflict: boolean;
};

export type HarmonyPipelineQualityGate = {
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

export type HarmonyPipelineQualityConstraints = {
  beatGridConfidence?: number;
  sourceSuitability?: "good" | "limited" | "unknown";
  bassStemReliability?: number;
  harmonyStemReliability?: number;
};

const FAMILY_CAPS: Record<HarmonyEvidenceFamily, number> = {
  harmonic_cqt: 1.65,
  protected_reference: 0.38,
  neural_harmony: 1.05,
  long_context: 0.42,
  note_events: 0.72,
  bass_root: 1.2,
  other: 0.5
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function harmonyEvidenceFamily(source: string): HarmonyEvidenceFamily {
  if (["cqt_harmony_stem", "cqt_half_beat_detail", "cqt_two_beat", "cqt_full_measure"].includes(source)) {
    return "harmonic_cqt";
  }
  if (source === "cqt_protected_mix") return "protected_reference";
  if (["madmom_crf_harmony_stem", "madmom_crf_protected_mix"].includes(source)) return "neural_harmony";
  if (source === "btc_long_context") return "long_context";
  if (source === "basic_pitch_notes") return "note_events";
  if (source === "bass_root_anchor") return "bass_root";
  return "other";
}

/**
 * Multiple CQT windows are correlated views of the same signal. This calibrator
 * caps each evidence family before voting, so four CQT resolutions cannot pose
 * as four independent engines. Disagreement inside one family also lowers its
 * total authority instead of manufacturing confidence from duplicated evidence.
 */
export function calibrateHarmonyEvidence(
  inputs: HarmonyEvidenceCalibrationInput[]
): CalibratedHarmonyEvidence[] {
  const preliminary = inputs.map((input) => {
    const family = harmonyEvidenceFamily(input.source);
    const confidence = clamp(input.confidence / 100);
    const overlap = clamp(input.overlapRatio ?? 1);
    const concentration = input.tonalConcentration === undefined
      ? 1
      : 0.72 + clamp(input.tonalConcentration) * 0.28;
    const reliability =
      (0.38 + confidence * 0.62) *
      (0.55 + Math.sqrt(overlap) * 0.45) *
      concentration;
    return {
      ...input,
      family,
      reliability: clamp(reliability),
      preliminaryWeight: Math.max(0, input.baseWeight) * clamp(reliability) * clamp(input.reliabilityMultiplier ?? 1, 0.5, 1.25)
    };
  });

  const familyStats = new Map<HarmonyEvidenceFamily, {
    total: number;
    dominant: number;
  }>();
  for (const family of new Set(preliminary.map((item) => item.family))) {
    const members = preliminary.filter((item) => item.family === family);
    const identityWeights = new Map<string, number>();
    for (const member of members) {
      identityWeights.set(member.identity, (identityWeights.get(member.identity) ?? 0) + member.preliminaryWeight);
    }
    const total = members.reduce((sum, member) => sum + member.preliminaryWeight, 0);
    familyStats.set(family, {
      total,
      dominant: Math.max(0, ...identityWeights.values())
    });
  }

  return preliminary.map(({ preliminaryWeight, ...item }) => {
    const stats = familyStats.get(item.family)!;
    const familyConflict = stats.total > 0 ? clamp(1 - stats.dominant / stats.total) : 1;
    const capScale = stats.total > 0 ? Math.min(1, FAMILY_CAPS[item.family] / stats.total) : 0;
    const agreementScale = 1 - familyConflict * 0.38;
    return {
      ...item,
      familyConflict,
      effectiveWeight: preliminaryWeight * capScale * agreementScale
    };
  });
}

export function summarizeHarmonyVote(input: {
  winnerScore: number;
  runnerUpScore: number;
  totalScore: number;
  supportingFamilyCount: number;
}): HarmonyVoteQuality {
  const share = input.totalScore > 0 ? clamp(input.winnerScore / input.totalScore) : 0;
  const margin = input.totalScore > 0
    ? clamp((input.winnerScore - input.runnerUpScore) / input.totalScore)
    : 0;
  const familyDiversity = clamp(input.supportingFamilyCount / 3);
  const confidence = clamp(share * 0.46 + Math.min(1, margin * 2.5) * 0.24 + familyDiversity * 0.3);
  return {
    share,
    margin,
    supportingFamilyCount: input.supportingFamilyCount,
    confidence
  };
}

export function buildHarmonyPipelineQualityGate(
  beats: HarmonyBeatQuality[],
  constraints: HarmonyPipelineQualityConstraints = {}
): HarmonyPipelineQualityGate {
  if (!beats.length) {
    return {
      status: "degraded",
      beatCount: 0,
      highConfidenceBeatCount: 0,
      reviewBeatCount: 0,
      conflictBeatCount: 0,
      rootConfidence: 0,
      qualityConfidence: 0,
      boundaryConfidence: 0,
      independentFamilyAverage: 0,
      reasons: ["沒有可評估的逐拍和聲決策"]
    };
  }

  const beatGridConfidence = constraints.beatGridConfidence === undefined ? 1 : clamp(constraints.beatGridConfidence);
  const bassStemReliability = constraints.bassStemReliability === undefined ? 1 : clamp(constraints.bassStemReliability);
  const harmonyStemReliability = constraints.harmonyStemReliability === undefined ? 1 : clamp(constraints.harmonyStemReliability);
  const rootConfidence = mean(beats.map((beat) => clamp(beat.rootConfidence))) * (0.76 + bassStemReliability * 0.24);
  const qualityConfidence = mean(beats.map((beat) => clamp(beat.qualityConfidence))) * (0.76 + harmonyStemReliability * 0.24);
  const boundaryConfidence = mean(beats.map((beat) => clamp(beat.boundaryConfidence))) * (0.62 + beatGridConfidence * 0.38);
  const independentFamilyAverage = mean(beats.map((beat) => Math.max(0, beat.independentFamilyCount)));
  const conflictBeatCount = beats.filter((beat) => beat.conflict).length;
  const rawHighConfidenceBeatCount = beats.filter((beat) =>
    beat.rootConfidence >= 0.68 &&
    beat.qualityConfidence >= 0.58 &&
    beat.independentFamilyCount >= 2 &&
    !beat.conflict
  ).length;
  // An unstable beat grid cannot produce a high-confidence chord boundary,
  // even when the spectral chord vote happens to agree.
  const highConfidenceBeatCount = beatGridConfidence >= 0.55 ? rawHighConfidenceBeatCount : 0;
  const reviewBeatCount = beats.length - highConfidenceBeatCount;
  const conflictRatio = conflictBeatCount / beats.length;
  const highConfidenceRatio = highConfidenceBeatCount / beats.length;
  const reasons: string[] = [];

  if (rootConfidence < 0.68) reasons.push("根音平均證據仍不足");
  if (qualityConfidence < 0.58) reasons.push("大、小、七與延伸音性質仍有分歧");
  if (independentFamilyAverage < 2) reasons.push("每拍獨立證據家族不足兩組");
  if (conflictRatio > 0.12) reasons.push(`${Math.round(conflictRatio * 100)}% 拍點存在跨家族衝突`);
  if (highConfidenceRatio < 0.68) reasons.push("高可信逐拍覆蓋尚未達 68%");
  if (beatGridConfidence < 0.55) reasons.push(`拍點可信僅 ${Math.round(beatGridConfidence * 100)}%，已禁止高可信輸出`);
  if (constraints.sourceSuitability === "limited") reasons.push("來源音質受限，品質閘門最高只能進入複核");
  if (constraints.sourceSuitability === "unknown") reasons.push("來源規格無法完整確認");
  if (bassStemReliability < 0.65) reasons.push(`Bass Stem 可靠度 ${Math.round(bassStemReliability * 100)}%，根音證據已降權`);
  if (harmonyStemReliability < 0.65) reasons.push(`和聲 Stem 可靠度 ${Math.round(harmonyStemReliability * 100)}%，和弦性質證據已降權`);

  const degraded =
    rootConfidence < 0.44 ||
    qualityConfidence < 0.36 ||
    independentFamilyAverage < 1.25 ||
    conflictRatio > 0.42 ||
    beatGridConfidence < 0.38;
  const passed =
    !degraded &&
    rootConfidence >= 0.68 &&
    qualityConfidence >= 0.58 &&
    independentFamilyAverage >= 2 &&
    conflictRatio <= 0.12 &&
    highConfidenceRatio >= 0.68 &&
    beatGridConfidence >= 0.55 &&
    constraints.sourceSuitability !== "limited" &&
    constraints.sourceSuitability !== "unknown" &&
    bassStemReliability >= 0.65 &&
    harmonyStemReliability >= 0.65;

  return {
    status: degraded ? "degraded" : passed ? "pass" : "review",
    beatCount: beats.length,
    highConfidenceBeatCount,
    reviewBeatCount,
    conflictBeatCount,
    rootConfidence,
    qualityConfidence,
    boundaryConfidence,
    independentFamilyAverage,
    reasons: reasons.length ? reasons : ["根音、和弦性質與獨立來源覆蓋均達主管線門檻"]
  };
}
