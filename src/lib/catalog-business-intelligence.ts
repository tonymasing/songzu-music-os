import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { storagePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

function parseArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  }
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  const normalized = normalize(value);
  const words = normalized.split(/[\s,，、/|]+/).filter((item) => item.length > 1);
  const chars = [...normalized.replace(/[\s\p{P}\p{S}]/gu, "")];
  const bigrams = chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  return [...new Set([...words, ...bigrams])];
}

function sum(values: Array<number | null | undefined>) {
  return Math.round(values.reduce<number>((total, value) => total + (value ?? 0), 0) * 100) / 100;
}

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 90) || "song";
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function createCatalogBrief(input: {
  title: string;
  description?: string | null;
  useCase: string;
  query: string;
  moods?: string[];
  instruments?: string[];
  genres?: string[];
  bpmMin?: number | null;
  bpmMax?: number | null;
  requiredRights?: string;
  allowVocals?: boolean;
}) {
  return prisma.catalogBrief.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      useCase: input.useCase,
      query: input.query,
      moodsJson: JSON.stringify(input.moods ?? []),
      instrumentsJson: JSON.stringify(input.instruments ?? []),
      genresJson: JSON.stringify(input.genres ?? []),
      bpmMin: input.bpmMin ?? null,
      bpmMax: input.bpmMax ?? null,
      requiredRights: input.requiredRights ?? "one_stop_preferred",
      allowVocals: input.allowVocals ?? true,
      status: "ACTIVE"
    }
  });
}

function scoreSongForBrief(
  song: Awaited<ReturnType<typeof loadCatalogSongs>>[number],
  brief: Awaited<ReturnType<typeof prisma.catalogBrief.findUniqueOrThrow>>
) {
  const queryTokens = tokens(`${brief.query} ${brief.description || ""}`);
  const requiredMoods = parseArray(brief.moodsJson).map(normalize);
  const requiredGenres = parseArray(brief.genresJson).map(normalize);
  const requiredInstruments = parseArray(brief.instrumentsJson).map(normalize);
  const songMoods = parseArray(song.moodJson).map(normalize);
  const sounds = song.soundUsages.flatMap((usage) => [usage.role, usage.soundLibraryItem.name, usage.soundLibraryItem.family]).filter(Boolean).map((item) => normalize(String(item)));
  const lyrics = song.lyricsVersions.map((version) => version.content).join(" ");
  const haystack = normalize([
    song.title,
    song.summary,
    song.notes,
    song.genre,
    song.subgenre,
    song.musicalKey,
    lyrics,
    ...songMoods,
    ...sounds,
    ...song.musicMaterials.flatMap((material) => [material.title, material.summary, material.content, material.genre, material.tagsJson])
  ].filter(Boolean).join(" "));

  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 8;
  const matchedQuery = queryTokens.filter((token) => haystack.includes(token));
  if (matchedQuery.length) {
    score += Math.min(32, matchedQuery.length * 6);
    reasons.push(`符合搜尋語意：${matchedQuery.slice(0, 5).join("、")}`);
  }
  const matchedMoods = requiredMoods.filter((mood) => songMoods.some((item) => item.includes(mood) || mood.includes(item)));
  if (matchedMoods.length) {
    score += Math.min(16, matchedMoods.length * 8);
    reasons.push(`情緒符合：${matchedMoods.join("、")}`);
  }
  if (requiredGenres.some((genre) => normalize(`${song.genre || ""} ${song.subgenre || ""}`).includes(genre))) {
    score += 14;
    reasons.push(`曲風符合：${song.genre || song.subgenre}`);
  }
  const matchedInstruments = requiredInstruments.filter((instrument) => sounds.some((sound) => sound.includes(instrument)));
  if (matchedInstruments.length) {
    score += Math.min(14, matchedInstruments.length * 7);
    reasons.push(`樂器符合：${matchedInstruments.join("、")}`);
  }
  if (song.bpm && (!brief.bpmMin || song.bpm >= brief.bpmMin) && (!brief.bpmMax || song.bpm <= brief.bpmMax)) {
    score += 10;
    reasons.push(`速度 ${song.bpm} BPM 在需求範圍內`);
  } else if (brief.bpmMin || brief.bpmMax) {
    blockers.push(song.bpm ? `BPM ${song.bpm} 不在需求範圍` : "缺少 BPM");
    score -= 8;
  }
  const hasVocal = song.audioFiles.some((file) => file.fileType.includes("vocal")) || lyrics.trim().length > 30;
  if (!brief.allowVocals && hasVocal) {
    blockers.push("需求不接受人聲版本");
    score -= 16;
  }
  const rights = song.rightsProfile;
  const splitTotal = sum(song.credits.map((credit) => credit.publishingSplit ?? credit.splitPercentage));
  const rightsReady = Boolean(rights?.masterControlled && rights.publishingControlled && splitTotal === 100);
  if (rightsReady) {
    score += rights?.oneStopClearance ? 15 : 8;
    reasons.push(rights?.oneStopClearance ? "One-stop 權利可控" : "Master 與 Publishing 權利可控");
  } else {
    blockers.push(splitTotal !== 100 ? `Publishing 分潤目前 ${splitTotal}%` : "權利控制狀態未完成");
    score -= brief.requiredRights === "one_stop_required" ? 22 : 10;
  }
  const master = song.audioFiles.find((file) => file.fileType === "master" && file.qualityStatus === "pass");
  if (master) {
    score += 8;
    reasons.push("已有音質通過的 Master");
  } else blockers.push("沒有音質通過的 Master");
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    reasons,
    blockers,
    rightsStatus: rightsReady ? (rights?.oneStopClearance ? "ONE_STOP" : "CONTROLLED") : "INCOMPLETE"
  };
}

