export type AudioVersionRecord = {
  id: string;
  songId: string;
  fileType: string;
  versionName: string | null;
  parentAudioFileId: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
  createdAt: string;
};

export type AudioVersionGovernance = {
  versionIssues: string[];
  suggestedVersionName: string | null;
  recommendedPrimary: boolean;
};

function stageKey(fileType: string) {
  const normalized = fileType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    voice: "voice_memo",
    memo: "voice_memo",
    voice_memo: "voice_memo",
    rough_mix: "mix",
    final_mix: "mix",
    mastered: "master"
  };
  return aliases[normalized] ?? (normalized || "audio");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseVersionNumber(fileType: string, versionName: string | null) {
  if (!versionName) return null;
  const match = versionName.trim().match(new RegExp(`^${escapeRegExp(stageKey(fileType))}_v(\\d+)(?:_(?:revised|rev)(?:_?\\d+)?)?$`, "i"));
  return match ? Number(match[1]) : null;
}

function nextVersionName(file: AudioVersionRecord, siblings: AudioVersionRecord[]) {
  const used = siblings
    .filter((item) => item.songId === file.songId && item.fileType === file.fileType && !item.archivedAt)
    .map((item) => parseVersionNumber(item.fileType, item.versionName))
    .filter((value): value is number => value !== null);
  return `${stageKey(file.fileType)}_v${Math.max(0, ...used) + 1}`;
}

export function buildAudioVersionGovernance(files: AudioVersionRecord[]) {
  const byId = new Map(files.map((file) => [file.id, file]));
  const result = new Map<string, AudioVersionGovernance>();

  for (const file of files) {
    if (file.archivedAt) {
      result.set(file.id, { versionIssues: [], suggestedVersionName: null, recommendedPrimary: false });
      continue;
    }

    const issues: string[] = [];
    const sameType = files.filter(
      (item) => item.songId === file.songId && item.fileType === file.fileType && !item.archivedAt
    );
    const parsedVersion = parseVersionNumber(file.fileType, file.versionName);
    const duplicateName = file.versionName
      ? sameType.filter((item) => item.versionName?.trim().toLowerCase() === file.versionName?.trim().toLowerCase()).length > 1
      : false;
    const primaries = sameType.filter((item) => item.isPrimary);
    const numbered = sameType
      .map((item) => ({ item, version: parseVersionNumber(item.fileType, item.versionName) }))
      .filter((entry): entry is { item: AudioVersionRecord; version: number } => entry.version !== null)
      .sort((a, b) => b.version - a.version || b.item.createdAt.localeCompare(a.item.createdAt));
    const recommendedPrimaryId = numbered[0]?.item.id ?? [...sameType].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;

    // Engine provenance and descriptive take names are valid version labels.
    if (duplicateName) issues.push("版本名稱重複");
    const needsPrimary = ["demo", "mix", "master"].includes(stageKey(file.fileType));
    if (needsPrimary && !primaries.length && file.id === recommendedPrimaryId) issues.push("此類型未指定主要版本");
    if (primaries.length > 1 && file.isPrimary) issues.push("主要版本重複");

    if (file.parentAudioFileId) {
      const parent = byId.get(file.parentAudioFileId);
      if (!parent) issues.push("版本來源不存在");
      else if (parent.songId !== file.songId) issues.push("版本來源跨作品");
    } else if (sameType.length > 1 && parsedVersion !== null) {
      const earliestVersion = Math.min(...numbered.map((entry) => entry.version));
      if (parsedVersion > earliestVersion) issues.push("後續版本未連結來源");
    }

    result.set(file.id, {
      versionIssues: issues,
      suggestedVersionName: !file.versionName?.trim() || duplicateName ? nextVersionName(file, files) : null,
      recommendedPrimary: needsPrimary && !primaries.length && file.id === recommendedPrimaryId
    });
  }

  return result;
}
