import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type { AudioFile, Prisma } from "@prisma/client";

import { probeMedia } from "@/lib/media-export";
import { appPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";
const previewSeconds = 30;

export const previewStatuses = ["DRAFT", "PUBLISHED", "PAUSED"] as const;
export const claimOfferStatuses = ["ACTIVE", "PAUSED", "SOLD_OUT"] as const;
export const claimOrderStatuses = [
  "REQUESTED",
  "AWAITING_PAYMENT",
  "PAID",
  "IN_PROGRESS",
  "DELIVERED",
  "CANCELLED"
] as const;

export const claimOrderStatusLabels: Record<(typeof claimOrderStatuses)[number], string> = {
  REQUESTED: "新認領單",
  AWAITING_PAYMENT: "等待付款",
  PAID: "已付款",
  IN_PROGRESS: "製作中",
  DELIVERED: "已交付",
  CANCELLED: "已取消"
};

const defaultRightsSummary =
  "認領價格不會自動轉讓著作權。商用範圍、是否獨家、改作方式與署名，會在付款前由雙方另行確認。";

export const defaultClaimOffers = [
  {
    offerType: "LYRICS",
    title: "歌詞認領稿",
    description: "認領這首作品的歌詞創作稿與後續溝通資格。",
    price: 200,
    currency: "TWD",
    rightsSummary: defaultRightsSummary,
    deliveryDays: 7,
    maxClaims: 1,
    sortOrder: 10
  },
  {
    offerType: "COMPOSITION",
    title: "曲子認領稿",
    description: "認領旋律與曲式方向稿，確認後再約定使用情境。",
    price: 300,
    currency: "TWD",
    rightsSummary: defaultRightsSummary,
    deliveryDays: 7,
    maxClaims: 1,
    sortOrder: 20
  },
  {
    offerType: "LYRICS_COMPOSITION",
    title: "詞曲組合認領稿",
    description: "一次認領歌詞與曲子方向稿，組合價比單獨認領節省 50 元。",
    price: 450,
    currency: "TWD",
    rightsSummary: defaultRightsSummary,
    deliveryDays: 10,
    maxClaims: 1,
    sortOrder: 30
  }
] as const;

export const previewAdminInclude = {
  song: {
    include: {
      audioFiles: {
        where: { archivedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }]
      }
    }
  },
  release: true,
  sourceAudioFile: true,
  offers: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      orders: { orderBy: { createdAt: "desc" } }
    }
  }
} satisfies Prisma.SongPreviewInclude;

export type SongPreviewRecord = Prisma.SongPreviewGetPayload<{ include: typeof previewAdminInclude }>;
export type SongPreviewDto = ReturnType<typeof toSongPreviewDto>;

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "song"
  );
}

function previewRoot(songId: string) {
  return appPath("previews", songId);
}

export function songPreviewPath(songId: string, fileName: string) {
  return join(previewRoot(songId), basename(fileName));
}

function toIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function activeReservation(order: { status: string; reservationExpiresAt: Date | null }, now = new Date()) {
  if (["PAID", "IN_PROGRESS", "DELIVERED"].includes(order.status)) return true;
  return (
    ["REQUESTED", "AWAITING_PAYMENT"].includes(order.status) &&
    (!order.reservationExpiresAt || order.reservationExpiresAt > now)
  );
}

export function claimConflictTypes(offerType: string) {
  if (offerType === "LYRICS") return ["LYRICS", "LYRICS_COMPOSITION"];
  if (offerType === "COMPOSITION") return ["COMPOSITION", "LYRICS_COMPOSITION"];
  if (offerType === "LYRICS_COMPOSITION") return ["LYRICS", "COMPOSITION", "LYRICS_COMPOSITION"];
  return [offerType];
}

