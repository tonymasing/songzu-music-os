export const METRONOME_LOOKAHEAD_MS = 25;
export const METRONOME_SCHEDULE_AHEAD_SECONDS = 0.14;
export const METRONOME_START_DELAY_SECONDS = 0.06;

export const METRONOME_SOUND_OPTIONS = [
  { id: "studio", group: "現代清晰", label: "錄音室清脆", shortLabel: "錄音室", description: "平衡、乾淨且沒有復古染色，適合大多數錄音。" },
  { id: "tight", group: "現代清晰", label: "數位短拍", shortLabel: "短拍", description: "極短俐落，適合節奏樂器與快速曲目。" },
  { id: "crystal", group: "現代清晰", label: "水晶亮點", shortLabel: "水晶", description: "高頻明亮，容易穿過密集伴奏。" },
  { id: "digital", group: "現代清晰", label: "精準光點", shortLabel: "光點", description: "現代數位瞬態，重拍輪廓非常清楚。" },
  { id: "rim", group: "自然打擊", label: "現代鼓邊", shortLabel: "鼓邊", description: "乾淨鼓邊質感，適合吉他、貝斯與現場感歌曲。" },
  { id: "stick", group: "自然打擊", label: "清亮鼓棒", shortLabel: "鼓棒", description: "有木質輪廓但不帶老舊音色，拍點自然好跟。" },
  { id: "hat", group: "自然打擊", label: "封閉帽鈸", shortLabel: "帽鈸", description: "短促現代帽鈸，適合需要高頻穿透的編曲。" },
  { id: "clave", group: "自然打擊", label: "乾淨木點", shortLabel: "木點", description: "集中、乾燥的木質敲擊，適合原聲樂器。" },
  { id: "pulse", group: "低疲勞", label: "中性脈衝", shortLabel: "脈衝", description: "中頻扎實，長時間錄音仍容易辨識。" },
  { id: "soft", group: "低疲勞", label: "柔和耳機", shortLabel: "柔和", description: "高頻較少，適合人聲與長時間監聽。" },
  { id: "low", group: "低疲勞", label: "低頻提示", shortLabel: "低頻", description: "避開尖銳高頻，適合對清脆聲敏感時使用。" },
  { id: "round", group: "低疲勞", label: "圓潤膠囊", shortLabel: "圓潤", description: "柔順但仍保留清楚起音，適合慢歌與鋼琴。" }
] as const;

export const METRONOME_SOUND_GROUPS = ["現代清晰", "自然打擊", "低疲勞"] as const;

export type MetronomeSoundId = (typeof METRONOME_SOUND_OPTIONS)[number]["id"];

export const DEFAULT_METRONOME_SOUND: MetronomeSoundId = "studio";
export const METRONOME_SOUND_STORAGE_KEY = "songzu.metronome.sound.v1";
export const DEFAULT_METRONOME_VOLUME = 1;
export const METRONOME_VOLUME_STORAGE_KEY = "songzu.metronome.volume.v1";

export const SMART_METRONOME_RATE_OPTIONS = [
  { value: 0.5, label: "每兩拍", description: "每兩個歌曲拍點提示一次" },
  { value: 1, label: "每拍", description: "標準節拍；4/4 拍每小節固定四聲" },
  { value: 2, label: "八分細分", description: "每一拍再加入一個八分音符提示" }
] as const;

export type SmartMetronomeRate = (typeof SMART_METRONOME_RATE_OPTIONS)[number]["value"];

export type SmartMetronomeBeat = {
  beatTime: number;
  accented: boolean;
  subdivision: boolean;
};

export type MetronomeScheduleState = {
  nextBeatTime: number;
  beatIndex: number;
};

type MetronomeBufferSet = {
  accent: AudioBuffer;
  regular: AudioBuffer;
};

type ClickProfile = {
  durationSeconds: number;
  frequency: number;
  decayRate: number;
  chirpAmount: number;
  releaseSeconds: number;
  gain: number;
  partials: ReadonlyArray<readonly [ratio: number, level: number]>;
  attackSeconds?: number;
  toneLevel?: number;
  noiseLevel?: number;
  noiseColor?: "white" | "bright" | "soft";
};

