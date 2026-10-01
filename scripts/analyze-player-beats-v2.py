#!/usr/bin/env python3
"""Read-only player beats with joint beat/downbeat decoding (local models)."""
import argparse
import json
import runpy
from pathlib import Path

engine = runpy.run_path(str(Path(__file__).with_name("analyze-rhythm-neural.py")))
np = engine["np"]
from madmom.features.downbeats import DBNDownBeatTrackingProcessor


def decode_downbeats(activations, tempo=None):
    """Decode bar context without the installed library's ragged-array coercion.

    Use madmom's existing HMMs directly; select their scalar log likelihoods.
    This preserves the upstream decoder semantics under newer NumPy versions,
    without patching the installed engine or affecting score transcription.
    """
    active = np.flatnonzero(np.max(activations, axis=1) >= 0.05)
    if not len(active):
        raise ValueError("uncertain_beats")
    first = int(active[0])
    window = activations[first:int(active[-1]) + 1]
    processor = DBNDownBeatTrackingProcessor(
        beats_per_bar=[3, 4], fps=100,
        min_bpm=45 if tempo is None else max(45, tempo * 0.8),
        max_bpm=220 if tempo is None else min(220, tempo * 1.2),
        transition_lambda=100, threshold=0,
    )
    paths = [hmm.viterbi(window) for hmm in processor.hmms]
    best = max(range(len(paths)), key=lambda i: paths[i][1])
    path, score = paths[best]
    if not np.isfinite(score):
        raise ValueError("uncertain_beats")
    hmm = processor.hmms[best]
    inside = hmm.observation_model.pointers[path] >= 1
    edges = np.flatnonzero(np.diff(np.r_[False, inside, False].astype(int)))
    frames = np.array([
        left + int(np.argmax(window[left:right])) // 2
        for left, right in edges.reshape(-1, 2)
    ], dtype=int) + first
    return frames / 100.0


def format_grid(beats, activations, name):
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 8:
        raise ValueError("insufficient_beats")
    strength = activations[np.clip(np.rint(beats * 100).astype(int), 0, len(activations) - 1)]
    mean_strength = float(np.mean(strength))
    if mean_strength < 0.08 or np.count_nonzero(strength > 0.1) < 6:
        raise ValueError("uncertain_beats")
    intervals = np.diff(beats)
    middle = float(np.median(intervals))
    steady = intervals[(intervals > middle * 0.85) & (intervals < middle * 1.15)]
    bpm = 60 / float(np.mean(steady if len(steady) else intervals))
    reliable = np.flatnonzero(strength > 0.05)
    beats = beats[reliable[0]:reliable[-1] + 1]
    if len(beats) < 8:
        raise ValueError("insufficient_beats")
    return {"version": 1, "bpm": round(bpm, 2), "beats": [round(float(t), 3) for t in beats],
            "confidence": round(min(1.0, mean_strength), 4), "engine": name}


def coherent_tempo(grid):
    intervals = np.diff(grid["beats"])
    low, high = np.quantile(intervals, [0.1, 0.9])
    return grid["bpm"] if low > 0 and high / low < 1.25 else None


def select_grid(beat_grid, activations):
    """Keep a supported tempo level; use bar context to resolve phase/half-time.

    A strong joint-model score alone cannot distinguish quarter/eighth notes.
    Coherent beat-only cadence is retained. An unstable beat-only grid changes
    level only when a coherent joint grid explains its intervals as octaves.
    Genuine tempo changes and disagreements retain the original timestamps.
    """
    original = {**beat_grid, "engine": "local-rnn-preserved-v2"}
    tempo = coherent_tempo(beat_grid)
    strength = activations.max(axis=1)
    try:
        if tempo is None:
            joint = format_grid(decode_downbeats(activations), strength, "local-joint-beats-v2")
            tempo = coherent_tempo(joint)
            if tempo is None:
                return original
            ratios = np.diff(beat_grid["beats"]) / (60 / tempo)
            octave_error = np.min(abs(np.log2(ratios[:, None] / np.array([0.5, 1, 2]))), axis=1)
            if np.mean(octave_error < np.log2(1.12)) < 0.9:
                return original
        joint = format_grid(decode_downbeats(activations, tempo), strength, "local-joint-beats-v2")
        if coherent_tempo(joint) is None or abs(np.log2(joint["bpm"] / tempo)) > np.log2(1.12):
            return original
        # Once the two models agree on a beat, retain the beat detector's finer
        # onset timing. Bar context resolves large phase errors/cadence, not a
        # blanket phase shift on recordings that were already locally aligned.
        original_times = np.asarray(beat_grid["beats"])
        matched = [float(np.min(abs(original_times - t))) for t in joint["beats"]]
        if coherent_tempo(beat_grid) is not None and np.mean(np.asarray(matched) <= 0.06) >= 0.9:
            return original
        fused = []
        for time in joint["beats"]:
            nearest = original_times[np.argmin(abs(original_times - time))]
            fused.append(float(nearest) if abs(nearest - time) <= 0.06 else time)
        if np.any(np.diff(fused) <= 0):
            return original
        joint["beats"] = fused
        return joint
    except ValueError:
        return original


def analyze(path):
    beat_activations = engine["RNNBeatProcessor"]()(str(path))
    beats = engine["DBNBeatTrackingProcessor"](
        fps=100, min_bpm=45, max_bpm=220, transition_lambda=100,
    )(beat_activations)
    beat_grid = format_grid(beats, beat_activations, "local-rnn-preserved-v2")
    activations = engine["RNNDownBeatProcessor"]()(str(path))
    return select_grid(beat_grid, activations)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    print(json.dumps(analyze(Path(args.input)), separators=(",", ":")))
