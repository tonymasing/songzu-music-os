import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV18Columns, v18SchemaSql } from "./v18-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_UPGRADE_DB_PATH || join(__dirname, "dev.db");

if (!existsSync(dbPath)) {
  console.error(`找不到資料庫：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
ensureV18Columns(db);
db.exec(v18SchemaSql);
db.close();

console.log(`upgrade-v18 完成：${dbPath} 已加入專業錄音可信層、Comp、路由、Automation 與復原紀錄。`);
