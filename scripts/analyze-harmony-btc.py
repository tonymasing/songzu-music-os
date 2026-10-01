#!/usr/bin/env python3
"""Run the official BTC-ISMIR19 long-context chord model locally.

The upstream repository and weights live in the Songzu cache/vendor area and
are intentionally excluded from the desktop package. This adapter emits JSON
only and does not alter the protected source audio.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import os
import sys
from pathlib import Path

import librosa
import numpy as np
import torch
import yaml


QUALITY_MAP = {
    "maj": "", "min": "m", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6",
    "min7": "m7", "minmaj7": "mMaj7", "maj7": "maj7", "7": "7", "dim7": "dim7",
    "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4",
}


def chord_parts(label: str) -> tuple[str, str, str] | None:
    if label in {"N", "X"}:
        return ("N.C.", "N.C.", "none")
    root, _, quality = label.partition(":")
    suffix = QUALITY_MAP.get(quality or "maj")
    if suffix is None:
        return None
    return (f"{root}{suffix}", root, suffix)


def load_upstream(repo: Path):
    if not (repo / "btc_model.py").is_file():
        raise FileNotFoundError(f"BTC repository not found: {repo}")
    os.chdir(repo)
    sys.path.insert(0, str(repo))
    # Compatibility aliases required by the 2019 reference implementation.
    if not hasattr(np, "float"):
        np.float = float  # type: ignore[attr-defined]
    if not hasattr(np, "int"):
        np.int = int  # type: ignore[attr-defined]
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from btc_model import BTC_model
        from utils.hparams import HParams
        from utils.mir_eval_modules import idx2voca_chord
    with (repo / "run_config.yaml").open("r", encoding="utf-8") as handle:
        config = HParams(**yaml.safe_load(handle))
    config.feature["large_voca"] = True
    config.model["num_chords"] = 170
    return BTC_model, config, idx2voca_chord()


def extract_features(source: Path, config, max_seconds: float) -> tuple[np.ndarray, float, float]:
    sample_rate = int(config.mp3["song_hz"])
    audio, _ = librosa.load(source, sr=sample_rate, mono=True, duration=max_seconds)
    if audio.size < sample_rate // 2:
        raise ValueError("audio is too short for BTC analysis")
    feature = librosa.cqt(
        audio,
        sr=sample_rate,
        n_bins=int(config.feature["n_bins"]),
        bins_per_octave=int(config.feature["bins_per_octave"]),
        hop_length=int(config.feature["hop_length"]),
    )
    feature = np.log(np.abs(feature) + 1e-6).T
    time_unit = int(config.feature["hop_length"]) / float(sample_rate)
    return feature, time_unit, len(audio) / float(sample_rate)


def analyze(args: argparse.Namespace) -> dict[str, object]:
    source = Path(args.input).expanduser().resolve()
    repo = Path(args.repo).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Audio file not found: {source}")
    BTCModel, config, labels = load_upstream(repo)
    model = BTCModel(config=config.model).cpu()
    checkpoint_path = repo / "test" / "btc_model_large_voca.pt"
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    feature, time_unit, duration = extract_features(source, config, args.max_seconds)
    mean = float(checkpoint.get("mean", 0.0))
    std = max(1e-8, float(checkpoint.get("std", 1.0)))
    feature = (feature - mean) / std
    timestep = int(config.model["timestep"])
    original_frames = feature.shape[0]
    padding = (-original_frames) % timestep
    if padding:
        feature = np.pad(feature, ((0, padding), (0, 0)), mode="constant")

    frame_labels: list[tuple[int, float, float]] = []
    with torch.inference_mode():
        tensor = torch.tensor(feature, dtype=torch.float32).unsqueeze(0)
        for offset in range(0, feature.shape[0], timestep):
            encoded, _weights = model.self_attn_layers(tensor[:, offset:offset + timestep, :])
            logits = model.output_layer.output_projection(encoded)
            probabilities = torch.softmax(logits, dim=-1).squeeze(0)
            top_values, top_indices = torch.topk(probabilities, 2, dim=-1)
            for row in range(min(timestep, original_frames - offset)):
                frame_labels.append((
                    int(top_indices[row, 0].item()),
                    float(top_values[row, 0].item()),
                    float(top_values[row, 1].item()),
                ))

    events: list[dict[str, object]] = []
    run_start = 0
    while run_start < len(frame_labels):
        run_end = run_start + 1
        while run_end < len(frame_labels) and frame_labels[run_end][0] == frame_labels[run_start][0]:
            run_end += 1
        label_index = frame_labels[run_start][0]
        parsed = chord_parts(str(labels[label_index]))
        if parsed is not None:
            name, root, quality = parsed
            confidence_values = [value[1] for value in frame_labels[run_start:run_end]]
            margin_values = [value[1] - value[2] for value in frame_labels[run_start:run_end]]
            events.append({
                "startSeconds": round(run_start * time_unit, 3),
                "durationSeconds": round(max(0.05, min(duration, run_end * time_unit) - run_start * time_unit), 3),
                "name": name,
                "root": root,
                "quality": quality,
                "confidence": round(float(np.mean(confidence_values)) * 100.0, 1),
                "margin": round(float(np.mean(margin_values)) * 100.0, 1),
            })
        run_start = run_end

    return {
        "engine": "btc_ismir19_large_vocabulary",
        "durationSeconds": round(duration, 3),
        "events": events,
        "diagnostics": {
            "model": "official_btc_ismir19_large_voca",
            "modelPath": str(checkpoint_path),
            "contextSeconds": round(timestep * time_unit, 3),
            "frameSeconds": round(time_unit, 5),
            "frameCount": original_frames,
            "audioNeverModified": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--max-seconds", type=float, default=600.0)
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(args), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # pragma: no cover - surfaced to the Next API
        print(f"BTC harmony analysis failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
