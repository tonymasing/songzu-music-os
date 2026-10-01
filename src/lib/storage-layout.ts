import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  utimes,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { getStorageLayout, type StorageLayout, type StorageZone } from "@/lib/paths";

export type PersistentStorageConfig = {
  version: 1;
  mode: "hybrid";
  dataRoot: string;
  databasePath: string;
  uploadsRoot: string;
  exportsRoot: string;
  backupsRoot: string;
  soundLibraryRoot: string;
  cacheRoot: string;
  legacyRoot: string;
  createdAt: string;
  updatedAt: string;
  migrationId: string;
};

export type StorageRootStatus = {
  zone: StorageZone;
  label: string;
  path: string;
  description: string;
  location: "internal" | "external";
  exists: boolean;
  online: boolean;
  writable: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
  fileSystem: string | null;
  severity: "ok" | "warning" | "danger";
};

export type StorageStatus = {
  generatedAt: string;
  mode: StorageLayout["mode"];
  layout: StorageLayout;
  roots: StorageRootStatus[];
  pendingConfig: PersistentStorageConfig | null;
  restartRequired: boolean;
  warnings: string[];
};

export type StorageMigrationTargets = {
  databasePath: string;
  mediaRoot: string;
  cacheRoot: string;
  configPath: string;
};

type Inventory = {
  files: number;
  bytes: number;
  skippedLinks: number;
};

export type StorageMigrationPlan = {
  source: StorageLayout;
  target: StorageLayout;
  configPath: string;
  inventory: {
    database: Inventory;
    uploads: Inventory;
    exports: Inventory;
    backups: Inventory;
    sounds: Inventory;
    totalFiles: number;
    totalBytes: number;
    mediaBytes: number;
  };
  targetStatus: StorageRootStatus[];
  steps: string[];
  warnings: string[];
  blockers: string[];
  ready: boolean;
};

export type StorageMigrationResult = {
  migrationId: string;
  status: "ready_to_restart";
  startedAt: string;
  completedAt: string;
  configPath: string;
  target: StorageLayout;
  copied: {
    files: number;
    skipped: number;
    bytes: number;
  };
  database: {
    sourceSha256: string;
    targetSha256: string;
    songs: number;
    audioFiles: number;
    rewrittenAudioPaths: number;
    rewrittenSoundPaths: number;
    verifiedProtectedFiles: number;
  };
  journalPath: string;
  oldDataRetained: true;
  restartRequired: true;
};

const ROOT_LABELS: Record<StorageZone, { label: string; description: string }> = {
  database: { label: "作品資料庫", description: "SQLite 索引與所有作品關聯；建議留在 Mac 內建 APFS。" },
  uploads: { label: "錄音原檔", description: "上傳、Web 錄音與原生 24-bit WAV；保留在外接大容量磁碟。" },
  exports: { label: "輸出成品", description: "Mixdown、stems、YouTube、IG 與錄音套件。" },
  backups: { label: "安全備份", description: "全站備份與遷移紀錄；不與 exports 遞迴互包。" },
  sounds: { label: "音色素材", description: "樂器原檔、預覽與效果素材。" },
  cache: { label: "暫存快取", description: "可重建的分析與工作檔；保持小型，不存唯一原檔。" }
};

