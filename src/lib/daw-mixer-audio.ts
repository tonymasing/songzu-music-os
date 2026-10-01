import { DAW_MASTER } from "@/lib/daw-mix-contract";
import { createDawMasterGraph } from "@/lib/daw-master-graph";
import { createDawTrackGraph } from "@/lib/daw-track-graph";

export type MixerTrack = {
  id: string;
  muted: boolean;
  solo: boolean;
  trackType: string;
};

type MixerRoute = {
  sourceTrackId: string | null;
  destinationTrackId: string | null;
  routeType: string;
  muted: boolean;
  gain?: number;
};

export type MixerScope = { excludeTrackId?: string; soloTrackId?: string };

export function audibleMixerTrackIds(tracks: MixerTrack[], routes: MixerRoute[], scope: MixerScope = {}) {
  const eligible = tracks.filter((track) => track.id !== scope.excludeTrackId);
  const solos = scope.soloTrackId ? eligible.filter((track) => track.id === scope.soloTrackId) : eligible.filter((track) => track.solo);
  const enabled = new Set(eligible.filter((track) => !track.muted).map((track) => track.id));
  if (!solos.length && !scope.soloTrackId) return enabled;
  const audible = new Set(solos.filter((track) => enabled.has(track.id)).map((track) => track.id));
  const buses = new Set(eligible.filter((track) => track.trackType === "bus").map((track) => track.id));
  const connections = routes.filter((route) => !route.muted && ["output", "send", "cue"].includes(route.routeType)
    && route.sourceTrackId && route.destinationTrackId);
  // Soloing a bus includes its inputs; soloing a source keeps its downstream
  // buses open, without admitting the other sources feeding those buses.
  const soloInputs = new Set([...audible].filter((id) => buses.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const route of connections) {
      const source = route.sourceTrackId!;
      if (soloInputs.has(route.destinationTrackId!) && enabled.has(source) && !soloInputs.has(source)) {
        soloInputs.add(source);
        audible.add(source);
        changed = true;
      }
    }
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const route of connections) {
      const destination = route.destinationTrackId!;
      if (audible.has(route.sourceTrackId!) && buses.has(destination) && enabled.has(destination) && !audible.has(destination)) {
        audible.add(destination);
        changed = true;
      }
    }
  }
  return audible;
}

// Decide master processing from the graph that can actually carry scheduled
// sources to the output. A bus with no clips can still be on that signal path.
export function audibleMasterTrackIds(
  tracks: MixerTrack[], routes: MixerRoute[], sourceTrackIds: ReadonlySet<string>, scope: MixerScope = {}
) {
  const audible = audibleMixerTrackIds(tracks, routes, scope);
  const buses = new Set(tracks.filter(track => track.trackType === "bus").map(track => track.id));
  const edges = new Map<string, Set<string>>();
  const reachesMaster = new Set<string>();
  for (const track of tracks) {
    if (!audible.has(track.id)) continue;
    const destinations = new Set<string>();
    const connect = (destination: string | null | undefined) => {
      if (destination && buses.has(destination)) {
        if (audible.has(destination)) destinations.add(destination);
      } else reachesMaster.add(track.id);
    };
    const output = routes.find(route => route.sourceTrackId === track.id && route.routeType === "output" && !route.muted);
    connect(output?.destinationTrackId);
    for (const route of routes.filter(route => route.sourceTrackId === track.id && !route.muted && ["send", "cue"].includes(route.routeType) && (route.gain ?? 1) > 0)) {
      connect(route.destinationTrackId);
    }
    edges.set(track.id, destinations);
  }
  const reachedBySources = new Set([...sourceTrackIds].filter(id => audible.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, destinations] of edges) {
      for (const destination of destinations) {
        if (reachedBySources.has(source) && !reachedBySources.has(destination)) {
          reachedBySources.add(destination); changed = true;
        }
        if (reachesMaster.has(destination) && !reachesMaster.has(source)) {
          reachesMaster.add(source); changed = true;
        }
      }
    }
  }
  return new Set([...reachedBySources].filter(id => reachesMaster.has(id)));
}

export function setMixerGate(gate: GainNode, audible: boolean, seconds = 0.006) {
  const context = gate.context;
  if (context.state === "closed") return;
  const now = context.currentTime;
  const param = gate.gain;
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
  else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }
  param.linearRampToValueAtTime(audible ? 1 : 0, now + seconds);
}

export function createMixerTrackBus(context: BaseAudioContext, track: {
  volume: number; pan: number; polarityInverted: boolean; stereoMode: string;
}, audible: boolean) {
  return createDawTrackGraph(context, track, audible);
}

export function createMixerMasterOutput(context: BaseAudioContext, transparent: boolean) {
  return createDawMasterGraph(context, transparent, DAW_MASTER);
}