const soundProfiles: Record<MetronomeSoundId, { accent: ClickProfile; regular: ClickProfile }> = {
  studio: {
    accent: { durationSeconds: 0.026, frequency: 1940, decayRate: 138, chirpAmount: 0.25, releaseSeconds: 0.0045, gain: 0.175, partials: [[1, 0.9], [2.15, 0.1]] },
    regular: { durationSeconds: 0.021, frequency: 1420, decayRate: 165, chirpAmount: 0.22, releaseSeconds: 0.004, gain: 0.12, partials: [[1, 0.91], [2.1, 0.09]] }
  },
  crystal: {
    accent: { durationSeconds: 0.042, frequency: 2780, decayRate: 105, chirpAmount: 0.07, releaseSeconds: 0.007, gain: 0.14, partials: [[1, 0.86], [1.5, 0.1], [2.45, 0.04]] },
    regular: { durationSeconds: 0.034, frequency: 2050, decayRate: 125, chirpAmount: 0.06, releaseSeconds: 0.006, gain: 0.095, partials: [[1, 0.88], [1.5, 0.09], [2.4, 0.03]] }
  },
  tight: {
    accent: { durationSeconds: 0.016, frequency: 2320, decayRate: 260, chirpAmount: 0.32, releaseSeconds: 0.003, gain: 0.17, partials: [[1, 0.72], [2, 0.2], [3, 0.08]] },
    regular: { durationSeconds: 0.013, frequency: 1680, decayRate: 300, chirpAmount: 0.3, releaseSeconds: 0.0025, gain: 0.115, partials: [[1, 0.74], [2, 0.19], [3, 0.07]] }
  },
  digital: {
    accent: { durationSeconds: 0.018, frequency: 2580, decayRate: 235, chirpAmount: 0.42, releaseSeconds: 0.0032, gain: 0.17, partials: [[1, 0.53], [1.99, 0.31], [3.02, 0.16]], attackSeconds: 0.00022, noiseLevel: 0.035, noiseColor: "bright" },
    regular: { durationSeconds: 0.014, frequency: 1860, decayRate: 285, chirpAmount: 0.38, releaseSeconds: 0.0026, gain: 0.115, partials: [[1, 0.56], [2.01, 0.3], [3.04, 0.14]], attackSeconds: 0.0002, noiseLevel: 0.025, noiseColor: "bright" }
  },
  rim: {
    accent: { durationSeconds: 0.034, frequency: 1840, decayRate: 128, chirpAmount: 0.22, releaseSeconds: 0.005, gain: 0.17, partials: [[1, 0.48], [1.66, 0.29], [2.73, 0.23]], attackSeconds: 0.00018, noiseLevel: 0.24, noiseColor: "bright" },
    regular: { durationSeconds: 0.028, frequency: 1350, decayRate: 152, chirpAmount: 0.19, releaseSeconds: 0.0044, gain: 0.115, partials: [[1, 0.52], [1.64, 0.28], [2.68, 0.2]], attackSeconds: 0.00018, noiseLevel: 0.18, noiseColor: "bright" }
  },
  stick: {
    accent: { durationSeconds: 0.042, frequency: 1370, decayRate: 99, chirpAmount: 0.12, releaseSeconds: 0.0065, gain: 0.165, partials: [[1, 0.56], [1.47, 0.27], [2.34, 0.17]], attackSeconds: 0.00028, noiseLevel: 0.085, noiseColor: "white" },
    regular: { durationSeconds: 0.034, frequency: 1010, decayRate: 118, chirpAmount: 0.1, releaseSeconds: 0.0055, gain: 0.11, partials: [[1, 0.6], [1.45, 0.25], [2.3, 0.15]], attackSeconds: 0.00026, noiseLevel: 0.065, noiseColor: "white" }
  },
  hat: {
    accent: { durationSeconds: 0.032, frequency: 3550, decayRate: 142, chirpAmount: 0.02, releaseSeconds: 0.005, gain: 0.125, partials: [[1, 0.7], [1.42, 0.3]], attackSeconds: 0.0001, toneLevel: 0.16, noiseLevel: 0.84, noiseColor: "bright" },
    regular: { durationSeconds: 0.024, frequency: 2980, decayRate: 178, chirpAmount: 0.015, releaseSeconds: 0.004, gain: 0.085, partials: [[1, 0.72], [1.4, 0.28]], attackSeconds: 0.0001, toneLevel: 0.12, noiseLevel: 0.88, noiseColor: "bright" }
  },
  clave: {
    accent: { durationSeconds: 0.052, frequency: 1260, decayRate: 82, chirpAmount: 0.04, releaseSeconds: 0.008, gain: 0.16, partials: [[1, 0.5], [1.43, 0.31], [2.08, 0.19]], attackSeconds: 0.00032, noiseLevel: 0.018, noiseColor: "soft" },
    regular: { durationSeconds: 0.043, frequency: 940, decayRate: 96, chirpAmount: 0.035, releaseSeconds: 0.007, gain: 0.108, partials: [[1, 0.54], [1.42, 0.29], [2.05, 0.17]], attackSeconds: 0.0003, noiseLevel: 0.014, noiseColor: "soft" }
  },
  pulse: {
    accent: { durationSeconds: 0.029, frequency: 1580, decayRate: 120, chirpAmount: 0.16, releaseSeconds: 0.005, gain: 0.17, partials: [[1, 0.92], [2, 0.08]] },
    regular: { durationSeconds: 0.024, frequency: 1080, decayRate: 145, chirpAmount: 0.14, releaseSeconds: 0.0045, gain: 0.115, partials: [[1, 0.93], [2, 0.07]] }
  },
  soft: {
    accent: { durationSeconds: 0.048, frequency: 1100, decayRate: 72, chirpAmount: 0.04, releaseSeconds: 0.009, gain: 0.12, partials: [[1, 0.97], [2, 0.03]] },
    regular: { durationSeconds: 0.04, frequency: 760, decayRate: 86, chirpAmount: 0.035, releaseSeconds: 0.008, gain: 0.08, partials: [[1, 0.98], [2, 0.02]] }
  },
  low: {
    accent: { durationSeconds: 0.062, frequency: 590, decayRate: 60, chirpAmount: 0.08, releaseSeconds: 0.011, gain: 0.17, partials: [[1, 0.93], [2, 0.07]], attackSeconds: 0.0007 },
    regular: { durationSeconds: 0.052, frequency: 410, decayRate: 72, chirpAmount: 0.065, releaseSeconds: 0.009, gain: 0.12, partials: [[1, 0.95], [2, 0.05]], attackSeconds: 0.00065 }
  },
  round: {
    accent: { durationSeconds: 0.056, frequency: 980, decayRate: 66, chirpAmount: 0.025, releaseSeconds: 0.01, gain: 0.15, partials: [[1, 0.91], [1.51, 0.07], [2, 0.02]], attackSeconds: 0.00058, noiseLevel: 0.012, noiseColor: "soft" },
    regular: { durationSeconds: 0.047, frequency: 710, decayRate: 78, chirpAmount: 0.02, releaseSeconds: 0.0085, gain: 0.102, partials: [[1, 0.93], [1.5, 0.055], [2, 0.015]], attackSeconds: 0.00055, noiseLevel: 0.009, noiseColor: "soft" }
  }
};

