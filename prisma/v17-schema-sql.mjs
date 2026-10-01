export function ensureV17Columns(db) {
  const columns = [
    ["Contributor", "ipi", "TEXT"],
    ["Contributor", "isni", "TEXT"],
    ["Contributor", "proAffiliation", "TEXT"],
    ["Contributor", "countryCode", "TEXT"],
    ["Credit", "publishingSplit", "REAL"],
    ["Credit", "masterSplit", "REAL"],
    ["Credit", "creditCategory", "TEXT"]
  ];

  for (const [table, column, definition] of columns) {
    const existing = db.prepare(`PRAGMA table_info("${table}")`).all();
    if (!existing.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
    }
  }
}

export const v17SchemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "KnowledgeNode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityKey" TEXT NOT NULL,
  "songId" TEXT,
  "nodeType" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "summary" TEXT,
  "searchText" TEXT NOT NULL,
  "tagsJson" TEXT,
  "attributesJson" TEXT,
  "source" TEXT NOT NULL DEFAULT 'derived',
  "confidence" REAL NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeNode_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "KnowledgeEdge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceNodeId" TEXT NOT NULL,
  "targetNodeId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "weight" REAL NOT NULL DEFAULT 1,
  "evidenceJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "KnowledgeNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "KnowledgeNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AudioIntelligenceJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "audioFileId" TEXT,
  "jobType" TEXT NOT NULL,
  "target" TEXT,
  "engine" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "resultJson" TEXT,
  "warningsJson" TEXT,
  "outputAudioFileIdsJson" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AudioIntelligenceJob_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudioIntelligenceJob_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "AudioFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PluginDescriptor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vendor" TEXT,
  "format" TEXT NOT NULL,
  "version" TEXT,
  "filePath" TEXT NOT NULL,
  "architecture" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "validationStatus" TEXT NOT NULL DEFAULT 'UNVALIDATED',
  "capabilitiesJson" TEXT,
  "presetsJson" TEXT,
  "quarantined" BOOLEAN NOT NULL DEFAULT false,
  "lastScannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastValidatedAt" DATETIME,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "EffectChain" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "pluginIdsJson" TEXT,
  "stepsJson" TEXT NOT NULL,
  "tagsJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "AutomationWorkflow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "stepsJson" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "AutomationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowId" TEXT NOT NULL,
  "songId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "previewJson" TEXT,
  "resultJson" TEXT,
  "rollbackJson" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" DATETIME,
  "executedAt" DATETIME,
  "rolledBackAt" DATETIME,
  CONSTRAINT "AutomationRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AutomationRun_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CatalogBrief" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "useCase" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "moodsJson" TEXT,
  "instrumentsJson" TEXT,
  "genresJson" TEXT,
  "bpmMin" INTEGER,
  "bpmMax" INTEGER,
  "requiredRights" TEXT NOT NULL DEFAULT 'one_stop_preferred',
  "allowVocals" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "CatalogMatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "briefId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reasonsJson" TEXT,
  "blockersJson" TEXT,
  "rightsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CatalogMatch_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "CatalogBrief" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CatalogMatch_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SongRightsProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "alternateTitle" TEXT,
  "iswc" TEXT,
  "language" TEXT NOT NULL DEFAULT 'zh-TW',
  "explicit" BOOLEAN NOT NULL DEFAULT false,
  "territory" TEXT NOT NULL DEFAULT 'Worldwide',
  "publisher" TEXT,
  "proAffiliation" TEXT,
  "masterOwner" TEXT,
  "publishingOwner" TEXT,
  "oneStopClearance" BOOLEAN NOT NULL DEFAULT false,
  "masterControlled" BOOLEAN NOT NULL DEFAULT true,
  "publishingControlled" BOOLEAN NOT NULL DEFAULT true,
  "recordingLocation" TEXT,
  "equipmentJson" TEXT,
  "identifiersJson" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SongRightsProfile_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "IndustryExport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "releaseId" TEXT,
  "format" TEXT NOT NULL,
  "profileVersion" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "validationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  "warningsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndustryExport_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IndustryExport_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PlatformMetricSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT,
  "provider" TEXT NOT NULL,
  "externalMediaId" TEXT,
  "periodStart" DATETIME NOT NULL,
  "periodEnd" DATETIME NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "engagedViews" INTEGER NOT NULL DEFAULT 0,
  "watchMinutes" REAL NOT NULL DEFAULT 0,
  "averageViewDuration" REAL NOT NULL DEFAULT 0,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "comments" INTEGER NOT NULL DEFAULT 0,
  "shares" INTEGER NOT NULL DEFAULT 0,
  "subscribersGained" INTEGER NOT NULL DEFAULT 0,
  "estimatedRevenue" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "metricsJson" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformMetricSnapshot_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AudienceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "previewId" TEXT,
  "eventType" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'direct',
  "sessionHash" TEXT,
  "metadataJson" TEXT,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudienceEvent_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudienceEvent_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "SongPreview" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeNode_entityKey_key" ON "KnowledgeNode"("entityKey");
