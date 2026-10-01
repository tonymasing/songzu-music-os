#!/usr/bin/env python3
"""Local harmony analysis for Songzu Music OS.

The analyzer intentionally produces a conservative chord draft. It uses
harmonic/percussive separation, CQT chroma, bass evidence, key context and a
Viterbi sequence model. Audio never leaves the local machine.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import librosa
import numpy as np


SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
MAJOR_PROFILE = np.asarray([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.asarray([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTE_TO_PC = {name: index for index, name in enumerate(SHARP_NAMES)} | {
    name: index for index, name in enumerate(FLAT_NAMES)
}

# Tony's root search order, expressed as semitones above the active tonic.
# 1, 6, 4, 5, 3, 2, 7, b7, b6, b5, b3, b2
TONY_DEGREE_ORDER = (0, 9, 5, 7, 4, 2, 11, 10, 8, 6, 3, 1)
TONY_DEGREE_LABELS = ("1", "6", "4", "5", "3", "2", "7", "b7", "b6", "b5", "b3", "b2")

# The first eight entries preserve Tony's stated quality search order. The
# remaining common pop/rock colors fill gaps that otherwise create false
# major/minor matches. m9 is the standard lead-sheet spelling for m7(add9).
TONY_QUALITY_SPECS: tuple[tuple[str, tuple[int, ...]], ...] = (
    ("", (0, 4, 7)),
    ("maj7", (0, 4, 7, 11)),
    ("maj9", (0, 2, 4, 7, 11)),
    ("m", (0, 3, 7)),
    ("m7", (0, 3, 7, 10)),
    ("m9", (0, 2, 3, 7, 10)),
    ("dim", (0, 3, 6)),
    ("dim7", (0, 3, 6, 9)),
    ("7", (0, 4, 7, 10)),
    ("9", (0, 2, 4, 7, 10)),
    ("mMaj7", (0, 3, 7, 11)),
    ("m7b5", (0, 3, 6, 10)),
    ("aug", (0, 4, 8)),
    ("sus2", (0, 2, 7)),
    ("sus4", (0, 5, 7)),
    ("add9", (0, 2, 4, 7)),
    ("6", (0, 4, 7, 9)),
    ("m6", (0, 3, 7, 9)),
    ("6/9", (0, 2, 4, 7, 9)),
    ("7sus4", (0, 5, 7, 10)),
)

QUALITY_COMPLEXITY_PENALTY = {
    "": 0.0,
    "m": 0.0,
    "maj7": 0.045,
    "m7": 0.035,
    "7": 0.04,
    "6": 0.035,
    "m6": 0.038,
    "add9": 0.04,
    "sus2": 0.05,
    "sus4": 0.05,
    "dim": 0.04,
    "aug": 0.045,
    "m7b5": 0.05,
    "maj9": 0.09,
    "m9": 0.04,
    "9": 0.068,
    "6/9": 0.068,
    "dim7": 0.075,
    "7sus4": 0.105,
    "mMaj7": 0.09,
}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def parse_key(value: str | None) -> tuple[int, bool] | None:
    if not value:
        return None
    # A song may persist a modulation summary such as "A -> C". The first
    # key remains the home-key hint; local key contexts handle later changes.
    normalized = value.replace("→", "->").split("->", 1)[0].strip().replace("Major", "").replace("major", "").replace("maj", "").replace("Minor", "m").replace("minor", "m").replace("min", "m").strip()
    minor = normalized.endswith("m")
    root = normalized[:-1] if minor else normalized
    root = root[:1].upper() + root[1:]
    pitch_class = NOTE_TO_PC.get(root)
    return (pitch_class, minor) if pitch_class is not None else None


def profile_score(chroma: np.ndarray, profile: np.ndarray, root: int) -> float:
    rotated = np.asarray([chroma[(index + root) % 12] for index in range(12)])
    if float(np.std(rotated)) < 1e-8:
        return -1.0
    return float(np.corrcoef(rotated, profile)[0, 1])


def estimate_key(chroma: np.ndarray, hint: str | None) -> tuple[int, bool, float]:
    candidates: list[tuple[float, int, bool]] = []
    for root in range(12):
        candidates.append((profile_score(chroma, MAJOR_PROFILE, root), root, False))
        candidates.append((profile_score(chroma, MINOR_PROFILE, root), root, True))
    candidates.sort(reverse=True)
    best_score, best_root, best_minor = candidates[0]
    parsed_hint = parse_key(hint)
    if parsed_hint:
        hint_root, hint_minor = parsed_hint
        hint_score = next(score for score, root, minor in candidates if root == hint_root and minor == hint_minor)
        # Stored song metadata is a hint, never a lock. A wider tolerance made
        # an earlier draft reinforce its own wrong key on songs that modulate.
        if hint_score >= best_score - 0.025:
            best_score, best_root, best_minor = hint_score, hint_root, hint_minor
    margin = best_score - candidates[1][0]
    confidence = clamp(45.0 + best_score * 35.0 + margin * 90.0, 35.0, 94.0)
    return best_root, best_minor, confidence


def prefer_flats(key_root: int, hint: str | None) -> bool:
    if hint and "b" in hint:
        return True
    if hint and "#" in hint:
        return key_root in {3, 8, 10}
    return key_root in {1, 3, 5, 8, 10}


def relative_major_root(root: int, minor: bool) -> int:
    return (root + 3) % 12 if minor else root


def tony_root_candidates(tonic: int) -> list[tuple[int, str, int]]:
    return [
        ((tonic + offset) % 12, TONY_DEGREE_LABELS[index], index + 1)
        for index, offset in enumerate(TONY_DEGREE_ORDER)
    ]


def diatonic_quality(root: int, minor: bool, chord_root: int, chord_minor: bool) -> bool:
    relative = (chord_root - root) % 12
    if minor:
        expected = {0: True, 3: False, 5: True, 7: True, 8: False, 10: False}
        if relative == 7 and not chord_minor:
            return True
    else:
        expected = {0: False, 2: True, 4: True, 5: False, 7: False, 9: True}
    return expected.get(relative) == chord_minor


def quality_intervals(quality: str) -> tuple[int, ...]:
    return dict(TONY_QUALITY_SPECS).get(quality, (0, 4, 7))


def tony_degree_metadata(tonic: int, chord_root: int) -> tuple[str, int]:
    offset = (chord_root - tonic) % 12
    index = TONY_DEGREE_ORDER.index(offset)
    return TONY_DEGREE_LABELS[index], index + 1


def key_pitch_weight(key_root: int, key_minor: bool, pitch: int) -> float:
    relative = (pitch - key_root) % 12
    natural = {0, 2, 3, 5, 7, 8, 10} if key_minor else {0, 2, 4, 5, 7, 9, 11}
    if relative in natural:
        return 1.0
    # Harmonic and melodic minor legitimately introduce raised 6 and 7.
    if key_minor and relative in {9, 11}:
        return 0.55
    return 0.0


def quality_template(root: int, quality: str) -> np.ndarray:
    intervals = quality_intervals(quality)
    template = np.zeros(12, dtype=np.float64)
    for index, interval in enumerate(intervals):
        weight = 1.0 if interval == 0 else 0.92 if index == 1 else 0.78 if index == 2 else 0.56
        template[(root + interval) % 12] = max(template[(root + interval) % 12], weight)
    return template / max(float(np.linalg.norm(template)), 1e-9)


def quality_base_intervals(quality: str) -> set[int]:
    if quality in {"dim", "dim7", "m7b5"}:
        return {0, 3, 6}
    if quality == "aug":
        return {0, 4, 8}
    if quality == "sus2":
        return {0, 2, 7}
    if quality in {"sus4", "7sus4"}:
        return {0, 5, 7}
    if quality.startswith("m") and not quality.startswith("maj"):
        return {0, 3, 7}
    return {0, 4, 7}


def defining_color_support(root: int, quality: str, chroma_sum: np.ndarray) -> float:
    defining = [interval for interval in quality_intervals(quality) if interval not in quality_base_intervals(quality)]
    if not defining:
        return 0.0
    defining_energy = min(float(chroma_sum[(root + interval) % 12]) for interval in defining)
    core = sorted(float(chroma_sum[(root + interval) % 12]) for interval in quality_base_intervals(quality))
    core_median = core[len(core) // 2] if core else 0.0
    relative = defining_energy / max(0.04, core_median)
    return clamp(defining_energy * 3.2 + clamp((relative - 0.32) / 0.9, 0.0, 1.0) * 0.34, 0.0, 1.0)


def quality_candidate_score(
    root: int,
    quality: str,
    chroma: np.ndarray,
    bass: np.ndarray,
    key_root: int,
    key_minor: bool,
    root_rank: int,
    quality_rank: int,
) -> float:
    chroma_l2 = chroma / max(float(np.linalg.norm(chroma)), 1e-9)
    chroma_total = max(float(np.sum(chroma)), 1e-9)
    chroma_sum = chroma / chroma_total
    bass_sum = bass / max(float(np.sum(bass)), 1e-9)
    intervals = quality_intervals(quality)
    tones = {(root + interval) % 12 for interval in intervals}
    template = quality_template(root, quality)
    cosine = float(np.dot(chroma_l2, template))
    coverage = float(sum(chroma_sum[pitch] for pitch in tones))
    outside = max(0.0, 1.0 - coverage)
    median = float(np.median(chroma_sum))
    base_intervals = quality_base_intervals(quality)
    defining = [interval for interval in intervals if interval not in base_intervals]
    color_support = defining_color_support(root, quality, chroma_sum)

    score = cosine * 0.67 + coverage * 0.27 - outside * 0.045
    score += float(bass_sum[root]) * 0.055
    score += max(float(bass_sum[pitch]) for pitch in tones) * 0.018
    complexity_penalty = QUALITY_COMPLEXITY_PENALTY.get(quality, 0.04)
    if defining:
        complexity_penalty *= 0.15 + (1.0 - color_support) * 0.85
        score += color_support * 0.045
    score -= complexity_penalty

    # Third evidence is the strongest major/minor discriminator. Suspended
    # chords deliberately skip this test instead of being forced to major.
    major_third = float(chroma_sum[(root + 4) % 12])
    minor_third = float(chroma_sum[(root + 3) % 12])
    if quality in {"", "maj7", "maj9", "7", "9", "add9", "6", "6/9"}:
        score += clamp((major_third - minor_third) * 0.55, -0.075, 0.075)
    elif quality in {"m", "m7", "m9", "mMaj7", "m7b5", "m6", "dim", "dim7"}:
        score += clamp((minor_third - major_third) * 0.55, -0.075, 0.075)
    elif quality in {"sus2", "sus4", "7sus4"}:
        suspended_interval = 2 if quality == "sus2" else 5
        suspended_energy = float(chroma_sum[(root + suspended_interval) % 12])
        third_energy = max(major_third, minor_third)
        if suspended_energy < third_energy * 1.12:
            score -= min(0.09, (third_energy * 1.12 - suspended_energy) * 0.9 + 0.025)

    # Extra colors are accepted only when their defining pitch is present.
    # This prevents every ordinary triad from being mislabeled maj9 or m9.
    if defining:
        evidence = min(float(chroma_sum[(root + interval) % 12]) for interval in defining)
        evidence_floor = max(0.055, median * 1.08)
        score += clamp((evidence - evidence_floor) * 1.2, -0.105, 0.065)
        outside_colors = [
            interval
            for interval in defining
            if key_pitch_weight(key_root, key_minor, (root + interval) % 12) == 0.0
        ]
        if outside_colors:
            # Borrowed colors remain available, but a melody or overtone may
            # not promote a diatonic triad to maj7/add9 without clear energy.
            outside_evidence = min(float(chroma_sum[(root + interval) % 12]) for interval in outside_colors)
            outside_floor = max(0.09, median * 1.5)
            if outside_evidence < outside_floor:
                score -= min(0.06, (outside_floor - outside_evidence) * 0.9 + 0.012)

    scale_fit = key_pitch_weight(key_root, key_minor, root)
    score += 0.016 if scale_fit == 1.0 else 0.007 if scale_fit > 0 else -0.004

    # Tony's order is a deterministic tie-breaker, never a substitute for
    # audio evidence. The entire root-order range is below 0.006.
    score += (13 - root_rank) * 0.00042 + (len(TONY_QUALITY_SPECS) + 1 - quality_rank) * 0.00008
    return score


def rank_tony_candidates(
    chroma: np.ndarray,
    bass: np.ndarray,
    key_root: int,
    key_minor: bool,
) -> list[dict[str, object]]:
    ranked: list[dict[str, object]] = []
    for root, degree, root_rank in tony_root_candidates(key_root):
        for quality_rank, (quality, _intervals) in enumerate(TONY_QUALITY_SPECS, start=1):
            ranked.append({
                "root": root,
                "quality": quality,
                "degree": degree,
                "rootRank": root_rank,
                "qualityRank": quality_rank,
                "score": quality_candidate_score(
                    root,
                    quality,
                    chroma,
                    bass,
                    key_root,
                    key_minor,
                    root_rank,
                    quality_rank,
                ),
            })
    ranked.sort(key=lambda candidate: float(candidate["score"]), reverse=True)
    return ranked


# Root tracking must not be won by an extension bonus. These qualities describe
# the triadic/suspended skeleton; 7ths, 9ths and added tones compete only after
# the Viterbi path has selected a root for the beat.
ROOT_ANCHOR_QUALITIES = frozenset({"", "m", "dim", "aug", "sus2", "sus4"})


def stable_bass_details(bass: np.ndarray, bass_frames: np.ndarray | None = None) -> dict[str, object] | None:
    total = max(float(np.sum(bass)), 1e-9)
    normalized = bass / total
    dominant = int(np.argmax(normalized))
    dominant_energy = float(normalized[dominant])
    runner_up = float(np.partition(normalized, -2)[-2])
    if dominant_energy < max(0.18, runner_up * 1.1, float(np.median(normalized)) * 1.85):
        return None
    stability = 1.0
    if bass_frames is not None and bass_frames.ndim == 2 and bass_frames.shape[1] >= 4:
        frame_totals = np.sum(bass_frames, axis=0)
        valid = frame_totals > max(1e-9, float(np.percentile(frame_totals, 25)) * 0.35)
        if int(np.sum(valid)) >= 4:
            normalized_frames = bass_frames[:, valid] / np.maximum(frame_totals[valid], 1e-9)
            stability = float(np.mean(np.argmax(normalized_frames, axis=0) == dominant))
            if stability < 0.58:
                return None
    confidence = clamp(42.0 + dominant_energy * 110.0 + stability * 24.0, 45.0, 92.0)
    candidates = np.argsort(normalized)[::-1][:3]
    return {
        "pitch": dominant,
        "confidence": confidence,
        "stability": stability,
        "dominantEnergy": dominant_energy,
        "candidates": [
            {"pitch": int(pitch), "energy": float(normalized[pitch])}
            for pitch in candidates
        ],
    }


def stable_pitch_tracker_details(
    f0: np.ndarray | None,
    voiced: np.ndarray | None,
    voiced_probability: np.ndarray | None,
    rms: np.ndarray,
    start: int,
    end: int,
    activity_floor: float,
) -> dict[str, object] | None:
    """Summarize the isolated Bass fundamental without letting overtones vote as roots."""
    if f0 is None or voiced is None or voiced_probability is None:
        return None
    end = min(end, len(f0), len(voiced), len(voiced_probability), len(rms))
    start = max(0, min(start, end - 1))
    if end - start < 3:
        return None

    local_f0 = f0[start:end]
    local_voiced = voiced[start:end]
    local_probability = voiced_probability[start:end]
    local_rms = rms[start:end]
    valid = (
        np.isfinite(local_f0)
        & local_voiced.astype(bool)
        & (local_probability >= 0.24)
        & (local_rms >= max(1e-9, activity_floor * 0.12))
    )
    valid_count = int(np.sum(valid))
    if valid_count < max(3, int(math.ceil((end - start) * 0.28))):
        return None

    midi = librosa.hz_to_midi(local_f0[valid])
    nearest_midi = np.rint(midi)
    pitch_classes = np.mod(nearest_midi.astype(np.int16), 12)
    cents_error = np.abs((midi - nearest_midi) * 100.0)
    weights = (
        np.clip(local_probability[valid], 0.1, 1.0)
        * np.clip(local_rms[valid] / max(activity_floor, 1e-9), 0.18, 2.4)
    )
    distribution = np.bincount(pitch_classes, weights=weights, minlength=12).astype(np.float64)
    total_weight = float(np.sum(distribution))
    if total_weight <= 1e-9:
        return None
    distribution /= total_weight
    dominant = int(np.argmax(distribution))
    dominant_share = float(distribution[dominant])
    runner_up = float(np.partition(distribution, -2)[-2])
    frame_stability = float(np.mean(pitch_classes == dominant))
    tuning_stability = clamp(1.0 - float(np.median(cents_error)) / 48.0, 0.0, 1.0)
    stability = frame_stability * 0.72 + tuning_stability * 0.28
    if dominant_share < max(0.5, runner_up * 1.32) or stability < 0.58:
        return None

    probability = float(np.mean(local_probability[valid]))
    confidence = clamp(
        34.0 + dominant_share * 34.0 + stability * 22.0 + probability * 12.0,
        45.0,
        94.0,
    )
    candidates = np.argsort(distribution)[::-1][:3]
    return {
        "pitch": dominant,
        "confidence": confidence,
        "stability": stability,
        "dominantEnergy": dominant_share,
        "candidates": [
            {"pitch": int(pitch), "energy": float(distribution[pitch])}
            for pitch in candidates
        ],
    }


def stable_bass_pitch(bass: np.ndarray, bass_frames: np.ndarray | None = None) -> tuple[int, float] | None:
    details = stable_bass_details(bass, bass_frames)
    if details is None:
        return None
    return int(details["pitch"]), float(details["confidence"])


def detect_inversion(root: int, quality: str, bass: np.ndarray, bass_frames: np.ndarray | None = None) -> int | None:
    stable = stable_bass_pitch(bass, bass_frames)
    if stable is None:
        return None
    dominant, _confidence = stable
    if dominant == root:
        return None
    chord_pitches = {(root + interval) % 12 for interval in quality_intervals(quality)}
    if dominant not in chord_pitches:
        return None
    total = max(float(np.sum(bass)), 1e-9)
    normalized = bass / total
    root_energy = float(normalized[root])
    dominant_energy = float(normalized[dominant])
    if dominant_energy < max(0.23, root_energy * 1.5):
        return None
    return dominant


def transition_matrix() -> np.ndarray:
    matrix = np.full((12, 12), -0.045, dtype=np.float64)
    for previous_root in range(12):
        for current_root in range(12):
            if previous_root == current_root:
                matrix[previous_root, current_root] = 0.17
                continue
            distance = (current_root - previous_root) % 12
            if distance in {5, 7}:
                matrix[previous_root, current_root] = 0.025
            elif distance in {2, 10}:
                matrix[previous_root, current_root] = -0.01
    return matrix


def emission_scores(
    chroma: np.ndarray,
    bass: np.ndarray,
    key_root: int,
    key_minor: bool,
) -> np.ndarray:
    output = np.full(12, -np.inf, dtype=np.float64)
    for candidate in rank_tony_candidates(chroma, bass, key_root, key_minor):
        if str(candidate["quality"]) not in ROOT_ANCHOR_QUALITIES:
            continue
        root = int(candidate["root"])
        output[root] = max(output[root], float(candidate["score"]))
    return output


def viterbi(emissions: np.ndarray) -> np.ndarray:
    transitions = transition_matrix()
    steps, states = emissions.shape
    scores = np.full((steps, states), -np.inf, dtype=np.float64)
    back = np.zeros((steps, states), dtype=np.int16)
    scores[0] = emissions[0]
    for step in range(1, steps):
        candidates = scores[step - 1][:, None] + transitions
        back[step] = np.argmax(candidates, axis=0)
        scores[step] = emissions[step] + np.max(candidates, axis=0)
    path = np.zeros(steps, dtype=np.int16)
    path[-1] = int(np.argmax(scores[-1]))
    for step in range(steps - 1, 0, -1):
        path[step - 1] = back[step, path[step]]
    return path


def remove_short_blips(path: np.ndarray, emissions: np.ndarray) -> np.ndarray:
    cleaned = path.copy()
    for index in range(1, len(path) - 1):
        if path[index - 1] == path[index + 1] != path[index]:
            chosen = emissions[index, path[index]]
            neighbor = emissions[index, path[index - 1]]
            if chosen - neighbor < 0.12:
                cleaned[index] = path[index - 1]
    return cleaned


def entry_boundary_strength(
    boundary_candidates: list[dict[str, object]],
    start_time: float,
    end_time: float,
) -> float:
    """Measure a chord entrance, not arbitrary novelty later in the beat."""
    duration = max(0.08, end_time - start_time)
    entrance_window = min(0.18, max(0.08, duration * 0.3))
    return max(
        (
            float(candidate["strength"])
            for candidate in boundary_candidates
            if start_time - 0.08 <= float(candidate["timeSeconds"]) <= start_time + entrance_window
        ),
        default=0.0,
    )


def frame_slice_mean(matrix: np.ndarray, start: int, end: int) -> np.ndarray:
    start = max(0, min(matrix.shape[1] - 1, start))
    end = max(start + 1, min(matrix.shape[1], end))
    return np.median(matrix[:, start:end], axis=1)


def rolling_key_contexts(
    observations: list[np.ndarray],
    window_beats: float,
    hint: str | None,
) -> list[tuple[int, bool, float, int, bool]]:
    """Estimate stable local keys while treating relative pairs as one pitch pool."""
    if not observations:
        return []
    radius = max(4, int(math.ceil(16 / max(0.25, window_beats))))
    parsed_hint = parse_key(hint)
    estimates: list[tuple[int, bool, float]] = []
    for index in range(len(observations)):
        start = max(0, index - radius)
        end = min(len(observations), index + radius + 1)
        local_chroma = np.mean(np.vstack(observations[start:end]), axis=0)
        estimates.append(estimate_key(local_chroma, None))

    # Remove single-window key jumps before using the contexts as priors.
    pair_roots = [relative_major_root(root, minor) for root, minor, _confidence in estimates]
    for index in range(1, len(pair_roots) - 1):
        if pair_roots[index - 1] == pair_roots[index + 1] != pair_roots[index]:
            pair_roots[index] = pair_roots[index - 1]

    contexts: list[tuple[int, bool, float, int, bool]] = []
    hint_pair = relative_major_root(*parsed_hint) if parsed_hint else None
    for pair_root, (raw_root, raw_minor, confidence) in zip(pair_roots, estimates):
        if parsed_hint and pair_root == hint_pair:
            context_root, context_minor = parsed_hint
        else:
            # For a newly detected pair, use its relative-major name as the
            # shared pitch collection. The raw center is retained separately.
            context_root, context_minor = pair_root, False
        contexts.append((context_root, context_minor, confidence, raw_root, raw_minor))
    return contexts


def significant_key_sequence(
    contexts: list[tuple[int, bool, float, int, bool]],
    home_root: int,
    home_minor: bool,
    names: tuple[str, ...],
) -> list[str]:
    if not contexts:
        return [f"{names[home_root]}{'m' if home_minor else ''}"]
    labels = [f"{names[root]}{'m' if minor else ''}" for root, minor, _confidence, _raw_root, _raw_minor in contexts]
    runs: list[tuple[str, int]] = []
    for label in labels:
        if runs and runs[-1][0] == label:
            runs[-1] = (label, runs[-1][1] + 1)
        else:
            runs.append((label, 1))
    minimum_run = max(8, int(math.ceil(len(labels) * 0.035)))
    home_label = f"{names[home_root]}{'m' if home_minor else ''}"
    sequence = [home_label]
    # A long terminal region is strong evidence for a real modulation. Short
    # G/D/F regions are commonly dominant or subdominant tonicizations and do
    # not become headline key changes by themselves.
    terminal_label, terminal_length = runs[-1]
    if terminal_length >= minimum_run and terminal_label != home_label:
        sequence.append(terminal_label)
    return sequence


def observation_chord_family(observation: np.ndarray, root: int) -> str:
    """Return a conservative major/minor family without using a key prior."""
    total = max(float(np.sum(observation)), 1e-9)
    normalized = observation / total
    major_third = float(normalized[(root + 4) % 12])
    minor_third = float(normalized[(root + 3) % 12])
    return "minor" if minor_third > major_third * 1.035 else "major"


def expected_key_families(key_minor: bool) -> dict[int, set[str]]:
    if key_minor:
        # Natural minor plus the major V / leading-tone diminished harmony
        # introduced by harmonic minor.
        return {
            0: {"minor"},
            2: {"minor", "diminished"},
            3: {"major"},
            5: {"minor"},
            7: {"minor", "major"},
            8: {"major"},
            10: {"major"},
            11: {"diminished"},
        }
    return {
        0: {"major"},
        2: {"minor"},
        4: {"minor"},
        5: {"major"},
        7: {"major"},
        9: {"minor"},
        11: {"diminished"},
    }


def refine_contexts_to_significant_keys(
    observations: list[np.ndarray],
    path: np.ndarray,
    contexts: list[tuple[int, bool, float, int, bool]],
    home_root: int,
    home_minor: bool,
    key_sequence: list[str],
    window_beats: float,
) -> list[tuple[int, bool, float, int, bool]]:
    """Resolve dominant/subdominant tonicizations against stable key regions.

    Pitch-profile estimators often call a long V area a new key. Once a
    sustained terminal key has been found, chord-root functions and cadences
    choose between the home and significant key pools. This keeps, for
    example, a C-major chorus from oscillating between G, C and F while still
    allowing a later return to the marked home key.
    """
    candidates: list[tuple[int, bool]] = []
    for label in key_sequence:
        parsed = parse_key(label)
        if parsed and parsed not in candidates:
            candidates.append(parsed)
    home = (home_root, home_minor)
    if home not in candidates:
        candidates.insert(0, home)
    else:
        candidates.remove(home)
        candidates.insert(0, home)
    if len(candidates) < 2 or len(path) != len(observations):
        return contexts

    families = [observation_chord_family(observation, int(root)) for observation, root in zip(observations, path)]
    radius = max(3, int(math.ceil(10 / max(0.25, window_beats))))
    emissions = np.zeros((len(observations), len(candidates)), dtype=np.float64)
    for index in range(len(observations)):
        start = max(0, index - radius)
        end = min(len(observations), index + radius + 1)
        for candidate_index, (candidate_root, candidate_minor) in enumerate(candidates):
            expected = expected_key_families(candidate_minor)
            score = 0.0
            for event_index in range(start, end):
                degree = (int(path[event_index]) - candidate_root) % 12
                if degree in expected:
                    score += 1.0
                    score += 0.9 if families[event_index] in expected[degree] else -0.35
                    score += 0.25 if degree == 0 else 0.1 if degree in {5, 7} else 0.0
                else:
                    score -= 1.35
            for event_index in range(start + 1, end):
                previous_degree = (int(path[event_index - 1]) - candidate_root) % 12
                current_degree = (int(path[event_index]) - candidate_root) % 12
                if previous_degree == 7 and current_degree == 0 and families[event_index - 1] == "major":
                    score += 3.0
                elif previous_degree == 5 and current_degree == 0:
                    score += 1.1
                elif previous_degree == 2 and current_degree == 7:
                    score += 0.7
            emissions[index, candidate_index] = score / max(1, end - start)

    scores = np.full_like(emissions, -np.inf)
    back = np.zeros_like(emissions, dtype=np.int16)
    scores[0] = emissions[0]
    scores[0, 0] += 3.0
    for index in range(1, len(observations)):
        for candidate_index in range(len(candidates)):
            transitions = scores[index - 1] - 1.7
            transitions[candidate_index] += 1.7
            best_previous = int(np.argmax(transitions))
            back[index, candidate_index] = best_previous
            scores[index, candidate_index] = transitions[best_previous] + emissions[index, candidate_index]

    refined_path = np.zeros(len(observations), dtype=np.int16)
    refined_path[-1] = int(np.argmax(scores[-1]))
    for index in range(len(observations) - 1, 0, -1):
        refined_path[index - 1] = back[index, refined_path[index]]

    minimum_run = max(2, int(math.ceil(8 / max(0.25, window_beats))))
    for _pass in range(3):
        runs: list[tuple[int, int, int]] = []
        run_start = 0
        for index in range(1, len(refined_path) + 1):
            if index == len(refined_path) or refined_path[index] != refined_path[run_start]:
                runs.append((run_start, index, int(refined_path[run_start])))
                run_start = index
        changed = False
        for run_index, (start, end, _candidate) in enumerate(runs):
            if (
                end - start < minimum_run
                and run_index > 0
                and run_index + 1 < len(runs)
                and runs[run_index - 1][2] == runs[run_index + 1][2]
            ):
                refined_path[start:end] = runs[run_index - 1][2]
                changed = True
        if not changed:
            break

    refined: list[tuple[int, bool, float, int, bool]] = []
    for context, candidate_index in zip(contexts, refined_path):
        _context_root, _context_minor, confidence, raw_root, raw_minor = context
        candidate_root, candidate_minor = candidates[int(candidate_index)]
        refined.append((candidate_root, candidate_minor, confidence, raw_root, raw_minor))
    return refined


def analyze(args: argparse.Namespace) -> dict[str, object]:
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Audio file not found: {source}")
    bass_source = Path(args.bass_input).expanduser().resolve() if args.bass_input else None
    if bass_source is not None and not bass_source.is_file():
        raise FileNotFoundError(f"Bass evidence file not found: {bass_source}")

    sample_rate = 22050
    hop_length = 512
    audio, sample_rate = librosa.load(source, sr=sample_rate, mono=True, duration=args.max_seconds)
    if audio.size < sample_rate // 2:
        raise ValueError("Audio is too short for harmony analysis")
    duration = float(len(audio) / sample_rate)
    harmonic, percussive = librosa.effects.hpss(audio, margin=(1.0, 2.2))
    bass_harmonic = harmonic
    isolated_bass_evidence = False
    if bass_source is not None:
        bass_audio, _ = librosa.load(bass_source, sr=sample_rate, mono=True, duration=args.max_seconds)
        if bass_audio.size >= sample_rate // 2:
            bass_harmonic = librosa.effects.harmonic(bass_audio, margin=1.0)
            isolated_bass_evidence = True
    bass_rms = librosa.feature.rms(y=bass_harmonic, frame_length=2048, hop_length=hop_length)[0]
    bass_activity_values = bass_rms[bass_rms > 1e-8]
    bass_reference = float(np.percentile(bass_activity_values, 60)) if bass_activity_values.size else 1e-8
    suppressed_bass_windows = 0
    suppressed_tracker_disagreements = 0
    bass_tracker_f0: np.ndarray | None = None
    bass_tracker_voiced: np.ndarray | None = None
    bass_tracker_probability: np.ndarray | None = None
    # The fusion layer consumes Bass decisions from the half-beat pass. Run
    # the comparatively expensive pitch tracker once there, not again for
    # every coarse and phrase-scale CQT view.
    if isolated_bass_evidence and args.window_beats == 1 and args.subdivisions_per_beat > 1:
        try:
            bass_tracker_f0, bass_tracker_voiced, bass_tracker_probability = librosa.pyin(
                bass_harmonic,
                fmin=librosa.note_to_hz("C1"),
                fmax=librosa.note_to_hz("C4"),
                sr=sample_rate,
                frame_length=2048,
                hop_length=hop_length,
            )
        except Exception:
            # CQT Bass evidence remains available if pYIN cannot resolve a
            # noisy or unusually sparse stem.
            bass_tracker_f0 = None
            bass_tracker_voiced = None
            bass_tracker_probability = None
    tuning = float(librosa.estimate_tuning(y=harmonic, sr=sample_rate, bins_per_octave=36))
    chroma = librosa.feature.chroma_cqt(
        y=harmonic,
        sr=sample_rate,
        hop_length=hop_length,
        bins_per_octave=36,
        n_chroma=12,
        n_octaves=7,
        tuning=tuning,
    )
    bass = librosa.feature.chroma_cqt(
        y=bass_harmonic,
        sr=sample_rate,
        hop_length=hop_length,
        fmin=librosa.note_to_hz("C1"),
        bins_per_octave=36,
        n_chroma=12,
        n_octaves=3,
        tuning=tuning,
    )
    chroma = librosa.decompose.nn_filter(chroma, aggregate=np.median, metric="cosine", width=5)

    # Keep timing and silence evidence independent from chord templates. A
    # chord recognizer should be allowed to say N.C. instead of forcing every
    # percussion hit, effect or silent pickup into a major/minor label.
    harmonic_rms = librosa.feature.rms(y=harmonic, frame_length=2048, hop_length=hop_length)[0]
    percussive_rms = librosa.feature.rms(y=percussive, frame_length=2048, hop_length=hop_length)[0]
    activity_values = harmonic_rms[harmonic_rms > 1e-7]
    harmonic_reference = float(np.percentile(activity_values, 60)) if activity_values.size else 1e-7

    chroma_norm = chroma / np.maximum(np.linalg.norm(chroma, axis=0, keepdims=True), 1e-9)
    chroma_novelty = np.zeros(chroma.shape[1], dtype=np.float64)
    if chroma.shape[1] > 1:
        chroma_novelty[1:] = 1.0 - np.sum(chroma_norm[:, 1:] * chroma_norm[:, :-1], axis=0)
    chroma_novelty = np.convolve(chroma_novelty, np.ones(5, dtype=np.float64) / 5.0, mode="same")
    novelty_threshold = max(0.055, float(np.percentile(chroma_novelty, 78))) if chroma_novelty.size else 1.0
    boundary_candidates: list[dict[str, float]] = []
    last_boundary_frame = -999
    for frame in range(1, max(1, len(chroma_novelty) - 1)):
        strength = float(chroma_novelty[frame])
        if (
            strength >= novelty_threshold
            and strength >= float(chroma_novelty[frame - 1])
            and strength >= float(chroma_novelty[frame + 1])
            and frame - last_boundary_frame >= 3
        ):
            boundary_candidates.append({
                "timeSeconds": round(float(librosa.frames_to_time(frame, sr=sample_rate, hop_length=hop_length)), 3),
                "strength": round(clamp(strength / max(novelty_threshold, 1e-9), 0.0, 2.0), 4),
            })
            last_boundary_frame = frame

    global_chroma = np.mean(chroma, axis=1)
    detected_key_root, detected_key_minor, key_confidence = estimate_key(global_chroma, None)
    marked_key = parse_key(args.key)
    key_root, key_minor = marked_key or (detected_key_root, detected_key_minor)
    use_flats = prefer_flats(key_root, args.key)
    names = FLAT_NAMES if use_flats else SHARP_NAMES
    musical_key = f"{names[key_root]}{'m' if key_minor else ''}"

    onset = librosa.onset.onset_strength(y=percussive, sr=sample_rate, hop_length=hop_length)
    canonical_beat_times: np.ndarray | None = None
    if args.beat_times_json:
        parsed_times = json.loads(args.beat_times_json)
        if not isinstance(parsed_times, list):
            raise ValueError("beat-times-json must contain an array")
        canonical_beat_times = np.asarray(
            sorted({float(value) for value in parsed_times if math.isfinite(float(value)) and 0.0 <= float(value) < duration}),
            dtype=np.float64,
        )
        if canonical_beat_times.size < 4:
            canonical_beat_times = None

    if canonical_beat_times is None:
        detected_tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset,
            sr=sample_rate,
            hop_length=hop_length,
            bpm=float(args.bpm) if args.bpm else None,
            trim=False,
        )
        detected_tempo = float(np.asarray(detected_tempo).reshape(-1)[0])
        beat_frames = np.asarray(beat_frames, dtype=np.int64)
    else:
        detected_tempo = float(args.bpm or 120.0)
        beat_frames = librosa.time_to_frames(canonical_beat_times, sr=sample_rate, hop_length=hop_length).astype(np.int64)
    bpm = float(args.bpm or detected_tempo or 120.0)

    non_silent = librosa.effects.split(audio, top_db=36)
    sound_start = float(non_silent[0, 0] / sample_rate) if len(non_silent) else 0.0
    sound_end = float(non_silent[-1, 1] / sample_rate) if len(non_silent) else duration
    if beat_frames.size and canonical_beat_times is None:
        beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop_length)
        keep = (beat_times >= max(0.0, sound_start - 0.3)) & (beat_times <= sound_end + 0.2)
        beat_frames = beat_frames[keep]

    if beat_frames.size < 4:
        beat_seconds = 60.0 / max(40.0, bpm)
        regular_times = np.arange(sound_start, sound_end + beat_seconds, beat_seconds)
        beat_frames = librosa.time_to_frames(regular_times, sr=sample_rate, hop_length=hop_length)

    final_frame = min(chroma.shape[1] - 1, int(librosa.time_to_frames([sound_end], sr=sample_rate, hop_length=hop_length)[0]))
    subdivisions_per_beat = max(1, min(2, int(args.subdivisions_per_beat)))
    analysis_boundaries = beat_frames
    if canonical_beat_times is not None and subdivisions_per_beat > 1:
        subdivided: list[int] = []
        for index, start_frame in enumerate(beat_frames):
            end_frame = int(beat_frames[index + 1]) if index + 1 < len(beat_frames) else final_frame
            if end_frame <= int(start_frame):
                continue
            subdivided.append(int(start_frame))
            for subdivision in range(1, subdivisions_per_beat):
                subdivided.append(int(round(
                    int(start_frame) + (end_frame - int(start_frame)) * subdivision / subdivisions_per_beat
                )))
        analysis_boundaries = np.asarray(subdivided, dtype=np.int64)
    boundaries = np.unique(np.concatenate([analysis_boundaries, np.asarray([final_frame], dtype=np.int64)]))
    boundaries = boundaries[(boundaries >= 0) & (boundaries < chroma.shape[1])]
    if boundaries.size < 3:
        raise ValueError("Not enough rhythmic boundaries for harmony analysis")

    observations: list[np.ndarray] = []
    bass_observations: list[np.ndarray] = []
    intervals: list[tuple[float, float]] = []
    # For the detail pass, one analysis window is one beat subdivision. The
    # normal pass uses one subdivision, so existing whole-beat behaviour is
    # unchanged. This exposes off-beat evidence without changing Tony's final
    # one-chord-state-per-beat score format.
    pair_size = max(1, min(8, int(args.window_beats)))
    for index in range(0, len(boundaries) - 1, pair_size):
        end_index = min(len(boundaries) - 1, index + pair_size)
        start_frame = int(boundaries[index])
        end_frame = int(boundaries[end_index])
        if end_frame <= start_frame:
            continue
        start_time = float(librosa.frames_to_time(start_frame, sr=sample_rate, hop_length=hop_length))
        end_time = min(duration, float(librosa.frames_to_time(end_frame, sr=sample_rate, hop_length=hop_length)))
        if end_time - start_time < 0.08:
            continue
        observations.append(frame_slice_mean(chroma, start_frame, end_frame))
        bass_observation = frame_slice_mean(bass, start_frame, end_frame)
        if isolated_bass_evidence:
            interval_bass_activity = float(np.mean(bass_rms[start_frame:min(end_frame, len(bass_rms))]))
            if interval_bass_activity / max(bass_reference, 1e-9) < 0.12:
                bass_observation = np.zeros_like(bass_observation)
                suppressed_bass_windows += 1
        bass_observations.append(bass_observation)
        intervals.append((start_time, end_time))

    analysis_window_beats = pair_size / subdivisions_per_beat
    local_key_contexts = rolling_key_contexts(observations, analysis_window_beats, args.key)
    emissions = np.vstack([
        emission_scores(observation, bass_observation, local_root, local_minor)
        for observation, bass_observation, (local_root, local_minor, _confidence, _raw_root, _raw_minor) in zip(
            observations,
            bass_observations,
            local_key_contexts,
        )
    ])
    path = remove_short_blips(viterbi(emissions), emissions)
    initial_key_sequence = significant_key_sequence(local_key_contexts, key_root, key_minor, names)
    local_key_contexts = refine_contexts_to_significant_keys(
        observations,
        path,
        local_key_contexts,
        key_root,
        key_minor,
        initial_key_sequence,
        analysis_window_beats,
    )
    emissions = np.vstack([
        emission_scores(observation, bass_observation, local_root, local_minor)
        for observation, bass_observation, (local_root, local_minor, _confidence, _raw_root, _raw_minor) in zip(
            observations,
            bass_observations,
            local_key_contexts,
        )
    ])
    path = remove_short_blips(viterbi(emissions), emissions)

    raw_events: list[dict[str, object]] = []
    for index, state_value in enumerate(path):
        root = int(state_value)
        local_root, local_minor, local_confidence, raw_key_root, raw_key_minor = local_key_contexts[index]
        ranked_candidates = rank_tony_candidates(
            observations[index],
            bass_observations[index],
            local_root,
            local_minor,
        )
        root_candidates = [candidate for candidate in ranked_candidates if int(candidate["root"]) == root]
        selected = root_candidates[0]
        quality = str(selected["quality"])
        degree = str(selected["degree"])
        ranked = np.sort(emissions[index])[::-1]
        root_margin = float(ranked[0] - ranked[1]) if len(ranked) > 1 else 0.0
        quality_margin = (
            float(selected["score"]) - float(root_candidates[1]["score"])
            if len(root_candidates) > 1
            else 0.0
        )
        confidence = clamp(
            35.0
            + root_margin * 170.0
            + quality_margin * 130.0
            + max(0.0, float(selected["score"]) - 0.58) * 48.0,
            34.0,
            89.0,
        )
        start_time, end_time = intervals[index]
        interval_start_frame = int(librosa.time_to_frames([start_time], sr=sample_rate, hop_length=hop_length)[0])
        interval_end_frame = int(librosa.time_to_frames([end_time], sr=sample_rate, hop_length=hop_length)[0])
        interval_start_frame = max(0, min(interval_start_frame, len(harmonic_rms) - 1))
        interval_end_frame = max(interval_start_frame + 1, min(interval_end_frame, len(harmonic_rms)))
        harmonic_activity = float(np.mean(harmonic_rms[interval_start_frame:interval_end_frame]))
        percussive_activity = float(np.mean(percussive_rms[interval_start_frame:interval_end_frame]))
        relative_activity = harmonic_activity / max(harmonic_reference, 1e-9)
        observation_total = max(float(np.sum(observations[index])), 1e-9)
        normalized_observation = observations[index] / observation_total
        tonal_concentration = float(np.sum(np.sort(normalized_observation)[-4:]))
        percussive_ratio = percussive_activity / max(harmonic_activity + percussive_activity, 1e-9)
        low_energy = clamp((0.42 - relative_activity) / 0.42, 0.0, 1.0)
        low_tonal = clamp((0.60 - tonal_concentration) / 0.35, 0.0, 1.0)
        no_chord_probability = clamp(low_energy * 0.62 + low_tonal * 0.28 + percussive_ratio * low_tonal * 0.10, 0.0, 1.0)
        if start_time < sound_start - 0.04 or start_time > sound_end + 0.04:
            no_chord_probability = max(no_chord_probability, 0.92)
        boundary_strength = entry_boundary_strength(boundary_candidates, start_time, end_time)
        root_name = FLAT_NAMES[root] if degree.startswith("b") else names[root]
        alternatives = []
        for candidate in ranked_candidates:
            candidate_root = int(candidate["root"])
            candidate_degree = str(candidate["degree"])
            candidate_root_name = FLAT_NAMES[candidate_root] if candidate_degree.startswith("b") else names[candidate_root]
            candidate_name = f"{candidate_root_name}{candidate['quality']}"
            if candidate_name == f"{root_name}{quality}" or candidate_name in alternatives:
                continue
            alternatives.append(candidate_name)
            if len(alternatives) == 3:
                break
        raw_events.append({
            "startSeconds": round(start_time, 3),
            "durationSeconds": round(max(0.08, end_time - start_time), 3),
            "name": f"{root_name}{quality}",
            "root": root_name,
            "quality": quality,
            "confidence": round(confidence, 1),
            "reviewStatus": "likely" if confidence >= 70.0 else "review",
            "alternateNames": alternatives,
            "theoryDegree": degree,
            "rootSearchRank": int(selected["rootRank"]),
            "qualitySearchRank": int(selected["qualityRank"]),
            "relativeKeyContext": f"{names[local_root]}{'m' if local_minor else ''}",
            "rawTonalCenter": f"{names[raw_key_root]}{'m' if raw_key_minor else ''}",
            "localKeyConfidence": round(local_confidence, 1),
            "candidateAlternatives": [
                {
                    "name": f"{FLAT_NAMES[int(candidate['root'])] if str(candidate['degree']).startswith('b') else names[int(candidate['root'])]}{candidate['quality']}",
                    "degree": str(candidate["degree"]),
                    "score": round(float(candidate["score"]), 4),
                }
                for candidate in ranked_candidates[:5]
            ],
            "harmonicActivity": round(relative_activity, 4),
            "tonalConcentration": round(tonal_concentration, 4),
            "percussiveRatio": round(percussive_ratio, 4),
            "noChordProbability": round(no_chord_probability, 4),
            "boundaryStrength": round(clamp(boundary_strength, 0.0, 1.0), 4),
        })

    # Color tones in a dense mix can flare for one beat because of melody.
    # Keep genuine root changes, but remove a lone low-confidence quality
    # change when the same root and quality are stable on both sides.
    for index in range(1, len(raw_events) - 1):
        previous = raw_events[index - 1]
        current = raw_events[index]
        following = raw_events[index + 1]
        if (
            previous["root"] == current["root"] == following["root"]
            and previous["name"] == following["name"] != current["name"]
            and float(current["confidence"]) < 70.0
            and max(float(current["boundaryStrength"]), float(following["boundaryStrength"])) < 0.58
            and defining_color_support(
                NOTE_TO_PC[str(current["root"])],
                str(current["quality"]),
                observations[index] / max(float(np.sum(observations[index])), 1e-9),
            ) < 0.4
        ):
            original_name = str(current["name"])
            current["name"] = previous["name"]
            current["quality"] = previous["quality"]
            current["qualitySearchRank"] = previous["qualitySearchRank"]
            current["alternateNames"] = list(dict.fromkeys([original_name, *list(current["alternateNames"])]))[:3]
    if len(raw_events) >= 2:
        first, second = raw_events[0], raw_events[1]
        if (
            first["root"] == second["root"]
            and first["name"] != second["name"]
            and (float(first["confidence"]) < 50.0 or float(first["startSeconds"]) < sound_start)
        ):
            original_name = str(first["name"])
            first["name"] = second["name"]
            first["quality"] = second["quality"]
            first["qualitySearchRank"] = second["qualitySearchRank"]
            first["alternateNames"] = list(dict.fromkeys([original_name, *list(first["alternateNames"])]))[:3]

    events: list[dict[str, object]] = []
    for event in raw_events:
        if canonical_beat_times is not None:
            # Preserve one decision per real beat for the multi-engine fusion.
            # Merging before color and Bass analysis can smear E-sus into Em
            # or hide a one-beat inversion inside a longer chord block.
            events.append(dict(event))
            continue
        previous = events[-1] if events else None
        if previous and previous["name"] == event["name"]:
            previous_end = float(previous["startSeconds"]) + float(previous["durationSeconds"])
            if abs(previous_end - float(event["startSeconds"])) < 0.12:
                previous["durationSeconds"] = round(float(event["startSeconds"]) + float(event["durationSeconds"]) - float(previous["startSeconds"]), 3)
                previous["confidence"] = round((float(previous["confidence"]) + float(event["confidence"])) / 2.0, 1)
                previous["reviewStatus"] = "likely" if float(previous["confidence"]) >= 68.0 else "review"
                continue
        events.append(event)

    for event in events:
        if float(event.get("noChordProbability", 0.0)) >= 0.82:
            previous_name = str(event["name"])
            event["name"] = "N.C."
            event["root"] = "N.C."
            event["quality"] = "none"
            event["bass"] = None
            event["isolatedBassEvidence"] = False
            event["bassPitch"] = None
            event["bassPitchConfidence"] = None
            event["alternateNames"] = list(dict.fromkeys([previous_name, *list(event.get("alternateNames", []))]))[:3]
            event["confidence"] = round(max(float(event["confidence"]), float(event["noChordProbability"]) * 100.0), 1)
            event["reviewStatus"] = "likely" if float(event["noChordProbability"]) >= 0.9 else "review"
            continue
        start_frame = int(librosa.time_to_frames([float(event["startSeconds"])], sr=sample_rate, hop_length=hop_length)[0])
        end_frame = int(librosa.time_to_frames(
            [float(event["startSeconds"]) + float(event["durationSeconds"])],
            sr=sample_rate,
            hop_length=hop_length,
        )[0])
        event_chroma = frame_slice_mean(chroma, start_frame, end_frame)
        event_bass = frame_slice_mean(bass, start_frame, end_frame)
        event_bass_frames = bass[:, start_frame:end_frame]
        event_bass_activity = float(np.mean(bass_rms[start_frame:min(end_frame, len(bass_rms))]))
        bass_is_active = (
            not isolated_bass_evidence
            or event_bass_activity / max(bass_reference, 1e-9) >= 0.12
        )
        if not bass_is_active:
            event_bass = np.zeros_like(event_bass)
            event_bass_frames = np.zeros_like(event_bass_frames)
        root = NOTE_TO_PC[str(event["root"])]
        quality = str(event["quality"])
        cqt_bass_profile = stable_bass_details(event_bass, event_bass_frames) if bass_is_active else None
        tracker_bass_profile = stable_pitch_tracker_details(
            bass_tracker_f0,
            bass_tracker_voiced,
            bass_tracker_probability,
            bass_rms,
            start_frame,
            end_frame,
            bass_reference,
        ) if bass_is_active else None
        tracker_agreement: bool | None = None
        stable_bass_profile = cqt_bass_profile
        if cqt_bass_profile is not None and tracker_bass_profile is not None:
            tracker_agreement = int(cqt_bass_profile["pitch"]) == int(tracker_bass_profile["pitch"])
            if tracker_agreement:
                stable_bass_profile = {
                    **cqt_bass_profile,
                    "confidence": clamp(
                        float(cqt_bass_profile["confidence"]) * 0.56
                        + float(tracker_bass_profile["confidence"]) * 0.44
                        + 4.0,
                        45.0,
                        96.0,
                    ),
                    "stability": min(
                        float(cqt_bass_profile["stability"]),
                        float(tracker_bass_profile["stability"]),
                    ),
                }
            else:
                stable_bass_profile = None
                suppressed_tracker_disagreements += 1
        elif tracker_bass_profile is not None:
            stable_bass_profile = tracker_bass_profile
        stable_bass = (
            (int(stable_bass_profile["pitch"]), float(stable_bass_profile["confidence"]))
            if stable_bass_profile is not None
            else None
        )
        inversion = detect_inversion(root, quality, event_bass, event_bass_frames) if bass_is_active else None
        if stable_bass_profile is None or (inversion is not None and int(stable_bass_profile["pitch"]) != inversion):
            inversion = None
        inversion_name = names[inversion] if inversion is not None else None
        suffix = f"/{inversion_name}" if inversion_name is not None else ""
        event["quality"] = quality
        event["bass"] = inversion_name
        event["isolatedBassEvidence"] = bool(isolated_bass_evidence and inversion is not None)
        event["bassPitch"] = names[stable_bass[0]] if isolated_bass_evidence and stable_bass is not None else None
        event["bassPitchConfidence"] = round(stable_bass[1], 1) if isolated_bass_evidence and stable_bass is not None else None
        event["bassPitchStability"] = (
            round(float(stable_bass_profile["stability"]), 4)
            if isolated_bass_evidence and stable_bass_profile is not None
            else None
        )
        event["bassPitchTracker"] = (
            names[int(tracker_bass_profile["pitch"])]
            if isolated_bass_evidence and tracker_bass_profile is not None
            else None
        )
        event["bassPitchTrackerConfidence"] = (
            round(float(tracker_bass_profile["confidence"]), 1)
            if isolated_bass_evidence and tracker_bass_profile is not None
            else None
        )
        event["bassPitchTrackerStability"] = (
            round(float(tracker_bass_profile["stability"]), 4)
            if isolated_bass_evidence and tracker_bass_profile is not None
            else None
        )
        event["bassPitchTrackerAgreement"] = tracker_agreement
        event["bassPitchCandidates"] = (
            [
                {
                    "name": names[int(candidate["pitch"])],
                    "energy": round(float(candidate["energy"]), 4),
                }
                for candidate in list(stable_bass_profile["candidates"])
            ]
            if isolated_bass_evidence and stable_bass_profile is not None
            else []
        )
        event["beatSubdivision"] = subdivisions_per_beat
        event["name"] = f"{event['root']}{quality}{suffix}"
        if inversion is not None and stable_bass is not None:
            event["confidence"] = round(min(float(event["confidence"]), stable_bass[1]), 1)
            event["reviewStatus"] = "likely" if float(event["confidence"]) >= 70.0 else "review"

    event_confidences = [float(event["confidence"]) for event in events]
    local_key_counts: dict[str, int] = {}
    for local_root, local_minor, _confidence, _raw_root, _raw_minor in local_key_contexts:
        label = f"{names[local_root]}{'m' if local_minor else ''}"
        local_key_counts[label] = local_key_counts.get(label, 0) + 1
    dominant_local_keys = [
        {"key": label, "windows": count}
        for label, count in sorted(local_key_counts.items(), key=lambda item: item[1], reverse=True)[:4]
    ]
    key_sequence = significant_key_sequence(local_key_contexts, key_root, key_minor, names)
    musical_key = f"{names[key_root]}{'m' if key_minor else ''}"
    overall_confidence = clamp(
        (float(np.mean(event_confidences)) if event_confidences else 35.0) * 0.88,
        30.0,
        78.0,
    )
    return {
        "engine": "songzu_harmony_v2",
        "bpm": round(bpm, 2),
        "musicalKey": musical_key,
        "durationSeconds": round(duration, 3),
        "confidence": round(overall_confidence, 1),
        "sourceProfile": "mixed_audio",
        "events": events,
        "warnings": [
            "mixed_audio_harmony_draft",
            "marked_key_is_home_anchor_and_sustained_audio_evidence_may_add_modulation",
            "tony_root_then_quality_search_order_used_as_tie_breaker",
            "conservative_extensions_and_inversions_enabled",
            "complex_harmony_still_requires_review",
        ],
        "diagnostics": {
            "keyConfidence": round(key_confidence, 1),
            "markedKeyUsed": bool(marked_key),
            "audioEstimatedGlobalKey": f"{names[detected_key_root]}{'m' if detected_key_minor else ''}",
            "tuningCents": round(tuning * 100.0, 1),
            "beatCount": int(len(beat_frames)),
            "eventCount": len(events),
            "soundStartSeconds": round(sound_start, 3),
            "soundEndSeconds": round(sound_end, 3),
            "canonicalBeatGrid": canonical_beat_times is not None,
            "beatGranularEvents": canonical_beat_times is not None,
            "subdivisionsPerBeat": subdivisions_per_beat,
            "subBeatGranularEvents": canonical_beat_times is not None and subdivisions_per_beat > 1,
            "isolatedBassEvidence": isolated_bass_evidence,
            "suppressedInactiveBassWindows": suppressed_bass_windows,
            "suppressedBassTrackerDisagreements": suppressed_tracker_disagreements,
            "bassActivityGateRatio": 0.12,
            "bassPitchTracker": "pyin_cqt_consensus_v1" if bass_tracker_f0 is not None else "cqt_only",
            "localKeyContext": True,
            "dominantLocalKeys": dominant_local_keys,
            "significantKeySequence": key_sequence,
            "tonyRootSearchOrder": list(TONY_DEGREE_LABELS),
            "tonyQualitySearchOrder": [quality or "Major" for quality, _intervals in TONY_QUALITY_SPECS],
            "relativeMajorMinorPairing": True,
            "significantKeyRegionRefinement": len(initial_key_sequence) > 1,
            "inversionAwareRootScoring": True,
            "explicitNoChordDetection": True,
            "chordBoundaryCandidates": boundary_candidates,
            "chordBoundaryDetector": "cqt_cosine_novelty_v1",
            "harmonicActivityReference": round(harmonic_reference, 7),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--bass-input", default=None)
    parser.add_argument("--bpm", type=float, default=None)
    parser.add_argument("--key", default=None)
    parser.add_argument("--time-signature", default="4/4")
    parser.add_argument("--window-beats", type=int, default=1)
    parser.add_argument("--subdivisions-per-beat", type=int, choices=[1, 2], default=1)
    parser.add_argument("--beat-times-json", default=None)
    parser.add_argument("--max-seconds", type=float, default=600.0)
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(args), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # pragma: no cover - surfaced to the Next API
        print(f"Harmony analysis failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
