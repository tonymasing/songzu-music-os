import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV19HealthSnapshotBigInt } from "./v19-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_UPGRADE_DB_PATH || join(__dirname, "dev.db");

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
ensureV19HealthSnapshotBigInt(db);
db.close();

console.log(`upgrade-v19 完成：${dbPath} 的磁碟健康容量已升級為 64-bit，原有快照完整保留。`);