function isInside(parent: string, child: string) {
  const value = relative(resolve(parent), resolve(child));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function externalVolumeRoot(path: string) {
  const normalized = resolve(path);
  if (!normalized.startsWith(`${sep}Volumes${sep}`)) return null;
  const parts = normalized.split(sep).filter(Boolean);
  return parts.length >= 2 ? join(sep, parts[0], parts[1]) : null;
}

async function safeStat(path: string) {
  try {
    return await stat(/* turbopackIgnore: true */ path);
  } catch {
    return null;
  }
}

async function mountFileSystem(path: string) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("/sbin/mount", []);
    const candidates = stdout
      .split("\n")
      .map((line) => line.match(/ on (.+) \(([^,]+)/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({ mountPath: match[1], fileSystem: match[2] }))
      .filter((item) => path === item.mountPath || path.startsWith(`${item.mountPath}/`))
      .sort((a, b) => b.mountPath.length - a.mountPath.length);
    return candidates[0]?.fileSystem ?? null;
  } catch {
    return null;
  }
}

async function rootStatus(zone: StorageZone, path: string): Promise<StorageRootStatus> {
  const expectedFile = zone === "database";
  const itemStat = await safeStat(path);
  const volumeRoot = externalVolumeRoot(path);
  const volumeOnline = volumeRoot ? Boolean(await safeStat(volumeRoot)) : true;
  let capacityPath: string | null = volumeOnline ? resolve(path) : null;
  while (capacityPath && !(await safeStat(capacityPath))) {
    const parent = dirname(capacityPath);
    if (parent === capacityPath) { capacityPath = null; break; }
    capacityPath = parent;
  }
  let totalBytes: number | null = null;
  let freeBytes: number | null = null;
  let writable = false;

  if (capacityPath) {
    try {
      const fileSystem = await statfs(/* turbopackIgnore: true */ capacityPath);
      totalBytes = Number(fileSystem.blocks) * Number(fileSystem.bsize);
      freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
      if (itemStat && (expectedFile ? !itemStat.isFile() : !itemStat.isDirectory())) throw new Error("Invalid storage root type");
      // Check the actual destination (or its nearest existing parent), not
      // $HOME/the volume root, which can be writable while this folder is not.
      await access(/* turbopackIgnore: true */ capacityPath, constants.W_OK | (itemStat?.isFile() ? 0 : constants.X_OK));
      if (expectedFile && itemStat?.isFile()) await access(/* turbopackIgnore: true */ dirname(resolve(path)), constants.W_OK | constants.X_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }

  const usedPercent = totalBytes && freeBytes !== null ? Math.round((1 - freeBytes / totalBytes) * 1_000) / 10 : null;
  const exists = expectedFile ? Boolean(itemStat?.isFile()) : Boolean(itemStat?.isDirectory());
  const severity = !volumeOnline || !writable ? "danger" : usedPercent !== null && usedPercent >= 90 ? "danger" : usedPercent !== null && usedPercent >= 80 ? "warning" : "ok";

  return {
    zone,
    ...ROOT_LABELS[zone],
    path,
    location: volumeRoot ? "external" : "internal",
    exists,
    online: volumeOnline,
    writable,
    totalBytes,
    freeBytes,
    usedPercent,
    fileSystem: capacityPath ? await mountFileSystem(capacityPath) : null,
    severity
  };
}

export async function readPersistentStorageConfig(configPath = getStorageLayout().configPath) {
  if (!configPath) return null;
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ configPath, "utf8")) as Partial<PersistentStorageConfig>;
    if (
      parsed.version !== 1 ||
      parsed.mode !== "hybrid" ||
      !parsed.databasePath ||
      !parsed.uploadsRoot ||
      !parsed.exportsRoot ||
      !parsed.backupsRoot ||
      !parsed.soundLibraryRoot ||
      !parsed.cacheRoot
    ) {
      return null;
    }
    return parsed as PersistentStorageConfig;
  } catch {
    return null;
  }
}

function layoutMatchesConfig(layout: StorageLayout, config: PersistentStorageConfig | null) {
  return Boolean(
    config &&
      resolve(layout.databasePath) === resolve(config.databasePath) &&
      resolve(layout.uploadsRoot) === resolve(config.uploadsRoot) &&
      resolve(layout.exportsRoot) === resolve(config.exportsRoot) &&
      resolve(layout.backupsRoot) === resolve(config.backupsRoot) &&
      resolve(layout.soundLibraryRoot) === resolve(config.soundLibraryRoot) &&
      resolve(layout.cacheRoot) === resolve(config.cacheRoot)
  );
}

