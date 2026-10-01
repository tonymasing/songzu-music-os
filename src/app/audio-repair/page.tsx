import { SystemWorkspace } from "@/components/SystemWorkspace";
import { AudioRepairWorkspace } from "@/components/AudioRepairWorkspace";
import { getAudioRepairItems } from "@/lib/audio-repair";

export const dynamic = "force-dynamic";

export default async function AudioRepairPage() {
  const items = await getAudioRepairItems();

  return <SystemWorkspace area="maintenance" current="/audio-repair"><AudioRepairWorkspace initialItems={items} /></SystemWorkspace>;
}
