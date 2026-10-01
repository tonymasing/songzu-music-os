import { getEffectiveStudioSettings, type Effects } from "@/lib/daw-dsp";
import { createDawChannelGraph } from "@/lib/daw-channel-graph";

export type ChannelAutomationTarget = { param: AudioParam; map?: (value: number) => number };

// Metadata interpretation stays outside the shared playback/offline graph.
export function createDawChannel(context: BaseAudioContext, source: AudioNode, effects: Effects, destination: AudioNode) {
  const graph = createDawChannelGraph(context, source, getEffectiveStudioSettings(effects), destination);
  return { ...graph, update: (next: Effects, immediate = false) => graph.update(getEffectiveStudioSettings(next), immediate) };
}