const bufferCache = new WeakMap<BaseAudioContext, Map<MetronomeSoundId, MetronomeBufferSet>>();

export function getMetronomeBeatDuration(bpm: number) {
  return Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : 0;
}

export function isMetronomeSoundId(value: string | null | undefined): value is MetronomeSoundId {
  return METRONOME_SOUND_OPTIONS.some((option) => option.id === value);
}

export function normalizeMetronomeVolume(value: number) {
  return Number.isFinite(value) ? Math.min(1.5, Math.max(0.25, value)) : DEFAULT_METRONOME_VOLUME;
}

export function isSmartMetronomeRate(value: unknown): value is SmartMetronomeRate {
  return value === 0.5 || value === 1 || value === 2;
}

export function recommendedSmartMetronomeRate(bpm: number | null | undefined): SmartMetronomeRate {
  // BPM 只決定拍速，不應暗中改變每小節的 click 數量。
  // 細分或減半仍可由使用者在節拍器控制器中明確選擇。
  void bpm;
  return 1;
}

export function buildSmartMetronomeGrid(
  beatTimesSeconds: readonly number[],
  beatNumbers: readonly number[],
  rate: SmartMetronomeRate,
  offsetSeconds = 0,
  reliableStartSeconds = 0
): SmartMetronomeBeat[] {
  const safeOffset = Number.isFinite(offsetSeconds) ? Math.min(0.25, Math.max(-0.25, offsetSeconds)) : 0;
  const base = beatTimesSeconds
    .map((beatTime, index) => ({ beatTime, beatNumber: beatNumbers[index] ?? 0 }))
    .filter((beat, index, values) =>
      Number.isFinite(beat.beatTime) &&
      beat.beatTime >= Math.max(0, reliableStartSeconds) - 0.001 &&
      (index === 0 || beat.beatTime > values[index - 1].beatTime)
    );

  if (rate === 0.5) {
    const anchor = Math.max(0, base.findIndex((beat) => beat.beatNumber === 1));
    return base
      .filter((_, index) => (index - anchor) % 2 === 0)
      .map((beat) => ({
        beatTime: Math.max(0, beat.beatTime + safeOffset),
        accented: beat.beatNumber === 1,
        subdivision: false
      }));
  }

  if (rate === 2) {
    return base.flatMap((beat, index) => {
      const current: SmartMetronomeBeat = {
        beatTime: Math.max(0, beat.beatTime + safeOffset),
        accented: beat.beatNumber === 1,
        subdivision: false
      };
      const next = base[index + 1];
      if (!next) return [current];
      return [
        current,
        {
          beatTime: Math.max(0, (beat.beatTime + next.beatTime) / 2 + safeOffset),
          accented: false,
          subdivision: true
        }
      ];
    });
  }

  return base.map((beat) => ({
    beatTime: Math.max(0, beat.beatTime + safeOffset),
    accented: beat.beatNumber === 1,
    subdivision: false
  }));
}

