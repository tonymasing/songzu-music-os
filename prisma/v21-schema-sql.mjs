function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info("${tableName}")`).all().map((column) => column.name));
}

export function ensureV21FormalScoreReleaseManifest(db) {
  const columns = tableColumns(db, "DawScoreRelease");
  if (!columns.has("contentHashVersion")) {
    db.exec(`ALTER TABLE "DawScoreRelease" ADD COLUMN "contentHashVersion" TEXT NOT NULL DEFAULT 'songzu_formal_score_v2'`);
  }
  if (!columns.has("textSha256")) {
    db.exec(`ALTER TABLE "DawScoreRelease" ADD COLUMN "textSha256" TEXT`);
  }
  if (!columns.has("pdfSha256")) {
    db.exec(`ALTER TABLE "DawScoreRelease" ADD COLUMN "pdfSha256" TEXT`);
  }
  if (!columns.has("artifactGeneratedAt")) {
    db.exec(`ALTER TABLE "DawScoreRelease" ADD COLUMN "artifactGeneratedAt" DATETIME`);
  }
}
