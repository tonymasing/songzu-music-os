import type { SoundLibraryItem } from "@prisma/client";

import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

export const soundItemTypeOptions = [
  { value: "instrument", label: "樂器" },
  { value: "effect", label: "效果" },
  { value: "effect_chain", label: "效果鏈" },
  { value: "era_reference", label: "年代參考" },
  { value: "preset", label: "Preset" }
] as const;

export const soundStatusOptions = [
  { value: "COLLECTED", label: "已收集" },
  { value: "TESTING", label: "待測試" },
  { value: "ACTIVE", label: "可使用" },
  { value: "ARCHIVED", label: "封存" }
] as const;

export type SoundLibraryItemDto = ReturnType<typeof toSoundLibraryItemDto>;

export function soundItemTypeLabel(value: string) {
  return soundItemTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function soundStatusLabel(value: string) {
  return soundStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function toSoundLibraryItemDto(item: SoundLibraryItem) {
  return {
    id: item.id,
    name: item.name,
    itemType: item.itemType,
    itemTypeLabel: soundItemTypeLabel(item.itemType),
    family: item.family,
    era: item.era,
    source: item.source,
    description: item.description,
    tags: parseJsonValue<string[]>(item.tagsJson, []),
    character: parseJsonValue<string[]>(item.characterJson, []),
    useCases: parseJsonValue<string[]>(item.useCasesJson, []),
    chain: parseJsonValue<string[]>(item.chainJson, []),
    garageBandHint: item.garageBandHint,
    notes: item.notes,
    assetPath: item.assetPath,
    previewPath: item.previewPath,
    sourceUrl: item.sourceUrl,
    licenseName: item.licenseName,
    licenseUrl: item.licenseUrl,
    fileSizeBytes: item.fileSizeBytes,
    sha256: item.sha256,
    status: item.status,
    statusLabel: soundStatusLabel(item.status),
    favorite: item.favorite,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt)
  };
}

export async function getSoundLibraryItems() {
  const items = await prisma.soundLibraryItem.findMany({
    orderBy: [{ favorite: "desc" }, { updatedAt: "desc" }, { name: "asc" }]
  });

  return items.map(toSoundLibraryItemDto);
}