export function closeMetronomeAudioContext(context: AudioContext | null | undefined) {
  if (!context || context.state === "closed") return;
  void context.close().catch(() => undefined);
}

function createClickBuffer(context: BaseAudioContext, sound: MetronomeSoundId, accented: boolean) {
  const profile = soundProfiles[sound][accented ? "accent" : "regular"];
  const { durationSeconds } = profile;
  const frameCount = Math.max(1, Math.ceil(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  const phases = profile.partials.map(() => 0);
  const toneLevel = profile.toneLevel ?? 1;
  const noiseLevel = profile.noiseLevel ?? 0;
  let noiseSeed = METRONOME_SOUND_OPTIONS.findIndex((option) => option.id === sound) * 977 + (accented ? 7919 : 104729);
  let previousNoise = 0;
  let smoothNoise = 0;
  let peak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / context.sampleRate;
    const remaining = durationSeconds - time;
    const attack = Math.min(1, time / (profile.attackSeconds ?? 0.00045));
    const release = Math.min(1, remaining / profile.releaseSeconds);
    const envelope = attack * Math.max(0, release) * Math.exp(-time * profile.decayRate);
    const frequency = profile.frequency * (1 + profile.chirpAmount * Math.exp(-time * 175));
    let tone = 0;
    profile.partials.forEach(([ratio, level], partialIndex) => {
      phases[partialIndex] += (Math.PI * 2 * frequency * ratio) / context.sampleRate;
      tone += Math.sin(phases[partialIndex]) * level;
    });
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    const rawNoise = (noiseSeed / 0xffffffff) * 2 - 1;
    smoothNoise += (rawNoise - smoothNoise) * 0.2;
    const shapedNoise = profile.noiseColor === "bright"
      ? (rawNoise - previousNoise * 0.72) / 1.72
      : profile.noiseColor === "soft"
        ? smoothNoise
        : rawNoise;
    previousNoise = rawNoise;
    const sample = envelope * (tone * toneLevel + shapedNoise * noiseLevel);
    channel[frame] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  if (peak > 0) {
    const normalization = 0.96 / peak;
    for (let frame = 0; frame < frameCount; frame += 1) channel[frame] *= normalization;
  }
  channel[0] = 0;
  channel[frameCount - 1] = 0;

  return buffer;
}

function getClickBuffers(context: BaseAudioContext, sound: MetronomeSoundId) {
  let contextCache = bufferCache.get(context);
  if (!contextCache) {
    contextCache = new Map();
    bufferCache.set(context, contextCache);
  }
  const cached = contextCache.get(sound);
  if (cached) return cached;
  const buffers = {
    accent: createClickBuffer(context, sound, true),
    regular: createClickBuffer(context, sound, false)
  };
  contextCache.set(sound, buffers);
  return buffers;
}

export function scheduleCleanMetronomeClick(
  context: BaseAudioContext,
  destination: AudioNode,
  when: number,
  accented: boolean,
  sound: MetronomeSoundId = DEFAULT_METRONOME_SOUND,
  volume = DEFAULT_METRONOME_VOLUME
) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const profile = soundProfiles[sound][accented ? "accent" : "regular"];
  const bufferSet = getClickBuffers(context, sound);
  const buffer = accented ? bufferSet.accent : bufferSet.regular;
  source.buffer = buffer;
  gain.gain.setValueAtTime(profile.gain * normalizeMetronomeVolume(volume), when);
  source.connect(gain).connect(destination);
  source.start(when);
  source.stop(when + buffer.duration + 0.003);
  return [source, gain] as AudioNode[];
}

export function scheduleMetronomeWindow(
  state: MetronomeScheduleState,
  now: number,
  beatDuration: number,
  onBeat: (when: number, beatIndex: number) => void,
  scheduleAheadSeconds = METRONOME_SCHEDULE_AHEAD_SECONDS
) {
  if (!Number.isFinite(beatDuration) || beatDuration <= 0) return state;

  let { nextBeatTime, beatIndex } = state;
  const staleBefore = now - 0.004;
  if (nextBeatTime < staleBefore) {
    const missedBeats = Math.ceil((staleBefore - nextBeatTime) / beatDuration);
    nextBeatTime += missedBeats * beatDuration;
    beatIndex += missedBeats;
  }

  const horizon = now + Math.max(0.02, scheduleAheadSeconds);
  let scheduledCount = 0;
  while (nextBeatTime < horizon && scheduledCount < 32) {
    onBeat(nextBeatTime, beatIndex);
    nextBeatTime += beatDuration;
    beatIndex += 1;
    scheduledCount += 1;
  }

  return { nextBeatTime, beatIndex };
}
