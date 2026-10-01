import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

function hashFile(path) {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      resolve(hash.digest("hex"));
    } catch (error) {
      reject(error);
    }
  });
}

function numberValue(row, key) {
  const value = row[key];
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

async function run({ source, target, migrationId }) {
  mkdirSync(dirname(target.databasePath), { recursive: true });
  const temporaryPath = `${target.databasePath}.songzu-part-${migrationId}`;
  rmSync(temporaryPath, { force: true });
  const sourceSha256 = await hashFile(source.databasePath);
  const sourceDb = new DatabaseSync(source.databasePath, { readOnly: true });
  let sourceSongs = 0;
  let sourceAudioFiles = 0;
  try {
    sourceSongs = numberValue(sourceDb.prepare('SELECT count(*) AS count FROM "Song"').get(), "count");
    sourceAudioFiles = numberValue(sourceDb.prepare('SELECT count(*) AS count FROM "AudioFile"').get(), "count");
    sourceDb.exec(`VACUUM INTO '${temporaryPath.replaceAll("'", "''")}'`);
  } finally {
    sourceDb.close();
  }

  const targetDb = new DatabaseSync(temporaryPath);
  let rewrittenAudioPaths = 0;
  let rewrittenSoundPaths = 0;
  let verifiedProtectedFiles = 0;
  try {
    targetDb.exec("PRAGMA foreign_keys = ON");
    const canonicalUploadsRoot = realpathSync(source.uploadsRoot);
    const audioRows = targetDb.prepare('SELECT "id", "filePath" FROM "AudioFile" WHERE "filePath" IS NOT NULL').all();
    const updateAudioPath = targetDb.prepare('UPDATE "AudioFile" SET "filePath" = @filePath WHERE "id" = @id');
    for (const row of audioRows) {
      if (!existsSync(row.filePath)) continue;
      const canonicalFilePath = realpathSync(row.filePath);
      const relativePath = relative(canonicalUploadsRoot, canonicalFilePath);
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
      const targetPath = join(target.uploadsRoot, relativePath);
      if (!existsSync(targetPath)) throw new Error(`已辨識的上傳原檔尚未複製到新位置：${targetPath}`);
      rewrittenAudioPaths += Number(updateAudioPath.run({ id: row.id, filePath: targetPath }).changes);
    }
    const soundAssetResult = targetDb
      .prepare(
        `UPDATE "SoundLibraryItem"
         SET "assetPath" = '/api/sound-assets/' || substr("assetPath", length('/sound-assets/') + 1)
         WHERE "assetPath" LIKE '/sound-assets/%'`
      )
      .run();
    const soundPreviewResult = targetDb
      .prepare(
        `UPDATE "SoundLibraryItem"
         SET "previewPath" = '/api/sound-assets/' || substr("previewPath", length('/sound-assets/') + 1)
         WHERE "previewPath" LIKE '/sound-assets/%'`
      )
      .run();
    rewrittenSoundPaths = Number(soundAssetResult.changes) + Number(soundPreviewResult.changes);

    const integrity = targetDb.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error(`新資料庫完整性檢查失敗：${String(integrity.integrity_check)}`);
    const foreignKeys = targetDb.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error(`新資料庫有 ${foreignKeys.length} 個外鍵問題。`);
    const targetSongs = numberValue(targetDb.prepare('SELECT count(*) AS count FROM "Song"').get(), "count");
    const targetAudioFiles = numberValue(targetDb.prepare('SELECT count(*) AS count FROM "AudioFile"').get(), "count");
    if (targetSongs !== sourceSongs || targetAudioFiles !== sourceAudioFiles) throw new Error("資料庫快照筆數與來源不一致。");

    const protectedRows = targetDb
      .prepare(
        `SELECT "filePath", "sha256"
         FROM "AudioFile"
         WHERE "isProtectedOriginal" = 1 AND "filePath" LIKE @targetLike`
      )
      .all({ targetLike: `${target.uploadsRoot}/%` });
    for (const row of protectedRows) {
      if (!existsSync(row.filePath)) throw new Error(`新資料庫指向的受保護原檔不存在：${row.filePath}`);
      if (row.sha256 && (await hashFile(row.filePath)) !== row.sha256) throw new Error(`受保護原檔與資料庫 SHA-256 不符：${row.filePath}`);
      verifiedProtectedFiles += 1;
    }
  } finally {
    targetDb.close();
  }

  const previousPath = `${target.databasePath}.before-${migrationId}.bak`;
  if (existsSync(target.databasePath)) renameSync(target.databasePath, previousPath);
  renameSync(temporaryPath, target.databasePath);
  return {
    sourceSha256,
    targetSha256: await hashFile(target.databasePath),
    songs: sourceSongs,
    audioFiles: sourceAudioFiles,
    rewrittenAudioPaths,
    rewrittenSoundPaths,
    verifiedProtectedFiles
  };
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error("缺少儲存搬移 worker 輸入檔。");
const result = await run(JSON.parse(readFileSync(inputPath, "utf8")));
process.stdout.write(`${JSON.stringify(result)}\n`);
