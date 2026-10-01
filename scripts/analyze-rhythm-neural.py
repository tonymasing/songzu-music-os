#!/usr/bin/env python3
"""Local musical beat-grid analysis for Songzu Music OS.

The result is a performance-following grid, not only a single rounded BPM.
It is intended for aligning imported songs, metronome clicks and score guides.
Audio remains on the local machine.
"""

from __future__ import annotations

import argparse
import collections
import collections.abc
import json
import sys
from pathlib import Path

for alias in ("MutableSequence", "MutableMapping", "MutableSet", "Sequence"):
    if not hasattr(collections, alias):
        setattr(collections, alias, getattr(collections.abc, alias))

import numpy as np

if not hasattr(np, "float"):
    np.float = float  # type: ignore[attr-defined]
if not hasattr(np, "int"):
    np.int = int  # type: ignore[attr-defined]
if not hasattr(np, "bool"):
    np.bool = bool  # type: ignore[attr-defined]

from madmom.features.beats import DBNBeatTrackingProcessor, RNNBeatProcessor
from madmom.features.downbeats import RNNDownBeatProcessor


FPS = 100


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def activation_at(activations: np.ndarray, seconds: float) -> np.ndarray:
    frame = int(round(seconds * FPS))
    return activations[max(0, min(len(activations) - 1, frame))]


def analyze(source: Path, beats_per_bar: int) -> dict[str, object]:
    beat_activations = RNNBeatProcessor()(str(source))
    beat_times = np.asarray(
        DBNBeatTrackingProcessor(
            fps=FPS,
            min_bpm=45,
            max_bpm=180,
            transition_lambda=100,
        )(beat_activations),
        dtype=np.float64,
    )
    if beat_times.size < 8:
        raise ValueError("Not enough stable beats were detected")

    intervals = np.diff(beat_times)
    median_interval = float(np.median(intervals))
    valid = intervals[(intervals >= median_interval * 0.65) & (intervals <= median_interval * 1.45)]
    if valid.size:
        median_interval = float(np.median(valid))
    bpm = 60.0 / max(0.001, median_interval)

    downbeat_activations = np.asarray(RNNDownBeatProcessor()(str(source)), dtype=np.float64)
    sampled = np.asarray([activation_at(downbeat_activations, float(time)) for time in beat_times])
    beat_strength = sampled[:, 0]
    downbeat_strength = sampled[:, 1]
    reliable_indices = np.flatnonzero(np.maximum(beat_strength, downbeat_strength) >= 0.035)
    reliable_start = int(reliable_indices[0]) if reliable_indices.size else 0

    residue_scores: list[float] = []
    for residue in range(beats_per_bar):
        indices = np.arange(reliable_start, len(beat_times))
        indices = indices[indices % beats_per_bar == residue]
        residue_scores.append(float(np.mean(downbeat_strength[indices])) if indices.size else 0.0)
    downbeat_residue = int(np.argmax(residue_scores))

    first_downbeat_index = next(
        (index for index in range(reliable_start, len(beat_times)) if index % beats_per_bar == downbeat_residue),
        downbeat_residue,
    )
    beat_numbers = [((index - downbeat_residue) % beats_per_bar) + 1 for index in range(len(beat_times))]
    downbeat_times = [
        float(time)
        for index, time in enumerate(beat_times)
        if index >= first_downbeat_index and beat_numbers[index] == 1
    ]

    interval_mad = float(np.median(np.abs(valid - median_interval))) if valid.size else 0.0
    stability = clamp(1.0 - interval_mad / max(0.001, median_interval) * 5.0, 0.0, 1.0)
    mean_beat_strength = float(np.mean(np.maximum(beat_strength[reliable_start:], downbeat_strength[reliable_start:])))
    sorted_residue = sorted(residue_scores, reverse=True)
    downbeat_margin = sorted_residue[0] - (sorted_residue[1] if len(sorted_residue) > 1 else 0.0)
    confidence = clamp(42.0 + stability * 32.0 + mean_beat_strength * 40.0 + downbeat_margin * 45.0, 35.0, 94.0)

    tempo_map: list[dict[str, float]] = []
    chunk_beats = beats_per_bar * 4
    for start in range(0, len(beat_times) - 1, chunk_beats):
        end = min(len(beat_times) - 1, start + chunk_beats)
        chunk = np.diff(beat_times[start : end + 1])
        if not chunk.size:
            continue
        chunk_interval = float(np.median(chunk))
        tempo_map.append(
            {
                "startSeconds": round(float(beat_times[start]), 3),
                "bpm": round(60.0 / max(0.001, chunk_interval), 3),
            }
        )

    warnings: list[str] = []
    if interval_mad / max(0.001, median_interval) > 0.025:
        warnings.append("演奏速度有自然浮動，播放歌曲時會使用逐拍時間格，而不是僵硬的固定 BPM。")

    return {
        "engine": "madmom_rnn_beat_grid_v1",
        "bpm": round(bpm, 3),
        "displayBpm": int(round(bpm)),
        "beatsPerBar": beats_per_bar,
        "confidence": round(confidence, 1),
        "firstBeatSeconds": round(float(beat_times[0]), 3),
        "firstDownbeatSeconds": round(float(beat_times[first_downbeat_index]), 3),
        "beatTimesSeconds": [round(float(time), 3) for time in beat_times],
        "beatNumbers": beat_numbers,
        "downbeatTimesSeconds": [round(time, 3) for time in downbeat_times],
        "tempoMap": tempo_map,
        "diagnostics": {
            "beatCount": int(len(beat_times)),
            "medianBeatSeconds": round(median_interval, 5),
            "intervalMadSeconds": round(interval_mad, 5),
            "downbeatResidue": downbeat_residue,
            "downbeatScores": [round(score, 5) for score in residue_scores],
        },
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--beats-per-bar", type=int, default=4)
    args = parser.parse_args()
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        print(f"Audio file not found: {source}", file=sys.stderr)
        return 1
    try:
        beats_per_bar = max(2, min(12, int(args.beats_per_bar)))
        print(json.dumps(analyze(source, beats_per_bar), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # pragma: no cover - surfaced to the Next API
        print(f"Neural rhythm analysis failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
