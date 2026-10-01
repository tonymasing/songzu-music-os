import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { AudioFile, AudioQualityReport, Song } from "@prisma/client";

import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { isManagedAudioProvider } from "@/lib/audio-repair-policy";
import { buildAudioVersionGovernance, type AudioVersionGovernance } from "@/lib/audio-versioning";
import { acquireLocalOperationLock } from "@/lib/local-operation-lock";
import { fileTypeLabel, parseJsonValue, toIso } from "@/lib/music";
import { appPath, resolveStoredFilePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

type AudioFileWithSong = AudioFile & {
  song: Pick<Song, "id" | "title" | "status">;
  qualityReports: AudioQualityReport[];
};

type AudioRepairBaseDto = Awaited<ReturnType<typeof toAudioRepairBaseDto>>;
export type AudioRepairItemDto = AudioRepairBaseDto & AudioVersionGovernance;

function cleanFileName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim() || "audio-file";
}

function isLikelyAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

async function pathExists(filePath: string | null) {
  if (!filePath) return false;
  try {
    const fileStat = await stat(resolveStoredFilePath(filePath));
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function appendNote(existing: string | null, note: string) {
  return [existing, note].filter(Boolean).join("\n");
}

function uploadFolder(songId: string) {
  return appPath("uploads", songId);
}

function safeDiskName(fileName: string) {
  return `${randomUUID()}-${cleanFileName(fileName)}`;
}

function issueList(file: AudioFileWithSong, exists: boolean) {
  const issues: string[] = [];
  if (file.archivedAt) issues.push("已封存");
  if (file.filePath && !isManagedAudioProvider(file.storageProvider)) issues.push("外部路徑");
  if (!exists) issues.push("檔案不存在");
  if (!file.sha256) issues.push("缺 SHA-256");
  if (!file.qualityReports.length) issues.push("缺 Audio QA");
  if (file.qualityStatus === "pending") issues.push("音質待分析");
  if (file.qualityStatus === "fail") issues.push("音質未通過");
  if (file.qualityReports[0]?.errorMessage) issues.push("音質分析失敗");
  if (file.qualityStatus === "warning") {
    const warnings = parseJsonValue<string[]>(file.qualityReports[0]?.warningsJson, []);
    issues.push(...(warnings.length ? warnings : ["音質警告"]));
  }
  return issues;
}

async function toAudioRepairBaseDto(file: AudioFileWithSong) {
  const exists = await pathExists(file.filePath);
  return {
    id: file.id,
    songId: file.songId,
    songTitle: file.song.title,
    songStatus: file.song.status,
    fileName: file.fileName,
    filePath: file.filePath,
    storageProvider: file.storageProvider,
    fileType: file.fileType,
    fileTypeLabel: fileTypeLabel(file.fileType),
    versionName: file.versionName,
    parentAudioFileId: file.parentAudioFileId,
    fileSizeBytes: file.fileSizeBytes,
    sha256: file.sha256,
    qualityStatus: file.qualityStatus,
    isPrimary: file.isPrimary,
    archivedAt: toIso(file.archivedAt),
    notes: file.notes,
    createdAt: file.createdAt.toISOString(),
    exists,
    latestReport: file.qualityReports[0]
      ? {
          id: file.qualityReports[0].id,
          verdict: file.qualityReports[0].verdict,
          errorMessage: file.qualityReports[0].errorMessage,
          createdAt: toIso(file.qualityReports[0].createdAt)
        }
      : null,
    issues: issueList(file, exists)
  };
}

export async function getAudioRepairItems() {
  const files = await prisma.audioFile.findMany({
    include: {
      song: { select: { id: true, title: true, status: true } },
      qualityReports: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }]
  });

  const items = await Promise.all(files.map(toAudioRepairBaseDto));
  const governance = buildAudioVersionGovernance(items);
  return items.map((item) => ({
    ...item,
    ...(governance.get(item.id) ?? { versionIssues: [], suggestedVersionName: null, recommendedPrimary: false })
  }));
}

export async function getAudioRepairItem(audioFileId: string) {
  const item = (await getAudioRepairItems()).find((candidate) => candidate.id === audioFileId);
  if (!item) throw new Error("找不到音檔紀錄。");
  return item;
}

export async function withAudioRepairLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const release = acquireLocalOperationLock(`audio-repair:${id}`);
  if (!release) throw new Error("這個音檔正在處理，請等目前工作完成。");
  try { return await operation(); } finally { release(); }
}

const referenceCounts = {
  dawClips: true, dawScoreDrafts: true, recordingTakes: true,
  referencedRecordingSessions: true, previewSources: true, childAudioFiles: true,
  performanceReports: true, performanceIssues: true, intelligenceJobs: true
} as const;

async function readRepairTarget(id: string) {
  return prisma.audioFile.findUniqueOrThrow({ where: { id }, include: { _count: { select: referenceCounts } } });
}

export async function archiveAudioFile(audioFileId: string, reason?: string | null) {
  return withAudioRepairLock(audioFileId, async () => {
    const existing = await readRepairTarget(audioFileId);
    if (existing.archivedAt) return getAudioRepairItem(audioFileId);
    if (await pathExists(existing.filePath)) throw new Error("檔案仍然存在，無須封存。要整理版本請使用作品庫。");
    if (existing.isPrimary || Object.values(existing._count).some((count) => count > 0)) {
      throw new Error("音檔仍被軌道、錄音、採譜或版本引用，請先找回原檔；不能直接封存。");
    }
    const archivedAt = new Date();
    await prisma.$transaction(async (tx) => {
      // Recheck references inside the same transaction as the archive.
      const latest = await tx.audioFile.findUniqueOrThrow({ where: { id: audioFileId }, include: { _count: { select: referenceCounts } } });
      if (latest.isPrimary || Object.values(latest._count).some((count) => count > 0)
        || latest.filePath !== existing.filePath || await pathExists(latest.filePath)) throw new Error("音檔狀態已改變，請重新整理後再試。");
      await tx.audioFile.update({ where: { id: audioFileId }, data: {
        archivedAt, isPrimary: false,
        notes: appendNote(latest.notes, `已於 ${archivedAt.toISOString()} 封存缺檔紀錄。${reason ? `原因：${reason}` : ""}`)
      } });
      await tx.timelineEvent.create({ data: {
        songId: latest.songId, eventType: "audio_archived", title: "封存缺檔紀錄",
        description: latest.fileName, relatedModel: "AudioFile", relatedId: audioFileId
      } });
    });
    return getAudioRepairItem(audioFileId);
  });
}

