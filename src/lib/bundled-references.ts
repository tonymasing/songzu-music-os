import { stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { appAssetPath } from "@/lib/paths";
import manifest from "../../public/bundled-references/manifest.json";

export const bundledReferenceSource = "隨附參考曲・Tony";
const prefix = "bundled-reference://";
export const bundledReferenceUris = manifest.map((item) => `${prefix}${item.id}`);

// Persist a stable identity, never an installation-specific absolute path.
// Only these explicitly shipped files can be resolved by the audio endpoint.
export function bundledReferenceAudioPath(value: string | null) {
  const entry = manifest.find((item) => value === `${prefix}${item.id}`);
  return entry ? appAssetPath("public", "bundled-references", entry.audio) : null;
}

let pending: Promise<void> | undefined;
export function ensureBundledReferences() {
  if (pending) return pending;
  pending = (async () => {
    // Check all assets before inserting anything. A failed install can retry.
    await Promise.all(manifest.map(async (item) => {
      const file = await stat(bundledReferenceAudioPath(`${prefix}${item.id}`)!);
      if (!file.isFile() || file.size !== item.sizeBytes) throw new Error(`隨附音檔不完整：${item.title}`);
    }));
    await prisma.$transaction(manifest.map((item) => prisma.musicMaterial.upsert({
      where: { externalSourceKey: item.key },
      update: {}, // Keep existing notes, favorites and imported local-file paths.
      create: {
        externalSourceKey: item.key,
        title: item.title,
        materialType: "style_reference",
        content: `喜歡：${item.likes.join("；")}\n可參考：${item.referenceUses.join("；")}\n在意：${item.priorities.join("；")}`,
        summary: item.likes.join("；"),
        source: bundledReferenceSource,
        externalAudioPath: `${prefix}${item.id}`,
        externalNotePath: `bundled-reference-note://${item.id}`,
        externalFileName: item.fileName,
        externalFileSizeBytes: item.sizeBytes,
        externalDurationSeconds: item.durationSeconds,
        externalCodec: "mp3",
        externalBitRate: item.bitRate,
        externalAudioSha256: item.audioSha256,
        externalNoteSha256: item.noteSha256,
        genre: item.genre,
        referenceUsesJson: JSON.stringify(item.referenceUses),
        preferenceNotesJson: JSON.stringify(item.likes),
        priorityNotesJson: JSON.stringify(item.priorities),
        tagsJson: JSON.stringify([...item.genre.split(" / "), "arrangement", "rhythm", ...item.priorities]),
        moodJson: "[]",
        styleFeaturesJson: "[]",
        suggestedCollection: item.collection,
        matchStatus: "MATCHED",
        status: "ACTIVE",
        importedAt: new Date(),
        favorite: false
      }
    })));
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function bundledReferenceCount() {
  const rows = await prisma.musicMaterial.findMany({
    where: { source: bundledReferenceSource },
    select: { externalAudioPath: true }
  });
  const available = await Promise.all(rows.map(async (row) => {
    const path = bundledReferenceAudioPath(row.externalAudioPath);
    return path ? stat(path).then((info) => info.isFile()).catch(() => false) : false;
  }));
  return available.filter(Boolean).length;
}
