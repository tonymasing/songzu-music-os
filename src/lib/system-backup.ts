import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import { storagePath } from "@/lib/paths";
import { acquireLocalOperationLock } from "@/lib/local-operation-lock";
import { createSqliteSnapshot } from "@/lib/sqlite-snapshot";

export type SystemBackupRecord = {
  fileName: string;
  fileSizeBytes: number;
  createdAt: string;
  sha256: string | null;
  downloadUrl: string;
};

type BackupManifest = {
  format: "songzu-system-backup";
  version: 2;
  createdAt: string;
  includes: string[];
  excluded: string[];
  inventory: {
    databaseBytes: number;
    uploadFiles: number;
    uploadBytes: number;
    exportFiles: number;
    exportBytes: number;
    soundFiles: number;
    soundBytes: number;
  };
};

const backupDirectory = () => storagePath("backups");
const mediaSources = [
  ["uploads", "uploads", "原始音檔資料夾"],
  ["exports", "exports", "輸出檔資料夾"],
  ["sounds", "sound-library", "音色庫資料夾"]
] as const;

async function requireMediaDirectory(source: string, label: string) {
  try {
    if (!(await stat(source)).isDirectory()) throw new Error("來源不是資料夾");
    await access(source, constants.R_OK | constants.X_OK);
    return await realpath(source);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "來源不存在或磁碟尚未連接"
      : code === "EACCES" || code === "EPERM" ? "沒有讀取來源的權限"
        : code === "ENOTDIR" ? "來源路徑不是資料夾"
          : error instanceof Error ? error.message : "無法讀取來源";
    throw new Error(`無法建立全站備份：${label}（${source}）${reason}。請確認儲存設定與磁碟連線後再試；未產生備份包。`);
  }
}

async function pathStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function isInside(root: string, path: string) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(fromRoot));
}

async function stageMedia(path: string, target: string, ignoredRoot: string): Promise<{ files: number; bytes: number }> {
  await mkdir(target, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (isInside(ignoredRoot, entryPath)) continue;
    const destination = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`資料目錄內含符號連結，請先確認來源後再備份：${entryPath}`);
    if (entry.isDirectory()) {
      const child = await stageMedia(entryPath, destination, ignoredRoot);
      files += child.files;
      bytes += child.bytes;
    } else if (entry.isFile()) {
      const before = await lstat(entryPath);
      if (!before.isFile()) throw new Error(`備份來源已變更：${entryPath}`);
      await copyFile(entryPath, destination, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      const after = await lstat(entryPath);
      if (!after.isFile() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new Error(`備份期間檔案仍在寫入，未發佈不完整備份：${entryPath}`);
      }
      files += 1;
      bytes += before.size;
    }
  }
  return { files, bytes };
}