CREATE INDEX IF NOT EXISTS "KnowledgeNode_songId_idx" ON "KnowledgeNode"("songId");
CREATE INDEX IF NOT EXISTS "KnowledgeNode_nodeType_idx" ON "KnowledgeNode"("nodeType");
CREATE INDEX IF NOT EXISTS "KnowledgeNode_source_idx" ON "KnowledgeNode"("source");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeEdge_sourceNodeId_targetNodeId_relationType_key" ON "KnowledgeEdge"("sourceNodeId", "targetNodeId", "relationType");
CREATE INDEX IF NOT EXISTS "KnowledgeEdge_sourceNodeId_idx" ON "KnowledgeEdge"("sourceNodeId");
CREATE INDEX IF NOT EXISTS "KnowledgeEdge_targetNodeId_idx" ON "KnowledgeEdge"("targetNodeId");
CREATE INDEX IF NOT EXISTS "KnowledgeEdge_relationType_idx" ON "KnowledgeEdge"("relationType");
CREATE INDEX IF NOT EXISTS "AudioIntelligenceJob_songId_idx" ON "AudioIntelligenceJob"("songId");
CREATE INDEX IF NOT EXISTS "AudioIntelligenceJob_audioFileId_idx" ON "AudioIntelligenceJob"("audioFileId");
CREATE INDEX IF NOT EXISTS "AudioIntelligenceJob_jobType_idx" ON "AudioIntelligenceJob"("jobType");
CREATE INDEX IF NOT EXISTS "AudioIntelligenceJob_status_idx" ON "AudioIntelligenceJob"("status");
CREATE INDEX IF NOT EXISTS "AudioIntelligenceJob_createdAt_idx" ON "AudioIntelligenceJob"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PluginDescriptor_identifier_key" ON "PluginDescriptor"("identifier");
CREATE INDEX IF NOT EXISTS "PluginDescriptor_format_idx" ON "PluginDescriptor"("format");
CREATE INDEX IF NOT EXISTS "PluginDescriptor_status_idx" ON "PluginDescriptor"("status");
CREATE INDEX IF NOT EXISTS "PluginDescriptor_validationStatus_idx" ON "PluginDescriptor"("validationStatus");
CREATE INDEX IF NOT EXISTS "PluginDescriptor_quarantined_idx" ON "PluginDescriptor"("quarantined");
CREATE INDEX IF NOT EXISTS "EffectChain_category_idx" ON "EffectChain"("category");
CREATE INDEX IF NOT EXISTS "EffectChain_status_idx" ON "EffectChain"("status");
CREATE INDEX IF NOT EXISTS "EffectChain_favorite_idx" ON "EffectChain"("favorite");
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationWorkflow_code_key" ON "AutomationWorkflow"("code");
CREATE INDEX IF NOT EXISTS "AutomationWorkflow_category_idx" ON "AutomationWorkflow"("category");
CREATE INDEX IF NOT EXISTS "AutomationWorkflow_status_idx" ON "AutomationWorkflow"("status");
CREATE INDEX IF NOT EXISTS "AutomationRun_workflowId_idx" ON "AutomationRun"("workflowId");
CREATE INDEX IF NOT EXISTS "AutomationRun_songId_idx" ON "AutomationRun"("songId");
CREATE INDEX IF NOT EXISTS "AutomationRun_status_idx" ON "AutomationRun"("status");
CREATE INDEX IF NOT EXISTS "AutomationRun_createdAt_idx" ON "AutomationRun"("createdAt");
CREATE INDEX IF NOT EXISTS "CatalogBrief_useCase_idx" ON "CatalogBrief"("useCase");
CREATE INDEX IF NOT EXISTS "CatalogBrief_status_idx" ON "CatalogBrief"("status");
CREATE INDEX IF NOT EXISTS "CatalogBrief_createdAt_idx" ON "CatalogBrief"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogMatch_briefId_songId_key" ON "CatalogMatch"("briefId", "songId");
CREATE INDEX IF NOT EXISTS "CatalogMatch_briefId_idx" ON "CatalogMatch"("briefId");
CREATE INDEX IF NOT EXISTS "CatalogMatch_songId_idx" ON "CatalogMatch"("songId");
CREATE INDEX IF NOT EXISTS "CatalogMatch_score_idx" ON "CatalogMatch"("score");
CREATE INDEX IF NOT EXISTS "CatalogMatch_status_idx" ON "CatalogMatch"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "SongRightsProfile_songId_key" ON "SongRightsProfile"("songId");
CREATE INDEX IF NOT EXISTS "SongRightsProfile_iswc_idx" ON "SongRightsProfile"("iswc");
CREATE INDEX IF NOT EXISTS "SongRightsProfile_oneStopClearance_idx" ON "SongRightsProfile"("oneStopClearance");
CREATE INDEX IF NOT EXISTS "IndustryExport_songId_idx" ON "IndustryExport"("songId");
CREATE INDEX IF NOT EXISTS "IndustryExport_releaseId_idx" ON "IndustryExport"("releaseId");
CREATE INDEX IF NOT EXISTS "IndustryExport_format_idx" ON "IndustryExport"("format");
CREATE INDEX IF NOT EXISTS "IndustryExport_createdAt_idx" ON "IndustryExport"("createdAt");
CREATE INDEX IF NOT EXISTS "PlatformMetricSnapshot_songId_idx" ON "PlatformMetricSnapshot"("songId");
CREATE INDEX IF NOT EXISTS "PlatformMetricSnapshot_provider_idx" ON "PlatformMetricSnapshot"("provider");
CREATE INDEX IF NOT EXISTS "PlatformMetricSnapshot_periodStart_idx" ON "PlatformMetricSnapshot"("periodStart");
CREATE INDEX IF NOT EXISTS "PlatformMetricSnapshot_createdAt_idx" ON "PlatformMetricSnapshot"("createdAt");
CREATE INDEX IF NOT EXISTS "AudienceEvent_songId_idx" ON "AudienceEvent"("songId");
CREATE INDEX IF NOT EXISTS "AudienceEvent_previewId_idx" ON "AudienceEvent"("previewId");
CREATE INDEX IF NOT EXISTS "AudienceEvent_eventType_idx" ON "AudienceEvent"("eventType");
CREATE INDEX IF NOT EXISTS "AudienceEvent_occurredAt_idx" ON "AudienceEvent"("occurredAt");
`;
