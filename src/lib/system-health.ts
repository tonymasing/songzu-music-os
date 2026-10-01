import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SongDto } from "@/lib/music";
import { isManagedAudioProvider } from "@/lib/audio-repair-policy";
import { appPath, resolveStoredFilePath, storagePath } from "@/lib/paths";
import { getStorageStatus, type StorageStatus } from "@/lib/storage-layout";

type DirectoryHealth = {
  label: string;
  relativePath: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
};

export type SystemHealth = {
  generatedAt: string;
  storage: StorageStatus;
  database: DirectoryHealth & { filePath: string };
  uploads: DirectoryHealth;
  exports: DirectoryHealth;
  sounds: DirectoryHealth;
  audio: {
    totalRecords: number;
    archivedRecords: number;
    localFiles: number;
    protectedOriginals: number;
    externalPaths: number;
    missingLocalFiles: number;
    missingSha256: number;
    missingQualityReport: number;
    pendingQuality: number;
    failedQuality: number;
    warningQuality: number;
  };
  issues: Array<{
    id: string;
    severity: "high" | "medium" | "low";
    title: string;
    detail: string;
    href?: string;
  }>;
};

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

export async function runtimeExecutableAvailable(path = process.execPath) {
  try { await access(path, constants.X_OK); return true; }
  catch { return false; }
}

async function scanDirectory(relativePath: "uploads" | "exports" | "sound-library", label: string): Promise<DirectoryHealth> {
  const absolutePath = relativePath === "uploads" ? appPath("uploads") : relativePath === "exports" ? appPath("exports") : storagePath("sounds");
  const root = await safeStat(absolutePath);
  if (!root?.isDirectory()) {
    return { label, relativePath, exists: false, fileCount: 0, totalBytes: 0 };
  }

  async function walk(path: string): Promise<{ fileCount: number; totalBytes: number }> {
    const entries = await readdir(path, { withFileTypes: true });
    let fileCount = 0;
    let totalBytes = 0;

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        const child = await walk(entryPath);
        fileCount += child.fileCount;
        totalBytes += child.totalBytes;
      } else if (entry.isFile()) {
        const fileStat = await safeStat(entryPath);
        fileCount += 1;
        totalBytes += fileStat?.size ?? 0;
      }
    }

    return { fileCount, totalBytes };
  }

  return { label, relativePath, exists: true, ...(await walk(absolutePath)) };
}

export async function buildSystemHealth(songs: SongDto[]): Promise<SystemHealth> {
  const [uploads, exportsHealth, sounds, storage] = await Promise.all([
    scanDirectory("uploads", "Uploads"),
    scanDirectory("exports", "Exports"),
    scanDirectory("sound-library", "Sound library"),
    getStorageStatus()
  ]);
  const dbPath = appPath("prisma", "dev.db");
  const dbStat = await safeStat(dbPath);
  const audioFiles = songs.flatMap((song) => song.audioFiles.map((file) => ({ song, file })));
  const activeAudioFiles = audioFiles.filter(({ file }) => !file.archivedAt);
  const localFiles = activeAudioFiles.filter(({ file }) => isManagedAudioProvider(file.storageProvider));
  const fileExists = await Promise.all(
    localFiles.map(async ({ song, file }) => {
      let exists = false;
      try { exists = Boolean(file.filePath && (await safeStat(resolveStoredFilePath(file.filePath)))?.isFile()); }
      catch { /* Invalid stored paths are missing sources, not healthy files. */ }
      return { song, file, exists };
    })
  );

  const missingLocal = fileExists.filter((item) => !item.exists);
  const missingSha = localFiles.filter(({ file }) => !file.sha256);
  const missingQuality = localFiles.filter(({ file }) => file.qualityReports.length === 0);
  const pendingQuality = activeAudioFiles.filter(({ file }) => file.qualityStatus === "pending");
  const failedQuality = activeAudioFiles.filter(({ file }) => file.qualityStatus === "fail");
  const warningQuality = activeAudioFiles.filter(({ file }) => file.qualityStatus === "warning");
  const externalPaths = activeAudioFiles.filter(({ file }) => file.filePath && !isManagedAudioProvider(file.storageProvider));

  const issues: SystemHealth["issues"] = [];
  if (!(await runtimeExecutableAvailable())) {
    issues.push({
      id: "runtime-executable-missing", severity: "high", title: "啟動用的 Node 執行檔已移除",
      detail: "系統更新後舊服務仍在記憶體中，但新工作可能無法啟動。請先結束並保存錄音，再重新啟動 OS 服務。", href: "/local-app"
    });
  }
  for (const item of missingLocal.slice(0, 8)) {
    issues.push({
      id: `missing-${item.file.id}`,
      severity: "high",
      title: `${item.song.title}：本機檔案遺失`,
      detail: item.file.fileName,
      href: `/songs/${item.song.id}`
    });
  }
  for (const item of failedQuality.slice(0, 6)) {
    issues.push({
      id: `quality-${item.file.id}`,
      severity: "high",
      title: `${item.song.title}：音質未通過`,
      detail: item.file.fileName,
      href: `/songs/${item.song.id}`
    });
  }
  for (const item of pendingQuality.slice(0, 6)) {
    issues.push({
      id: `pending-${item.file.id}`,
      severity: "medium",
      title: `${item.song.title}：Audio QA 待分析`,
      detail: item.file.fileName,
      href: `/songs/${item.song.id}`
    });
  }
  if (externalPaths.length) {
    issues.push({
      id: "external-paths",
      severity: "medium",
      title: "仍有外部路徑紀錄",
      detail: `${externalPaths.length} 個檔案尚未匯入 uploads，手機與輸出流程可能無法使用。`,
      href: "/songs"
    });
  }
  if (!dbStat?.isFile()) {
    issues.push({
      id: "missing-db",
      severity: "high",
      title: "找不到 SQLite 資料庫",
      detail: `預期位置 ${dbPath}。`,
      href: "/settings"
    });
  }
  for (const root of storage.roots.filter((item) => item.severity === "danger")) {
    issues.push({
      id: `storage-${root.zone}`,
      severity: "high",
      title: `${root.label}不可用`,
      detail: !root.online ? `磁碟未連接：${root.path}` : `位置不可寫入：${root.path}`,
      href: "/settings#storage-layout"
    });
  }
  if (storage.restartRequired) {
    issues.push({
      id: "storage-restart-required",
      severity: "medium",
      title: "新儲存配置等待重新啟動",
      detail: "安全副本已完成；重新啟動桌面 App 後才會切換到新位置。",
      href: "/settings#storage-layout"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    storage,
    database: {
      label: "SQLite database",
      relativePath: "prisma/dev.db",
      filePath: dbPath,
      exists: Boolean(dbStat?.isFile()),
      fileCount: dbStat?.isFile() ? 1 : 0,
      totalBytes: dbStat?.size ?? 0
    },
    uploads,
    exports: exportsHealth,
    sounds,
    audio: {
      totalRecords: audioFiles.length,
      archivedRecords: audioFiles.filter(({ file }) => Boolean(file.archivedAt)).length,
      localFiles: localFiles.length,
      protectedOriginals: activeAudioFiles.filter(({ file }) => file.isProtectedOriginal).length,
      externalPaths: externalPaths.length,
      missingLocalFiles: missingLocal.length,
      missingSha256: missingSha.length,
      missingQualityReport: missingQuality.length,
      pendingQuality: pendingQuality.length,
      failedQuality: failedQuality.length,
      warningQuality: warningQuality.length
    },
    issues
  };
}