const runArchiveCommand = promisify(execFile);
const archiveOptions = { timeout: 30 * 60_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" as const };

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sidecarPath(zipPath: string) {
  return `${zipPath}.json`;
}

export async function listSystemBackups(): Promise<SystemBackupRecord[]> {
  const directory = backupDirectory();
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".zip"))
      .map(async (entry) => {
        const filePath = join(directory, entry.name);
        const info = await stat(filePath);
        let sha256: string | null = null;
        try {
          const sidecar = JSON.parse(await readFile(sidecarPath(filePath), "utf8")) as { sha256?: string };
          sha256 = sidecar.sha256 ?? null;
        } catch {
          sha256 = null;
        }
        return {
          fileName: entry.name,
          fileSizeBytes: info.size,
          createdAt: info.mtime.toISOString(),
          sha256,
          downloadUrl: `/api/system/backup?file=${encodeURIComponent(entry.name)}`
        };
      })
  );
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createSystemBackup(): Promise<SystemBackupRecord> {
  // Every media zone has a resolved root in the storage contract, including
  // fresh installations. Empty directories are valid; missing roots are not.
  // Check before mkdir: the default backup folder lives inside exports, so
  // creating it first could conceal a missing media root as an empty one.
  const sources = await Promise.all(mediaSources.map(async ([zone, archiveName, label]) => ({
    archiveName,
    canonicalSource: await requireMediaDirectory(resolve(storagePath(zone)), label)
  })));
  const directory = resolve(backupDirectory());
  await mkdir(directory, { recursive: true });
  const canonicalDirectory = await realpath(directory);
  const release = acquireLocalOperationLock(`system-backup:${canonicalDirectory}`);
  if (!release) throw new Error("系統備份正在建立，沒有啟動重複工作。");
  let stagingRoot: string | undefined;
  let metadataPath: string | undefined;
  let published = false;
  try {
    const dbPath = resolve(storagePath("database"));
    if (!(await pathStat(dbPath))?.isFile()) throw new Error("找不到資料庫；未建立不完整的系統備份。");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `songzu-music-os-backup-${stamp}-${randomUUID().slice(0, 8)}.zip`;
    const outputPath = join(directory, fileName);
    // Keep incomplete artifacts off the download list and on the same volume
    // as publication, so the final rename is atomic even with external storage.
    stagingRoot = await mkdtemp(join(directory, ".pending-"));
    const pendingZip = join(stagingRoot, "archive.zip");
    await mkdir(join(stagingRoot, "prisma"));
    const snapshotPath = join(stagingRoot, "prisma", "dev.db");
    await createSqliteSnapshot(dbPath, snapshotPath);
    const includes = ["prisma/dev.db"];
    const excluded: string[] = [];
    const inventories: Array<{ files: number; bytes: number }> = [];
    for (const { archiveName, canonicalSource } of sources) {
      if (isInside(canonicalDirectory, canonicalSource)) throw new Error("備份目錄不能與資料來源相同或包含資料來源。");
      if (isInside(canonicalSource, canonicalDirectory)) {
        excluded.push(`${archiveName}/${relative(canonicalSource, canonicalDirectory).replaceAll("\\", "/")}`);
      }
      inventories.push(await stageMedia(canonicalSource, join(stagingRoot, archiveName), canonicalDirectory));
      includes.push(archiveName);
    }
    const [uploads, exportsInventory, sounds] = inventories;
    const manifest: BackupManifest = {
      format: "songzu-system-backup", version: 2, createdAt: new Date().toISOString(), includes, excluded,
      inventory: {
        databaseBytes: (await stat(snapshotPath)).size,
        uploadFiles: uploads.files, uploadBytes: uploads.bytes,
        exportFiles: exportsInventory.files, exportBytes: exportsInventory.bytes,
        soundFiles: sounds.files, soundBytes: sounds.bytes
      }
    };
    await writeFile(join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await runArchiveCommand("/usr/bin/zip", ["-q", "-r", pendingZip, "manifest.json", ...includes], { ...archiveOptions, cwd: stagingRoot });
    await runArchiveCommand("/usr/bin/unzip", ["-tqq", pendingZip], archiveOptions);
    const sha256 = await hashFile(pendingZip);
    const handle = await open(pendingZip, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    const info = await stat(pendingZip);
    metadataPath = sidecarPath(outputPath);
    await writeFile(metadataPath, `${JSON.stringify({ sha256, manifest }, null, 2)}\n`, { flag: "wx" });
    await rename(pendingZip, outputPath);
    published = true;
    return { fileName, fileSizeBytes: info.size, createdAt: info.mtime.toISOString(), sha256, downloadUrl: `/api/system/backup?file=${encodeURIComponent(fileName)}` };
  } finally {
    if (!published && metadataPath) await rm(metadataPath, { force: true }).catch(() => undefined);
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    release();
  }
}

export async function openSystemBackup(fileName: string) {
  const safeName = basename(fileName);
  if (safeName !== fileName || safeName.startsWith(".") || !safeName.endsWith(".zip")) return null;
  const filePath = join(backupDirectory(), safeName);
  const info = await pathStat(filePath);
  if (!info?.isFile()) return null;
  return {
    size: info.size,
    stream: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
  };
}
