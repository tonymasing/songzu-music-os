#!/usr/bin/env python3
"""Optional local CNN/CRF chord recognizer for Songzu Music OS."""

from __future__ import annotations

import argparse
import collections
import collections.abc
import json
import sys
from pathlib import Path

for alias in ("MutableSequence", "MutableMapping", "Sequence"):
    if not hasattr(collections, alias):
        setattr(collections, alias, getattr(collections.abc, alias))

import numpy as np

if not hasattr(np, "float"):
    np.float = float  # type: ignore[attr-defined]
if not hasattr(np, "int"):
    np.int = int  # type: ignore[attr-defined]

from madmom.features.chords import CNNChordFeatureProcessor, CRFChordRecognitionProcessor


SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
NOTE_TO_PC = {name: index for index, name in enumerate(SHARP_NAMES)} | {
    name: index for index, name in enumerate(FLAT_NAMES)
}


def key_root(value: str | None) -> int | None:
    if not value:
        return None
    root = value.strip().replace("maj", "").replace("min", "m")
    if root.endswith("m"):
        root = root[:-1]
    root = root[:1].upper() + root[1:]
    return NOTE_TO_PC.get(root)


def use_flats(value: str | None) -> bool:
    root = key_root(value)
    if value and "b" in value:
        return True
    return root in {1, 3, 5, 8, 10}


def parse_label(label: str, flat_names: bool) -> tuple[str, str, str] | None:
    if label == "N" or ":" not in label:
        return None
    raw_root, raw_quality = label.split(":", 1)
    pitch_class = NOTE_TO_PC.get(raw_root)
    if pitch_class is None:
        return None
    root = (FLAT_NAMES if flat_names else SHARP_NAMES)[pitch_class]
    quality = "m" if raw_quality.startswith("min") else ""
    return f"{root}{quality}", root, quality


def analyze(source: Path, musical_key: str | None) -> dict[str, object]:
    features = CNNChordFeatureProcessor()(str(source))
    segments = CRFChordRecognitionProcessor()(features)
    flat_names = use_flats(musical_key)
    events: list[dict[str, object]] = []
    for start, end, raw_label in segments:
        parsed = parse_label(str(raw_label), flat_names)
        if not parsed:
            continue
        name, root, quality = parsed
        event = {
            "startSeconds": round(float(start), 3),
            "durationSeconds": round(max(0.05, float(end) - float(start)), 3),
            "name": name,
            "root": root,
            "quality": quality,
        }
        previous = events[-1] if events else None
        if previous and previous["name"] == name:
            previous_end = float(previous["startSeconds"]) + float(previous["durationSeconds"])
            if abs(previous_end - float(start)) < 0.08:
                previous["durationSeconds"] = round(float(end) - float(previous["startSeconds"]), 3)
                continue
        events.append(event)
    return {"engine": "madmom_cnn_crf", "events": events}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--key", default=None)
    args = parser.parse_args()
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        print(f"Audio file not found: {source}", file=sys.stderr)
        return 1
    try:
        print(json.dumps(analyze(source, args.key), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # pragma: no cover - surfaced to the Next API
        print(f"Neural harmony analysis failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
