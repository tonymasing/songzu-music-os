import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV21FormalScoreReleaseManifest } from "./v21-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_UPGRADE_DB_PATH || join(__dirname, "dev.db");

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
ensureV21FormalScoreReleaseManifest(db);
db.close();

console.log(`upgrade-v21 完成：${dbPath} 已加入正式譜內容版本與 TXT/PDF 產物雜湊。`);
