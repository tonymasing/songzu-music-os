import type { MusicGenerationDraft, MusicMaterial, PersonalTheoryRule, Song, SoundLibraryItem } from "@prisma/client";

import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { evaluateTheoryRuleReadiness, theoryDomainDefinitions } from "@/lib/theory-profile";

type MaterialWithRelations = MusicMaterial & {
  relatedSong: Pick<Song, "id" | "title"> | null;
  relatedSound: Pick<SoundLibraryItem, "id" | "name" | "family" | "previewPath" | "assetPath"> | null;
};

export const musicMaterialTypeOptions = [
  { value: "style_reference", label: "風格參考歌曲" },
  { value: "lyric_seed", label: "歌詞片語" },
  { value: "melodic_motif", label: "旋律動機" },
  { value: "chord_progression", label: "和弦進行" },
  { value: "rhythm_pattern", label: "節奏語彙" },
  { value: "arrangement_reference", label: "編曲參考" },
  { value: "production_note", label: "製作指令" },
  { value: "sound_palette", label: "音色素材" },
  { value: "concept", label: "概念" }
] as const;

export const theoryRuleTypeOptions = theoryDomainDefinitions.map(({ value, label }) => ({ value, label }));

export const materialStatusOptions = [
  { value: "COLLECTED", label: "已收集" },
  { value: "ACTIVE", label: "可生成" },
  { value: "TESTING", label: "測試中" },
  { value: "ARCHIVED", label: "封存" }
] as const;

export type MusicMaterialDto = ReturnType<typeof toMusicMaterialDto>;
export type PersonalTheoryRuleDto = ReturnType<typeof toPersonalTheoryRuleDto>;
export type MusicGenerationDraftDto = ReturnType<typeof toMusicGenerationDraftDto>;
export type LocalGenerationOutput = ReturnType<typeof buildLocalGenerationOutput>;

