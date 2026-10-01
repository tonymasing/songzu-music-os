import type { DAW_MASTER } from "@/lib/daw-mix-contract";

// Self-contained so offline export runs the identical processed master.
export function createDawMasterGraph(context: BaseAudioContext, transparent: boolean, settings: typeof DAW_MASTER) {
  const input = context.createGain();
  const analyser = context.createAnalyser();
  const dry = context.createGain();
  const processed = context.createGain();
  const limiter = context.createDynamicsCompressor();
  input.gain.value = settings.gain;
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  limiter.threshold.value = settings.playbackThresholdDb;
  limiter.knee.value = settings.knee;
  limiter.ratio.value = settings.ratio;
  limiter.attack.value = settings.attackSeconds;
  limiter.release.value = settings.releaseSeconds;
  input.connect(dry).connect(analyser);
  input.connect(limiter).connect(processed).connect(analyser);
  analyser.connect(context.destination);
  let currentTransparent: boolean | null = null;
  function updateTransparent(next: boolean, immediate = false) {
    if (context.state === "closed" || next === currentTransparent) return false;
    currentTransparent = next;
    for (const [param, value] of [[dry.gain, next ? 1 : 0], [processed.gain, next ? 0 : 1]] as const) {
      if (immediate) { param.value = value; continue; }
      const now = context.currentTime;
      if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
      else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
      param.linearRampToValueAtTime(value, now + 0.012);
    }
    return true;
  }
  // Both routes stay connected, so bypass edits never recreate or seek sources.
  // The short transition can include the compressor's intrinsic latency; only
  // the settled transparent path is intended to be sample-transparent.
  updateTransparent(transparent, true);
  return { input, analyser, nodes: [input, dry, limiter, processed, analyser], updateTransparent, get transparent() { return currentTransparent === true; } };
}