export async function getStorageStatus(layout = getStorageLayout()): Promise<StorageStatus> {
  const roots = await Promise.all([
    rootStatus("database", layout.databasePath),
    rootStatus("uploads", layout.uploadsRoot),
    rootStatus("exports", layout.exportsRoot),
    rootStatus("backups", layout.backupsRoot),
    rootStatus("sounds", layout.soundLibraryRoot),
    rootStatus("cache", layout.cacheRoot)
  ]);
  const pendingConfig = await readPersistentStorageConfig(layout.configPath);
  const restartRequired = Boolean(pendingConfig && !layoutMatchesConfig(layout, pendingConfig));
  const warnings = roots.flatMap((root) => {
    if (!root.online) return [`${root.label}所在磁碟未連接：${root.path}`];
    if (!root.writable) return [`${root.label}目前不可寫入：${root.path}`];
    if (root.usedPercent !== null && root.usedPercent >= 90) return [`${root.label}所在磁碟已使用 ${root.usedPercent}%。`];
    if (root.usedPercent !== null && root.usedPercent >= 80) return [`${root.label}所在磁碟空間偏低，已使用 ${root.usedPercent}%。`];
    return [];
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: layout.mode,
    layout,
    roots,
    pendingConfig,
    restartRequired,
    warnings
  };
}

export function recommendedStorageTargets(current = getStorageLayout()): StorageMigrationTargets {
  const supportRoot = process.env.SONGZU_STORAGE_USER_DATA_ROOT?.trim() || join(homedir(), "Library", "Application Support", "ai-music-os");
  const sourceVolume = externalVolumeRoot(current.dataRoot);
  const mediaRoot = sourceVolume
    ? join(sourceVolume, "頌祖音樂 OS 資料")
    : join(homedir(), "Documents", "頌祖音樂 OS 資料");
  return {
    databasePath: join(supportRoot, "data", "prisma", "dev.db"),
    mediaRoot,
    cacheRoot: join(homedir(), "Library", "Caches", "ai-music-os"),
    configPath: current.configPath || join(supportRoot, "storage.json")
  };
}

function targetLayout(targets: StorageMigrationTargets, current = getStorageLayout()): StorageLayout {
  const mediaRoot = resolve(targets.mediaRoot);
  return {
    mode: "hybrid",
    dataRoot: mediaRoot,
    databasePath: resolve(targets.databasePath),
    uploadsRoot: join(mediaRoot, "uploads"),
    exportsRoot: join(mediaRoot, "exports"),
    backupsRoot: join(mediaRoot, "backups"),
    soundLibraryRoot: join(mediaRoot, "sound-library"),
    cacheRoot: resolve(targets.cacheRoot),
    appAssetsRoot: current.appAssetsRoot,
    configPath: resolve(targets.configPath)
  };
}

async function inventoryDirectory(root: string, ignoredRoots: string[] = []): Promise<Inventory> {
  const rootStat = await safeStat(root);
  if (!rootStat?.isDirectory()) return { files: 0, bytes: 0, skippedLinks: 0 };
  let files = 0;
  let bytes = 0;
  let skippedLinks = 0;

  async function walk(path: string) {
    for (const entry of await readdir(/* turbopackIgnore: true */ path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name);
      if (ignoredRoots.some((ignored) => isInside(ignored, entryPath))) continue;
      const entryStat = await lstat(/* turbopackIgnore: true */ entryPath);
      if (entryStat.isSymbolicLink()) {
        skippedLinks += 1;
      } else if (entryStat.isDirectory()) {
        await walk(entryPath);
      } else if (entryStat.isFile()) {
        files += 1;
        bytes += entryStat.size;
      }
    }
  }

  await walk(root);
  return { files, bytes, skippedLinks };
}

function fileInventory(path: string, fileStat: Awaited<ReturnType<typeof safeStat>>): Inventory {
  return fileStat?.isFile() ? { files: 1, bytes: fileStat.size, skippedLinks: 0 } : { files: 0, bytes: 0, skippedLinks: 0 };
}

export async function buildStorageMigrationPlan(targets: StorageMigrationTargets): Promise<StorageMigrationPlan> {
  for (const [label, path] of Object.entries(targets)) {
    if (!path.trim() || !isAbsolute(path)) throw new Error(`${label} 必須是完整絕對路徑。`);
  }
  const source = getStorageLayout();
  const target = targetLayout(targets, source);
  const ignoredExports = isInside(source.exportsRoot, source.backupsRoot) ? [source.backupsRoot] : [];
  const [databaseStat, uploads, exportsInventory, backups, sounds, targetStatus] = await Promise.all([
    safeStat(source.databasePath),
    inventoryDirectory(source.uploadsRoot),
    inventoryDirectory(source.exportsRoot, ignoredExports),
    inventoryDirectory(source.backupsRoot),
    inventoryDirectory(source.soundLibraryRoot),
    Promise.all([
      rootStatus("database", target.databasePath),
      rootStatus("uploads", target.uploadsRoot),
      rootStatus("exports", target.exportsRoot),
      rootStatus("backups", target.backupsRoot),
      rootStatus("sounds", target.soundLibraryRoot),
      rootStatus("cache", target.cacheRoot)
    ])
  ]);
  const database = fileInventory(source.databasePath, databaseStat);
  const inventories = [database, uploads, exportsInventory, backups, sounds];
  const mediaBytes = uploads.bytes + exportsInventory.bytes + backups.bytes + sounds.bytes;
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!database.files) blockers.push(`找不到來源資料庫：${source.databasePath}`);
  if (isInside(target.dataRoot, target.databasePath)) warnings.push("資料庫仍位於媒體磁碟內，無法獲得混合式架構的完整保護。");
  if (isInside(target.dataRoot, target.cacheRoot)) warnings.push("快取位於外接媒體根目錄，拔除磁碟時背景工作會中斷。");
  const mediaStatus = targetStatus.find((item) => item.zone === "uploads");
  const databaseStatus = targetStatus.find((item) => item.zone === "database");
  if (!mediaStatus?.online || !mediaStatus.writable) blockers.push(`媒體目標不可用：${target.dataRoot}`);
  if (!databaseStatus?.online || !databaseStatus.writable) blockers.push(`資料庫目標不可用：${target.databasePath}`);
  if (mediaStatus?.freeBytes !== null && mediaStatus?.freeBytes !== undefined && mediaStatus.freeBytes < mediaBytes * 1.1) {
    blockers.push("外接磁碟剩餘空間不足以建立安全副本與 10% 緩衝。");
  }
  if (databaseStatus?.freeBytes !== null && databaseStatus?.freeBytes !== undefined && databaseStatus.freeBytes < database.bytes * 3 + 32 * 1024 * 1024) {
    blockers.push("Mac 內建磁碟空間不足以建立資料庫快照與回復副本。");
  }
  const skippedLinks = inventories.reduce((total, item) => total + item.skippedLinks, 0);
  if (skippedLinks) warnings.push(`${skippedLinks} 個符號連結不會被當成原始檔搬移。`);
  if (resolve(source.uploadsRoot) === resolve(target.uploadsRoot)) warnings.push("uploads 已在目標位置，會做雜湊檢查但不重複複製。");

  return {
    source,
    target,
    configPath: resolve(targets.configPath),
    inventory: {
      database,
      uploads,
      exports: exportsInventory,
      backups,
      sounds,
      totalFiles: inventories.reduce((total, item) => total + item.files, 0),
      totalBytes: inventories.reduce((total, item) => total + item.bytes, 0),
      mediaBytes
    },
    targetStatus,
    steps: [
      "建立目標資料夾與遷移日誌",
      "逐檔複製 uploads、exports、音色與既有備份",
      "重新讀取來源與目標並比對 SHA-256",
      "用 SQLite VACUUM INTO 建立一致性資料庫快照",
      "只在新快照重寫音檔與音色路徑",
      "執行 integrity_check、foreign_key_check 與受保護音檔驗證",
      "原子寫入 storage.json，重新啟動後切換",
      "保留全部舊資料，確認穩定後再由使用者決定是否封存"
    ],
    warnings,
    blockers,
    ready: blockers.length === 0
  };
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(/* turbopackIgnore: true */ path)) hash.update(chunk);
  return hash.digest("hex");
}

