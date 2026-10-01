import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV17Columns, v17SchemaSql } from "./v17-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_UPGRADE_DB_PATH || join(__dirname, "dev.db");

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
ensureV17Columns(db);
db.exec(v17SchemaSql);
db.close();

console.log(`upgrade-v17 完成：${dbPath} 已加入音樂智慧核心、插件、自動化、權利與成效資料層。`);
