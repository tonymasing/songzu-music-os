import type { Prisma } from "@prisma/client";

export const songInclude = {
  lyricsVersions: { orderBy: { createdAt: "desc" } },
  audioFiles: {
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      analyses: { orderBy: { createdAt: "desc" }, take: 3 },
      qualityReports: { orderBy: { createdAt: "desc" }, take: 3 }
    },
    orderBy: { createdAt: "desc" }
  },
  credits: {
    include: {
      contributor: true,
      confirmations: { orderBy: { createdAt: "desc" }, take: 3 }
    },
    orderBy: { createdAt: "asc" }
  },
  tasks: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
  releaseTracks: {
    include: { release: true },
    orderBy: { trackNumber: "asc" }
  },
  statusHistory: { orderBy: { changedAt: "desc" }, take: 12 },
  aiSuggestions: { orderBy: { createdAt: "desc" }, take: 8 },
  inspirations: { orderBy: { createdAt: "desc" }, take: 12 },
  timelineEvents: { orderBy: { createdAt: "desc" }, take: 40 },
  promoAssets: { orderBy: { updatedAt: "desc" } },
  garageBandLogs: { orderBy: { createdAt: "desc" }, take: 20 },
  recordingSessions: {
    include: {
      takes: {
        include: {
          audioFile: true,
          reports: {
            include: {
              issues: { orderBy: { timestampSeconds: "asc" } }
            },
            orderBy: { createdAt: "desc" },
            take: 3
          }
        },
        orderBy: { createdAt: "desc" },
        take: 8
      }
    },
    orderBy: { createdAt: "desc" },
    take: 8
  },
  soundUsages: {
    include: { soundLibraryItem: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }]
  },
  setupChecklistItems: {
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
  }
} satisfies Prisma.SongInclude;

export type SongRecord = Prisma.SongGetPayload<{ include: typeof songInclude }>;

export type SongDto = ReturnType<typeof toSongDto>;

export type ReleaseReadinessGateStatus = "pass" | "warning" | "blocked";

export type ReleaseReadinessGate = {
  id: string;
  label: string;
  category: "production" | "quality" | "metadata" | "rights" | "release";
  status: ReleaseReadinessGateStatus;
  weight: number;
  critical: boolean;
  detail: string;
};

export type ReleaseReadiness = {
  score: number;
  label: string;
  ready: boolean;
  metadataComplete: boolean;
  masterQualityPassed: boolean;
  splitComplete: boolean;
  rightsConfirmed: boolean;
  pendingRightsCount: number;
  gates: ReleaseReadinessGate[];
  blockers: string[];
  warnings: string[];
};

export const statusOptions = [
  { value: "IDEA", label: "靈感中" },
  { value: "LYRICS", label: "寫詞中" },
  { value: "COMPOSITION", label: "作曲中" },
  { value: "ARRANGEMENT", label: "編曲中" },
  { value: "RECORDING", label: "錄音中" },
  { value: "MIXING", label: "混音中" },
  { value: "MASTERING", label: "母帶中" },
  { value: "READY_FOR_RELEASE", label: "準備發行" },
  { value: "RELEASED", label: "已發行" },
  { value: "PAUSED", label: "暫停" },
  { value: "ARCHIVED", label: "封存" }
] as const;

export const fileTypeOptions = [
  { value: "demo", label: "Demo" },
  { value: "vocal_stem", label: "人聲 Stem" },
  { value: "instrumental_stem", label: "伴奏 Stem" },
  { value: "drum_stem", label: "鼓組 Stem" },
  { value: "bass_stem", label: "低音 Stem" },
  { value: "mix", label: "混音" },
  { value: "master", label: "母帶" },
  { value: "music_video", label: "音樂影片" },
  { value: "short_video", label: "短影音" },
  { value: "project", label: "專案檔" },
  { value: "cover", label: "封面" },
  { value: "document", label: "文件" }
] as const;

export const taskStatusLabels: Record<string, string> = {
  TODO: "待辦",
  DOING: "進行中",
  DONE: "完成",
  BLOCKED: "卡住"
};

export const releaseTypeLabels: Record<string, string> = {
  SINGLE: "單曲",
  EP: "EP",
  ALBUM: "專輯",
  COLLECTION: "合集"
};

export const releaseStatusLabels: Record<string, string> = {
  PLANNING: "規劃中",
  ASSET_PREP: "素材準備",
  DISTRIBUTION_READY: "可送發行",
  DISTRIBUTED: "已送發行",
  RELEASED: "已發行",
  TAKEDOWN: "下架處理"
};