export function toSongPreviewDto(preview: SongPreviewRecord) {
  const cover = preview.song.audioFiles.find(
    (file) => file.fileType === "cover" && file.filePath && /\.(png|jpe?g|webp)$/i.test(file.fileName)
  );
  return {
    id: preview.id,
    songId: preview.songId,
    songTitle: preview.song.title,
    songStatus: preview.song.status,
    releaseId: preview.releaseId,
    releaseTitle: preview.release?.title ?? null,
    token: preview.token,
    publicUrl: `/listen/${preview.token}`,
    status: preview.status,
    title: preview.title || preview.song.title,
    description: preview.description || preview.song.summary,
    previewFileName: preview.previewFileName,
    previewReady: Boolean(preview.previewFileName && preview.previewSha256),
    previewStartSeconds: preview.previewStartSeconds,
    previewDurationSeconds: preview.previewDurationSeconds,
    previewSha256: preview.previewSha256,
    sourceSha256: preview.sourceSha256,
    sourceAudioFile: preview.sourceAudioFile
      ? {
          id: preview.sourceAudioFile.id,
          fileName: preview.sourceAudioFile.fileName,
          fileType: preview.sourceAudioFile.fileType,
          qualityStatus: preview.sourceAudioFile.qualityStatus,
          durationSeconds: preview.sourceAudioFile.durationSeconds
        }
      : null,
    releaseUrl: preview.releaseUrl,
    contactInfo: preview.contactInfo,
    paymentInstructions: preview.paymentInstructions,
    allowClaims: preview.allowClaims,
    playCount: preview.playCount,
    coverReady: Boolean(cover),
    publishedAt: toIso(preview.publishedAt),
    createdAt: preview.createdAt.toISOString(),
    updatedAt: preview.updatedAt.toISOString(),
    offers: preview.offers.map((offer) => {
      const conflicts = claimConflictTypes(offer.offerType);
      const reservedCount = preview.offers.reduce((count, candidate) => {
        const conflictsWithCandidate = offer.offerType === "CUSTOM" ? candidate.id === offer.id : conflicts.includes(candidate.offerType);
        return conflictsWithCandidate ? count + candidate.orders.filter((order) => activeReservation(order)).length : count;
      }, 0);
      return {
        id: offer.id,
        offerType: offer.offerType,
        title: offer.title,
        description: offer.description,
        price: offer.price,
        currency: offer.currency,
        rightsSummary: offer.rightsSummary,
        deliveryDays: offer.deliveryDays,
        maxClaims: offer.maxClaims,
        claimedCount: offer.claimedCount,
        reservedCount,
        remaining: Math.max(0, offer.maxClaims - reservedCount),
        status: offer.status,
        sortOrder: offer.sortOrder,
        orders: offer.orders.map((order) => ({
          id: order.id,
          orderCode: order.orderCode,
          customerName: order.customerName,
          contactChannel: order.contactChannel,
          contactValue: order.contactValue,
          message: order.message,
          status: order.status,
          amountSnapshot: order.amountSnapshot,
          currency: order.currency,
          adminNotes: order.adminNotes,
          reservationExpiresAt: toIso(order.reservationExpiresAt),
          paidAt: toIso(order.paidAt),
          completedAt: toIso(order.completedAt),
          revenueRecordId: order.revenueRecordId,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString()
        }))
      };
    })
  };
}

export function toPublicSongPreviewDto(preview: SongPreviewRecord) {
  const admin = toSongPreviewDto(preview);
  let mood: string[] = [];
  try {
    mood = preview.song.moodJson ? (JSON.parse(preview.song.moodJson) as string[]) : [];
  } catch {
    mood = [];
  }
  return {
    token: admin.token,
    publicUrl: admin.publicUrl,
    title: admin.title,
    description: admin.description,
    genre: preview.song.genre,
    mood,
    releaseUrl: admin.releaseUrl,
    contactInfo: admin.contactInfo,
    playCount: admin.playCount,
    previewDurationSeconds: admin.previewDurationSeconds,
    previewReady: admin.previewReady,
    coverReady: admin.coverReady,
    offers: admin.offers
      .filter((offer) => offer.status === "ACTIVE")
      .map(({ orders: _orders, ...offer }) => offer)
  };
}

async function executable(path: string) {
  try {
    await stat(path);
    return path;
  } catch {
    return basename(path);
  }
}

