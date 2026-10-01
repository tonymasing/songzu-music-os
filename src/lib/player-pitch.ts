// Player-only live transposition; native media remains the authoritative transport.
const moduleUrl = "/vendor/signalsmith-stretch/8621f1479f0c90de5c9fb3215a1157351ee92ede/SignalsmithStretch.mjs";
const shiftOptions = (semitones: number) => ({ active: true, semitones, tonalityHz: 8000, formantSemitones: 0, formantCompensation: false, formantBaseHz: 0 });
type StretchNode = AudioWorkletNode & {
  start(options: ReturnType<typeof shiftOptions>): Promise<unknown>;
  schedule(options: ReturnType<typeof shiftOptions>): Promise<unknown>;
  latency(): Promise<number>;
};
type StretchFactory = ((context: AudioContext) => Promise<StretchNode>) & { moduleUrl?: string };
type Graph = { context: AudioContext; source: MediaElementAudioSourceNode; stretch: StretchNode; dry: GainNode; wet: GainNode; gate: GainNode; latency: number };

function supportedSource(audio: HTMLAudioElement) {
  const url = new URL(audio.currentSrc || audio.src, location.href);
  // Routing a non-CORS media element through WebAudio would silence it.
  return url.origin === location.origin;
}
function deadline<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("移調引擎載入逾時，請再試一次。")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export class PlayerPitch {
  private graph: Graph | null = null;
  private context: AudioContext | null = null;
  private pending: Promise<Graph> | null = null;
  private disposed = false;
  private revision = 0;
  private pitch = 0;

  constructor(private audio: HTMLAudioElement, private reportError: (message: string) => void) {
    audio.addEventListener("play", this.onPlay);
    audio.addEventListener("pause", this.onPause);
  }

  private onPlay = () => { void this.resume().then(() => this.openGate()).catch(() => {
    if (this.disposed) return;
    this.pitch = 0; this.route(0);
    this.reportError("請再按一次播放，已切回原調。");
  }); };
  private onPause = () => {
    this.closeGate();
    const context = this.context;
    if (this.graph && context?.state === "running") void context.suspend().catch(() => {});
  };

  private closeGate() {
    if (!this.graph) return;
    const { gate, context } = this.graph;
    gate.gain.cancelScheduledValues(context.currentTime);
    gate.gain.setValueAtTime(0, context.currentTime);
  }
  private openGate() {
    if (!this.graph || this.disposed || this.audio.paused) return;
    // The processor retains its own analysis window across pauses and seeks.
    // Reopen immediately: restarting a latency-sized mute on each short loop
    // could suppress the entire loop, especially at 2× playback speed.
    const { gate, context } = this.graph;
    gate.gain.setTargetAtTime(1, context.currentTime, 0.005);
  }

  private async initialize(context: AudioContext): Promise<Graph> {
    const stale = () => this.disposed || this.context !== context || context.state === "closed";
    // Serve the audited module intact: its worklet bootstrap must not be rewritten by a bundler.
    const { default: factory } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleUrl) as { default: StretchFactory };
    if (stale()) throw new Error("移調已取消。");
    // The upstream factory supports a static worklet URL; this also avoids retaining Blob URLs.
    factory.moduleUrl = moduleUrl;
    const stretch = await factory(context);
    if (stale()) {
      stretch.disconnect(); stretch.port.close(); throw new Error("移調已取消。");
    }
    const latency = await stretch.latency();
    // Supply all spectral defaults each time: this release's scheduler only
    // inherits a subset of fields, so omitted formant parameters become NaN.
    await stretch.start(shiftOptions(0));
    if (stale()) {
      stretch.disconnect(); stretch.port.close(); throw new Error("移調已取消。");
    }
    const dry = context.createGain(), wet = context.createGain(), gate = context.createGain();
    dry.gain.value = 1; wet.gain.value = 0; gate.gain.value = this.audio.paused ? 0 : 1;
    // Build all fallible worklet parts before rerouting the native element.
    dry.connect(gate); wet.connect(gate); gate.connect(context.destination); stretch.connect(wet);
    const source = context.createMediaElementSource(this.audio);
    this.graph = { context, source, stretch, dry, wet, gate, latency: Number.isFinite(latency) ? latency : 0.15 };
    source.connect(dry); source.connect(stretch);
    stretch.addEventListener("processorerror", () => {
      if (this.disposed) return;
      this.pitch = 0; this.route(0);
      this.reportError("移調引擎停止，已恢復原調播放。");
    });
    return this.graph;
  }

  private route(semitones: number) {
    if (!this.graph) return;
    const { dry, wet, context } = this.graph;
    dry.gain.cancelScheduledValues(context.currentTime); wet.gain.cancelScheduledValues(context.currentTime);
    dry.gain.setTargetAtTime(semitones === 0 ? 1 : 0, context.currentTime, 0.01);
    wet.gain.setTargetAtTime(semitones === 0 ? 0 : 1, context.currentTime, 0.01);
  }

  async setSemitones(value: number) {
    if (!Number.isInteger(value) || value < -12 || value > 12) throw new Error("調性範圍為 −12 至 +12 半音。");
    const revision = ++this.revision;
    if (!this.graph && value === 0) { this.pitch = 0; return; }
    if (!supportedSource(this.audio)) throw new Error("這個外部音檔無法移調，仍可使用原調播放。");
    if (!this.graph && !this.pending) {
      if (!window.isSecureContext || !window.AudioContext) throw new Error("此環境不支援移調，請使用本機 App 或 HTTPS。");
      const context = new AudioContext({ latencyHint: "interactive" });
      this.context = context;
      // Resume immediately inside the user's selection gesture, before async module loading.
      const resumed = context.resume();
      this.pending = deadline(Promise.all([resumed, this.initialize(context)]).then(([, graph]) => graph)).catch(error => {
        if (!this.graph && this.context === context) {
          this.context = null; this.pending = null; void context.close().catch(() => {});
        }
        throw error;
      });
    }
    const graph = this.graph ?? await this.pending!;
    if (this.disposed || revision !== this.revision) return;
    try {
      await this.resume();
      await deadline(graph.stretch.schedule(shiftOptions(value)));
      if (this.disposed || revision !== this.revision) return;
      this.audio.preservesPitch = true;
      this.pitch = value; this.route(value);
      if (this.audio.paused) await graph.context.suspend();
      else { await this.resume(); this.openGate(); }
    } catch (error) {
      if (!this.disposed) { this.pitch = 0; this.route(0); }
      throw error;
    }
  }

  /** Estimated processing + output delay, in wall seconds, for visual beat alignment. */
  get visualLatency() {
    if (!this.graph) return 0;
    return (this.pitch === 0 ? 0 : this.graph.latency) + this.graph.context.baseLatency + (this.graph.context.outputLatency || 0);
  }

  async resume() {
    if (this.context && this.context.state !== "closed" && this.context.state !== "running") await this.context.resume();
  }

  dispose() {
    this.disposed = true; ++this.revision; this.closeGate();
    this.audio.removeEventListener("play", this.onPlay);
    this.audio.removeEventListener("pause", this.onPause);
    if (this.graph) {
      const { source, stretch, dry, wet, gate } = this.graph;
      source.disconnect(); stretch.disconnect(); stretch.port.close(); dry.disconnect(); wet.disconnect(); gate.disconnect();
    }
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    this.graph = null;
  }
}
