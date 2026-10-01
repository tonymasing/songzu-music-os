import type { StudioSettings } from "@/lib/daw-dsp";

// Shared with offline rendering. Keep all runtime dependencies inside this factory.
export function createDawChannelGraph(context: BaseAudioContext, source: AudioNode, initial: StudioSettings, destination: AudioNode) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  type ChannelAutomationTarget = { param: AudioParam; map?: (value: number) => number };

  function impulse(context: BaseAudioContext, amount: number) {
    const seconds = 1.1 + amount * 1.3;
    const decay = 2.1 + amount * 2.2;
    const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
    let seed = (Math.round(seconds * 1000) ^ Math.round(decay * 10000) ^ context.sampleRate) >>> 0;
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 0xffffffff * 2 - 1) * (1 - i / data.length) ** decay;
      }
    }
    return buffer;
  }

  const channelGain = context.createGain();
  const inputLevel = context.createGain();
  const bypass = context.createGain();
  const fxInput = context.createGain();
  const fxOutput = context.createGain();
  const gate = context.createWaveShaper();
  const highPass = context.createBiquadFilter(); highPass.type = "highpass";
  const lowPass = context.createBiquadFilter(); lowPass.type = "lowpass";
  highPass.Q.value = lowPass.Q.value = 0.707;
  const low = context.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 120;
  const mid = context.createBiquadFilter(); mid.type = "peaking";
  const high = context.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = Math.min(6500, context.sampleRate / 2 - 1);
  const compressor = context.createDynamicsCompressor();
  const dry = context.createGain();
  const delay = context.createDelay(1.2);
  const feedback = context.createGain();
  const echoWet = context.createGain();
  const convolver = context.createConvolver();
  const reverbWet = context.createGain();
  source.connect(channelGain).connect(inputLevel);
  inputLevel.connect(bypass).connect(destination);
  inputLevel.connect(fxInput).connect(gate).connect(highPass).connect(lowPass).connect(low).connect(mid).connect(high).connect(compressor);
  compressor.connect(dry).connect(fxOutput);
  compressor.connect(delay).connect(echoWet).connect(fxOutput);
  delay.connect(feedback).connect(delay);
  compressor.connect(convolver).connect(reverbWet).connect(fxOutput);
  fxOutput.connect(destination);
  const nodes: AudioNode[] = [channelGain, inputLevel, bypass, fxInput, fxOutput, gate, highPass, lowPass, low, mid, high, compressor, dry, delay, feedback, echoWet, convolver, reverbWet];
  let previousGate = -1;
  let previousReverb = -1;
  let lastEffects = "";
  const set = (param: AudioParam, value: number, immediate: boolean) => {
    const now = context.currentTime;
    if (immediate) { param.value = value; return; }
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.linearRampToValueAtTime(value, now + 0.012);
  };
  function update(nextEffects: StudioSettings, immediate = false) {
    const signature = JSON.stringify(nextEffects);
    if (!immediate && signature === lastEffects) return false;
    lastEffects = signature;
    const s = nextEffects;
    const nyquist = context.sampleRate / 2 - 1;
    set(inputLevel.gain, clamp(Number.isFinite(s.inputGain) ? s.inputGain : 1, 0, 1.5), immediate);
    set(bypass.gain, s.effectsBypassed ? 1 : 0, immediate);
    set(fxInput.gain, s.effectsBypassed ? 0 : 1, immediate);
    set(fxOutput.gain, s.effectsBypassed ? 0 : 1, immediate);
    set(highPass.frequency, Math.min(nyquist, clamp(s.highPassHz, 20, 2000)), immediate);
    set(lowPass.frequency, Math.min(nyquist, clamp(s.lowPassHz, 2000, 22000)), immediate);
    set(low.gain, clamp(s.lowGain, -12, 12), immediate);
    set(mid.gain, clamp(s.midGain, -12, 12), immediate);
    set(high.gain, clamp(s.highGain, -12, 12), immediate);
    set(mid.frequency, Math.min(nyquist, clamp(s.midFrequency, 120, 12000)), immediate);
    set(mid.Q, clamp(s.midQ, 0.2, 12), immediate);
    const compression = clamp(s.compression, 0, 1);
    set(compressor.threshold, -18 - compression * 18, immediate);
    set(compressor.knee, 8 + compression * 18, immediate);
    set(compressor.ratio, 1 + compression * 8, immediate);
    set(compressor.attack, 0.006, immediate);
    set(compressor.release, 0.16 + compression * 0.24, immediate);
    const echo = clamp(s.echo, 0, 1);
    const reverb = clamp(s.reverb, 0, 1);
    set(dry.gain, clamp(1 - echo * 0.18 - reverb * 0.22, 0.64, 1), immediate);
    set(delay.delayTime, 0.12 + echo * 0.32, immediate);
    set(feedback.gain, clamp(0.12 + echo * 0.42, 0, 0.62), immediate);
    set(echoWet.gain, echo * 0.36, immediate);
    set(reverbWet.gain, reverb * 0.34, immediate);
    if (previousReverb !== reverb) {
      convolver.buffer = impulse(context, reverb);
      previousReverb = reverb;
    }
    const gateAmount = clamp(s.noiseGate, 0, 1);
    if (previousGate !== gateAmount) {
      const curve = new Float32Array(4097);
      const threshold = gateAmount === 0 ? 0 : 0.0015 + gateAmount * 0.035;
      for (let i = 0; i < curve.length; i++) {
        const sample = i / (curve.length - 1) * 2 - 1;
        curve[i] = Math.abs(sample) < threshold ? 0 : Math.sign(sample) * ((Math.abs(sample) - threshold) / (1 - threshold));
      }
      gate.curve = curve;
      previousGate = gateAmount;
    }
    return true;
  }
  update(initial, true);
  const automationTargets: Record<string, ChannelAutomationTarget> = {
    lowGain: { param: low.gain }, midGain: { param: mid.gain }, highGain: { param: high.gain },
    compression: { param: compressor.threshold, map: value => -18 - clamp(value, 0, 1) * 18 },
    echo: { param: echoWet.gain, map: value => clamp(value, 0, 1) * 0.36 },
    reverb: { param: reverbWet.gain, map: value => clamp(value, 0, 1) * 0.34 }
  };
  return { channelGain, nodes, update, automationTargets, hasAudibleFx: !initial.effectsBypassed };
}