async function sha256File(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function existingSource(audioFiles: AudioFile[]) {
  const rank = { master: 0, mix: 1, demo: 2 } as Record<string, number>;
  const candidates = audioFiles
    .filter((file) => file.filePath && ["master", "mix", "demo"].includes(file.fileType) && !file.archivedAt)
    .sort((a, b) => {
      const qualityA = a.qualityStatus === "pass" ? 0 : a.qualityStatus === "warning" ? 1 : 2;
      const qualityB = b.qualityStatus === "pass" ? 0 : b.qualityStatus === "warning" ? 1 : 2;
      return qualityA - qualityB || (rank[a.fileType] ?? 9) - (rank[b.fileType] ?? 9) || Number(b.isPrimary) - Number(a.isPrimary);
    });
  for (const file of candidates) {
    try {
      await stat(file.filePath as string);
      return file;
    } catch {
      // Try the next protected local asset when an old external path is missing.
    }
  }
  return null;
}

async function ensureDefaultOffers(previewId: string) {
  const existing = await prisma.claimOffer.findMany({ where: { previewId }, select: { offerType: true } });
  const existingTypes = new Set(existing.map((item) => item.offerType));
  for (const offer of defaultClaimOffers) {
    if (existingTypes.has(offer.offerType)) continue;
    await prisma.claimOffer.create({ data: { previewId, ...offer } });
  }
}

export async function ensureSongPreview(songId: string, options: {
  releaseId?: string | null;
  title?: string | null;
  description?: string | null;
  releaseUrl?: string | null;
  contactInfo?: string | null;
  paymentInstructions?: string | null;
  allowClaims?: boolean;
  publish?: boolean;
} = {}) {
  const token = randomBytes(18).toString("base64url");
  const preview = await prisma.songPreview.upsert({
    where: { songId },
    create: {
      songId,
      token,
      releaseId: options.releaseId || null,
      title: options.title || null,
      description: options.description || null,
      releaseUrl: options.releaseUrl || null,
      contactInfo: options.contactInfo || null,
      paymentInstructions: options.paymentInstructions || null,
      allowClaims: options.allowClaims ?? true,
      status: options.publish ? "PUBLISHED" : "DRAFT",
      publishedAt: options.publish ? new Date() : null
    },
    update: {
      ...(options.releaseId !== undefined ? { releaseId: options.releaseId || null } : {}),
      ...(options.title !== undefined ? { title: options.title || null } : {}),
      ...(options.description !== undefined ? { description: options.description || null } : {}),
      ...(options.releaseUrl !== undefined ? { releaseUrl: options.releaseUrl || null } : {}),
      ...(options.contactInfo !== undefined ? { contactInfo: options.contactInfo || null } : {}),
      ...(options.paymentInstructions !== undefined ? { paymentInstructions: options.paymentInstructions || null } : {}),
      ...(options.allowClaims !== undefined ? { allowClaims: options.allowClaims } : {}),
      ...(options.publish ? { status: "PUBLISHED", publishedAt: new Date() } : {})
    }
  });
  await ensureDefaultOffers(preview.id);
  return prisma.songPreview.findUniqueOrThrow({ where: { id: preview.id }, include: previewAdminInclude });
}

export async function generateSongPreview(previewId: string, requestedStartSeconds?: number, publish = false) {
  const preview = await prisma.songPreview.findUnique({ where: { id: previewId }, include: previewAdminInclude });
  if (!preview) throw new Error("找不到試聽頁。");
  const source = await existingSource(preview.song.audioFiles);
  if (!source?.filePath) {
    throw new Error("這首歌沒有可讀取的 master、mix 或 demo。請先上傳正式音檔或修復舊路徑。");
  }

  const sourceProbe = await probeMedia(source.filePath);
  const sourceDuration = sourceProbe.durationSeconds ?? source.durationSeconds ?? 0;
  if (sourceDuration < previewSeconds) {
    throw new Error(`來源音檔只有 ${Math.round(sourceDuration * 10) / 10} 秒，至少需要 30 秒才能建立正式試聽檔。`);
  }

  const suggestedStart = Math.min(Math.max(0, sourceDuration * 0.25), sourceDuration - previewSeconds);
  const requested = Number.isFinite(requestedStartSeconds) ? Number(requestedStartSeconds) : suggestedStart;
  const startSeconds = Math.min(Math.max(0, requested), Math.max(0, sourceDuration - previewSeconds));
  const folder = previewRoot(preview.songId);
  await mkdir(folder, { recursive: true });
  const fileName = `${slugify(preview.song.title)}-preview-30s.m4a`;
  const outputPath = songPreviewPath(preview.songId, fileName);
  const ffmpeg = await executable(ffmpegPath);

  await execFileAsync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startSeconds.toFixed(3),
      "-i",
      source.filePath,
      "-t",
      String(previewSeconds),
      "-vn",
      "-map_metadata",
      "-1",
      "-af",
      "afade=t=in:st=0:d=0.15,afade=t=out:st=29.5:d=0.5",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { maxBuffer: 8 * 1024 * 1024, timeout: 2 * 60_000 }
  );

  const outputProbe = await probeMedia(outputPath);
  if (!outputProbe.durationSeconds || outputProbe.durationSeconds < 29.5 || outputProbe.durationSeconds > 30.5) {
    throw new Error("試聽檔輸出驗證失敗，長度不是 30 秒。");
  }
  const previewSha256 = await sha256File(outputPath);
  const sourceSha256 = source.sha256 || (await sha256File(source.filePath));
  await prisma.songPreview.update({
    where: { id: preview.id },
    data: {
      sourceAudioFileId: source.id,
      previewFileName: fileName,
      previewStartSeconds: startSeconds,
      previewDurationSeconds: outputProbe.durationSeconds,
      sourceSha256,
      previewSha256,
      ...(publish ? { status: "PUBLISHED", publishedAt: new Date() } : {})
    }
  });
  await prisma.timelineEvent.create({
    data: {
      songId: preview.songId,
      eventType: "preview_created",
      title: "30 秒試聽檔已建立",
      description: `從 ${startSeconds.toFixed(1)} 秒開始，輸出 ${outputProbe.durationSeconds.toFixed(1)} 秒試聽檔。`,
      relatedModel: "SongPreview",
      relatedId: preview.id,
      metadataJson: JSON.stringify({ sourceAudioFileId: source.id, sourceSha256, previewSha256 })
    }
  });
  return prisma.songPreview.findUniqueOrThrow({ where: { id: preview.id }, include: previewAdminInclude });
}

