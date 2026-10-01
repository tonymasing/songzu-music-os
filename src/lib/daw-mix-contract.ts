import { getEffectiveStudioSettings, type Effects } from "@/lib/daw-dsp";

const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const clampDawInputGain = (value: unknown) => clamp(finite(value, 1), 0, 1.5);
export const clampDawTrackGain = (value: unknown) => clamp(finite(value, 1), 0, 2);
export const clampDawPan = (value: unknown) => clamp(finite(value, 0), -1, 1);

// Web Audio StereoPanner's stereo crossfeed, not a left/right balance control.
// Mono clips enter this stage as unity-duplicated stereo, matching the channel graph.
export function dawStereoPanMatrix(value: unknown) {
  const pan = clampDawPan(value);
  if (pan === 0) return { ll: 1, lr: 0, rl: 0, rr: 1 };
  if (pan === -1) return { ll: 1, lr: 1, rl: 0, rr: 0 };
  if (pan === 1) return { ll: 0, lr: 0, rl: 1, rr: 1 };
  const angle = (pan <= 0 ? pan + 1 : pan) * Math.PI / 2;
  return pan <= 0
    ? { ll: 1, lr: Math.cos(angle), rl: 0, rr: Math.sin(angle) }
    : { ll: Math.cos(angle), lr: 0, rl: Math.sin(angle), rr: 1 };
}

// Callers supply only effect groups contributing to the audible master path.
export function isDawMasterTransparent(effectGroups: readonly Effects[]) {
  return effectGroups.every(effects => getEffectiveStudioSettings(effects).effectsBypassed);
}

// Playback and processed export now use the same Web Audio master graph.
// exportCeiling records the retired FFmpeg policy for compatibility only.
export const DAW_MASTER = {
  gain: 1,
  playbackThresholdDb: -0.3,
  exportCeiling: 0.891,
  ratio: 20,
  knee: 0,
  attackSeconds: 0.003,
  releaseSeconds: 0.08
} as const;

export type DawClipEnvelope = {
  gain: number;
  sampleRate: number;
  durationFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
};

export function dawClipEnvelope(
  clip: { gain: number; fadeInSeconds: number; fadeOutSeconds: number },
  durationSeconds: number,
  sampleRate: number
): DawClipEnvelope {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid clip sample rate");
  const durationFrames = Math.max(0, Math.round(finite(durationSeconds, 0) * sampleRate));
  const maxFadeFrames = Math.floor(durationFrames / 2);
  return {
    gain: Math.max(0, finite(clip.gain, 1)),
    sampleRate,
    durationFrames,
    fadeInFrames: clamp(Math.round(finite(clip.fadeInSeconds, 0) * sampleRate), 0, maxFadeFrames),
    fadeOutFrames: clamp(Math.round(finite(clip.fadeOutSeconds, 0) * sampleRate), 0, maxFadeFrames)
  };
}

// Points are relative to this playback window, but gains are evaluated on the
// original clip. Seeking into a fade must not restart or shorten that fade.
export function dawClipEnvelopePoints(envelope: DawClipEnvelope, offsetSeconds: number, lengthSeconds: number) {
  const { gain, sampleRate, durationFrames, fadeInFrames, fadeOutFrames } = envelope;
  const offsetFrames = clamp(Math.round(finite(offsetSeconds, 0) * sampleRate), 0, durationFrames);
  const lengthFrames = clamp(Math.round(finite(lengthSeconds, 0) * sampleRate), 0, durationFrames - offsetFrames);
  const endFrame = offsetFrames + lengthFrames;
  const frames = [offsetFrames, fadeInFrames, durationFrames - fadeOutFrames, endFrame]
    .filter(frame => frame >= offsetFrames && frame <= endFrame);
  return Array.from(new Set(frames)).sort((a, b) => a - b).map(frame => ({
    timeSeconds: (frame - offsetFrames) / sampleRate,
    gain: gain * (fadeInFrames > 0 ? Math.min(1, frame / fadeInFrames) : 1)
      * (fadeOutFrames > 0 ? Math.min(1, (durationFrames - frame) / fadeOutFrames) : 1)
  }));
}
