// Shared parameter interpretation for the editor, playback and WAV rendering.
export const DSP_LIMITS = {
  highPassHz: [20, 2000], lowPassHz: [2000, 22000],
  lowGain: [-12, 12], midGain: [-12, 12], highGain: [-12, 12],
  midFrequency: [120, 12000], midQ: [0.2, 12],
  compression: [0, 1], noiseGate: [0, 1], echo: [0, 1], reverb: [0, 1]
} as const;
export type DspKey = keyof typeof DSP_LIMITS;
export type DspValues = Record<DspKey, number>;
export type DspPatch = Partial<DspValues> & { effectsBypassed?: boolean };
export type Effects = Array<Record<string, unknown>>;
export const isDspChannel = (effect: Record<string, unknown>) => effect.kind === "songzu_recording_channel" || effect.type === "songzu_recording_channel";

export const defaultStudioSettings = {
  inputGain: 0.72, monitorLevel: 0.82, lowGain: 0, midGain: 0, highGain: 0,
  highPassHz: 70, lowPassHz: 20000, midFrequency: 1000, midQ: 0.85,
  echo: 0.08, reverb: 0.18, compression: 0.34, noiseGate: 0.18,
  aiTiming: true, aiPitch: true, aiLevel: true, effectsBypassed: false,
  instrumentPreset: "乾淨錄音"
};
export type StudioSettings = typeof defaultStudioSettings;
export const neutralPlaybackSettings: StudioSettings = {
  ...defaultStudioSettings, inputGain: 1, highPassHz: 20, lowPassHz: 22000,
  echo: 0, reverb: 0, compression: 0, noiseGate: 0,
  effectsBypassed: true, instrumentPreset: "原音直通"
};

export function getStudioSettings(effects: Effects = []): StudioSettings {
  const channel = effects.find(isDspChannel);
  if (!channel) return { ...neutralPlaybackSettings };
  return Object.fromEntries(Object.entries(defaultStudioSettings).map(([key, fallback]) => {
    const value = channel[key];
    return [key, typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value)) ? value : fallback];
  })) as StudioSettings;
}

export function getEffectiveStudioSettings(effects: Effects = []): StudioSettings {
  const settings = getStudioSettings(effects);
  for (const effect of effects) {
    if (effect.kind !== "effect_macro" || !effect.settings || typeof effect.settings !== "object") continue;
    for (const key of Object.keys(DSP_LIMITS) as DspKey[]) {
      const value = (effect.settings as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) settings[key] = value;
    }
  }
  return settings;
}

export function validateDspPatch(value: unknown): DspPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DSP 參數格式錯誤。");
  const entries = Object.entries(value);
  if (!entries.length) throw new Error("沒有 DSP 變更。");
  for (const [key, item] of entries) {
    if (key === "effectsBypassed" && typeof item === "boolean") continue;
    const limits = Object.hasOwn(DSP_LIMITS, key) ? DSP_LIMITS[key as DspKey] : undefined;
    if (!limits || typeof item !== "number" || !Number.isFinite(item) || item < limits[0] || item > limits[1]) {
      throw new Error(`DSP 參數超出範圍：${key}`);
    }
  }
  return value as DspPatch;
}

export function applyDspPatch(effects: Effects, input: DspPatch): Effects {
  const patch = validateDspPatch(input);
  const channel = effects.find(isDspChannel);
  const next = { ...(channel ?? neutralPlaybackSettings), ...patch, kind: "songzu_recording_channel" };
  // Manual values replace only the matching macro fields; all other metadata stays intact.
  const rest = effects.filter(effect => !isDspChannel(effect)).map(effect => {
    if (effect.kind !== "effect_macro" || !effect.settings || typeof effect.settings !== "object") return effect;
    return { ...effect, settings: Object.fromEntries(Object.entries(effect.settings).filter(([key]) => !(key in patch))) };
  });
  return [next, ...rest];
}

export function dspRevision(effects: Effects): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)])) : value;
  return JSON.stringify(sorted(effects));
}
