export function ensureV18Columns(db) {
  const columns = [
    ["DawTrack", "inputSource", "TEXT"],
    ["DawTrack", "outputTarget", "TEXT NOT NULL DEFAULT 'master'"],
    ["DawTrack", "polarityInverted", "BOOLEAN NOT NULL DEFAULT false"],
    ["DawTrack", "stereoMode", "TEXT NOT NULL DEFAULT 'stereo'"],
    ["DawClip", "groupId", "TEXT"],
    ["DawClip", "zeroCrossingAdjusted", "BOOLEAN NOT NULL DEFAULT false"],
    ["DawClip", "crossfadeGroupId", "TEXT"]
  ];

  for (const [table, column, definition] of columns) {
    const existing = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (!existing.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
  }
}

export const v18SchemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "DawTakeCompSegment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "takeLaneId" TEXT NOT NULL,
  "sourceStartSeconds" REAL NOT NULL,
  "sourceEndSeconds" REAL NOT NULL,
  "timelineStartSeconds" REAL NOT NULL,
  "fadeInSeconds" REAL NOT NULL DEFAULT 0.01,
  "fadeOutSeconds" REAL NOT NULL DEFAULT 0.01,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawTakeCompSegment_takeLaneId_fkey" FOREIGN KEY ("takeLaneId") REFERENCES "DawTakeLane" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DawLatencyProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "inputDeviceName" TEXT NOT NULL,
  "outputDeviceName" TEXT NOT NULL,
  "sampleRate" INTEGER NOT NULL,
  "bufferFrames" INTEGER NOT NULL,
  "measuredRoundTripMs" REAL NOT NULL,
  "inputLatencyMs" REAL,
  "outputLatencyMs" REAL,
  "compensationMs" REAL NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'acoustic_loopback',
  "confidence" REAL NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "measurementJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawLatencyProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS "DawEditOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "groupId" TEXT,
  "operationType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "label" TEXT NOT NULL,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'APPLIED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" DATETIME,
  CONSTRAINT "DawEditOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DawRoute" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sourceTrackId" TEXT,
  "destinationTrackId" TEXT,
  "routeType" TEXT NOT NULL DEFAULT 'output',
  "name" TEXT NOT NULL,
  "preFader" BOOLEAN NOT NULL DEFAULT false,
  "gain" REAL NOT NULL DEFAULT 1,
  "pan" REAL NOT NULL DEFAULT 0,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawRoute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DawRoute_sourceTrackId_fkey" FOREIGN KEY ("sourceTrackId") REFERENCES "DawTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DawRoute_destinationTrackId_fkey" FOREIGN KEY ("destinationTrackId") REFERENCES "DawTrack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DawAutomationLane" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trackId" TEXT NOT NULL,
  "parameter" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'read',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minValue" REAL NOT NULL DEFAULT 0,
  "maxValue" REAL NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawAutomationLane_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "DawTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DawAutomationPoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "laneId" TEXT NOT NULL,
  "timeSeconds" REAL NOT NULL,
  "value" REAL NOT NULL,
  "curve" TEXT NOT NULL DEFAULT 'linear',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawAutomationPoint_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "DawAutomationLane" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "DawRecoveryEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "DawRecoveryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DawClip_groupId_idx" ON "DawClip"("groupId");
CREATE INDEX IF NOT EXISTS "DawClip_crossfadeGroupId_idx" ON "DawClip"("crossfadeGroupId");
CREATE INDEX IF NOT EXISTS "DawTakeCompSegment_takeLaneId_idx" ON "DawTakeCompSegment"("takeLaneId");
CREATE INDEX IF NOT EXISTS "DawTakeCompSegment_timelineStartSeconds_idx" ON "DawTakeCompSegment"("timelineStartSeconds");
CREATE INDEX IF NOT EXISTS "DawLatencyProfile_projectId_idx" ON "DawLatencyProfile"("projectId");
CREATE INDEX IF NOT EXISTS "DawLatencyProfile_inputDeviceName_outputDeviceName_idx" ON "DawLatencyProfile"("inputDeviceName", "outputDeviceName");
CREATE INDEX IF NOT EXISTS "DawLatencyProfile_sampleRate_bufferFrames_idx" ON "DawLatencyProfile"("sampleRate", "bufferFrames");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_projectId_idx" ON "DawEngineHealthSnapshot"("projectId");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_recordingId_idx" ON "DawEngineHealthSnapshot"("recordingId");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_status_idx" ON "DawEngineHealthSnapshot"("status");
CREATE INDEX IF NOT EXISTS "DawEngineHealthSnapshot_createdAt_idx" ON "DawEngineHealthSnapshot"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "DawEditOperation_projectId_sequence_key" ON "DawEditOperation"("projectId", "sequence");
CREATE INDEX IF NOT EXISTS "DawEditOperation_projectId_status_idx" ON "DawEditOperation"("projectId", "status");
CREATE INDEX IF NOT EXISTS "DawEditOperation_groupId_idx" ON "DawEditOperation"("groupId");
CREATE INDEX IF NOT EXISTS "DawRoute_projectId_idx" ON "DawRoute"("projectId");
CREATE INDEX IF NOT EXISTS "DawRoute_sourceTrackId_idx" ON "DawRoute"("sourceTrackId");
CREATE INDEX IF NOT EXISTS "DawRoute_destinationTrackId_idx" ON "DawRoute"("destinationTrackId");
CREATE INDEX IF NOT EXISTS "DawRoute_routeType_idx" ON "DawRoute"("routeType");
CREATE UNIQUE INDEX IF NOT EXISTS "DawAutomationLane_trackId_parameter_key" ON "DawAutomationLane"("trackId", "parameter");
CREATE INDEX IF NOT EXISTS "DawAutomationLane_trackId_idx" ON "DawAutomationLane"("trackId");
CREATE INDEX IF NOT EXISTS "DawAutomationLane_mode_idx" ON "DawAutomationLane"("mode");
CREATE INDEX IF NOT EXISTS "DawAutomationPoint_laneId_idx" ON "DawAutomationPoint"("laneId");
CREATE INDEX IF NOT EXISTS "DawAutomationPoint_timeSeconds_idx" ON "DawAutomationPoint"("timeSeconds");
CREATE UNIQUE INDEX IF NOT EXISTS "DawRecoveryEntry_projectId_sessionId_sequence_key" ON "DawRecoveryEntry"("projectId", "sessionId", "sequence");
CREATE INDEX IF NOT EXISTS "DawRecoveryEntry_projectId_status_idx" ON "DawRecoveryEntry"("projectId", "status");
CREATE INDEX IF NOT EXISTS "DawRecoveryEntry_sessionId_idx" ON "DawRecoveryEntry"("sessionId");
CREATE INDEX IF NOT EXISTS "DawRecoveryEntry_createdAt_idx" ON "DawRecoveryEntry"("createdAt");
`;
