/** Calibration and rendering must use the same corrected media-time coordinate. */
export function playbackBeatTime(time: number, rate: number, latency: number, offsetMs: number) {
  return time - (latency + offsetMs / 1000) * rate;
}

/** A visual metronome locked to native media time, never to a drifting timer. */
export function beatPulse(time: number, bpm: number, anchor: number, rate: number) {
  if (![time, bpm, anchor, rate].every(Number.isFinite) || bpm <= 0 || rate <= 0) return 0;
  const cycle = (time - anchor) * bpm / 60;
  const phase = ((cycle % 1) + 1) % 1;
  const sinceBeat = phase * 60 / bpm / rate;
  const pulse = Math.exp(-sinceBeat / 0.1);
  return pulse < 0.005 ? 0 : pulse;
}

/** Tap intervals use media seconds, so the result is the original tempo at any rate. */
export function tappedTempo(times: number[]) {
  if (times.length < 4) return null;
  const intervals = times.slice(1).map((time, i) => time - times[i]);
  if (intervals.some(interval => interval < 0.2 - 1e-6 || interval > 2 + 1e-6)) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  const consistent = intervals.filter(interval => Math.abs(interval - middle) <= middle * 0.25);
  if (consistent.length < 3) return null;
  return Math.min(300, Math.max(30, Math.round(600 / (consistent.reduce((sum, interval) => sum + interval, 0) / consistent.length)) / 10));
}

export type BeatGrid = { version: 1; bpm: number; beats: number[]; confidence: number; engine: string };
export function parseBeatGrid(value: unknown): BeatGrid | null {
  if (!value || typeof value !== "object") return null;
  const grid = value as BeatGrid;
  if (grid.version !== 1 || !Number.isFinite(grid.bpm) || grid.bpm < 30 || grid.bpm > 300 || !Number.isFinite(grid.confidence) || grid.confidence < 0.08 || grid.confidence > 1 || typeof grid.engine !== "string" || !Array.isArray(grid.beats) || grid.beats.length < 8 || grid.beats.length > 6000) return null;
  if (grid.beats.some((time, index) => !Number.isFinite(time) || time < 0 || time > 901 || (index > 0 && time <= grid.beats[index - 1]))) return null;
  return { version: 1, bpm: grid.bpm, beats: [...grid.beats], confidence: grid.confidence, engine: grid.engine };
}

/** Binary search the actual recorded beats; never extrapolate through an intro/outro. */
export function gridPulse(time: number, beats: readonly number[], rate: number) {
  if (!Number.isFinite(time) || !Number.isFinite(rate) || rate <= 0 || !beats.length || time < beats[0]) return 0;
  let low = 0, high = beats.length;
  while (low < high) { const mid = (low + high) >>> 1; if (beats[mid] <= time) low = mid + 1; else high = mid; }
  const sinceBeat = (time - beats[low - 1]) / rate;
  return sinceBeat < 0.53 ? Math.exp(-sinceBeat / 0.1) : 0;
}

/**
 * Remove detector jitter only when the entire recording supports one steady tempo.
 * Tempo changes, gaps and extra detections fail the fit and retain their timestamps.
 * Run once in the visual player, never while parsing server/cache data.
 */
export function regularizeBeats(beats: readonly number[]) {
  if (beats.length < 16) return [...beats];
  const count = beats.length, center = (count - 1) / 2;
  const mean = beats.reduce((sum, time) => sum + time, 0) / count;
  let covariance = 0, variance = 0;
  for (let i = 0; i < count; i++) {
    covariance += (i - center) * (beats[i] - mean);
    variance += (i - center) ** 2;
  }
  const period = covariance / variance, anchor = mean - period * center;
  if (!Number.isFinite(period) || period < 0.2 || period > 2) return [...beats];
  const errors = beats.map((time, i) => Math.abs(time - (anchor + i * period))).sort((a, b) => a - b);
  const percentile = (fraction: number) => errors[Math.floor((count - 1) * fraction)];
  if (percentile(0.9) > Math.min(0.025, period * 0.05)
    || percentile(0.98) > Math.min(0.05, period * 0.1)
    || errors[count - 1] > Math.min(0.08, period * 0.18)) return [...beats];
  const first = beats[0], last = beats[count - 1];
  return beats.map((_, i) => Math.min(last, Math.max(first, anchor + i * period)));
}
