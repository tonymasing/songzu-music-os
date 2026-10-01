export const v20SchemaSql = `
CREATE TABLE IF NOT EXISTS "DawScoreRelease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scoreDraftId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "formalContentSha256" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "releasedAt" DATETIME NOT NULL,
  "releasedBy" TEXT NOT NULL,
  "confirmationEvidenceJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DawScoreRelease_scoreDraftId_fkey" FOREIGN KEY ("scoreDraftId") REFERENCES "DawScoreDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DawScoreRelease_scoreDraftId_revision_key" ON "DawScoreRelease"("scoreDraftId", "revision");
CREATE INDEX IF NOT EXISTS "DawScoreRelease_scoreDraftId_releasedAt_idx" ON "DawScoreRelease"("scoreDraftId", "releasedAt");
CREATE INDEX IF NOT EXISTS "DawScoreRelease_formalContentSha256_idx" ON "DawScoreRelease"("formalContentSha256");
`;

export function ensureV20FormalScoreReleases(db) {
  db.exec(v20SchemaSql);
}
