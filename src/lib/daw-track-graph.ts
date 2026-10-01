// The same static track graph is used for playback and processed export.
export function createDawTrackGraph(context: BaseAudioContext, track: {
  volume: number; pan: number; polarityInverted: boolean; stereoMode: string;
}, audible: boolean) {
  const clampDawTrackGain = (value: number) => Math.max(0, Math.min(2, Number.isFinite(value) ? value : 1));
  const clampDawPan = (value: number) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  const input = context.createGain();
  const polarity = context.createGain();
  const muteGate = context.createGain();
  const fader = context.createGain();
  const panner = context.createStereoPanner();
  const duckGain = context.createGain();
  const analyser = context.createAnalyser();
  const nodes: AudioNode[] = [input, polarity, muteGate, fader, panner, duckGain, analyser];
  polarity.gain.value = track.polarityInverted ? -1 : 1;
  muteGate.gain.value = audible ? 1 : 0;
  fader.gain.value = clampDawTrackGain(track.volume);
  panner.pan.value = clampDawPan(track.pan);
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.68;
  if (track.stereoMode === "mono") {
    const splitter = context.createChannelSplitter(2);
    const mono = context.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = "explicit";
    mono.channelInterpretation = "discrete";
    mono.gain.value = 0.5;
    input.connect(splitter);
    splitter.connect(mono, 0);
    splitter.connect(mono, 1);
    mono.connect(polarity);
    nodes.push(splitter, mono);
  } else input.connect(polarity);
  // All clip dry/wet signals enter input. Pre-fader sends must still be
  // post-mute, so volume automation and cue routes cannot bypass Mute.
  polarity.connect(muteGate).connect(fader).connect(panner).connect(duckGain).connect(analyser);
  return { input, polarity, muteGate, fader, panner, duckGain, analyser, preFaderTap: muteGate, nodes };
}