type CopySummary = { files: number; skipped: number; bytes: number };

async function copyFileVerified(source: string, target: string): Promise<{ copied: boolean; bytes: number }> {
  const sourceStat = await stat(/* turbopackIgnore: true */ source);
  const targetStat = await safeStat(target);
  const sourceHash = await hashFile(source);
  if (targetStat?.isFile() && targetStat.size === sourceStat.size && (await hashFile(target)) === sourceHash) {
    return { copied: false, bytes: sourceStat.size };
  }
  if (targetStat) throw new Error(`目標已有不同內容，為避免覆蓋已停止：${target}`);

  await mkdir(dirname(target), { recursive: true });
  const partialPath = `${target}.songzu-part-${randomUUID()}`;
  try {
    await copyFile(/* turbopackIgnore: true */ source, partialPath, constants.COPYFILE_EXCL);
    const targetHash = await hashFile(partialPath);
    if (sourceHash !== targetHash) throw new Error(`SHA-256 驗證失敗：${basename(source)}`);
    await rename(partialPath, target);
    await utimes(target, sourceStat.atime, sourceStat.mtime).catch(() => undefined);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { copied: true, bytes: sourceStat.size };
}

async function copyTreeVerified(sourceRoot: string, targetRoot: string, ignoredRoots: string[] = []): Promise<CopySummary> {
  if (resolve(sourceRoot) === resolve(targetRoot)) return { files: 0, skipped: 0, bytes: 0 };
  const sourceStat = await safeStat(sourceRoot);
  if (!sourceStat?.isDirectory()) return { files: 0, skipped: 0, bytes: 0 };
  const summary: CopySummary = { files: 0, skipped: 0, bytes: 0 };

  async function walk(path: string) {
    for (const entry of await readdir(/* turbopackIgnore: true */ path, { withFileTypes: true })) {
      const sourcePath = join(path, entry.name);
      if (ignoredRoots.some((ignored) => isInside(ignored, sourcePath))) continue;
      const entryStat = await lstat(/* turbopackIgnore: true */ sourcePath);
      if (entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) {
        await walk(sourcePath);
        continue;
      }
      if (!entryStat.isFile()) continue;
      const relativePath = relative(sourceRoot, sourcePath);
      const result = await copyFileVerified(sourcePath, join(targetRoot, relativePath));
      summary.bytes += result.bytes;
      if (result.copied) summary.files += 1;
      else summary.skipped += 1;
    }
  }

  await mkdir(targetRoot, { recursive: true });
  await walk(sourceRoot);
  return summary;
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const partialPath = `${path}.songzu-part-${randomUUID()}`;
  await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(partialPath, path);
}

async function buildDatabaseSnapshot(source: StorageLayout, target: StorageLayout, migrationId: string) {
  await mkdir(dirname(target.databasePath), { recursive: true });
  const requestPath = join(dirname(target.databasePath), `.storage-worker-${migrationId}.json`);
  const workerPath =
    process.env.SONGZU_STORAGE_MIGRATION_WORKER?.trim() ||
    join(getStorageLayout().appAssetsRoot, "scripts", "storage-migration-worker.mjs");
  await writeFile(requestPath, `${JSON.stringify({ source, target, migrationId })}\n`, { flag: "wx" });
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [workerPath, requestPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout) as StorageMigrationResult["database"];
  } finally {
    await rm(requestPath, { force: true }).catch(() => undefined);
  }
}

