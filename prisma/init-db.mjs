import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureV17Columns, v17SchemaSql } from "./v17-schema-sql.mjs";
import { ensureV18Columns, v18SchemaSql } from "./v18-schema-sql.mjs";
import { ensureV19HealthSnapshotBigInt } from "./v19-schema-sql.mjs";
import { ensureV20FormalScoreReleases } from "./v20-schema-sql.mjs";
import { ensureV21FormalScoreReleaseManifest } from "./v21-schema-sql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SONGZU_INIT_DB_PATH ? resolve(process.env.SONGZU_INIT_DB_PATH) : join(__dirname, "dev.db");

function pathPresent(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

const sidecars = [dbPath + "-wal", dbPath + "-shm", dbPath + "-journal"];
if ([dbPath, ...sidecars].some(pathPresent)) {
  throw new Error("資料庫或復原檔已存在，已停止初始化以保留作品。更新結構請使用資料庫升級指令。");
}
mkdirSync(dirname(dbPath), { recursive: true });
// Reserve a new path exclusively; a second initializer cannot overwrite it.
closeSync(openSync(dbPath, "wx"));
if (sidecars.some(pathPresent)) throw new Error("發現資料庫復原檔，已停止初始化。");
const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE "Song" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "workingTitle" TEXT,
  "status" TEXT NOT NULL DEFAULT 'IDEA',
  "bpm" INTEGER,
  "musicalKey" TEXT,
  "genre" TEXT,
  "subgenre" TEXT,
  "language" TEXT DEFAULT 'zh-TW',
  "moodJson" TEXT,
  "summary" TEXT,
  "notes" TEXT,
  "createdOn" DATETIME,
  "targetReleaseDate" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "LyricsVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "versionName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sectionsJson" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LyricsVersion_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AudioFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT,
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "fileType" TEXT NOT NULL,
  "versionName" TEXT,
  "fileSizeBytes" INTEGER,
  "sha256" TEXT,
  "originalFileName" TEXT,
  "mimeType" TEXT,
  "codecName" TEXT,
  "containerFormat" TEXT,
  "sourceKind" TEXT NOT NULL DEFAULT 'external_path',
  "parentAudioFileId" TEXT,
  "originGarageBandLogId" TEXT,
  "qualityStatus" TEXT NOT NULL DEFAULT 'pending',
  "isProtectedOriginal" BOOLEAN NOT NULL DEFAULT true,
  "durationSeconds" REAL,
  "sampleRate" INTEGER,
  "bitDepth" INTEGER,
  "lufs" REAL,
  "truePeak" REAL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" DATETIME,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AudioFile_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioFile_parentAudioFileId_fkey" FOREIGN KEY ("parentAudioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AudioFile_originGarageBandLogId_fkey" FOREIGN KEY ("originGarageBandLogId") REFERENCES "GarageBandOperationLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AudioComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "audioFileId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "timestampSeconds" REAL NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '其他',
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AudioComment_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AudioAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "audioFileId" TEXT NOT NULL,
  "durationSeconds" REAL,
  "peak" REAL,
  "rms" REAL,
  "energyJson" TEXT,
  "waveformJson" TEXT,
  "suggestedBpm" REAL,
  "suggestedMoodJson" TEXT,
  "suggestedUseCaseJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioAnalysis_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RecordingSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "targetInstrument" TEXT NOT NULL,
  "detectionMode" TEXT NOT NULL DEFAULT 'timing_pitch',
  "targetBpm" INTEGER,
  "targetKey" TEXT,
  "metronomeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "referenceAudioFileId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RecordingSession_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecordingSession_referenceAudioFileId_fkey" FOREIGN KEY ("referenceAudioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RecordingTake" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "audioFileId" TEXT,
  "takeNumber" INTEGER NOT NULL DEFAULT 1,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RecordingTake_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RecordingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecordingTake_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecordingTake_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PerformanceAnalysisReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recordingTakeId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "audioFileId" TEXT,
  "analyzer" TEXT NOT NULL DEFAULT 'browser_web_audio',
  "detectionMode" TEXT NOT NULL DEFAULT 'timing_pitch',
  "overallScore" INTEGER NOT NULL,
  "timingScore" INTEGER,
  "pitchScore" INTEGER,
  "levelScore" INTEGER,
  "durationSeconds" REAL,
  "peak" REAL,
  "rms" REAL,
  "tempoDriftMs" REAL,
  "pitchDriftCents" REAL,
  "summary" TEXT NOT NULL,
  "recommendationsJson" TEXT,
  "metricsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceAnalysisReport_recordingTakeId_fkey" FOREIGN KEY ("recordingTakeId") REFERENCES "RecordingTake" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PerformanceAnalysisReport_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PerformanceAnalysisReport_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PerformanceIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reportId" TEXT NOT NULL,
  "recordingTakeId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "audioFileId" TEXT,
  "timestampSeconds" REAL NOT NULL,
  "issueType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "suggestion" TEXT,
  "measuredValue" REAL,
  "expectedValue" REAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PerformanceAnalysisReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PerformanceIssue_recordingTakeId_fkey" FOREIGN KEY ("recordingTakeId") REFERENCES "RecordingTake" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PerformanceIssue_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PerformanceIssue_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DawProject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "bpm" INTEGER,
  "musicalKey" TEXT,
  "sampleRate" INTEGER NOT NULL DEFAULT 48000,
  "bitDepth" INTEGER NOT NULL DEFAULT 24,
  "timeSignature" TEXT NOT NULL DEFAULT '4/4',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "engineMode" TEXT NOT NULL DEFAULT 'web_fallback',
  "projectJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawProject_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trackType" TEXT NOT NULL DEFAULT 'audio',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "solo" BOOLEAN NOT NULL DEFAULT false,
  "armed" BOOLEAN NOT NULL DEFAULT false,
  "monitoring" BOOLEAN NOT NULL DEFAULT false,
  "volume" REAL NOT NULL DEFAULT 1,
  "pan" REAL NOT NULL DEFAULT 0,
  "color" TEXT,
  "effectsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawClip" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trackId" TEXT NOT NULL,
  "audioFileId" TEXT NOT NULL,
  "startSeconds" REAL NOT NULL DEFAULT 0,
  "offsetSeconds" REAL NOT NULL DEFAULT 0,
  "durationSeconds" REAL,
  "gain" REAL NOT NULL DEFAULT 1,
  "fadeInSeconds" REAL NOT NULL DEFAULT 0,
  "fadeOutSeconds" REAL NOT NULL DEFAULT 0,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "label" TEXT,
  "color" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawClip_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "DawTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DawClip_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawTakeLane" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trackId" TEXT NOT NULL,
  "recordingTakeId" TEXT NOT NULL,
  "laneOrder" INTEGER NOT NULL DEFAULT 0,
  "compStatus" TEXT NOT NULL DEFAULT 'candidate',
  "selectedRangeJson" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawTakeLane_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "DawTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DawTakeLane_recordingTakeId_fkey" FOREIGN KEY ("recordingTakeId") REFERENCES "RecordingTake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawMarker" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "markerType" TEXT NOT NULL DEFAULT 'idea',
  "label" TEXT NOT NULL,
  "timestampSeconds" REAL NOT NULL DEFAULT 0,
  "color" TEXT,
  "relatedModel" TEXT,
  "relatedId" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawMarker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawMixSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DawMixSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DawScoreDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sourceAudioFileId" TEXT,
  "title" TEXT NOT NULL,
  "targetInstrument" TEXT NOT NULL,
  "analyzer" TEXT NOT NULL DEFAULT 'songzu_local_dsp_v1',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "confidence" REAL NOT NULL DEFAULT 0,
  "bpm" INTEGER,
  "musicalKey" TEXT,
  "timeSignature" TEXT NOT NULL DEFAULT '4/4',
  "durationSeconds" REAL,
  "resultJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DawScoreDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DawProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DawScoreDraft_sourceAudioFileId_fkey" FOREIGN KEY ("sourceAudioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AudioQualityReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "audioFileId" TEXT NOT NULL,
  "sha256" TEXT,
  "fileSizeBytes" INTEGER,
  "formatName" TEXT,
  "containerFormat" TEXT,
  "codecName" TEXT,
  "sampleRate" INTEGER,
  "bitDepth" INTEGER,
  "bitRate" INTEGER,
  "channels" INTEGER,
  "durationSeconds" REAL,
  "peak" REAL,
  "rms" REAL,
  "integratedLufs" REAL,
  "truePeak" REAL,
  "clippingSampleCount" INTEGER NOT NULL DEFAULT 0,
  "clippingRisk" BOOLEAN NOT NULL DEFAULT false,
  "lowQualityRisk" BOOLEAN NOT NULL DEFAULT false,
  "sampleRateMismatch" BOOLEAN NOT NULL DEFAULT false,
  "bitDepthMismatch" BOOLEAN NOT NULL DEFAULT false,
  "warningsJson" TEXT,
  "metricsJson" TEXT,
  "verdict" TEXT NOT NULL DEFAULT 'warning',
  "analyzer" TEXT NOT NULL DEFAULT 'ffmpeg',
  "analyzerVersion" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioQualityReport_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Contributor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "defaultRoles" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Credit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "contributorId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "splitPercentage" REAL,
  "ownershipType" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Credit_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Credit_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CreditConfirmation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "creditId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "confirmedAt" DATETIME,
  "displayName" TEXT,
  "emailSnapshot" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CreditConfirmation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Release" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "releaseType" TEXT NOT NULL DEFAULT 'SINGLE',
  "releaseDate" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'PLANNING',
  "upc" TEXT,
  "coverArtFileId" TEXT,
  "copyrightLine" TEXT,
  "publishingLine" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ReleaseTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "trackNumber" INTEGER NOT NULL,
  "isrc" TEXT,
  "displayTitle" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReleaseTrack_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReleaseTrack_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReleaseChecklistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReleaseChecklistItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "category" TEXT,
  "dueDate" DATETIME,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Task_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StatusHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "note" TEXT,
  "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatusHistory_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiSuggestion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "suggestionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "inputSnapshotJson" TEXT,
  "outputPayloadJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" DATETIME,
  CONSTRAINT "AiSuggestion_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AiMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiAgentAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "sourceMessageId" TEXT,
  "songId" TEXT,
  "actionType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "payloadJson" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "resultJson" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" DATETIME,
  "executedAt" DATETIME,
  CONSTRAINT "AiAgentAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Inspiration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'text',
  "status" TEXT NOT NULL DEFAULT 'INBOX',
  "aiCategory" TEXT,
  "moodJson" TEXT,
  "suggestedTitle" TEXT,
  "linkedSongId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Inspiration_linkedSongId_fkey" FOREIGN KEY ("linkedSongId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PitchPack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "allowDownload" BOOLEAN NOT NULL DEFAULT false,
  "showLyrics" BOOLEAN NOT NULL DEFAULT true,
  "showCredits" BOOLEAN NOT NULL DEFAULT true,
  "showContact" BOOLEAN NOT NULL DEFAULT true,
  "contactInfo" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PitchPackSong" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pitchPackId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PitchPackSong_pitchPackId_fkey" FOREIGN KEY ("pitchPackId") REFERENCES "PitchPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PitchPackSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TimelineEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "relatedModel" TEXT,
  "relatedId" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimelineEvent_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GarageBandOperationLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "operation" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "payloadJson" TEXT,
  "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "resultStatus" TEXT NOT NULL DEFAULT 'QUEUED',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GarageBandOperationLog_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PromoAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "assetType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PromoAsset_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SoundLibraryItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "itemType" TEXT NOT NULL,
  "family" TEXT,
  "era" TEXT,
  "source" TEXT,
  "description" TEXT,
  "tagsJson" TEXT,
  "characterJson" TEXT,
  "useCasesJson" TEXT,
  "chainJson" TEXT,
  "garageBandHint" TEXT,
  "notes" TEXT,
  "assetPath" TEXT,
  "previewPath" TEXT,
  "sourceUrl" TEXT,
  "licenseName" TEXT,
  "licenseUrl" TEXT,
  "fileSizeBytes" INTEGER,
  "sha256" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COLLECTED',
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SongSoundUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "soundLibraryItemId" TEXT NOT NULL,
  "role" TEXT,
  "section" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SongSoundUse_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SongSoundUse_soundLibraryItemId_fkey" FOREIGN KEY ("soundLibraryItemId") REFERENCES "SoundLibraryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SongSetupChecklistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '錄音準備',
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SongSetupChecklistItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MusicMaterial" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "materialType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "summary" TEXT,
  "source" TEXT,
  "sourceUrl" TEXT,
  "externalSourceKey" TEXT,
  "externalAudioPath" TEXT,
  "externalNotePath" TEXT,
  "externalFileName" TEXT,
  "externalFileSizeBytes" INTEGER,
  "externalDurationSeconds" REAL,
  "externalCodec" TEXT,
  "externalBitRate" INTEGER,
  "externalAudioSha256" TEXT,
  "externalNoteSha256" TEXT,
  "artist" TEXT,
  "language" TEXT,
  "referenceUsesJson" TEXT,
  "preferenceNotesJson" TEXT,
  "priorityNotesJson" TEXT,
  "styleFeaturesJson" TEXT,
  "suggestedCollection" TEXT,
  "matchStatus" TEXT,
  "importedAt" DATETIME,
  "lastScannedAt" DATETIME,
  "genre" TEXT,
  "moodJson" TEXT,
  "tagsJson" TEXT,
  "musicalKey" TEXT,
  "mode" TEXT,
  "bpm" INTEGER,
  "meter" TEXT,
  "sectionRole" TEXT,
  "energy" INTEGER,
  "relatedSongId" TEXT,
  "relatedSoundId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'COLLECTED',
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MusicMaterial_relatedSongId_fkey" FOREIGN KEY ("relatedSongId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MusicMaterial_relatedSoundId_fkey" FOREIGN KEY ("relatedSoundId") REFERENCES "SoundLibraryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PersonalTheoryRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "ruleType" TEXT NOT NULL,
  "scope" TEXT,
  "statement" TEXT NOT NULL,
  "examplesJson" TEXT,
  "avoidJson" TEXT,
  "tagsJson" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 3,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "MusicGenerationDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "songId" TEXT,
  "materialIdsJson" TEXT,
  "ruleIdsJson" TEXT,
  "styleTagsJson" TEXT,
  "outputJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MusicGenerationDraft_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Song_status_idx" ON "Song"("status");
CREATE INDEX "Song_genre_idx" ON "Song"("genre");
CREATE INDEX "Song_updatedAt_idx" ON "Song"("updatedAt");
CREATE INDEX "LyricsVersion_songId_idx" ON "LyricsVersion"("songId");
CREATE INDEX "AudioFile_songId_idx" ON "AudioFile"("songId");
CREATE INDEX "AudioFile_fileType_idx" ON "AudioFile"("fileType");
CREATE INDEX "AudioFile_qualityStatus_idx" ON "AudioFile"("qualityStatus");
CREATE INDEX "AudioFile_sha256_idx" ON "AudioFile"("sha256");
CREATE INDEX "AudioFile_parentAudioFileId_idx" ON "AudioFile"("parentAudioFileId");
CREATE INDEX "AudioFile_originGarageBandLogId_idx" ON "AudioFile"("originGarageBandLogId");
CREATE INDEX "AudioFile_archivedAt_idx" ON "AudioFile"("archivedAt");
CREATE INDEX "AudioComment_audioFileId_idx" ON "AudioComment"("audioFileId");
CREATE INDEX "AudioComment_songId_idx" ON "AudioComment"("songId");
CREATE INDEX "AudioComment_status_idx" ON "AudioComment"("status");
CREATE INDEX "AudioAnalysis_audioFileId_idx" ON "AudioAnalysis"("audioFileId");
CREATE INDEX "RecordingSession_songId_idx" ON "RecordingSession"("songId");
CREATE INDEX "RecordingSession_targetInstrument_idx" ON "RecordingSession"("targetInstrument");
CREATE INDEX "RecordingSession_status_idx" ON "RecordingSession"("status");
CREATE INDEX "RecordingSession_referenceAudioFileId_idx" ON "RecordingSession"("referenceAudioFileId");
CREATE INDEX "RecordingTake_sessionId_idx" ON "RecordingTake"("sessionId");
CREATE INDEX "RecordingTake_songId_idx" ON "RecordingTake"("songId");
CREATE INDEX "RecordingTake_audioFileId_idx" ON "RecordingTake"("audioFileId");
CREATE INDEX "RecordingTake_status_idx" ON "RecordingTake"("status");
CREATE INDEX "PerformanceAnalysisReport_recordingTakeId_idx" ON "PerformanceAnalysisReport"("recordingTakeId");
CREATE INDEX "PerformanceAnalysisReport_songId_idx" ON "PerformanceAnalysisReport"("songId");
CREATE INDEX "PerformanceAnalysisReport_audioFileId_idx" ON "PerformanceAnalysisReport"("audioFileId");
CREATE INDEX "PerformanceAnalysisReport_overallScore_idx" ON "PerformanceAnalysisReport"("overallScore");
CREATE INDEX "PerformanceIssue_reportId_idx" ON "PerformanceIssue"("reportId");
CREATE INDEX "PerformanceIssue_recordingTakeId_idx" ON "PerformanceIssue"("recordingTakeId");
CREATE INDEX "PerformanceIssue_songId_idx" ON "PerformanceIssue"("songId");
CREATE INDEX "PerformanceIssue_audioFileId_idx" ON "PerformanceIssue"("audioFileId");
CREATE INDEX "PerformanceIssue_issueType_idx" ON "PerformanceIssue"("issueType");
CREATE INDEX "PerformanceIssue_severity_idx" ON "PerformanceIssue"("severity");
CREATE INDEX "DawProject_songId_idx" ON "DawProject"("songId");
CREATE INDEX "DawProject_status_idx" ON "DawProject"("status");
CREATE INDEX "DawTrack_projectId_idx" ON "DawTrack"("projectId");
CREATE INDEX "DawTrack_trackType_idx" ON "DawTrack"("trackType");
CREATE INDEX "DawClip_trackId_idx" ON "DawClip"("trackId");
CREATE INDEX "DawClip_audioFileId_idx" ON "DawClip"("audioFileId");
CREATE INDEX "DawTakeLane_trackId_idx" ON "DawTakeLane"("trackId");
CREATE INDEX "DawTakeLane_recordingTakeId_idx" ON "DawTakeLane"("recordingTakeId");
CREATE INDEX "DawTakeLane_compStatus_idx" ON "DawTakeLane"("compStatus");
CREATE INDEX "DawMarker_projectId_idx" ON "DawMarker"("projectId");
CREATE INDEX "DawMarker_markerType_idx" ON "DawMarker"("markerType");
CREATE INDEX "DawMarker_timestampSeconds_idx" ON "DawMarker"("timestampSeconds");
CREATE INDEX "DawMixSnapshot_projectId_idx" ON "DawMixSnapshot"("projectId");
CREATE INDEX "DawMixSnapshot_createdAt_idx" ON "DawMixSnapshot"("createdAt");
CREATE INDEX "DawScoreDraft_projectId_idx" ON "DawScoreDraft"("projectId");
CREATE INDEX "DawScoreDraft_sourceAudioFileId_idx" ON "DawScoreDraft"("sourceAudioFileId");
CREATE INDEX "DawScoreDraft_targetInstrument_idx" ON "DawScoreDraft"("targetInstrument");
CREATE INDEX "DawScoreDraft_status_idx" ON "DawScoreDraft"("status");
CREATE INDEX "DawScoreDraft_createdAt_idx" ON "DawScoreDraft"("createdAt");
CREATE INDEX "AudioQualityReport_audioFileId_idx" ON "AudioQualityReport"("audioFileId");
CREATE INDEX "AudioQualityReport_verdict_idx" ON "AudioQualityReport"("verdict");
CREATE INDEX "AudioQualityReport_sha256_idx" ON "AudioQualityReport"("sha256");
CREATE INDEX "Contributor_name_idx" ON "Contributor"("name");
CREATE INDEX "Credit_songId_idx" ON "Credit"("songId");
CREATE INDEX "Credit_contributorId_idx" ON "Credit"("contributorId");
CREATE UNIQUE INDEX "CreditConfirmation_token_key" ON "CreditConfirmation"("token");
CREATE INDEX "CreditConfirmation_creditId_idx" ON "CreditConfirmation"("creditId");
CREATE INDEX "CreditConfirmation_status_idx" ON "CreditConfirmation"("status");
CREATE INDEX "Release_status_idx" ON "Release"("status");
CREATE INDEX "Release_releaseDate_idx" ON "Release"("releaseDate");
CREATE INDEX "ReleaseTrack_releaseId_idx" ON "ReleaseTrack"("releaseId");
CREATE INDEX "ReleaseTrack_songId_idx" ON "ReleaseTrack"("songId");
CREATE INDEX "ReleaseChecklistItem_releaseId_idx" ON "ReleaseChecklistItem"("releaseId");
CREATE INDEX "ReleaseChecklistItem_status_idx" ON "ReleaseChecklistItem"("status");
CREATE INDEX "Task_songId_idx" ON "Task"("songId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "StatusHistory_songId_idx" ON "StatusHistory"("songId");
CREATE INDEX "AiSuggestion_songId_idx" ON "AiSuggestion"("songId");
CREATE INDEX "AiSuggestion_suggestionType_idx" ON "AiSuggestion"("suggestionType");
CREATE INDEX "AiConversation_status_idx" ON "AiConversation"("status");
CREATE INDEX "AiConversation_updatedAt_idx" ON "AiConversation"("updatedAt");
CREATE INDEX "AiMessage_conversationId_idx" ON "AiMessage"("conversationId");
CREATE INDEX "AiMessage_createdAt_idx" ON "AiMessage"("createdAt");
CREATE INDEX "AiAgentAction_conversationId_idx" ON "AiAgentAction"("conversationId");
CREATE INDEX "AiAgentAction_sourceMessageId_idx" ON "AiAgentAction"("sourceMessageId");
CREATE INDEX "AiAgentAction_songId_idx" ON "AiAgentAction"("songId");
CREATE INDEX "AiAgentAction_status_idx" ON "AiAgentAction"("status");
CREATE INDEX "Inspiration_status_idx" ON "Inspiration"("status");
CREATE INDEX "Inspiration_aiCategory_idx" ON "Inspiration"("aiCategory");
CREATE INDEX "Inspiration_linkedSongId_idx" ON "Inspiration"("linkedSongId");
CREATE UNIQUE INDEX "PitchPack_token_key" ON "PitchPack"("token");
CREATE INDEX "PitchPack_token_idx" ON "PitchPack"("token");
CREATE INDEX "PitchPackSong_pitchPackId_idx" ON "PitchPackSong"("pitchPackId");
CREATE INDEX "PitchPackSong_songId_idx" ON "PitchPackSong"("songId");
CREATE INDEX "TimelineEvent_songId_idx" ON "TimelineEvent"("songId");
CREATE INDEX "TimelineEvent_eventType_idx" ON "TimelineEvent"("eventType");
CREATE INDEX "GarageBandOperationLog_songId_idx" ON "GarageBandOperationLog"("songId");
CREATE INDEX "GarageBandOperationLog_approvalStatus_idx" ON "GarageBandOperationLog"("approvalStatus");
CREATE INDEX "GarageBandOperationLog_resultStatus_idx" ON "GarageBandOperationLog"("resultStatus");
CREATE INDEX "PromoAsset_songId_idx" ON "PromoAsset"("songId");
CREATE INDEX "PromoAsset_assetType_idx" ON "PromoAsset"("assetType");
CREATE INDEX "SoundLibraryItem_itemType_idx" ON "SoundLibraryItem"("itemType");
CREATE INDEX "SoundLibraryItem_family_idx" ON "SoundLibraryItem"("family");
CREATE INDEX "SoundLibraryItem_era_idx" ON "SoundLibraryItem"("era");
CREATE INDEX "SoundLibraryItem_status_idx" ON "SoundLibraryItem"("status");
CREATE INDEX "SoundLibraryItem_favorite_idx" ON "SoundLibraryItem"("favorite");
CREATE INDEX "SoundLibraryItem_assetPath_idx" ON "SoundLibraryItem"("assetPath");
CREATE INDEX "SoundLibraryItem_sha256_idx" ON "SoundLibraryItem"("sha256");
CREATE INDEX "SongSoundUse_songId_idx" ON "SongSoundUse"("songId");
CREATE INDEX "SongSoundUse_soundLibraryItemId_idx" ON "SongSoundUse"("soundLibraryItemId");
CREATE INDEX "SongSoundUse_status_idx" ON "SongSoundUse"("status");
CREATE INDEX "SongSetupChecklistItem_songId_idx" ON "SongSetupChecklistItem"("songId");
CREATE INDEX "SongSetupChecklistItem_status_idx" ON "SongSetupChecklistItem"("status");
CREATE INDEX "SongSetupChecklistItem_category_idx" ON "SongSetupChecklistItem"("category");
CREATE INDEX "MusicMaterial_materialType_idx" ON "MusicMaterial"("materialType");
CREATE INDEX "MusicMaterial_genre_idx" ON "MusicMaterial"("genre");
CREATE INDEX "MusicMaterial_status_idx" ON "MusicMaterial"("status");
CREATE INDEX "MusicMaterial_favorite_idx" ON "MusicMaterial"("favorite");
CREATE INDEX "MusicMaterial_relatedSongId_idx" ON "MusicMaterial"("relatedSongId");
CREATE INDEX "MusicMaterial_relatedSoundId_idx" ON "MusicMaterial"("relatedSoundId");
CREATE UNIQUE INDEX "MusicMaterial_externalSourceKey_key" ON "MusicMaterial"("externalSourceKey");
CREATE INDEX "MusicMaterial_externalSourceKey_idx" ON "MusicMaterial"("externalSourceKey");
CREATE INDEX "MusicMaterial_artist_idx" ON "MusicMaterial"("artist");
CREATE INDEX "MusicMaterial_language_idx" ON "MusicMaterial"("language");
CREATE INDEX "MusicMaterial_matchStatus_idx" ON "MusicMaterial"("matchStatus");
CREATE INDEX "MusicMaterial_suggestedCollection_idx" ON "MusicMaterial"("suggestedCollection");
CREATE INDEX "PersonalTheoryRule_ruleType_idx" ON "PersonalTheoryRule"("ruleType");
CREATE INDEX "PersonalTheoryRule_isActive_idx" ON "PersonalTheoryRule"("isActive");
CREATE INDEX "PersonalTheoryRule_priority_idx" ON "PersonalTheoryRule"("priority");
CREATE INDEX "MusicGenerationDraft_songId_idx" ON "MusicGenerationDraft"("songId");
CREATE INDEX "MusicGenerationDraft_status_idx" ON "MusicGenerationDraft"("status");
CREATE INDEX "MusicGenerationDraft_createdAt_idx" ON "MusicGenerationDraft"("createdAt");

CREATE TABLE "Integration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIGURED',
  "connectionKind" TEXT NOT NULL,
  "endpoint" TEXT,
  "apiKeyEnv" TEXT,
  "threadUrl" TEXT,
  "threadId" TEXT,
  "projectPath" TEXT,
  "commandPath" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PlatformConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "clientId" TEXT,
  "accountId" TEXT,
  "accountName" TEXT,
  "accountThumbnailUrl" TEXT,
  "scopesJson" TEXT,
  "tokenStorage" TEXT NOT NULL DEFAULT 'macos_keychain',
  "tokenReference" TEXT,
  "connectedAt" DATETIME,
  "tokenExpiresAt" DATETIME,
  "lastCheckedAt" DATETIME,
  "lastError" TEXT,
  "configJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PlatformPublishJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "connectionId" TEXT,
  "platform" TEXT NOT NULL DEFAULT 'youtube',
  "exportFileName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "tagsJson" TEXT,
  "categoryId" TEXT NOT NULL DEFAULT '10',
  "privacyStatus" TEXT NOT NULL DEFAULT 'private',
  "scheduledAt" DATETIME,
  "madeForKids" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "approvedAt" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "uploadSessionUrl" TEXT,
  "uploadedBytes" REAL NOT NULL DEFAULT 0,
  "fileSizeBytes" REAL,
  "platformMediaId" TEXT,
  "platformUrl" TEXT,
  "lastError" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlatformPublishJob_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlatformPublishJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PlatformConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MonetizationProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "regionCode" TEXT NOT NULL DEFAULT 'TW',
  "yppStatus" TEXT NOT NULL DEFAULT 'NOT_APPLIED',
  "subscriberCount" INTEGER NOT NULL DEFAULT 0,
  "publicWatchHours" REAL NOT NULL DEFAULT 0,
  "shortsViews90Days" INTEGER NOT NULL DEFAULT 0,
  "validPublicUploads90Days" INTEGER NOT NULL DEFAULT 0,
  "fanFundingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "adsRevenueEnabled" BOOLEAN NOT NULL DEFAULT false,
  "contentIdStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "distributorName" TEXT,
  "publishingAdmin" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RevenueRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "platform" TEXT NOT NULL,
  "revenueType" TEXT NOT NULL,
  "periodStart" DATETIME NOT NULL,
  "periodEnd" DATETIME NOT NULL,
  "grossAmount" REAL NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "externalReference" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RevenueRecord_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SongPreview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "releaseId" TEXT,
  "sourceAudioFileId" TEXT,
  "token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "title" TEXT,
  "description" TEXT,
  "previewFileName" TEXT,
  "previewStartSeconds" REAL NOT NULL DEFAULT 0,
  "previewDurationSeconds" REAL NOT NULL DEFAULT 30,
  "sourceSha256" TEXT,
  "previewSha256" TEXT,
  "releaseUrl" TEXT,
  "contactInfo" TEXT,
  "paymentInstructions" TEXT,
  "allowClaims" BOOLEAN NOT NULL DEFAULT true,
  "playCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SongPreview_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SongPreview_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SongPreview_sourceAudioFileId_fkey" FOREIGN KEY ("sourceAudioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ClaimOffer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "previewId" TEXT NOT NULL,
  "offerType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "price" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "rightsSummary" TEXT NOT NULL,
  "deliveryDays" INTEGER,
  "maxClaims" INTEGER NOT NULL DEFAULT 1,
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClaimOffer_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "SongPreview" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ClaimOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "offerId" TEXT NOT NULL,
  "orderCode" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "contactChannel" TEXT NOT NULL,
  "contactValue" TEXT NOT NULL,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "amountSnapshot" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "paymentMethod" TEXT NOT NULL DEFAULT 'manual',
  "adminNotes" TEXT,
  "termsVersion" TEXT NOT NULL DEFAULT 'v1',
  "termsAcceptedAt" DATETIME NOT NULL,
  "reservationExpiresAt" DATETIME,
  "paidAt" DATETIME,
  "completedAt" DATETIME,
  "revenueRecordId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClaimOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ClaimOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClaimOrder_revenueRecordId_fkey" FOREIGN KEY ("revenueRecordId") REFERENCES "RevenueRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");
CREATE INDEX "Integration_provider_idx" ON "Integration"("provider");
CREATE INDEX "Integration_status_idx" ON "Integration"("status");
CREATE UNIQUE INDEX "PlatformConnection_provider_key" ON "PlatformConnection"("provider");
CREATE INDEX "PlatformConnection_provider_idx" ON "PlatformConnection"("provider");
CREATE INDEX "PlatformConnection_status_idx" ON "PlatformConnection"("status");
CREATE INDEX "PlatformPublishJob_songId_idx" ON "PlatformPublishJob"("songId");
CREATE INDEX "PlatformPublishJob_connectionId_idx" ON "PlatformPublishJob"("connectionId");
CREATE INDEX "PlatformPublishJob_platform_idx" ON "PlatformPublishJob"("platform");
CREATE INDEX "PlatformPublishJob_status_idx" ON "PlatformPublishJob"("status");
CREATE INDEX "PlatformPublishJob_createdAt_idx" ON "PlatformPublishJob"("createdAt");
CREATE UNIQUE INDEX "MonetizationProfile_provider_key" ON "MonetizationProfile"("provider");
CREATE INDEX "MonetizationProfile_provider_idx" ON "MonetizationProfile"("provider");
CREATE INDEX "MonetizationProfile_yppStatus_idx" ON "MonetizationProfile"("yppStatus");
CREATE INDEX "RevenueRecord_songId_idx" ON "RevenueRecord"("songId");
CREATE INDEX "RevenueRecord_platform_idx" ON "RevenueRecord"("platform");
CREATE INDEX "RevenueRecord_revenueType_idx" ON "RevenueRecord"("revenueType");
CREATE INDEX "RevenueRecord_periodStart_idx" ON "RevenueRecord"("periodStart");
CREATE UNIQUE INDEX "SongPreview_songId_key" ON "SongPreview"("songId");
CREATE UNIQUE INDEX "SongPreview_token_key" ON "SongPreview"("token");
CREATE INDEX "SongPreview_releaseId_idx" ON "SongPreview"("releaseId");
CREATE INDEX "SongPreview_sourceAudioFileId_idx" ON "SongPreview"("sourceAudioFileId");
CREATE INDEX "SongPreview_status_idx" ON "SongPreview"("status");
CREATE INDEX "SongPreview_publishedAt_idx" ON "SongPreview"("publishedAt");
CREATE INDEX "ClaimOffer_previewId_idx" ON "ClaimOffer"("previewId");
CREATE INDEX "ClaimOffer_offerType_idx" ON "ClaimOffer"("offerType");
CREATE INDEX "ClaimOffer_status_idx" ON "ClaimOffer"("status");
CREATE UNIQUE INDEX "ClaimOrder_orderCode_key" ON "ClaimOrder"("orderCode");
CREATE UNIQUE INDEX "ClaimOrder_revenueRecordId_key" ON "ClaimOrder"("revenueRecordId");
CREATE INDEX "ClaimOrder_offerId_idx" ON "ClaimOrder"("offerId");
CREATE INDEX "ClaimOrder_status_idx" ON "ClaimOrder"("status");
CREATE INDEX "ClaimOrder_createdAt_idx" ON "ClaimOrder"("createdAt");
CREATE INDEX "ClaimOrder_reservationExpiresAt_idx" ON "ClaimOrder"("reservationExpiresAt");
`);

ensureV17Columns(db);
db.exec(v17SchemaSql);
ensureV18Columns(db);
db.exec(v18SchemaSql);
ensureV19HealthSnapshotBigInt(db);
ensureV20FormalScoreReleases(db);
ensureV21FormalScoreReleaseManifest(db);

db.close();
console.log(`Initialized SQLite database at ${dbPath}`);
