#!/usr/bin/env python3
"""Read-only beat timestamps for audition UI, using the installed rhythm models."""
import argparse
import json
import runpy
from pathlib import Path

# Share the existing engine's NumPy/madmom compatibility setup, without running
# its score/downbeat analysis or touching any musical project data.
engine = runpy.run_path(str(Path(__file__).with_name("analyze-rhythm-neural.py")))
np = engine["np"]


def analyze(path):
    activations = engine["RNNBeatProcessor"]()(str(path))
    beats = np.asarray(engine["DBNBeatTrackingProcessor"](
        fps=100, min_bpm=45, max_bpm=220, transition_lambda=100,
    )(activations), dtype=float)
    if len(beats) < 8:
        raise ValueError("insufficient_beats")
    strength = activations[np.clip(np.rint(beats * 100).astype(int), 0, len(activations) - 1)]
    mean_strength = float(np.mean(strength))
    if mean_strength < 0.08 or np.count_nonzero(strength > 0.1) < 6:
        raise ValueError("uncertain_beats")
    intervals = np.diff(beats)
    middle = float(np.median(intervals))
    # Average nearby intervals: a 10 ms analysis grid must not quantize 126 BPM
    # into 125 just because its median interval was rounded to .48 seconds.
    steady = intervals[(intervals > middle * 0.85) & (intervals < middle * 1.15)]
    bpm = 60 / float(np.mean(steady if len(steady) else intervals))
    # Omit unsupported leading/trailing extrapolation and long silent stretches.
    reliable = np.flatnonzero(strength > 0.05)
    beats = beats[reliable[0]:reliable[-1] + 1]
    return {"version": 1, "bpm": round(bpm, 2), "beats": [round(float(t), 3) for t in beats],
            "confidence": round(mean_strength, 4), "engine": "local-rnn-beats-v1"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    print(json.dumps(analyze(Path(args.input)), separators=(",", ":")))
