import { applyDspPatch, dspRevision, validateDspPatch, type Effects } from "@/lib/daw-dsp";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export async function saveTrackDsp(trackId: string, revision: string, input: unknown) {
  const patch = validateDspPatch(input);
  return prisma.$transaction(async tx => {
    const track = await tx.dawTrack.findUniqueOrThrow({ where: { id: trackId } });
    const effects: Effects = JSON.parse(track.effectsJson || "[]");
    if (dspRevision(effects) !== revision) throw new Error("音軌效果已在別處修改，請重新載入 DSP 後再儲存。");
    const effectsJson = JSON.stringify(applyDspPatch(effects, patch));
    const updated = await tx.dawTrack.update({ where: { id: trackId }, data: { effectsJson } });
    const operation = await recordDawEditOperation(tx, {
      projectId: track.projectId, entityType: "track_effects", entityId: trackId,
      operationType: "update", label: `DSP ${track.name}`,
      before: { effectsJson: track.effectsJson }, after: { effectsJson }
    });
    return { projectId: updated.projectId, operationId: operation.id };
  });
}