async function loadCatalogSongs() {
  return prisma.song.findMany({
    include: {
      lyricsVersions: { orderBy: { updatedAt: "desc" }, take: 2 },
      audioFiles: { where: { archivedAt: null }, select: { fileType: true, qualityStatus: true } },
      credits: true,
      rightsProfile: true,
      soundUsages: { include: { soundLibraryItem: true } },
      musicMaterials: true
    }
  });
}

export async function matchCatalogBrief(briefId: string) {
  const [brief, songs] = await Promise.all([
    prisma.catalogBrief.findUniqueOrThrow({ where: { id: briefId } }),
    loadCatalogSongs()
  ]);
  const ranked = songs
    .map((song) => ({ song, ...scoreSongForBrief(song, brief) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 30);
  await prisma.$transaction(async (tx) => {
    await tx.catalogMatch.deleteMany({ where: { briefId } });
    for (const item of ranked) {
      await tx.catalogMatch.create({
        data: {
          briefId,
          songId: item.song.id,
          score: item.score,
          reasonsJson: JSON.stringify(item.reasons),
          blockersJson: JSON.stringify(item.blockers),
          rightsStatus: item.rightsStatus,
          status: item.score >= 65 ? "STRONG_MATCH" : item.score >= 40 ? "SUGGESTED" : "LOW_MATCH"
        }
      });
    }
  });
  return prisma.catalogBrief.findUnique({
    where: { id: briefId },
    include: { matches: { include: { song: { select: { id: true, title: true, genre: true, bpm: true, musicalKey: true, status: true } } }, orderBy: { score: "desc" } } }
  });
}

export async function saveSongRightsProfile(input: {
  songId: string;
  alternateTitle?: string | null;
  iswc?: string | null;
  language?: string;
  explicit?: boolean;
  territory?: string;
  publisher?: string | null;
  proAffiliation?: string | null;
  masterOwner?: string | null;
  publishingOwner?: string | null;
  oneStopClearance?: boolean;
  masterControlled?: boolean;
  publishingControlled?: boolean;
  recordingLocation?: string | null;
  equipment?: unknown;
  identifiers?: unknown;
  notes?: string | null;
}) {
  const data = {
    alternateTitle: input.alternateTitle ?? null,
    iswc: input.iswc ?? null,
    language: input.language ?? "zh-TW",
    explicit: input.explicit ?? false,
    territory: input.territory ?? "Worldwide",
    publisher: input.publisher ?? null,
    proAffiliation: input.proAffiliation ?? null,
    masterOwner: input.masterOwner ?? null,
    publishingOwner: input.publishingOwner ?? null,
    oneStopClearance: input.oneStopClearance ?? false,
    masterControlled: input.masterControlled ?? true,
    publishingControlled: input.publishingControlled ?? true,
    recordingLocation: input.recordingLocation ?? null,
    equipmentJson: JSON.stringify(input.equipment ?? []),
    identifiersJson: JSON.stringify(input.identifiers ?? {}),
    notes: input.notes ?? null
  };
  return prisma.songRightsProfile.upsert({
    where: { songId: input.songId },
    create: { songId: input.songId, ...data },
    update: data
  });
}

function splitWarnings(song: Awaited<ReturnType<typeof loadRightsSong>>) {
  if (!song) return ["找不到歌曲"];
  const publishing = sum(song.credits.map((credit) => credit.publishingSplit ?? credit.splitPercentage));
  const master = sum(song.credits.map((credit) => credit.masterSplit));
  const warnings: string[] = [];
  if (publishing !== 100) warnings.push(`Publishing 分潤合計 ${publishing}%，應為 100%。`);
  if (song.credits.some((credit) => credit.masterSplit !== null) && master !== 100) warnings.push(`Master 分潤合計 ${master}%，應為 100%。`);
  if (!song.rightsProfile?.masterOwner) warnings.push("缺少 Master owner。");
  if (!song.rightsProfile?.publishingOwner) warnings.push("缺少 Publishing owner。");
  if (song.credits.some((credit) => !credit.contributor.ipi && ["作詞", "作曲", "composer", "lyricist"].includes(credit.role.toLocaleLowerCase()))) warnings.push("部分詞曲權利人缺 IPI。");
  if (!song.releaseTracks.some((track) => track.isrc)) warnings.push("缺少 ISRC。");
  return warnings;
}

async function loadRightsSong(songId: string) {
  return prisma.song.findUnique({
    where: { id: songId },
    include: {
      rightsProfile: true,
      credits: { include: { contributor: true, confirmations: true } },
      releaseTracks: { include: { release: true } },
      audioFiles: { where: { archivedAt: null }, select: { id: true, fileName: true, fileType: true, sha256: true, sampleRate: true, bitDepth: true, qualityStatus: true } }
    }
  });
}

function rightsPayload(song: NonNullable<Awaited<ReturnType<typeof loadRightsSong>>>) {
  return {
    song: {
      id: song.id,
      title: song.title,
      alternateTitle: song.rightsProfile?.alternateTitle,
      language: song.rightsProfile?.language || song.language,
      iswc: song.rightsProfile?.iswc,
      bpm: song.bpm,
      musicalKey: song.musicalKey,
      genre: song.genre
    },
    owners: {
      master: song.rightsProfile?.masterOwner,
      publishing: song.rightsProfile?.publishingOwner,
      publisher: song.rightsProfile?.publisher,
      territory: song.rightsProfile?.territory,
      oneStop: song.rightsProfile?.oneStopClearance
    },
    contributors: song.credits.map((credit) => ({
      name: credit.contributor.name,
      role: credit.role,
      ipi: credit.contributor.ipi,
      isni: credit.contributor.isni,
      pro: credit.contributor.proAffiliation,
      publishingSplit: credit.publishingSplit ?? credit.splitPercentage,
      masterSplit: credit.masterSplit,
      confirmed: credit.confirmations.some((confirmation) => confirmation.status === "CONFIRMED")
    })),
    releases: song.releaseTracks.map((track) => ({ title: track.release.title, upc: track.release.upc, isrc: track.isrc, trackNumber: track.trackNumber })),
    masters: song.audioFiles.filter((file) => file.fileType === "master")
  };
}

function rinDraftXml(payload: ReturnType<typeof rightsPayload>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SongzuRecordingInformationDraft profile="RIN-inspired-v1" certification="none">
  <Notice>This is a local review draft and is not DDEX-certified.</Notice>
  <Recording title="${escapeXml(payload.song.title)}" language="${escapeXml(payload.song.language)}">
    <ISWC>${escapeXml(payload.song.iswc)}</ISWC>
    <Genre>${escapeXml(payload.song.genre)}</Genre>
    <MusicalKey>${escapeXml(payload.song.musicalKey)}</MusicalKey>
    <BPM>${escapeXml(payload.song.bpm)}</BPM>
    <Contributors>${payload.contributors.map((item) => `
      <Contributor role="${escapeXml(item.role)}" publishingSplit="${escapeXml(item.publishingSplit)}" masterSplit="${escapeXml(item.masterSplit)}">
        <Name>${escapeXml(item.name)}</Name><IPI>${escapeXml(item.ipi)}</IPI><ISNI>${escapeXml(item.isni)}</ISNI>
      </Contributor>`).join("")}
    </Contributors>
  </Recording>
</SongzuRecordingInformationDraft>`;
}

function ernDraftXml(payload: ReturnType<typeof rightsPayload>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SongzuReleaseDeliveryDraft profile="ERN-inspired-v1" certification="none">
  <Notice>This is a local review draft and is not DDEX-certified or delivery-ready.</Notice>
  ${payload.releases.map((release) => `<Release title="${escapeXml(release.title)}" UPC="${escapeXml(release.upc)}"><Track number="${release.trackNumber}" ISRC="${escapeXml(release.isrc)}" title="${escapeXml(payload.song.title)}" /></Release>`).join("\n  ")}
</SongzuReleaseDeliveryDraft>`;
}

function splitSheetHtml(payload: ReturnType<typeof rightsPayload>) {
  const rows = payload.contributors.map((item) => `<tr><td>${escapeXml(item.name)}</td><td>${escapeXml(item.role)}</td><td>${escapeXml(item.ipi || "-")}</td><td>${escapeXml(item.publishingSplit ?? 0)}%</td><td>${escapeXml(item.masterSplit ?? 0)}%</td><td>${item.confirmed ? "已確認" : "待確認"}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${escapeXml(payload.song.title)} 權利表</title><style>body{font-family:-apple-system,sans-serif;max-width:960px;margin:48px auto;color:#181818}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #bbb;text-align:left}.notice{padding:12px;background:#fff6dd}</style><body><h1>${escapeXml(payload.song.title)} 權利確認草稿</h1><p class="notice">本文件為本機管理草稿，不構成法律意見或平台正式交付。</p><p>Master owner：${escapeXml(payload.owners.master || "待補")}</p><p>Publishing owner：${escapeXml(payload.owners.publishing || "待補")}</p><table><thead><tr><th>合作人</th><th>角色</th><th>IPI</th><th>Publishing</th><th>Master</th><th>確認</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function exportIndustryMetadata(songId: string, format: "LABEL_COPY_JSON" | "DDEX_RIN_DRAFT" | "DDEX_ERN_DRAFT" | "SPLIT_SHEET_HTML") {
  const song = await loadRightsSong(songId);
  if (!song) throw new Error("找不到歌曲");
  const payload = rightsPayload(song);
  const warnings = splitWarnings(song);
  const formats = {
    LABEL_COPY_JSON: { extension: "json", profile: "songzu-label-copy-v1", content: JSON.stringify({ notice: "Local review draft", ...payload }, null, 2) },
    DDEX_RIN_DRAFT: { extension: "xml", profile: "RIN-inspired-v1-not-certified", content: rinDraftXml(payload) },
    DDEX_ERN_DRAFT: { extension: "xml", profile: "ERN-inspired-v1-not-certified", content: ernDraftXml(payload) },
    SPLIT_SHEET_HTML: { extension: "html", profile: "songzu-split-sheet-v1", content: splitSheetHtml(payload) }
  } as const;
  const selected = formats[format];
  const folder = storagePath("exports", song.id, "industry");
  await mkdir(folder, { recursive: true });
  const fileName = `${safeName(song.title)}-${format.toLocaleLowerCase()}-${Date.now()}.${selected.extension}`;
  const filePath = join(folder, fileName);
  await writeFile(filePath, selected.content, "utf8");
  const sha256 = createHash("sha256").update(selected.content).digest("hex");
  const record = await prisma.industryExport.create({
    data: {
      songId: song.id,
      releaseId: song.releaseTracks[0]?.releaseId ?? null,
      format,
      profileVersion: selected.profile,
      fileName,
      filePath,
      sha256,
      validationStatus: warnings.length ? "WARNING" : "REVIEW_READY",
      warningsJson: JSON.stringify(warnings)
    }
  });
  return { record, warnings, certified: false };
}

export async function addPlatformMetricSnapshot(input: {
  songId?: string | null;
  provider: string;
  externalMediaId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  views?: number;
  engagedViews?: number;
  watchMinutes?: number;
  averageViewDuration?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  subscribersGained?: number;
  estimatedRevenue?: number;
  currency?: string;
  source?: string;
}) {
  return prisma.platformMetricSnapshot.create({
    data: {
      songId: input.songId ?? null,
      provider: input.provider,
      externalMediaId: input.externalMediaId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      views: input.views ?? 0,
      engagedViews: input.engagedViews ?? 0,
      watchMinutes: input.watchMinutes ?? 0,
      averageViewDuration: input.averageViewDuration ?? 0,
      likes: input.likes ?? 0,
      comments: input.comments ?? 0,
      shares: input.shares ?? 0,
      subscribersGained: input.subscribersGained ?? 0,
      estimatedRevenue: input.estimatedRevenue ?? 0,
      currency: input.currency ?? "TWD",
      source: input.source ?? "manual"
    }
  });
}

export async function recordAudienceEvent(input: {
  songId: string;
  previewId?: string | null;
  eventType: string;
  source?: string;
  sessionHash?: string | null;
  metadata?: unknown;
}) {
  return prisma.audienceEvent.create({
    data: {
      songId: input.songId,
      previewId: input.previewId ?? null,
      eventType: input.eventType,
      source: input.source ?? "direct",
      sessionHash: input.sessionHash ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {})
    }
  });
}

export async function getCatalogBusinessSummary() {
  const [briefs, rights, exports, metrics, events, revenues, songs] = await Promise.all([
    prisma.catalogBrief.findMany({ include: { matches: { include: { song: { select: { id: true, title: true, genre: true, bpm: true } } }, orderBy: { score: "desc" }, take: 8 } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.songRightsProfile.findMany({
      include: {
        song: {
          select: {
            id: true,
            title: true,
            credits: { select: { publishingSplit: true, splitPercentage: true } }
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.industryExport.findMany({ include: { song: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.platformMetricSnapshot.findMany({ include: { song: { select: { id: true, title: true } } }, orderBy: { periodEnd: "desc" }, take: 100 }),
    prisma.audienceEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 1000 }),
    prisma.revenueRecord.findMany({ orderBy: { periodEnd: "desc" }, take: 500 }),
    prisma.song.findMany({ select: { id: true, title: true, genre: true, status: true } })
  ]);

  const songInsights = songs.map((song) => {
    const songMetrics = metrics.filter((item) => item.songId === song.id);
    const songEvents = events.filter((item) => item.songId === song.id);
    const songRevenue = revenues.filter((item) => item.songId === song.id).reduce((total, item) => total + item.grossAmount, 0);
    const views = songMetrics.reduce((total, item) => total + item.views, 0);
    const engaged = songMetrics.reduce((total, item) => total + item.engagedViews + item.likes + item.comments + item.shares, 0);
    const plays = songEvents.filter((item) => item.eventType === "preview_play").length;
    const claims = songEvents.filter((item) => item.eventType === "claim_submitted").length;
    const engagementRate = views ? Math.round((engaged / views) * 10_000) / 100 : 0;
    const conversionRate = plays ? Math.round((claims / plays) * 10_000) / 100 : 0;
    const recommendations = [
      views > 0 && engagementRate < 2 ? "互動率偏低，檢查前 5 秒開場與標題/封面是否一致。" : null,
      plays >= 5 && claims === 0 ? "試聽有播放但尚無認領，檢查方案文案、價格與聯絡流程。" : null,
      views === 0 && plays === 0 ? "尚無成效資料，先發布試聽頁或補一筆平台數據。" : null,
      songRevenue > 0 ? "已有收入紀錄，可優先複製相近曲風與發行方式。" : null
    ].filter((item): item is string => Boolean(item));
    return { song, views, plays, claims, engagementRate, conversionRate, revenue: Math.round(songRevenue * 100) / 100, recommendations };
  }).sort((left, right) => right.revenue - left.revenue || right.views - left.views || right.plays - left.plays);

  return {
    briefs,
    rights,
    exports,
    metrics: metrics.slice(0, 30),
    songInsights,
    totals: {
      views: metrics.reduce((total, item) => total + item.views, 0),
      watchMinutes: Math.round(metrics.reduce((total, item) => total + item.watchMinutes, 0) * 10) / 10,
      previewPlays: events.filter((item) => item.eventType === "preview_play").length,
      claims: events.filter((item) => item.eventType === "claim_submitted").length,
      revenue: Math.round(revenues.reduce((total, item) => total + item.grossAmount, 0) * 100) / 100,
      rightsReady: rights.filter((item) => item.masterControlled && item.publishingControlled && sum(item.song.credits.map((credit) => credit.publishingSplit ?? credit.splitPercentage)) === 100).length
    }
  };
}