export function statusLabel(status: string) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

export function fileTypeLabel(fileType: string) {
  return fileTypeOptions.find((option) => option.value === fileType)?.label ?? fileType;
}

export function releaseTypeLabel(releaseType: string) {
  return releaseTypeLabels[releaseType] ?? releaseType;
}

export function releaseStatusLabel(status: string) {
  return releaseStatusLabels[status] ?? status;
}

export const soundUsageStatusLabels: Record<string, string> = {
  PLANNED: "已規劃",
  TESTING: "待測試",
  ACTIVE: "使用中",
  REJECTED: "暫不使用"
};

export const setupChecklistStatusLabels: Record<string, string> = {
  TODO: "待確認",
  READY: "已準備",
  BLOCKED: "卡住",
  SKIPPED: "略過"
};

export const setupPriorityLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

function soundItemTypeLabel(value: string) {
  const labels: Record<string, string> = {
    instrument: "樂器",
    effect: "效果",
    effect_chain: "效果鏈",
    era_reference: "年代參考",
    preset: "Preset"
  };
  return labels[value] ?? value;
}

function soundStatusLabel(value: string) {
  const labels: Record<string, string> = {
    COLLECTED: "已收集",
    TESTING: "待測試",
    ACTIVE: "可使用",
    ARCHIVED: "封存"
  };
  return labels[value] ?? value;
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

export function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function readinessGate(
  id: string,
  label: string,
  category: ReleaseReadinessGate["category"],
  status: ReleaseReadinessGateStatus,
  weight: number,
  critical: boolean,
  detail: string
): ReleaseReadinessGate {
  return { id, label, category, status, weight, critical, detail };
}

export function buildReleaseReadiness(song: SongRecord): ReleaseReadiness {
  const activeAudioFiles = song.audioFiles.filter((item) => !item.archivedAt);
  const hasPrimaryLyrics = song.lyricsVersions.some((item) => item.isPrimary);
  const hasListeningVersion = activeAudioFiles.some((item) => ["demo", "mix", "master"].includes(item.fileType));
  const masterFiles = activeAudioFiles.filter((item) => item.fileType === "master");
  const hasPassingMaster = masterFiles.some((item) => item.qualityStatus === "pass");
  const hasFailingMaster = masterFiles.some((item) => item.qualityStatus === "fail");
  const hasPendingMaster = masterFiles.some((item) => ["pending", "warning"].includes(item.qualityStatus));
  const hasCover = activeAudioFiles.some((item) => item.fileType === "cover");
  const hasCredits = song.credits.length > 0;
  const splitTotal = getSplitTotal(song);
  const hasReleaseTrack = song.releaseTracks.length > 0;
  const hasReleaseDate = Boolean(song.targetReleaseDate || song.releaseTracks.some((track) => track.release.releaseDate));
  const hasPromoCopy = Boolean(song.summary?.trim()) || song.promoAssets.some((asset) => asset.assetType === "release_copy" && asset.content.trim());
  const pendingRightsCount = song.credits.filter((credit) => !credit.confirmations.some((confirmation) => confirmation.status === "CONFIRMED")).length;
  const rightsConfirmed = hasCredits && pendingRightsCount === 0;
  const masterStatus: ReleaseReadinessGateStatus = hasPassingMaster
    ? "pass"
    : hasFailingMaster || !masterFiles.length
      ? "blocked"
      : hasPendingMaster
        ? "warning"
        : "blocked";

  const gates: ReleaseReadinessGate[] = [
    readinessGate("listeningVersion", "可聆聽版本", "production", hasListeningVersion ? "pass" : "blocked", 5, false, hasListeningVersion ? "已有 Demo、Mix 或 Master。" : "尚無可聆聽音檔。"),
    readinessGate(
      "masterQuality",
      "Master 音質",
      "quality",
      masterStatus,
      25,
      true,
      hasPassingMaster
        ? "至少一個 Master 通過 Audio QA。"
        : !masterFiles.length
          ? "尚未建立 Master。"
          : hasFailingMaster
            ? "Master 音質未通過。"
            : "Master 尚待完成 Audio QA 或人工確認。"
    ),
    readinessGate("lyrics", "主歌詞", "metadata", hasPrimaryLyrics ? "pass" : "blocked", 10, true, hasPrimaryLyrics ? "主歌詞版本已指定。" : "缺少主歌詞版本。"),
    readinessGate("cover", "封面", "metadata", hasCover ? "pass" : "blocked", 10, true, hasCover ? "封面素材已建立。" : "缺少封面素材。"),
    readinessGate("bpm", "BPM", "metadata", song.bpm ? "pass" : "blocked", 5, true, song.bpm ? `${song.bpm} BPM` : "尚未填寫 BPM。"),
    readinessGate("key", "調性", "metadata", song.musicalKey ? "pass" : "blocked", 5, true, song.musicalKey || "尚未填寫調性。"),
    readinessGate("genre", "曲風", "metadata", song.genre ? "pass" : "blocked", 5, true, song.genre || "尚未填寫曲風。"),
    readinessGate("credits", "製作名單", "rights", hasCredits ? "pass" : "blocked", 10, true, hasCredits ? `${song.credits.length} 位合作人。` : "尚未建立製作名單。"),
    readinessGate("split", "分潤 100%", "rights", splitTotal === 100 ? "pass" : "blocked", 10, true, splitTotal === 100 ? "分潤合計 100%。" : `目前分潤合計 ${splitTotal}%。`),
    readinessGate("confirmations", "權利確認", "rights", rightsConfirmed ? "pass" : hasCredits ? "warning" : "blocked", 5, false, rightsConfirmed ? "所有名單均已確認。" : hasCredits ? `${pendingRightsCount} 位尚未確認。` : "建立製作名單後才能確認。"),
    readinessGate("releaseProject", "發行專案", "release", hasReleaseTrack ? "pass" : "warning", 4, false, hasReleaseTrack ? "已加入發行專案。" : "尚未加入發行專案。"),
    readinessGate("releaseDate", "目標發行日", "release", hasReleaseDate ? "pass" : "warning", 3, false, hasReleaseDate ? "已設定發行日期。" : "尚未設定發行日期。"),
    readinessGate("promoCopy", "發行文案", "release", hasPromoCopy ? "pass" : "warning", 3, false, hasPromoCopy ? "已有作品摘要或發行文案。" : "尚未準備發行文案。")
  ];

  const weightedScore = gates.reduce((total, gate) => {
    if (gate.status === "pass") return total + gate.weight;
    if (gate.status === "warning") return total + gate.weight * 0.5;
    return total;
  }, 0);
  const score = Math.min(100, Math.round(weightedScore));
  const blockers = gates.filter((gate) => gate.critical && gate.status !== "pass").map((gate) => `${gate.label}：${gate.detail}`);
  const warnings = gates.filter((gate) => !gate.critical && gate.status !== "pass").map((gate) => `${gate.label}：${gate.detail}`);
  const metadataComplete = gates.filter((gate) => gate.category === "metadata").every((gate) => gate.status === "pass");
  const ready = blockers.length === 0;

  return {
    score,
    label: ready ? "可進入發行" : score >= 70 ? "接近發行" : score >= 40 ? "製作中" : "資料建立中",
    ready,
    metadataComplete,
    masterQualityPassed: hasPassingMaster,
    splitComplete: splitTotal === 100,
    rightsConfirmed,
    pendingRightsCount,
    gates,
    blockers,
    warnings
  };
}

export function computeReadiness(song: SongRecord) {
  return buildReleaseReadiness(song).score;
}

export function getSplitTotal(song: SongRecord) {
  return Math.round(
    song.credits.reduce((total, credit) => total + (credit.splitPercentage ?? 0), 0) * 100
  ) / 100;
}

export function getMissingWarnings(song: SongRecord) {
  const readiness = buildReleaseReadiness(song);
  const warnings = readiness.blockers.map((blocker) => blocker.replace(/：.*$/, ""));
  if (song.status === "READY_FOR_RELEASE") {
    warnings.push(...readiness.warnings.map((warning) => warning.replace(/：.*$/, "")));
    if (!song.releaseTracks.some((track) => track.isrc)) warnings.push("缺 ISRC");
  }
  return [...new Set(warnings)];
}

export function toSongDto(song: SongRecord) {
  const releaseReadiness = buildReleaseReadiness(song);
  return {
    id: song.id,
    title: song.title,
    workingTitle: song.workingTitle,
    status: song.status,
    statusLabel: statusLabel(song.status),
    bpm: song.bpm,
    musicalKey: song.musicalKey,
    genre: song.genre,
    subgenre: song.subgenre,
    language: song.language,
    mood: parseJsonArray(song.moodJson),
    summary: song.summary,
    notes: song.notes,
    createdOn: toIso(song.createdOn),
    targetReleaseDate: toIso(song.targetReleaseDate),
    createdAt: toIso(song.createdAt),
    updatedAt: toIso(song.updatedAt),
    readiness: releaseReadiness.score,
    releaseReadiness,
    splitTotal: getSplitTotal(song),
    warnings: getMissingWarnings(song),
    lyricsVersions: song.lyricsVersions.map((version) => ({
      id: version.id,
      versionName: version.versionName,
      content: version.content,
      sections: parseJsonValue<Array<{ label: string; startLine?: number; endLine?: number }>>(
        version.sectionsJson,
        []
      ),
      isPrimary: version.isPrimary,
      notes: version.notes,
      createdAt: toIso(version.createdAt),
      updatedAt: toIso(version.updatedAt)
    })),
    audioFiles: song.audioFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      filePath: file.filePath,
      storageProvider: file.storageProvider,
      fileType: file.fileType,
      versionName: file.versionName,
      fileSizeBytes: file.fileSizeBytes,
      sha256: file.sha256,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      codecName: file.codecName,
      containerFormat: file.containerFormat,
      sourceKind: file.sourceKind,
      parentAudioFileId: file.parentAudioFileId,
      originGarageBandLogId: file.originGarageBandLogId,
      qualityStatus: file.qualityStatus,
      isProtectedOriginal: file.isProtectedOriginal,
      durationSeconds: file.durationSeconds,
      sampleRate: file.sampleRate,
      bitDepth: file.bitDepth,
      lufs: file.lufs,
      truePeak: file.truePeak,
      isPrimary: file.isPrimary,
      archivedAt: toIso(file.archivedAt),
      notes: file.notes,
      createdAt: toIso(file.createdAt),
      updatedAt: toIso(file.updatedAt),
      comments: file.comments.map((comment) => ({
        id: comment.id,
        audioFileId: comment.audioFileId,
        songId: comment.songId,
        timestampSeconds: comment.timestampSeconds,
        body: comment.body,
        category: comment.category,
        status: comment.status,
        createdAt: toIso(comment.createdAt),
        updatedAt: toIso(comment.updatedAt)
      })),
      analyses: file.analyses.map((analysis) => ({
        id: analysis.id,
        audioFileId: analysis.audioFileId,
        durationSeconds: analysis.durationSeconds,
        peak: analysis.peak,
        rms: analysis.rms,
        energy: parseJsonValue<number[]>(analysis.energyJson, []),
        waveform: parseJsonValue<number[]>(analysis.waveformJson, []),
        suggestedBpm: analysis.suggestedBpm,
        suggestedMood: parseJsonArray(analysis.suggestedMoodJson),
        suggestedUseCase: parseJsonArray(analysis.suggestedUseCaseJson),
        createdAt: toIso(analysis.createdAt)
      })),
      qualityReports: file.qualityReports.map((report) => ({
        id: report.id,
        audioFileId: report.audioFileId,
        sha256: report.sha256,
        fileSizeBytes: report.fileSizeBytes,
        formatName: report.formatName,
        containerFormat: report.containerFormat,
        codecName: report.codecName,
        sampleRate: report.sampleRate,
        bitDepth: report.bitDepth,
        bitRate: report.bitRate,
        channels: report.channels,
        durationSeconds: report.durationSeconds,
        peak: report.peak,
        rms: report.rms,
        integratedLufs: report.integratedLufs,
        truePeak: report.truePeak,
        clippingSampleCount: report.clippingSampleCount,
        clippingRisk: report.clippingRisk,
        lowQualityRisk: report.lowQualityRisk,
        sampleRateMismatch: report.sampleRateMismatch,
        bitDepthMismatch: report.bitDepthMismatch,
        warnings: parseJsonValue<string[]>(report.warningsJson, []),
        metrics: parseJsonValue<Record<string, unknown>>(report.metricsJson, {}),
        verdict: report.verdict,
        analyzer: report.analyzer,
        analyzerVersion: report.analyzerVersion,
        errorMessage: report.errorMessage,
        createdAt: toIso(report.createdAt)
      }))
    })),
    credits: song.credits.map((credit) => ({
      id: credit.id,
      role: credit.role,
      splitPercentage: credit.splitPercentage,
      ownershipType: credit.ownershipType,
      notes: credit.notes,
      contributor: {
        id: credit.contributor.id,
        name: credit.contributor.name,
        email: credit.contributor.email,
        defaultRoles: credit.contributor.defaultRoles
      },
      confirmations: credit.confirmations.map((confirmation) => ({
        id: confirmation.id,
        token: confirmation.token,
        status: confirmation.status,
        confirmedAt: toIso(confirmation.confirmedAt),
        displayName: confirmation.displayName,
        emailSnapshot: confirmation.emailSnapshot,
        notes: confirmation.notes,
        createdAt: toIso(confirmation.createdAt),
        updatedAt: toIso(confirmation.updatedAt)
      }))
    })),
    tasks: song.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      statusLabel: taskStatusLabels[task.status] ?? task.status,
      category: task.category,
      dueDate: toIso(task.dueDate),
      sortOrder: task.sortOrder,
      completedAt: toIso(task.completedAt),
      createdAt: toIso(task.createdAt),
      updatedAt: toIso(task.updatedAt)
    })),
    releaseTracks: song.releaseTracks.map((track) => ({
      id: track.id,
      trackNumber: track.trackNumber,
      isrc: track.isrc,
      displayTitle: track.displayTitle,
      release: {
        id: track.release.id,
        title: track.release.title,
        releaseType: track.release.releaseType,
        releaseDate: toIso(track.release.releaseDate),
        status: track.release.status,
        upc: track.release.upc
      }
    })),
    statusHistory: song.statusHistory.map((history) => ({
      id: history.id,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      toStatusLabel: statusLabel(history.toStatus),
      note: history.note,
      changedAt: toIso(history.changedAt)
    })),
    aiSuggestions: song.aiSuggestions.map((suggestion) => ({
      id: suggestion.id,
      suggestionType: suggestion.suggestionType,
      status: suggestion.status,
      inputSnapshot: parseJsonValue(suggestion.inputSnapshotJson, null),
      outputPayload: parseJsonValue(suggestion.outputPayloadJson, null),
      createdAt: toIso(suggestion.createdAt),
      appliedAt: toIso(suggestion.appliedAt)
    })),
    inspirations: song.inspirations.map((inspiration) => ({
      id: inspiration.id,
      title: inspiration.title,
      content: inspiration.content,
      sourceType: inspiration.sourceType,
      status: inspiration.status,
      aiCategory: inspiration.aiCategory,
      mood: parseJsonArray(inspiration.moodJson),
      suggestedTitle: inspiration.suggestedTitle,
      createdAt: toIso(inspiration.createdAt),
      updatedAt: toIso(inspiration.updatedAt)
    })),
    timelineEvents: song.timelineEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      title: event.title,
      description: event.description,
      relatedModel: event.relatedModel,
      relatedId: event.relatedId,
      metadata: parseJsonValue<Record<string, unknown> | null>(event.metadataJson, null),
      createdAt: toIso(event.createdAt)
    })),
    promoAssets: song.promoAssets.map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
      title: asset.title,
      content: asset.content,
      status: asset.status,
      createdAt: toIso(asset.createdAt),
      updatedAt: toIso(asset.updatedAt)
    })),
    garageBandLogs: song.garageBandLogs.map((log) => ({
      id: log.id,
      songId: log.songId,
      operation: log.operation,
      command: log.command,
      payload: parseJsonValue<Record<string, unknown> | null>(log.payloadJson, null),
      payloadJson: log.payloadJson,
      requiresConfirmation: log.requiresConfirmation,
      approvalStatus: log.approvalStatus,
      resultStatus: log.resultStatus,
      notes: log.notes,
      createdAt: toIso(log.createdAt),
      updatedAt: toIso(log.updatedAt)
    })),
    recordingSessions: song.recordingSessions.map((session) => ({
      id: session.id,
      songId: session.songId,
      targetInstrument: session.targetInstrument,
      detectionMode: session.detectionMode,
      targetBpm: session.targetBpm,
      targetKey: session.targetKey,
      metronomeEnabled: session.metronomeEnabled,
      referenceAudioFileId: session.referenceAudioFileId,
      status: session.status,
      notes: session.notes,
      createdAt: toIso(session.createdAt),
      updatedAt: toIso(session.updatedAt),
      takes: session.takes.map((take) => ({
        id: take.id,
        sessionId: take.sessionId,
        songId: take.songId,
        audioFileId: take.audioFileId,
        takeNumber: take.takeNumber,
        label: take.label,
        status: take.status,
        recordedAt: toIso(take.recordedAt),
        createdAt: toIso(take.createdAt),
        updatedAt: toIso(take.updatedAt),
        audioFile: take.audioFile
          ? {
              id: take.audioFile.id,
              fileName: take.audioFile.fileName,
              filePath: take.audioFile.filePath,
              storageProvider: take.audioFile.storageProvider,
              fileType: take.audioFile.fileType,
              versionName: take.audioFile.versionName,
              qualityStatus: take.audioFile.qualityStatus,
              durationSeconds: take.audioFile.durationSeconds
            }
          : null,
        reports: take.reports.map((report) => ({
          id: report.id,
          recordingTakeId: report.recordingTakeId,
          songId: report.songId,
          audioFileId: report.audioFileId,
          analyzer: report.analyzer,
          detectionMode: report.detectionMode,
          overallScore: report.overallScore,
          timingScore: report.timingScore,
          pitchScore: report.pitchScore,
          levelScore: report.levelScore,
          durationSeconds: report.durationSeconds,
          peak: report.peak,
          rms: report.rms,
          tempoDriftMs: report.tempoDriftMs,
          pitchDriftCents: report.pitchDriftCents,
          summary: report.summary,
          recommendations: parseJsonValue<string[]>(report.recommendationsJson, []),
          metrics: parseJsonValue<Record<string, unknown>>(report.metricsJson, {}),
          createdAt: toIso(report.createdAt),
          issues: report.issues.map((issue) => ({
            id: issue.id,
            reportId: issue.reportId,
            recordingTakeId: issue.recordingTakeId,
            songId: issue.songId,
            audioFileId: issue.audioFileId,
            timestampSeconds: issue.timestampSeconds,
            issueType: issue.issueType,
            severity: issue.severity,
            title: issue.title,
            detail: issue.detail,
            suggestion: issue.suggestion,
            measuredValue: issue.measuredValue,
            expectedValue: issue.expectedValue,
            createdAt: toIso(issue.createdAt)
          }))
        }))
      }))
    })),
    soundUsages: song.soundUsages.map((usage) => ({
      id: usage.id,
      songId: usage.songId,
      soundLibraryItemId: usage.soundLibraryItemId,
      role: usage.role,
      section: usage.section,
      status: usage.status,
      statusLabel: soundUsageStatusLabels[usage.status] ?? usage.status,
      notes: usage.notes,
      createdAt: toIso(usage.createdAt),
      updatedAt: toIso(usage.updatedAt),
      soundLibraryItem: {
        id: usage.soundLibraryItem.id,
        name: usage.soundLibraryItem.name,
        itemType: usage.soundLibraryItem.itemType,
        itemTypeLabel: soundItemTypeLabel(usage.soundLibraryItem.itemType),
        family: usage.soundLibraryItem.family,
        era: usage.soundLibraryItem.era,
        source: usage.soundLibraryItem.source,
        description: usage.soundLibraryItem.description,
        tags: parseJsonValue<string[]>(usage.soundLibraryItem.tagsJson, []),
        character: parseJsonValue<string[]>(usage.soundLibraryItem.characterJson, []),
        useCases: parseJsonValue<string[]>(usage.soundLibraryItem.useCasesJson, []),
        chain: parseJsonValue<string[]>(usage.soundLibraryItem.chainJson, []),
        garageBandHint: usage.soundLibraryItem.garageBandHint,
        notes: usage.soundLibraryItem.notes,
        assetPath: usage.soundLibraryItem.assetPath,
        previewPath: usage.soundLibraryItem.previewPath,
        sourceUrl: usage.soundLibraryItem.sourceUrl,
        licenseName: usage.soundLibraryItem.licenseName,
        licenseUrl: usage.soundLibraryItem.licenseUrl,
        fileSizeBytes: usage.soundLibraryItem.fileSizeBytes,
        sha256: usage.soundLibraryItem.sha256,
        status: usage.soundLibraryItem.status,
        statusLabel: soundStatusLabel(usage.soundLibraryItem.status),
        favorite: usage.soundLibraryItem.favorite,
        createdAt: toIso(usage.soundLibraryItem.createdAt),
        updatedAt: toIso(usage.soundLibraryItem.updatedAt)
      }
    })),
    setupChecklistItems: song.setupChecklistItems.map((item) => ({
      id: item.id,
      songId: item.songId,
      title: item.title,
      category: item.category,
      status: item.status,
      statusLabel: setupChecklistStatusLabels[item.status] ?? item.status,
      priority: item.priority,
      priorityLabel: setupPriorityLabels[item.priority] ?? item.priority,
      sortOrder: item.sortOrder,
      notes: item.notes,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    }))
  };
}