export async function ensurePublishedSongPreview(songId: string, options: { releaseId?: string; releaseUrl?: string | null } = {}) {
  try {
    const preview = await ensureSongPreview(songId, {
      releaseId: options.releaseId,
      releaseUrl: options.releaseUrl,
      publish: false
    });
    const generated = await generateSongPreview(preview.id, preview.previewStartSeconds, true);
    return { ok: true as const, preview: toSongPreviewDto(generated) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "試聽檔建立失敗。" };
  }
}

export async function listSongPreviews() {
  const previews = await prisma.songPreview.findMany({
    include: previewAdminInclude,
    orderBy: [{ updatedAt: "desc" }]
  });
  return previews.map(toSongPreviewDto);
}

export async function listPublicSongPreviews() {
  const previews = await prisma.songPreview.findMany({
    where: { status: "PUBLISHED", previewFileName: { not: null } },
    include: previewAdminInclude,
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }]
  });
  return previews.map(toPublicSongPreviewDto);
}

export async function publicSongPreview(token: string) {
  const preview = await prisma.songPreview.findFirst({
    where: { token, status: "PUBLISHED", previewFileName: { not: null } },
    include: previewAdminInclude
  });
  return preview ? toPublicSongPreviewDto(preview) : null;
}

export async function publicPreviewRecord(token: string) {
  return prisma.songPreview.findFirst({
    where: { token, status: "PUBLISHED", previewFileName: { not: null } },
    include: previewAdminInclude
  });
}

export function newOrderCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SZ-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
