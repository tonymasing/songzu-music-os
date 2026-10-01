const createHealthSnapshotTable = `
CREATE TABLE IF NOT EXISTS "DawEngineHealthSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "recordingId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'healthy',
  "peak" REAL NOT NULL DEFAULT 0,
  "rms" REAL NOT NULL DEFAULT 0,
  "truePeak" REAL,
  "clipping" BOOLEAN NOT NULL DEFAULT false,
  "xrunCount" INTEGER NOT NULL DEFAULT 0,
  "inputOverflowCount" INTEGER NOT NULL DEFAULT 0,
  "outputUnderflowCount" INTEGER NOT NULL DEFAULT 0,
  "diskWriteErrorCount" INTEGER NOT NULL DEFAULT 0,
  "callbackLoad" REAL NOT NULL DEFAULT 0,
  "freeDiskBytes" BIGINT,
  "detailsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DawEngineHealthSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);`;

const healthSnapshotIndexes = `
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_projectId_idx" ON "DawEngineHealthSnapshot"("projectId");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_recordingId_idx" ON "DawEngineHealthSnapshot"("recordingId");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_status_idx" ON "DawEngineHealthSnapshot"("status");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_createdAt_idx" ON "DawEngineHealthSnapshot"("createdAt");`;

export const v19SchemaSql = `${createHealthSnapshotTable}\n${healthSnapshotIndexes}`;

export function ensureV19HealthSnapshotBigInt(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'DawEngineHealthSnapshot'").get();
  if (!table) {
    db.exec(v19SchemaSql);
    return;
  }

  const column = db.prepare('PRAGMA table_info("DawEngineHealthSnapshot")').all().find((item) => item.name === "freeDiskBytes");
  if (String(column?.type || "").toUpperCase() === "BIGINT") {
    db.exec(healthSnapshotIndexes);
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS "DawEngineHealthSnapshot_v19";
CREATE TABLE "DawEngineHealthSnapshot_v19" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "recordingId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'healthy',
  "peak" REAL NOT NULL DEFAULT 0,
  "rms" REAL NOT NULL DEFAULT 0,
  "truePeak" REAL,
  "clipping" BOOLEAN NOT NULL DEFAULT false,
  "xrunCount" INTEGER NOT NULL DEFAULT 0,
  "inputOverflowCount" INTEGER NOT NULL DEFAULT 0,
  "outputUnderflowCount" INTEGER NOT NULL DEFAULT 0,
  "diskWriteErrorCount" INTEGER NOT NULL DEFAULT 0,
  "callbackLoad" REAL NOT NULL DEFAULT 0,
  "freeDiskBytes" BIGINT,
  "detailsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DawEngineHealthSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "DawEngineHealthSnapshot_v19" (
  "id", "projectId", "recordingId", "status", "peak", "rms", "truePeak", "clipping",
  "xrunCount", "inputOverflowCount", "outputUnderflowCount", "diskWriteErrorCount",
  "callbackLoad", "freeDiskBytes", "detailsJson", "createdAt"
)
SELECT
  "id", "projectId", "recordingId", "status", "peak", "rms", "truePeak", "clipping",
  "xrunCount", "inputOverflowCount", "outputUnderflowCount", "diskWriteErrorCount",
  "callbackLoad", "freeDiskBytes", "detailsJson", "createdAt"
FROM "DawEngineHealthSnapshot";
DROP TABLE "DawEngineHealthSnapshot";
ALTER TABLE "DawEngineHealthSnapshot_v19" RENAME TO "DawEngineHealthSnapshot";
COMMIT;
`);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already have rolled back.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  db.exec(healthSnapshotIndexes);
}