async function updateAudioFileToLocalUpload(input: {
  existing: Awaited<ReturnType<typeof readRepairTarget>>;
  sourcePath: string;
  diskPath: string;
  fileName: string;
  note: string;
}) {
  const existing = input.existing;
  const [fileStat, sha256] = await Promise.all([stat(input.diskPath), hashFile(input.diskPath)]);
  const expectedHash = existing.sha256 || (await pathExists(existing.filePath)
    ? await hashFile(resolveStoredFilePath(existing.filePath!)) : null);
  if (!expectedHash) throw new Error("沒有原檔指紋，無法確認是同一份音訊。請到作品庫上傳為新版本。");
  if (sha256 !== expectedHash) throw new Error("這份檔案與原音訊不同，不能替換已接好的軌道或採譜來源。請到作品庫上傳為新版本。");
  await prisma.$transaction(async (tx) => {
    const result = await tx.audioFile.updateMany({ where: {
      id: existing.id, updatedAt: existing.updatedAt, filePath: existing.filePath, sha256: existing.sha256
    }, data: {
      fileName: input.fileName,
      filePath: input.diskPath,
      storageProvider: "local_upload",
      fileSizeBytes: fileStat.size,
      sha256,
      archivedAt: null,
      notes: input.note
    } });
    if (result.count !== 1) throw new Error("音檔已被其他工作更新，請重新整理後再試。");
    await tx.timelineEvent.create({ data: {
      songId: existing.songId,
      eventType: "audio_repaired",
      title: "修復音檔路徑",
      description: `${input.fileName} 已驗證與原音訊相同並複製匯入。`,
      relatedModel: "AudioFile",
      relatedId: existing.id,
      metadataJson: JSON.stringify({ sourcePath: input.sourcePath })
    } });
  });
}

export async function importAudioFileFromExternalPath(audioFileId: string, sourcePath: string) {
  const trimmed = sourcePath.trim();
  if (!trimmed || !isLikelyAbsolutePath(trimmed)) {
    throw new Error("請輸入外部硬碟或本機的完整檔案路徑。");
  }

  return withAudioRepairLock(audioFileId, async () => {
    const existing = await readRepairTarget(audioFileId);
    if (existing.archivedAt) throw new Error("已封存音檔不能從修復頁重新連結。");
    if (!(await stat(trimmed)).isFile()) throw new Error("指定路徑不是檔案。");
    if (isManagedAudioProvider(existing.storageProvider) && await pathExists(existing.filePath)) {
      throw new Error("原音檔已在 OS 內，無須再次複製匯入。");
    }
    const name = cleanFileName(basename(trimmed));
    const folder = uploadFolder(existing.songId);
    await mkdir(folder, { recursive: true });
    const diskPath = join(folder, safeDiskName(name));
    try {
      await copyFile(trimmed, diskPath, constants.COPYFILE_EXCL);
      await updateAudioFileToLocalUpload({ existing, sourcePath: trimmed, diskPath, fileName: name,
        note: appendNote(existing.notes, `從外部路徑找回原檔：${trimmed}`) });
    } catch (error) { await rm(diskPath, { force: true }); throw error; }
    return getAudioRepairItem(audioFileId);
  });
}

export async function replaceAudioFileWithUpload(audioFileId: string, file: File) {
  return withAudioRepairLock(audioFileId, async () => {
    const existing = await readRepairTarget(audioFileId);
    if (existing.archivedAt) throw new Error("已封存音檔不能從修復頁重新連結。");
    if (await pathExists(existing.filePath)) throw new Error("原音檔仍然存在。新錄音或不同音訊請到作品庫上傳為新版本。");
    if (!file.size) throw new Error("檔案是空的，請選擇原始音檔。");
    const name = cleanFileName(file.name || existing.fileName);
    const folder = uploadFolder(existing.songId);
    await mkdir(folder, { recursive: true });
    const diskPath = join(folder, safeDiskName(name));
    try {
      await writeFile(diskPath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      await updateAudioFileToLocalUpload({ existing, sourcePath: file.name, diskPath, fileName: name,
        note: appendNote(existing.notes, `重新上傳找回原檔：${name}`) });
    } catch (error) { await rm(diskPath, { force: true }); throw error; }
    return getAudioRepairItem(audioFileId);
  });
}

export async function reanalyzeAudioFile(audioFileId: string) {
  return withAudioRepairLock(audioFileId, async () => {
    const existing = await readRepairTarget(audioFileId);
    if (existing.archivedAt || !await pathExists(existing.filePath)) throw new Error("請先找回未封存的原音檔，再執行音質分析。");
    if (existing.sha256 && await hashFile(resolveStoredFilePath(existing.filePath!)) !== existing.sha256) {
      throw new Error("原路徑的音訊內容已改變，請上傳為新版本，避免影響既有軌道與採譜。");
    }
    await generateAndStoreAudioQualityReport(audioFileId);
    return getAudioRepairItem(audioFileId);
  });
}
