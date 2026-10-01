const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const PITCH_CLASS: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11
};

const CHORD_PATTERN = /^([A-G](?:#|b)?)(mMaj7|maj9|maj7|m7b5|dim7|7sus4|sus2|sus4|add9|6\/9|m9|m7|m6|dim|aug|9|7|6|m)?(?:\/([A-G](?:#|b)?))?$/;
const FLAT_KEYS = new Set([
  "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb",
  "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm"
]);

const QUALITY_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  maj9: [0, 2, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m9: [0, 2, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  add9: [0, 2, 4, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "6/9": [0, 2, 4, 7, 9],
  "9": [0, 2, 4, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8]
};

const DEFINING_INTERVALS: Record<string, number[]> = {
  "7": [10],
  maj7: [11],
  maj9: [11, 2],
  m7: [10],
  m9: [10, 2],
  mMaj7: [11],
  "9": [10, 2],
  add9: [2],
  "6": [9],
  m6: [9],
  "6/9": [9, 2],
  dim7: [9],
  "7sus4": [10]
};

type HarmonyEvidenceLike = {
  source: string;
  name: string;
  confidence: number;
  weight: number;
  support?: "supports" | "alternate" | "neutral";
};

export type HarmonyPostprocessEvent = {
  name: string;
  initialHarmonyName?: string;
  root?: string;
  quality?: string;
  bass?: string | null;
  durationSeconds: number;
  confidence?: number;
  boundaryConfidence?: number;
  harmonicChangeConfidence?: number;
  rootConfidence?: number;
  qualityConfidence?: number;
  independentSourceCount?: number;
  isolatedBassEvidence?: boolean;
  bassPitch?: string | null;
  bassPitchConfidence?: number | null;
  bassPitchStability?: number | null;
  alternateNames?: string[];
  candidateAlternatives?: Array<{ name: string; score: number }>;
  notePitchClasses?: number[];
  noteMidiWeights?: Array<{ midi: number; pitchClass: number; weight: number }>;
  evidence?: HarmonyEvidenceLike[];
};

export type StructuralHarmonyDecision = "unchanged" | "simplified_color" | "context_consensus";

export type StructuralHarmonyEvent<T extends HarmonyPostprocessEvent = HarmonyPostprocessEvent> = T & {
  acousticDetailName?: string;
  structuralDecision: StructuralHarmonyDecision;
  structuralConfidence: number;
};

export type StructuralHarmonyResult<T extends HarmonyPostprocessEvent = HarmonyPostprocessEvent> = {
  events: Array<StructuralHarmonyEvent<T>>;
  simplifiedBeatCount: number;
  structuralChordChangeCount: number;
};

export type HarmonyColorCandidate = {
  name: string;
  score: number;
  selectedDuration: number;
  definingSupport: number;
  independentQualityFamilies: number;
  qualifiedExtension: boolean;
};

export type HarmonyColorRunDecision = {
  winner: HarmonyColorCandidate | null;
  runnerUp: HarmonyColorCandidate | null;
  candidates: HarmonyColorCandidate[];
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedKey(value: string | null | undefined) {
  return (value ?? "")
    .replace(/Major|major|maj/g, "")
    .replace(/Minor|minor|min/g, "m")
    .replace(/→/g, "->")
    .split("->", 1)[0]
    .trim();
}

export function preferFlatChordSpelling(musicalKey: string | null | undefined) {
  const key = normalizedKey(musicalKey);
  if (key.includes("b")) return true;
  if (key.includes("#")) return false;
  return FLAT_KEYS.has(key);
}

export function spellPitchForKey(name: string, musicalKey: string | null | undefined) {
  const pitch = PITCH_CLASS[name];
  if (!Number.isFinite(pitch)) return name;
  return (preferFlatChordSpelling(musicalKey) ? FLAT_NAMES : SHARP_NAMES)[pitch];
}

export function spellChordNameForKey(name: string, musicalKey: string | null | undefined) {
  if (name === "N.C.") return name;
  const match = CHORD_PATTERN.exec(name);
  if (!match) return name;
  const root = spellPitchForKey(match[1], musicalKey);
  const bass = match[3] ? `/${spellPitchForKey(match[3], musicalKey)}` : "";
  return `${root}${match[2] ?? ""}${bass}`;
}

function parseChord(name: string) {
  const match = CHORD_PATTERN.exec(name);
  if (!match) return null;
  const root = PITCH_CLASS[match[1]];
  const bass = match[3] ? PITCH_CLASS[match[3]] : null;
  if (!Number.isFinite(root) || (match[3] && !Number.isFinite(bass))) return null;
  return {
    root,
    quality: match[2] ?? "",
    bass,
    rootName: match[1],
    bassName: match[3] ?? null
  };
}

function colorLineage(quality: string) {
  if (["", "7", "9", "maj7", "maj9", "add9", "6", "6/9"].includes(quality)) return "major";
  if (["m", "m7", "m9", "mMaj7", "m6"].includes(quality)) return "minor";
  return quality;
}

function canonicalChordIdentity(name: string, includeQuality = true) {
  const chord = parseChord(name);
  if (!chord) return name;
  const quality = includeQuality ? chord.quality : colorLineage(chord.quality);
  const bass = chord.bass === null ? "" : `/${chord.bass}`;
  return `${chord.root}:${quality}${bass}`;
}

function baseIntervals(quality: string) {
  if (["m", "m7", "m9", "mMaj7", "m6"].includes(quality)) return [0, 3, 7];
  if (["dim", "dim7", "m7b5"].includes(quality)) return [0, 3, 6];
  if (quality === "aug") return [0, 4, 8];
  if (quality === "sus2") return [0, 2, 7];
  if (["sus4", "7sus4"].includes(quality)) return [0, 5, 7];
  return [0, 4, 7];
}

export function definingColorSupport(name: string, pitchClasses: number[] | undefined) {
  const chord = parseChord(name);
  const defining = chord ? DEFINING_INTERVALS[chord.quality] : null;
  if (!chord || !defining?.length || pitchClasses?.length !== 12) return 0;
  const total = pitchClasses.reduce((sum, value) => sum + Math.max(0, value ?? 0), 0);
  if (total <= 1e-9) return 0;
  const normalized = pitchClasses.map((value) => Math.max(0, value ?? 0) / total);
  const definingEnergy = Math.min(...defining.map((interval) => normalized[(chord.root + interval) % 12] ?? 0));
  const core = baseIntervals(chord.quality)
    .map((interval) => normalized[(chord.root + interval) % 12] ?? 0)
    .sort((left, right) => left - right);
  const coreMedian = core[Math.floor(core.length / 2)] ?? 0;
  const relative = definingEnergy / Math.max(0.04, coreMedian);
  return clamp(definingEnergy * 3.2 + clamp((relative - 0.32) / 0.9) * 0.34);
}

function qualityEvidenceFamily(source: string) {
  if (source === "basic_pitch_notes") return "note_events";
  if (source === "btc_long_context") return "long_context";
  if (source === "repeated_section_consensus") return "repeated_section";
  if (source.startsWith("madmom_crf_")) return "neural_harmony";
  if (source === "cqt_protected_mix") return "protected_mix";
  if (source.startsWith("cqt_")) return "harmonic_cqt";
  return null;
}

function projectedStructuralQuality(quality: string) {
  if (quality === "maj9") return "maj7";
  if (quality === "m9") return "m7";
  if (quality === "9") return "7";
  if (quality === "add9") return "";
  if (quality === "6/9") return "6";
  return quality;
}

function structuralBaseQuality(lineage: string) {
  if (lineage === "minor") return "m";
  if (lineage === "major") return "";
  return lineage;
}

function structuralNameForEvent(event: HarmonyPostprocessEvent, quality: string) {
  const chord = parseChord(event.name);
  if (!chord) return event.name;
  const observedBass = stableObservedBass(event);
  const preserveSlash = chord.bass !== null && (
    observedBass === chord.bass || evidenceSupportsCurrentBass(event)
  );
  const slash = preserveSlash && chord.bassName ? `/${chord.bassName}` : "";
  return `${chord.rootName}${quality}${slash}`;
}

function structuralQualityFamilies(event: HarmonyPostprocessEvent, root: number, quality: string) {
  const families = new Set<string>();
  for (const evidence of event.evidence ?? []) {
    if (evidence.support !== "supports" || evidence.confidence < 52 || evidence.weight < 0.18) continue;
    const candidate = parseChord(evidence.name);
    if (!candidate || candidate.root !== root || projectedStructuralQuality(candidate.quality) !== quality) continue;
    const family = qualityEvidenceFamily(evidence.source);
    // Note events can confirm that a color tone exists, but a melody note is
    // never allowed to become an independent vote for the lead-sheet chord.
    if (family && family !== "note_events") families.add(family);
  }
  return families;
}

function weightedMedianMidi(notes: Array<{ midi: number; weight: number }>) {
  const sorted = [...notes].sort((left, right) => left.midi - right.midi);
  const total = sorted.reduce((sum, note) => sum + Math.max(0, note.weight), 0);
  let cumulative = 0;
  for (const note of sorted) {
    cumulative += Math.max(0, note.weight);
    if (cumulative >= total / 2) return note.midi;
  }
  return sorted.at(-1)?.midi ?? 0;
}

function isolatedUpperVoiceColor(event: HarmonyPostprocessEvent, name: string) {
  const chord = parseChord(name);
  const defining = chord ? DEFINING_INTERVALS[chord.quality] : null;
  const notes = event.noteMidiWeights?.filter((note) => note.weight >= 0.015) ?? [];
  if (!chord || !defining?.length || !notes.length) return false;

  const definingPcs = new Set(defining.map((interval) => (chord.root + interval) % 12));
  const corePcs = new Set(baseIntervals(chord.quality).map((interval) => (chord.root + interval) % 12));
  const colorNotes = notes.filter((note) => definingPcs.has(note.pitchClass));
  const coreNotes = notes.filter((note) => corePcs.has(note.pitchClass));
  if (!colorNotes.length || coreNotes.length < 2) return false;

  const colorWeight = colorNotes.reduce((sum, note) => sum + note.weight, 0);
  const representedCorePcs = new Set(coreNotes.map((note) => note.pitchClass));
  if (colorWeight < 0.08 || representedCorePcs.size < 2) return false;

  const colorMedian = weightedMedianMidi(colorNotes);
  const coreMedian = weightedMedianMidi(coreNotes);
  const colorSpread = Math.max(...colorNotes.map((note) => note.midi)) - Math.min(...colorNotes.map((note) => note.midi));
  const observedBass = stableObservedBass(event);
  const bassGroundsRoot = observedBass === chord.root &&
    (event.bassPitchConfidence ?? 0) >= 80 &&
    (event.bassPitchStability ?? 0) >= 0.75;

  return !bassGroundsRoot && colorMedian >= 72 && colorMedian - coreMedian >= 9 && colorSpread <= 7;
}

type StructuralQualityStats = {
  quality: string;
  beatCount: number;
  registerGroundedBeatCount: number;
  qualityConfidence: number;
  definingSupport: number;
  families: Set<string>;
  qualified: boolean;
  score: number;
};

function structuralQualityStats(
  events: HarmonyPostprocessEvent[],
  root: number,
  quality: string,
  beatDuration: number,
  lineage: string
): StructuralQualityStats {
  const selected = events.filter((event) => {
    const chord = parseChord(event.name);
    return chord?.root === root && projectedStructuralQuality(chord.quality) === quality;
  });
  const selectedDuration = selected.reduce((sum, event) => sum + Math.max(0.001, event.durationSeconds), 0);
  const candidateName = selected[0] ? structuralNameForEvent(selected[0], quality).replace(/\/[A-G](?:#|b)?$/, "") : "";
  const baseQuality = structuralBaseQuality(lineage);
  const registerGroundedColorEvents = quality === baseQuality || !candidateName
    ? []
    : events.filter((event) => {
        const chord = parseChord(event.name);
        return chord?.root === root &&
          colorLineage(chord.quality) === lineage &&
          definingColorSupport(candidateName, event.notePitchClasses) >= 0.4 &&
          !isolatedUpperVoiceColor(event, candidateName);
      });
  const registerGroundedDuration = registerGroundedColorEvents.reduce(
    (sum, event) => sum + Math.max(0.001, event.durationSeconds),
    0
  );
  const runDuration = events.reduce(
    (sum, event) => sum + Math.max(0.001, event.durationSeconds),
    0
  );
  const initialSelectedDuration = quality === baseQuality ? 0 : events.reduce((sum, event) => {
    const initial = parseChord(event.initialHarmonyName ?? "");
    if (
      initial?.root !== root ||
      projectedStructuralQuality(initial.quality) !== quality
    ) return sum;
    return sum + Math.max(0.001, event.durationSeconds);
  }, 0);
  const initialContinuationDuration = (
    ["7", "maj7", "m7"].includes(quality) &&
    selectedDuration >= beatDuration * 0.75 &&
    registerGroundedDuration >= beatDuration * 0.75 &&
    initialSelectedDuration >= runDuration * 0.75
  ) ? initialSelectedDuration : 0;
  // Raw models can alternate Cm7/Cm across a sustained Cm7 block. Let a
  // register-grounded defining tone and a consistent initial model decision
  // bridge temporary voicing omissions. An isolated upper melody note remains
  // excluded by isolatedUpperVoiceColor and cannot activate this prior.
  const duration = Math.max(selectedDuration, registerGroundedDuration, initialContinuationDuration);
  const beatCount = duration / Math.max(0.001, beatDuration);
  const weightedQualityConfidence = selected.reduce((sum, event) =>
    sum + clamp(event.qualityConfidence ?? (event.confidence ?? 50) / 100) * Math.max(0.001, event.durationSeconds), 0
  ) / Math.max(0.001, selectedDuration);
  const definingContext = quality === baseQuality ? selected : events.filter((event) => {
    const chord = parseChord(event.name);
    return chord?.root === root && colorLineage(chord.quality) === lineage;
  });
  const definingContextDuration = definingContext.reduce(
    (sum, event) => sum + Math.max(0.001, event.durationSeconds),
    0
  );
  const definingSupportValue = definingContext.reduce((sum, event) =>
    sum + definingColorSupport(candidateName, event.notePitchClasses) * Math.max(0.001, event.durationSeconds), 0
  ) / Math.max(0.001, definingContextDuration);
  const families = new Set<string>();
  for (const event of selected) {
    for (const family of structuralQualityFamilies(event, root, quality)) families.add(family);
  }
  const hasDefiningColor = Boolean(DEFINING_INTERVALS[quality]?.length);
  const qualified = quality === baseQuality || !hasDefiningColor || (
    // A color held for two full beats is structural enough to remain visible.
    // The strict multi-source gate is reserved for one-beat color changes,
    // where a passing melody note is much more likely to be the cause.
    (beatCount >= 1.8 && weightedQualityConfidence >= 0.5) ||
    (weightedQualityConfidence >= 0.66 && families.size >= 2 && definingSupportValue >= 0.4)
  );
  const simplicityPrior = quality === baseQuality ? 0.22 : 0;
  const evidenceBoost = Math.min(0.24, families.size * 0.08) + definingSupportValue * 0.14;
  const score = beatCount * (0.68 + weightedQualityConfidence * 0.32 + evidenceBoost) + simplicityPrior;
  return {
    quality,
    beatCount,
    registerGroundedBeatCount: registerGroundedDuration / Math.max(0.001, beatDuration),
    qualityConfidence: weightedQualityConfidence,
    definingSupport: definingSupportValue,
    families,
    qualified,
    score
  };
}

function strongSingleBeatStructuralColor(
  events: HarmonyPostprocessEvent[],
  index: number,
  stats: StructuralQualityStats
) {
  // A one-beat 6th inside an otherwise unchanged root is commonly an inner
  // voice or isolated timbre note. Keep it in diagnostics unless it lasts
  // long enough to form its own structural block.
  if (["6", "m6"].includes(stats.quality)) return false;
  const current = events[index];
  const candidateName = structuralNameForEvent(current, stats.quality).replace(/\/[A-G](?:#|b)?$/, "");
  if (isolatedUpperVoiceColor(current, candidateName)) return false;
  const next = events[index + 1];
  const entrance = Math.max(
    clamp(current.boundaryConfidence ?? 0),
    clamp(current.harmonicChangeConfidence ?? 0)
  );
  const exit = next ? Math.max(
    clamp(next.boundaryConfidence ?? 0),
    clamp(next.harmonicChangeConfidence ?? 0)
  ) : 0;
  const requiresDefiningTone = Boolean(DEFINING_INTERVALS[stats.quality]?.length);
  return (
    stats.qualityConfidence >= 0.66 &&
    stats.families.size >= 2 &&
    entrance >= 0.62 &&
    exit >= 0.5 &&
    (!requiresDefiningTone || stats.definingSupport >= 0.4)
  );
}

/**
 * Converts detailed acoustic labels into one deterministic lead-sheet chord
 * per beat. The original label and all evidence remain attached for review.
 */
export function decodeStructuralHarmony<T extends HarmonyPostprocessEvent>(
  inputEvents: T[],
  beatDuration: number
): StructuralHarmonyResult<T> {
  const events = inputEvents.map((event) => ({ ...event }));
  const targets = events.map((event) => event.name);
  const decisions = events.map<StructuralHarmonyDecision>(() => "unchanged");
  const confidences = events.map((event) => clamp(event.qualityConfidence ?? (event.confidence ?? 50) / 100));

  let runStart = 0;
  while (runStart < events.length) {
    const first = parseChord(events[runStart].name);
    if (!first) {
      runStart += 1;
      continue;
    }
    const lineage = colorLineage(first.quality);
    let runEnd = runStart + 1;
    while (runEnd < events.length) {
      const chord = parseChord(events[runEnd].name);
      if (!chord || chord.root !== first.root || colorLineage(chord.quality) !== lineage) break;
      runEnd += 1;
    }

    if (["major", "minor"].includes(lineage)) {
      const run = events.slice(runStart, runEnd);
      const qualities = [...new Set(run.map((event) => projectedStructuralQuality(parseChord(event.name)?.quality ?? "")))];
      const stats = qualities.map((quality) => structuralQualityStats(run, first.root, quality, beatDuration, lineage));
      const baseQuality = structuralBaseQuality(lineage);
      const baseStats = stats.find((entry) => entry.quality === baseQuality);
      const ranked = [...stats].sort((left, right) =>
        (right.qualified ? 1 : 0) - (left.qualified ? 1 : 0) ||
        right.score - left.score ||
        (left.quality === baseQuality ? -1 : right.quality === baseQuality ? 1 : 0)
      );
      let dominant = ranked[0]?.qualified ? ranked[0].quality : baseQuality;
      if (baseStats && dominant !== baseQuality) {
        const winner = ranked[0];
        if (!winner || winner.score < baseStats.score * 1.12) dominant = baseQuality;
      }
      const runBeats = run.reduce(
        (sum, event) => sum + Math.max(0.001, event.durationSeconds),
        0
      ) / Math.max(0.001, beatDuration);
      const dominantStats = stats.find((entry) => entry.quality === dominant);
      const dominantHasContinuousRegisterColor = dominant !== baseQuality &&
        (dominantStats?.registerGroundedBeatCount ?? 0) >= runBeats * 0.75;
      const dominantExample = run.find((event) =>
        projectedStructuralQuality(parseChord(event.name)?.quality ?? "") === dominant
      );
      const dominantCandidateName = dominantExample
        ? structuralNameForEvent(dominantExample, dominant).replace(/\/[A-G](?:#|b)?$/, "")
        : "";

      let blockStart = runStart;
      while (blockStart < runEnd) {
        const blockQuality = projectedStructuralQuality(parseChord(events[blockStart].name)?.quality ?? "");
        let blockEnd = blockStart + 1;
        while (
          blockEnd < runEnd &&
          projectedStructuralQuality(parseChord(events[blockEnd].name)?.quality ?? "") === blockQuality
        ) blockEnd += 1;
        const blockEvents = events.slice(blockStart, blockEnd);
        const blockStats = structuralQualityStats(blockEvents, first.root, blockQuality, beatDuration, lineage);
        const blockBeats = blockEvents.reduce((sum, event) => sum + event.durationSeconds, 0) / Math.max(0.001, beatDuration);
        const baseBlockLacksLocalDominantColor = dominant !== baseQuality &&
          blockQuality === baseQuality &&
          Boolean(dominantCandidateName) &&
          blockEvents.every((event) =>
            (
              definingColorSupport(dominantCandidateName, event.notePitchClasses) < 0.4 ||
              isolatedUpperVoiceColor(event, dominantCandidateName)
            ) &&
            projectedStructuralQuality(parseChord(event.initialHarmonyName ?? "")?.quality ?? "") !== dominant
          );
        const preserveAlternate = blockQuality === dominant || (
          baseBlockLacksLocalDominantColor
        ) || (
          blockBeats >= 1.8 &&
          blockStats.qualified &&
          blockStats.qualityConfidence >= 0.58 &&
          blockStats.families.size >= 1 &&
          !(blockQuality === baseQuality && dominantHasContinuousRegisterColor)
        ) || (
          blockBeats <= 1.2 && strongSingleBeatStructuralColor(events, blockStart, blockStats)
        );
        const targetQuality = preserveAlternate && blockStats.qualified ? blockQuality : dominant;

        for (let index = blockStart; index < blockEnd; index += 1) {
          const original = events[index].name;
          const projected = structuralNameForEvent(events[index], blockQuality);
          targets[index] = structuralNameForEvent(events[index], targetQuality);
          if (targets[index] !== original) {
            decisions[index] = targets[index] === projected ? "simplified_color" : "context_consensus";
            confidences[index] = clamp(
              0.45 + blockStats.qualityConfidence * 0.28 + Math.min(0.16, blockStats.families.size * 0.06) +
              Math.min(0.11, blockBeats * 0.035)
            );
          }
        }
        blockStart = blockEnd;
      }
    }
    runStart = runEnd;
  }

  let simplifiedBeatCount = 0;
  const structuralEvents = events.map((event, index): StructuralHarmonyEvent<T> => {
    const formalName = targets[index];
    const changed = formalName !== event.name;
    if (changed) simplifiedBeatCount += Math.max(1, Math.round(event.durationSeconds / Math.max(0.001, beatDuration)));
    const formal = parseChord(formalName);
    return {
      ...event,
      name: formalName,
      root: formal?.rootName ?? event.root,
      quality: formal?.quality ?? event.quality,
      bass: formal?.bassName ?? (formalName === "N.C." ? null : event.bass),
      ...(changed ? {
        acousticDetailName: event.name,
        alternateNames: [...new Set([event.name, ...(event.alternateNames ?? [])])].slice(0, 4),
        evidence: [
          ...(event.evidence ?? []),
          {
            source: "structural_harmony_decoder",
            name: formalName,
            confidence: Math.round(confidences[index] * 1000) / 10,
            weight: 0.55,
            support: "supports" as const,
            detail: decisions[index] === "context_consensus"
              ? "依同根音樂句脈絡統一正式譜；原聲色彩保留於診斷"
              : "延伸音保留於診斷；正式譜使用可演奏的結構和弦"
          }
        ]
      } : {}),
      structuralDecision: decisions[index],
      structuralConfidence: Math.round(confidences[index] * 10_000) / 10_000
    };
  });
  const structuralChordChangeCount = structuralEvents.reduce((count, event, index) =>
    index > 0 && canonicalChordIdentity(event.name) !== canonicalChordIdentity(structuralEvents[index - 1].name)
      ? count + 1
      : count, 0
  );
  return { events: structuralEvents, simplifiedBeatCount, structuralChordChangeCount };
}

function withRunBass(name: string, bassName: string | null) {
  const chord = parseChord(name);
  if (!chord) return name;
  const base = `${chord.rootName}${chord.quality}`;
  return bassName ? `${base}/${bassName}` : base;
}

export function rankHarmonyColorRun(
  events: HarmonyPostprocessEvent[],
  beatDuration: number
): HarmonyColorRunDecision {
  const first = parseChord(events[0]?.name ?? "");
  if (!first || !events.length) return { winner: null, runnerUp: null, candidates: [] };
  const runBass = first.bassName;
  const runIdentity = canonicalChordIdentity(events[0].name, false);
  const names = new Map<string, string>();
  const addName = (value: string) => {
    const candidate = withRunBass(value, runBass);
    if (canonicalChordIdentity(candidate, false) !== runIdentity) return;
    names.set(canonicalChordIdentity(candidate), candidate);
  };
  for (const event of events) {
    addName(event.name);
    for (const alternate of event.alternateNames ?? []) addName(alternate);
    for (const alternate of event.candidateAlternatives ?? []) addName(alternate.name);
    for (const evidence of event.evidence ?? []) addName(evidence.name);
  }

  const runDuration = events.reduce((sum, event) => sum + event.durationSeconds, 0);
  const candidates = [...names.values()].map((name): HarmonyColorCandidate => {
    const identity = canonicalChordIdentity(name);
    const chord = parseChord(name)!;
    const definingIntervals = DEFINING_INTERVALS[chord.quality] ?? [];
    let selectedDuration = 0;
    let selectedScore = 0;
    let alternativeScore = 0;
    let definingTotal = 0;
    let definingDuration = 0;
    const familyScores = new Map<string, number>();

    for (const event of events) {
      const duration = Math.max(0.001, event.durationSeconds);
      if (canonicalChordIdentity(event.name) === identity) {
        selectedDuration += duration;
        selectedScore += duration * (0.58 + clamp((event.confidence ?? 55) / 100) * 0.42);
      }
      const alternative = (event.candidateAlternatives ?? []).find((item) =>
        canonicalChordIdentity(withRunBass(item.name, runBass)) === identity
      );
      if (alternative) alternativeScore += duration * clamp(alternative.score) * 0.2;

      for (const evidence of event.evidence ?? []) {
        if (evidence.support === "neutral" || canonicalChordIdentity(withRunBass(evidence.name, runBass)) !== identity) continue;
        const family = qualityEvidenceFamily(evidence.source);
        if (!family) continue;
        const contribution = duration * clamp(evidence.weight, 0, 1.4) * clamp(evidence.confidence / 100);
        familyScores.set(family, (familyScores.get(family) ?? 0) + contribution);
      }

      if (definingIntervals.length && event.notePitchClasses?.length === 12) {
        definingTotal += definingColorSupport(name, event.notePitchClasses) * duration;
        definingDuration += duration;
      }
    }

    const definingSupport = definingDuration ? definingTotal / definingDuration : 0;
    const familyThreshold = Math.max(0.035, Math.min(beatDuration, runDuration) * 0.045);
    const independentQualityFamilies = [...familyScores.values()].filter((score) => score >= familyThreshold).length;
    const familyScore = [...familyScores.values()].reduce((sum, score) => sum + score, 0);
    const qualifiedExtension = !definingIntervals.length || (
      (definingSupport >= 0.4 && independentQualityFamilies >= 2) ||
      (definingSupport >= 0.68 && independentQualityFamilies >= 1 && selectedDuration >= beatDuration * 0.8)
    );
    let score = selectedScore + familyScore * 0.34 + alternativeScore;
    if (definingIntervals.length) {
      score += runDuration * definingSupport * 0.42;
      if (qualifiedExtension) {
        const seventhColor = ["7", "maj7", "m7", "mMaj7", "maj9", "m9", "9"].includes(chord.quality);
        const recognitionBoost = seventhColor
          ? 0.26 + definingSupport * 0.36 + Math.min(0.16, Math.max(0, independentQualityFamilies - 1) * 0.08)
          : 0.08 + definingSupport * 0.18;
        score += runDuration * recognitionBoost;
      } else {
        score -= Math.min(runDuration, beatDuration * 2) * 0.52;
      }
    } else {
      score += Math.min(runDuration, beatDuration * 2) * 0.035;
    }
    return {
      name,
      score,
      selectedDuration,
      definingSupport,
      independentQualityFamilies,
      qualifiedExtension
    };
  }).sort((left, right) =>
    right.score - left.score ||
    right.independentQualityFamilies - left.independentQualityFamilies ||
    right.definingSupport - left.definingSupport
  );

  return {
    winner: candidates[0] ?? null,
    runnerUp: candidates[1] ?? null,
    candidates
  };
}

export function colorCandidateForName(decision: HarmonyColorRunDecision, name: string) {
  const identity = canonicalChordIdentity(name);
  return decision.candidates.find((candidate) => canonicalChordIdentity(candidate.name) === identity) ?? null;
}

function evidenceSupportsCurrentBass(event: HarmonyPostprocessEvent) {
  const current = parseChord(event.name);
  if (!current) return false;
  const bassPitch = event.bassPitch ? PITCH_CLASS[event.bassPitch] : null;
  const expectedBass = current.bass ?? current.root;
  if (
    event.isolatedBassEvidence &&
    bassPitch === expectedBass &&
    (event.bassPitchConfidence ?? 0) >= 60 &&
    (event.bassPitchStability ?? 0) >= 0.64
  ) return true;
  return (event.evidence ?? []).some((evidence) =>
    evidence.source === "bass_root_anchor" &&
    PITCH_CLASS[evidence.name] === expectedBass &&
    evidence.confidence >= 64 &&
    evidence.support === "supports"
  );
}

function stableObservedBass(event: HarmonyPostprocessEvent) {
  const pitch = event.bassPitch ? PITCH_CLASS[event.bassPitch] : null;
  if (
    !Number.isFinite(pitch) ||
    (event.bassPitchConfidence ?? 0) < 60 ||
    (event.bassPitchStability ?? 0) < 0.64
  ) return null;
  return pitch;
}

function hasStableBassTransition(left: HarmonyPostprocessEvent, right: HarmonyPostprocessEvent) {
  const leftBass = stableObservedBass(left);
  const rightBass = stableObservedBass(right);
  return leftBass !== null && rightBass !== null && leftBass !== rightBass;
}

export function shouldSmoothTransientChord(
  previous: HarmonyPostprocessEvent,
  current: HarmonyPostprocessEvent,
  next: HarmonyPostprocessEvent,
  beatDuration: number
) {
  if (
    canonicalChordIdentity(previous.name, false) !== canonicalChordIdentity(next.name, false) ||
    canonicalChordIdentity(current.name, false) === canonicalChordIdentity(previous.name, false) ||
    current.durationSeconds > beatDuration * 1.2
  ) return false;

  const entrance = Math.max(
    clamp(current.boundaryConfidence ?? 0),
    clamp(current.harmonicChangeConfidence ?? 0),
    hasStableBassTransition(previous, current) ? 0.84 : 0
  );
  const exit = Math.max(
    clamp(next.boundaryConfidence ?? 0),
    clamp(next.harmonicChangeConfidence ?? 0),
    hasStableBassTransition(current, next) ? 0.84 : 0
  );
  const stableBass = evidenceSupportsCurrentBass(current);
  const rootConfidence = clamp(current.rootConfidence ?? (current.confidence ?? 50) / 100);
  const independentSources = current.independentSourceCount ?? 0;
  const strongTwoSidedBoundary = entrance >= 0.62 && exit >= 0.5;
  if (stableBass && rootConfidence >= 0.56 && (entrance >= 0.42 || exit >= 0.42)) return false;
  if (strongTwoSidedBoundary && independentSources >= 2 && rootConfidence >= 0.52) return false;
  if (Math.max(entrance, exit) >= 0.82 && independentSources >= 3 && rootConfidence >= 0.7) return false;

  const neighborIdentity = canonicalChordIdentity(previous.name, false);
  const neighborIsAlternative = (current.alternateNames ?? []).some((name) =>
    canonicalChordIdentity(name, false) === neighborIdentity
  );
  return (
    entrance < 0.56 &&
    exit < 0.56 &&
    !stableBass &&
    (neighborIsAlternative || (current.confidence ?? 50) <= 58 || rootConfidence < 0.52) &&
    (independentSources < 3 || rootConfidence < 0.66)
  );
}

export function shouldSmoothTransientColor(
  previous: HarmonyPostprocessEvent,
  current: HarmonyPostprocessEvent,
  next: HarmonyPostprocessEvent,
  beatDuration: number
) {
  const previousChord = parseChord(previous.name);
  const currentChord = parseChord(current.name);
  const nextChord = parseChord(next.name);
  if (
    !previousChord || !currentChord || !nextChord ||
    canonicalChordIdentity(previous.name) !== canonicalChordIdentity(next.name) ||
    canonicalChordIdentity(current.name) === canonicalChordIdentity(previous.name) ||
    previousChord.root !== currentChord.root ||
    previousChord.bass !== currentChord.bass ||
    currentChord.root !== nextChord.root ||
    currentChord.bass !== nextChord.bass ||
    current.durationSeconds > beatDuration * 1.2
  ) return false;

  const entrance = Math.max(
    clamp(current.boundaryConfidence ?? 0),
    clamp(current.harmonicChangeConfidence ?? 0)
  );
  const exit = Math.max(
    clamp(next.boundaryConfidence ?? 0),
    clamp(next.harmonicChangeConfidence ?? 0)
  );
  const decision = rankHarmonyColorRun([current], beatDuration);
  const local = colorCandidateForName(decision, current.name);
  const hasDefiningColor = (DEFINING_INTERVALS[currentChord.quality] ?? []).length > 0;
  const qualityConfidence = clamp(current.qualityConfidence ?? (current.confidence ?? 50) / 100);
  const locallyQualified = Boolean(
    local &&
    local.independentQualityFamilies >= 1 &&
    (!hasDefiningColor || local.qualifiedExtension)
  );
  const strongTwoSidedBoundary = entrance >= 0.62 && exit >= 0.5;
  if (strongTwoSidedBoundary && qualityConfidence >= 0.56 && locallyQualified) return false;
  if (
    hasDefiningColor &&
    local?.qualifiedExtension &&
    local.independentQualityFamilies >= 2 &&
    local.definingSupport >= 0.68 &&
    qualityConfidence >= 0.64 &&
    Math.max(entrance, exit) >= 0.52
  ) return false;
  return true;
}

export function qualityDefiningIntervals(name: string) {
  const chord = parseChord(name);
  return chord ? [...(DEFINING_INTERVALS[chord.quality] ?? [])] : [];
}

export function chordQualityPitchClasses(name: string) {
  const chord = parseChord(name);
  if (!chord) return [];
  return (QUALITY_INTERVALS[chord.quality] ?? QUALITY_INTERVALS[""]).map((interval) => (chord.root + interval) % 12);
}