export function materialTypeLabel(value: string) {
  return musicMaterialTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function theoryRuleTypeLabel(value: string) {
  return theoryRuleTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function materialStatusLabel(value: string) {
  return materialStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function toMusicMaterialDto(item: MaterialWithRelations) {
  return {
    id: item.id,
    title: item.title,
    materialType: item.materialType,
    materialTypeLabel: materialTypeLabel(item.materialType),
    content: item.content,
    summary: item.summary,
    source: item.source,
    sourceUrl: item.sourceUrl,
    genre: item.genre,
    artist: item.artist,
    language: item.language,
    moods: parseJsonValue<string[]>(item.moodJson, []),
    tags: parseJsonValue<string[]>(item.tagsJson, []),
    referenceUses: parseJsonValue<string[]>(item.referenceUsesJson, []),
    preferenceNotes: parseJsonValue<string[]>(item.preferenceNotesJson, []),
    priorityNotes: parseJsonValue<string[]>(item.priorityNotesJson, []),
    styleFeatures: parseJsonValue<string[]>(item.styleFeaturesJson, []),
    musicalKey: item.musicalKey,
    mode: item.mode,
    bpm: item.bpm,
    meter: item.meter,
    sectionRole: item.sectionRole,
    energy: item.energy,
    relatedSongId: item.relatedSongId,
    relatedSoundId: item.relatedSoundId,
    status: item.status,
    statusLabel: materialStatusLabel(item.status),
    favorite: item.favorite,
    suggestedCollection: item.suggestedCollection,
    matchStatus: item.matchStatus,
    externalFileName: item.externalFileName,
    externalDurationSeconds: item.externalDurationSeconds,
    externalCodec: item.externalCodec,
    importedAt: toIso(item.importedAt),
    lastScannedAt: toIso(item.lastScannedAt),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
    relatedSong: item.relatedSong,
    relatedSound: item.relatedSound
  };
}

export function toPersonalTheoryRuleDto(item: PersonalTheoryRule) {
  const examples = parseJsonValue<string[]>(item.examplesJson, []);
  const avoid = parseJsonValue<string[]>(item.avoidJson, []);
  const tags = parseJsonValue<string[]>(item.tagsJson, []);
  const readiness = evaluateTheoryRuleReadiness({
    statement: item.statement,
    scope: item.scope,
    examples,
    avoid,
    tags,
    priority: item.priority,
    isActive: item.isActive
  });
  return {
    id: item.id,
    title: item.title,
    ruleType: item.ruleType,
    ruleTypeLabel: theoryRuleTypeLabel(item.ruleType),
    scope: item.scope,
    statement: item.statement,
    examples,
    avoid,
    tags,
    priority: item.priority,
    isActive: item.isActive,
    completion: readiness.completion,
    aiReady: readiness.aiReady,
    missingFields: readiness.missingFields,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt)
  };
}

export function toMusicGenerationDraftDto(item: MusicGenerationDraft) {
  return {
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    songId: item.songId,
    materialIds: parseJsonValue<string[]>(item.materialIdsJson, []),
    ruleIds: parseJsonValue<string[]>(item.ruleIdsJson, []),
    styleTags: parseJsonValue<string[]>(item.styleTagsJson, []),
    output: parseJsonValue<Record<string, unknown>>(item.outputJson, {}),
    status: item.status,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt)
  };
}

export async function getMusicMaterials() {
  const items = await prisma.musicMaterial.findMany({
    include: {
      relatedSong: { select: { id: true, title: true } },
      relatedSound: { select: { id: true, name: true, family: true, previewPath: true, assetPath: true } }
    },
    orderBy: [{ favorite: "desc" }, { updatedAt: "desc" }, { title: "asc" }]
  });
  return items.map(toMusicMaterialDto);
}

export async function getPersonalTheoryRules() {
  const items = await prisma.personalTheoryRule.findMany({
    orderBy: [{ isActive: "desc" }, { priority: "asc" }, { updatedAt: "desc" }]
  });
  return items.map(toPersonalTheoryRuleDto);
}

export async function getGenerationDrafts(limit = 12) {
  const drafts = await prisma.musicGenerationDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return drafts.map(toMusicGenerationDraftDto);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[\s,，、。；;:：/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreMaterial(material: MusicMaterialDto, prompt: string, styleTags: string[]) {
  const promptTokens = tokenize([prompt, ...styleTags].join(" "));
  const haystack = [
    material.title,
    material.materialTypeLabel,
    material.content,
    material.summary,
    material.genre,
    material.musicalKey,
    material.mode,
    material.sectionRole,
    material.artist,
    material.language,
    ...material.referenceUses,
    ...material.preferenceNotes,
    ...material.priorityNotes,
    ...material.styleFeatures,
    ...material.moods,
    ...material.tags
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of promptTokens) {
    if (haystack.includes(token)) score += 3;
  }
  if (material.favorite) score += 4;
  if (material.status === "ACTIVE") score += 3;
  if (material.materialType === "lyric_seed") score += 1;
  if (material.materialType === "chord_progression") score += 1;
  if (material.relatedSound) score += 1;
  return score;
}

function firstByType(materials: MusicMaterialDto[], type: string) {
  return materials.find((item) => item.materialType === type);
}

export function buildLocalGenerationOutput(prompt: string, materials: MusicMaterialDto[], rules: PersonalTheoryRuleDto[], styleTags: string[]) {
  const chosen = [...materials]
    .filter((item) => item.status !== "ARCHIVED")
    .sort((a, b) => scoreMaterial(b, prompt, styleTags) - scoreMaterial(a, prompt, styleTags))
    .slice(0, 8);

  const lyricSeed = firstByType(chosen, "lyric_seed");
  const chordProgression = firstByType(chosen, "chord_progression");
  const rhythmPattern = firstByType(chosen, "rhythm_pattern");
  const soundMaterials = chosen.filter((item) => item.relatedSound || item.materialType === "sound_palette").slice(0, 4);
  const activeRules = rules
    .filter((rule) => rule.aiReady)
    .sort((a, b) => a.priority - b.priority || b.completion - a.completion)
    .slice(0, 8);
  const tempo = chosen.find((item) => item.bpm)?.bpm ?? 82;
  const key = chosen.find((item) => item.musicalKey)?.musicalKey ?? "G";
  const moodSet = [...new Set(chosen.flatMap((item) => item.moods).concat(styleTags).filter(Boolean))].slice(0, 6);
  const tagSet = [...new Set(chosen.flatMap((item) => item.tags).concat(styleTags).filter(Boolean))].slice(0, 10);

  return {
    title: `本機生成草稿 - ${new Date().toLocaleDateString("zh-TW")}`,
    concept: prompt.trim() || "從資料庫素材生成一首新的敬拜 / 流行作品草稿。",
    musicalBrief: {
      key,
      bpm: tempo,
      meter: chosen.find((item) => item.meter)?.meter ?? "4/4",
      moods: moodSet,
      tags: tagSet
    },
    structure: [
      { section: "Intro", instruction: "用主音色或環境 Foley 建立空間，保留人聲入口。" },
      { section: "Verse 1", instruction: lyricSeed ? `從「${lyricSeed.title}」拆出更生活化的第一人稱語氣。` : "先用低密度歌詞建立場景。" },
      { section: "Pre-Chorus", instruction: "提高旋律音域或和弦張力，但不要提前釋放副歌能量。" },
      { section: "Chorus", instruction: chordProgression ? `使用或改寫：${chordProgression.content}` : "使用穩定大調和弦打開情緒。" },
      { section: "Bridge", instruction: "引用核心句，但換成更直接的禱告或宣告語氣。" },
      { section: "Outro", instruction: "回到最簡單的 hook 或鋼琴，留下可剪短影音的尾巴。" }
    ],
    lyricSeeds: chosen.filter((item) => item.materialType === "lyric_seed" || item.materialType === "concept").map((item) => item.content).slice(0, 3),
    chordPlan: chordProgression?.content ?? "先用 I - V - vi - IV；若需要更深情緒，Bridge 改 vi - IV - I - V。",
    rhythmPlan: rhythmPattern?.content ?? "鼓先保持簡單，副歌增加 open hat 或 ride，避免主歌太滿。",
    soundPalette: soundMaterials.map((item) => ({
      material: item.title,
      sound: item.relatedSound?.name ?? item.summary ?? item.content,
      family: item.relatedSound?.family ?? item.genre,
      previewPath: item.relatedSound?.previewPath ?? item.relatedSound?.assetPath ?? null
    })),
    personalTheory: activeRules.map((rule) => ({
      title: rule.title,
      ruleType: rule.ruleTypeLabel,
      statement: rule.statement
    })),
    nextSteps: [
      "把 lyric seed 改成完整 Verse / Chorus 歌詞。",
      "用 chord plan 在 GarageBand 建立 8 小節 loop。",
      "從 sound palette 挑 2 個音色，不要一次塞滿。",
      "錄一版 voice memo，再回到 App 做版本時間軸與音質保護。"
    ],
    materialIds: chosen.map((item) => item.id),
    ruleIds: activeRules.map((rule) => rule.id)
  };
}
