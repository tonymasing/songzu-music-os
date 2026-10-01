import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV20FormalScoreReleases } from "./v20-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_UPGRADE_DB_PATH || join(__dirname, "dev.db");

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
ensureV20FormalScoreReleases(db);
db.close();

console.log(`upgrade-v20 完成：${dbPath} 已加入不可變正式譜版本資料表。`);
