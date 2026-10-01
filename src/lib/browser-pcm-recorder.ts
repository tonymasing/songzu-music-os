import { createDiscreteAudioInput } from "./discrete-audio-input";

export const PCM_RECORDING_LIMIT_SECONDS = 30 * 60;
export const PCM_RECORDING_WARNING_SECONDS = 29 * 60;

export type BrowserPcmRecording = {
  blob: Blob;
  sampleRate: number;
  channels: number;
  bitDepth: 24;
  durationSeconds: number;
  peak: number;
  rms: number;
  truncated: boolean;
  limitReached: boolean;
  inputChannelStart: number;
};

export type BrowserPcmRecorderOptions = {
  onLimitWarning?: (recorder: BrowserPcmRecorder) => void;
  onLimitReached?: (recorder: BrowserPcmRecorder) => void;
};

type AudioContextConstructor = typeof AudioContext;

function contextConstructor() {
  return (window.AudioContext || (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext) ?? null;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0;index < value.length;index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function encodePcm24(channels: Float32Array[], sampleRate: number) {
  const channelCount = Math.max(1, channels.length);
  const frameCount = channels[0]?.length ?? 0;
  const bytesPerSample = 3;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0;frame < frameCount;frame += 1) {
    for (let channel = 0;channel < channelCount;channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      const value = sample < 0 ? Math.round(sample * 8_388_608) : Math.round(sample * 8_388_607);
      view.setUint8(offset, value & 0xff);
      view.setUint8(offset + 1, (value >> 8) & 0xff);
      view.setUint8(offset + 2, (value >> 16) & 0xff);
      offset += 3;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mergeChunks(chunks: Float32Array[][], channelCount: number, frameCount: number) {
  const output = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  let offset = 0;
  for (const chunk of chunks) {
    const length = chunk[0]?.length ?? 0;
    if (!length) continue;
    for (let channel = 0;channel < channelCount;channel += 1) {
      if (chunk[channel]) output[channel].set(chunk[channel], offset);
    }
    offset += length;
  }
  return output;
}

export class BrowserPcmRecorder {
  private context: AudioContext;
  private input: ReturnType<typeof createDiscreteAudioInput>;
  private captureNode: AudioNode;
  private silentGain: GainNode;
  private chunks: Float32Array[][] = [];
  private frameCount = 0;
  private readonly channelCount: number;
  private readonly maxFrames: number;
  private readonly warningFrames: number;
  private readonly options: BrowserPcmRecorderOptions;
  private truncated = false;
  private limitReached = false;
  private warningSent = false;
  private captureFlushed = false;
  private cancelled = false;
  private stopPromise: Promise<BrowserPcmRecording> | null = null;
  private releasePromise: Promise<void> | null = null;
  private captureDisconnected = false;
  private workletUrl = "";
  private inputChannelStart = 0;
  private flushResolve: (() => void) | null = null;
  private closed = false;
  private ownsContext = true;

  private constructor(context: AudioContext, input: ReturnType<typeof createDiscreteAudioInput>, captureNode: AudioNode, silentGain: GainNode, channelCount: number, options: BrowserPcmRecorderOptions) {
    this.context = context;
    this.input = input;
    this.captureNode = captureNode;
    this.silentGain = silentGain;
    this.channelCount = channelCount;
    this.maxFrames = Math.floor(context.sampleRate * PCM_RECORDING_LIMIT_SECONDS);
    this.warningFrames = Math.floor(context.sampleRate * PCM_RECORDING_WARNING_SECONDS);
    this.options = options;
  }

  static async create(stream: MediaStream, requestedSampleRate?: number, requestedChannels = 1, inputChannelStart = 0, sharedContext?: AudioContext, options: BrowserPcmRecorderOptions = {}) {
    const Constructor = contextConstructor();
    if (!Constructor) throw new Error("這台裝置不支援 Web Audio PCM 錄音。");
    let context = sharedContext;
    if (!context) {
      try {
        context = new Constructor(requestedSampleRate ? { sampleRate: requestedSampleRate, latencyHint: "interactive" } : { latencyHint: "interactive" });
      } catch {
        context = new Constructor({ latencyHint: "interactive" });
      }
    }
    let input: ReturnType<typeof createDiscreteAudioInput> | undefined;
    let url = "";
    try {
      input = createDiscreteAudioInput(context, stream, inputChannelStart, requestedChannels);
      const channelCount = requestedChannels;
      const silentGain = context.createGain();
      silentGain.gain.value = 0;

      let captureNode: AudioNode;
      let recorder: BrowserPcmRecorder;
      if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        const code = `
        class SongzuPcmCapture extends AudioWorkletProcessor {
          constructor(options) {
            super();
            this.stopped = false;
            this.frames = 0;
            this.maxFrames = options.processorOptions.maxFrames;
            this.port.onmessage = () => {
              this.stopped = true;
              this.port.postMessage('flushed');
            };
          }
          process(inputs) {
            if (this.stopped) return false;
            const input = inputs[0];
            if (input && input[0] && input[0].length) {
              const length = Math.min(input[0].length, this.maxFrames - this.frames);
              const channels = input.map((channel) => Float32Array.from(channel.subarray(0, length)));
              this.port.postMessage(channels, channels.map((channel) => channel.buffer));
              this.frames += length;
              if (this.frames >= this.maxFrames) {
                this.stopped = true;
                this.port.postMessage('flushed');
                return false;
              }
            }
            return true;
          }
        }
        registerProcessor('songzu-pcm-capture', SongzuPcmCapture);
      `;
        url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        await context.audioWorklet.addModule(url);
        const worklet = new AudioWorkletNode(context, "songzu-pcm-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [channelCount],
          channelCount,
          channelCountMode: "explicit",
          channelInterpretation: "discrete",
          processorOptions: { maxFrames: Math.floor(context.sampleRate * PCM_RECORDING_LIMIT_SECONDS) }
        });
        captureNode = worklet;
        recorder = new BrowserPcmRecorder(context, input, captureNode, silentGain, channelCount, options);
        recorder.workletUrl = url;
        worklet.port.onmessage = (event: MessageEvent<Float32Array[] | "flushed">) => {
          if (event.data === "flushed") {
            recorder.captureFlushed = true;
            recorder.flushResolve?.();
          }
          else recorder.push(event.data);
        };
      } else {
        const processor = context.createScriptProcessor(1024, channelCount, channelCount);
        captureNode = processor;
        recorder = new BrowserPcmRecorder(context, input, captureNode, silentGain, channelCount, options);
        processor.onaudioprocess = (event) => {
          recorder.push(Array.from({ length: channelCount }, (_, channel) => Float32Array.from(event.inputBuffer.getChannelData(channel))));
        };
      }

      recorder.inputChannelStart = inputChannelStart;
      recorder.ownsContext = !sharedContext;
      input.output.connect(captureNode).connect(silentGain).connect(context.destination);
      await context.resume();
      return recorder;
    } catch (error) {
      input?.disconnect();
      if (url) URL.revokeObjectURL(url);
      if (!sharedContext) await context.close();
      throw error;
    }
  }

  private push(channels: Float32Array[]) {
    if (this.closed || this.limitReached) return;
    const available = this.maxFrames - this.frameCount;
    const length = Math.min(available, channels[0]?.length ?? 0);
    if (!length) return;
    this.chunks.push(channels.map((channel) => channel.length === length ? channel : channel.slice(0, length)));
    this.frameCount += length;
    if (!this.warningSent && this.frameCount >= this.warningFrames) {
      this.warningSent = true;
      this.notify(this.options.onLimitWarning);
    }
    if (this.frameCount >= this.maxFrames && !this.cancelled) {
      this.limitReached = true;
      // Keep the result available even without a UI listener. A simultaneous
      // manual stop receives this same promise rather than encoding twice.
      void this.stop().catch(() => {});
      this.notify(this.options.onLimitReached);
    }
  }

  private notify(callback: ((recorder: BrowserPcmRecorder) => void) | undefined) {
    if (callback) queueMicrotask(() => { if (!this.cancelled) callback(this); });
  }

  stop(): Promise<BrowserPcmRecording> {
    if (this.cancelled) return Promise.reject(new Error("這段錄音已取消。"));
    if (!this.stopPromise) this.stopPromise = this.finishStop();
    return this.stopPromise;
  }

  private async finishStop(): Promise<BrowserPcmRecording> {
    let result: BrowserPcmRecording;
    try {
      if (this.workletUrl && !this.captureFlushed) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(() => { this.truncated = true; resolve(); }, 1500);
          this.flushResolve = () => { window.clearTimeout(timeout); resolve(); };
          (this.captureNode as AudioWorkletNode).port.postMessage("stop");
        });
      }
      if (this.cancelled) throw new Error("這段錄音已取消。");
      this.closed = true;
      this.disconnectCapture();
      const channels = mergeChunks(this.chunks, this.channelCount, this.frameCount);
      let peak = 0;
      let squares = 0;
      let samples = 0;
      for (const channel of channels) {
        for (const sample of channel) {
          peak = Math.max(peak, Math.abs(sample));
          squares += sample * sample;
          samples += 1;
        }
      }
      result = {
        blob: encodePcm24(channels, this.context.sampleRate),
        sampleRate: this.context.sampleRate,
        channels: this.channelCount,
        bitDepth: 24,
        durationSeconds: this.frameCount / this.context.sampleRate,
        peak,
        rms: samples ? Math.sqrt(squares / samples) : 0,
        truncated: this.truncated,
        limitReached: this.limitReached,
        inputChannelStart: this.inputChannelStart
      };
    } finally {
      await this.releaseResources();
    }
    if (this.cancelled) throw new Error("這段錄音已取消。");
    return result;
  }

  private disconnectCapture() {
    if (this.captureDisconnected) return;
    this.captureDisconnected = true;
    this.input.disconnect();
    this.captureNode.disconnect();
    this.silentGain.disconnect();
    if (!this.workletUrl) (this.captureNode as ScriptProcessorNode).onaudioprocess = null;
  }

  private releaseResources(): Promise<void> {
    if (!this.releasePromise) this.releasePromise = Promise.resolve().then(async () => {
      this.disconnectCapture();
      this.chunks = [];
      this.flushResolve = null;
      if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
      if (this.ownsContext && this.context.state !== "closed") await this.context.close();
    });
    return this.releasePromise;
  }

  async cancel() {
    this.cancelled = true;
    this.closed = true;
    this.flushResolve?.();
    await this.releaseResources();
  }
}
