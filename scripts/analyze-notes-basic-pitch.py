#!/usr/bin/env python3
"""Extract beat-aligned note evidence with Spotify Basic Pitch.

This is an optional local sidecar. It never writes MIDI or modifies audio; it
returns compact pitch-class evidence that Songzu's harmony consensus can audit.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np


PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def parse_beats(raw: str, duration: float) -> list[float]:
    values = json.loads(raw)
    if not isinstance(values, list):
        raise ValueError("beat-times-json must contain an array")
    beats = sorted({float(value) for value in values if math.isfinite(float(value)) and 0 <= float(value) < duration})
    if len(beats) < 2:
        raise ValueError("at least two beat times are required")
    return beats


def analyze(args: argparse.Namespace) -> dict[str, object]:
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Audio file not found: {source}")

    # TensorFlow/CoreML and Basic Pitch print initialization messages to
    # stdout. Keep stdout JSON-only because Next parses this process directly.
    with contextlib.redirect_stdout(io.StringIO()):
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import predict

        model_output, _midi, note_events = predict(
            str(source),
            model_or_model_path=ICASSP_2022_MODEL_PATH,
            onset_threshold=args.onset_threshold,
            frame_threshold=args.frame_threshold,
            minimum_note_length=args.minimum_note_length,
            minimum_frequency=librosa_note_to_hz("C1"),
            maximum_frequency=librosa_note_to_hz("C7"),
        )

    duration = float(model_output.get("note", np.zeros((1, 1))).shape[0]) * 256.0 / 22050.0
    if note_events:
        duration = max(duration, max(float(note[1]) for note in note_events))
    beats = parse_beats(args.beat_times_json, max(duration, 0.001))
    median_beat = float(np.median(np.diff(np.asarray(beats, dtype=np.float64))))
    boundaries = beats + [min(max(duration, beats[-1] + median_beat), beats[-1] + median_beat * 1.5)]

    events: list[dict[str, object]] = []
    total_activity = 0.0
    for index in range(len(boundaries) - 1):
        start = boundaries[index]
        end = boundaries[index + 1]
        weights = np.zeros(12, dtype=np.float64)
        midi_weights: dict[int, float] = {}
        active_notes = 0
        for note in note_events:
            note_start, note_end, midi_pitch, amplitude = float(note[0]), float(note[1]), int(note[2]), float(note[3])
            overlap = max(0.0, min(end, note_end) - max(start, note_start))
            if overlap <= 0:
                continue
            weight = overlap * max(0.02, amplitude)
            weights[midi_pitch % 12] += weight
            midi_weights[midi_pitch] = midi_weights.get(midi_pitch, 0.0) + weight
            active_notes += 1
        total = float(np.sum(weights))
        total_activity += total
        normalized = weights / max(total, 1e-9)
        ranked = np.argsort(normalized)[::-1]
        stable_midis = sorted(midi_weights.items(), key=lambda item: (-item[1], item[0]))
        lowest = min((midi for midi, weight in midi_weights.items() if weight >= max(0.001, total * 0.035)), default=None)
        concentration = float(np.sum(np.sort(normalized)[-4:])) if total > 0 else 0.0
        events.append({
            "startSeconds": round(start, 3),
            "durationSeconds": round(max(0.05, end - start), 3),
            "pitchClasses": [round(float(value), 5) for value in normalized],
            "topPitchClasses": [
                {"name": PITCH_NAMES[int(pc)], "pitchClass": int(pc), "weight": round(float(normalized[pc]), 4)}
                for pc in ranked[:6] if normalized[pc] >= 0.025
            ],
            "lowestMidi": lowest,
            "lowestPitchClass": int(lowest % 12) if lowest is not None else None,
            "stableMidis": [
                {"midi": int(midi), "pitchClass": int(midi % 12), "weight": round(float(weight / max(total, 1e-9)), 4)}
                for midi, weight in stable_midis[:8]
            ],
            "activity": round(total, 5),
            "concentration": round(concentration, 4),
            "noteCount": active_notes,
            "tonal": bool(total > 0.002 and concentration >= 0.55),
        })

    activity_values = np.asarray([float(event["activity"]) for event in events], dtype=np.float64)
    activity_reference = float(np.percentile(activity_values[activity_values > 0], 60)) if np.any(activity_values > 0) else 0.0
    for event in events:
        relative = float(event["activity"]) / max(activity_reference, 1e-9)
        event["relativeActivity"] = round(clamp(relative, 0.0, 2.0), 4)
        event["noChordProbability"] = round(clamp(1.0 - relative * 0.72 - float(event["concentration"]) * 0.18, 0.0, 1.0), 4)

    return {
        "engine": "basic_pitch_coreml_v1",
        "durationSeconds": round(duration, 3),
        "noteCount": len(note_events),
        "beatCount": len(events),
        "events": events,
        "diagnostics": {
            "onsetThreshold": args.onset_threshold,
            "frameThreshold": args.frame_threshold,
            "minimumNoteLengthMs": args.minimum_note_length,
            "totalActivity": round(total_activity, 5),
            "audioNeverModified": True,
        },
    }


def librosa_note_to_hz(note: str) -> float:
    # Avoid importing librosa into the Basic Pitch process only for two fixed
    # frequency bounds.
    midi = {"C1": 24, "C7": 96}[note]
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--beat-times-json", required=True)
    parser.add_argument("--onset-threshold", type=float, default=0.43)
    parser.add_argument("--frame-threshold", type=float, default=0.30)
    parser.add_argument("--minimum-note-length", type=float, default=70.0)
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(args), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # pragma: no cover - surfaced to the Next API
        print(f"Basic Pitch analysis failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
