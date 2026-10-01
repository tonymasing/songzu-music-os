export type AutomationMode = "off" | "read" | "touch" | "latch" | "write";
export type AutomationPoint = { timeSeconds: number; value: number; curve: "step" | "linear" | "smooth" };
export type AutomationPayload = {
  mode: AutomationMode;
  enabled: boolean;
  minValue: number;
  maxValue: number;
  points: AutomationPoint[];
};
export type AutomationLaneSource = Omit<AutomationPayload, "mode" | "points"> & {
  mode: string;
  points: Array<{ timeSeconds: number; value: number; curve: string }>;
};
export type AutomationDefinition = { min: number; max: number; defaultValue: number };
export type AutomationDraft = {
  baseRevision: string;
  baseData: AutomationPayload;
  data: AutomationPayload;
  value: number;
  version: number;
};
export type AutomationDraftStore = Record<string, AutomationDraft>;
export type AutomationDraftView = AutomationDraft & { dirty: boolean; conflict: boolean };
export type AutomationDraftPatch = Partial<AutomationPayload> & { value?: number };
export type AutomationSaveSnapshot = { key: string; draft: AutomationDraft; payload: AutomationPayload };

export function automationDraftKey(projectId: string, trackId: string, parameter: string) {
  return JSON.stringify([projectId, trackId, parameter]);
}

function copyPayload(data: AutomationPayload): AutomationPayload {
  return {
    mode: data.mode, enabled: data.enabled, minValue: data.minValue, maxValue: data.maxValue,
    points: data.points.map(({ timeSeconds, value, curve }) => ({ timeSeconds, value, curve })).sort((a, b) => a.timeSeconds - b.timeSeconds)
  };
}

export function automationPayloadRevision(data: AutomationPayload) {
  return JSON.stringify({
    mode: data.mode, enabled: data.enabled, minValue: data.minValue, maxValue: data.maxValue,
    points: data.points.map(({ timeSeconds, value, curve }) => ({ timeSeconds, value, curve })).sort((a, b) => a.timeSeconds - b.timeSeconds)
  });
}

function serverDraft(lane: AutomationLaneSource | null, definition: AutomationDefinition): AutomationDraft {
  const data = lane ? copyPayload({ ...lane, mode: lane.mode as AutomationMode, points: lane.points as AutomationPoint[] }) : {
    mode: "read" as const, enabled: true, minValue: definition.min, maxValue: definition.max, points: []
  };
  // Only lane content belongs in the revision: mute, track names and generated
  // point IDs must not invalidate an unrelated automation draft.
  const revision = JSON.stringify([Boolean(lane), automationPayloadRevision(data)]);
  return { baseRevision: revision, baseData: data, data, value: data.points.at(-1)?.value ?? definition.defaultValue, version: 0 };
}

export function automationDraftDirty(draft: AutomationDraft) {
  return automationPayloadRevision(draft.data) !== automationPayloadRevision(draft.baseData);
}

export function readAutomationDraft(
  stored: AutomationDraft | undefined, lane: AutomationLaneSource | null, definition: AutomationDefinition
): AutomationDraftView {
  const server = serverDraft(lane, definition);
  if (!stored) return { ...server, dirty: false, conflict: false };
  const dirty = automationDraftDirty(stored);
  // A staged value is not a curve edit. Adopt fresh server data while retaining
  // that value when there are no unsaved mode/point changes.
  if (!dirty) return { ...server, value: stored.value, version: stored.version, dirty: false, conflict: false };
  return { ...stored, dirty, conflict: stored.baseRevision !== server.baseRevision };
}

export function editAutomationDraft(
  store: AutomationDraftStore, key: string, lane: AutomationLaneSource | null, definition: AutomationDefinition,
  change: AutomationDraftPatch | ((view: AutomationDraftView) => AutomationDraftPatch)
): AutomationDraftStore {
  const view = readAutomationDraft(store[key], lane, definition);
  if (view.conflict) return store;
  const patch = typeof change === "function" ? change(view) : change;
  const { value, ...payloadPatch } = patch;
  return { ...store, [key]: {
    baseRevision: view.baseRevision,
    baseData: view.baseData,
    data: copyPayload({ ...view.data, ...payloadPatch }),
    value: value ?? view.value,
    version: view.version + 1
  } };
}

export function discardAutomationDraft(store: AutomationDraftStore, key: string): AutomationDraftStore {
  const next = { ...store };
  delete next[key];
  return next;
}

export function prepareAutomationSave(
  store: AutomationDraftStore, key: string, lane: AutomationLaneSource | null, definition: AutomationDefinition
): AutomationSaveSnapshot | null {
  const view = readAutomationDraft(store[key], lane, definition);
  if (!view.dirty || view.conflict) return null;
  return { key, draft: store[key], payload: copyPayload(view.data) };
}

export function completeAutomationSave(
  store: AutomationDraftStore, saved: AutomationSaveSnapshot, lane: AutomationLaneSource, definition: AutomationDefinition
): AutomationDraftStore {
  const current = store[saved.key];
  if (!current) return store;
  const server = serverDraft(lane, definition);
  // If the response already contains a newer external lane, keep our draft so
  // the next render can expose the conflict instead of silently discarding it.
  if (automationPayloadRevision(server.data) !== automationPayloadRevision(saved.payload)) return store;
  if (current.baseRevision !== saved.draft.baseRevision) return store;
  const unchanged = current === saved.draft;
  return { ...store, [saved.key]: {
    ...current,
    baseRevision: server.baseRevision,
    baseData: server.data,
    data: unchanged ? server.data : current.data
  } };
}
