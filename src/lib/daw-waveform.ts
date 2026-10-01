export type DawWaveform = {
  peaks: number[];
  durationSeconds: number;
};

export type DawWaveformResult = DawWaveform & { status: "ready" | "error" | "unavailable" };
export type DawWaveformSource = { id: string; available: boolean };

// Preserve transient energy in either channel, without phase cancellation or
// per-file normalization. Retain time detail independently of timeline zoom.
export function buildDawWaveform(channels: Float32Array[], sampleRate: number): DawWaveform {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !channels.length) throw new Error("Invalid waveform source");
  const frames = channels[0].length;
  if (channels.some(channel => channel.length !== frames)) throw new Error("Waveform channel lengths differ");
  const durationSeconds = frames / sampleRate;
  const count = Math.min(frames, 262144, Math.ceil(durationSeconds * 200));
  const peaks = new Array<number>(count).fill(0);
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * frames / count);
    const end = Math.floor((index + 1) * frames / count);
    let peak = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const sample = channel[frame];
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
      }
    }
    peaks[index] = peak;
  }
  return { peaks, durationSeconds };
}

export function dawWaveformPointCount(widthPixels: number, quality: "quality" | "balanced" | "economy") {
  const pixelsPerPoint = quality === "quality" ? 1 : quality === "balanced" ? 1.5 : 2;
  return Math.max(2, Math.min(16384, Math.ceil(Math.max(0, widthPixels) / pixelsPerPoint)));
}

export function sampleDawWaveform(peaks: number[], count: number) {
  if (!peaks.length || count <= 0) return [];
  if (peaks.length <= count) return peaks;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * peaks.length / count);
    const end = Math.floor((index + 1) * peaks.length / count);
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, peaks[i]);
    return peak;
  });
}

export function dawWaveformWindow(waveform: DawWaveform, offset: number, duration: number, count: number) {
  const { peaks, durationSeconds } = waveform;
  if (!peaks.length || durationSeconds <= 0 || duration <= 0 || count <= 0) return [];
  const length = Math.min(Math.floor(count), Math.max(1, Math.ceil(duration / durationSeconds * peaks.length)));
  return Array.from({ length }, (_, index) => {
    const from = Math.max(0, offset) + index * duration / length;
    const to = Math.max(0, offset) + (index + 1) * duration / length;
    const start = Math.floor(from / durationSeconds * peaks.length);
    const end = Math.min(peaks.length, Math.ceil(to / durationSeconds * peaks.length));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, peaks[i]);
    return peak;
  });
}

export function dawWaveformPath(peaks: number[], displayGain = 1) {
  if (!peaks.length) return "";
  const amplitude = (peak: number) => Math.min(1, Math.max(0, peak * displayGain)) * 44;
  const upper = peaks.map((peak, index) => `${index} ${(50 - amplitude(peak)).toFixed(3)}`);
  const lower = peaks.map((peak, index) => `${index} ${(50 + amplitude(peak)).toFixed(3)}`).reverse();
  return `M 0 50 L ${upper.join(" L ")} L ${lower.join(" L ")} Z`;
}

export async function loadDawWaveforms(
  sources: DawWaveformSource[],
  options: {
    signal: AbortSignal;
    read: (id: string) => DawWaveformResult | undefined;
    load: (id: string, signal: AbortSignal) => Promise<DawWaveform>;
    publish: (id: string, result: DawWaveformResult) => void;
    idle: () => Promise<void>;
  }
) {
  for (const source of sources) {
    if (options.signal.aborted) return;
    const cached = options.read(source.id);
    if (!source.available) {
      if (cached?.status !== "unavailable") options.publish(source.id, { status: "unavailable", peaks: [], durationSeconds: 0 });
      continue;
    }
    if (cached?.status === "ready" || cached?.status === "error") continue;
    await options.idle();
    if (options.signal.aborted) return;
    try {
      const waveform = await options.load(source.id, options.signal);
      if (options.signal.aborted) return;
      // Commit each completed file before starting the next. Cancellation must
      // never leave a completed-but-unpublished ID permanently marked busy.
      options.publish(source.id, { ...waveform, status: "ready" });
    } catch {
      if (options.signal.aborted) return;
      options.publish(source.id, { status: "error", peaks: [], durationSeconds: 0 });
    }
  }
}
