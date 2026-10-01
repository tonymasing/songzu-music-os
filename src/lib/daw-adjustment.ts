import { z } from "zod";

export const DawAdjustmentSettingsSchema = z.object({
  volume: z.number().min(0.5).max(1.3),
  pan: z.number().min(-0.5).max(0.5),
  inputGain: z.number().min(0.45).max(1.2),
  lowGain: z.number().min(-6).max(6),
  midGain: z.number().min(-6).max(6),
  highGain: z.number().min(-6).max(6),
  compression: z.number().min(0).max(0.75),
  noiseGate: z.number().min(0).max(0.65),
  echo: z.number().min(0).max(0.4),
  reverb: z.number().min(0).max(0.5)
});

type AdjustmentTrack = {
  id: string;
  volume: number;
  pan: number;
  updatedAt?: string | Date | null;
  effects?: Array<Record<string, unknown>>;
  effectsJson?: string | null;
  clips?: Array<{ id: string; audioFileId: string; startSeconds: number; offsetSeconds: number; durationSeconds: number | null; gain: number; updatedAt?: string | Date | null }>;
  automationLanes?: Array<{
    id: string; parameter: string; mode: string; enabled: boolean; minValue: number; maxValue: number;
    points: Array<{ id: string; timeSeconds: number; value: number; curve: string }>;
  }>;
};

function effectsOf(track: AdjustmentTrack): Array<Record<string, unknown>> {
  if (track.effects) return track.effects;
  const value: unknown = JSON.parse(track.effectsJson || "[]");
  if (!Array.isArray(value)) throw new Error("Invalid track effects");
  return value;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

// A content revision works in both browser and server, including optimistic
// unsaved edits. It is a stale-state guard, not an authorization credential.
export function dawAdjustmentRevision(track: AdjustmentTrack) {
  return JSON.stringify(canonical({
    id: track.id, updatedAt: track.updatedAt ?? null,
    volume: track.volume, pan: track.pan, effects: effectsOf(track),
    clips: (track.clips ?? []).map(clip => ({
      id: clip.id, audioFileId: clip.audioFileId, startSeconds: clip.startSeconds,
      offsetSeconds: clip.offsetSeconds, durationSeconds: clip.durationSeconds,
      gain: clip.gain, updatedAt: clip.updatedAt ?? null
    })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    automation: (track.automationLanes ?? []).map(lane => ({
      id: lane.id, parameter: lane.parameter, mode: lane.mode, enabled: lane.enabled,
      minValue: lane.minValue, maxValue: lane.maxValue,
      points: lane.points.map(point => ({ id: point.id, timeSeconds: point.timeSeconds, value: point.value, curve: point.curve }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }));
}

export function buildDawAdjustment(track: AdjustmentTrack, values: unknown, presetLabel: string) {
  const settings = DawAdjustmentSettingsSchema.parse(values);
  const effects = effectsOf(track);
  const isChannel = (effect: Record<string, unknown>) => effect.kind === "songzu_recording_channel" || effect.type === "songzu_recording_channel";
  const current = effects.find(isChannel) ?? {};
  const { volume, pan, ...channelSettings } = settings;
  return {
    volume, pan,
    effects: [{
      ...current,
      kind: "songzu_recording_channel", label: "錄音通道",
      ...channelSettings, effectsBypassed: false, instrumentPreset: presetLabel
    }, ...effects.filter(effect => !isChannel(effect))]
  };
}

export function isCurrentDawProposal(track: AdjustmentTrack, payload: Record<string, unknown> | null) {
  return payload?.trackId === track.id && payload.baseRevision === dawAdjustmentRevision(track);
}