function addSummary(target: CopySummary, value: CopySummary) {
  target.files += value.files;
  target.skipped += value.skipped;
  target.bytes += value.bytes;
}

export async function executeStorageMigration(targets: StorageMigrationTargets): Promise<StorageMigrationResult> {
  const plan = await buildStorageMigrationPlan(targets);
  if (!plan.ready) throw new Error(plan.blockers.join(" "));
  const migrationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const journalPath = join(plan.target.backupsRoot, "migration-records", `migration-${migrationId}.json`);
  const copied: CopySummary = { files: 0, skipped: 0, bytes: 0 };
  const journal = {
    format: "songzu-storage-migration",
    version: 1,
    migrationId,
    status: "copying",
    startedAt,
    source: plan.source,
    target: plan.target,
    inventory: plan.inventory,
    oldDataRetained: true
  };

  await mkdir(plan.target.backupsRoot, { recursive: true });
  await writeJsonAtomic(journalPath, journal);
  try {
    const ignoredExports = isInside(plan.source.exportsRoot, plan.source.backupsRoot) ? [plan.source.backupsRoot] : [];
    addSummary(copied, await copyTreeVerified(plan.source.uploadsRoot, plan.target.uploadsRoot));
    addSummary(copied, await copyTreeVerified(plan.source.exportsRoot, plan.target.exportsRoot, ignoredExports));
    addSummary(copied, await copyTreeVerified(plan.source.backupsRoot, plan.target.backupsRoot));
    addSummary(copied, await copyTreeVerified(plan.source.soundLibraryRoot, plan.target.soundLibraryRoot));
    addSummary(
      copied,
      await copyTreeVerified(join(plan.source.dataRoot, ".local-ssl"), join(dirname(plan.configPath), ".local-ssl"))
    );
    await mkdir(plan.target.cacheRoot, { recursive: true });

    const database = await buildDatabaseSnapshot(plan.source, plan.target, migrationId);
    const completedAt = new Date().toISOString();
    const config: PersistentStorageConfig = {
      version: 1,
      mode: "hybrid",
      dataRoot: plan.target.dataRoot,
      databasePath: plan.target.databasePath,
      uploadsRoot: plan.target.uploadsRoot,
      exportsRoot: plan.target.exportsRoot,
      backupsRoot: plan.target.backupsRoot,
      soundLibraryRoot: plan.target.soundLibraryRoot,
      cacheRoot: plan.target.cacheRoot,
      legacyRoot: plan.source.dataRoot,
      createdAt: startedAt,
      updatedAt: completedAt,
      migrationId
    };
    await writeJsonAtomic(plan.configPath, config);
    const result: StorageMigrationResult = {
      migrationId,
      status: "ready_to_restart",
      startedAt,
      completedAt,
      configPath: plan.configPath,
      target: plan.target,
      copied,
      database,
      journalPath,
      oldDataRetained: true,
      restartRequired: true
    };
    await writeFile(journalPath, `${JSON.stringify({ ...journal, ...result, status: "ready_to_restart" }, null, 2)}\n`);
    return result;
  } catch (error) {
    await writeFile(
      journalPath,
      `${JSON.stringify({ ...journal, status: "failed", failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), copied }, null, 2)}\n`
    ).catch(() => undefined);
    throw error;
  }
}
