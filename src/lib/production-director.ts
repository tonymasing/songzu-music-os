import type { SongDto } from "@/lib/music";
import { fileTypeLabel } from "@/lib/music";

export type ProductionStage = "inspiration" | "demo" | "mix" | "master" | "release";

export type ProductionDirectorBrief = {
  stage: {
    id: ProductionStage;
    label: string;
    reason: string;
  };
  nextActions: string[];
  mixingCommands: string[];
  releaseBlockers: string[];
  qualityGate: {
    status: "pass" | "warning" | "fail" | "pending";
    label: string;
    reasons: string[];
  };
  masterReleaseSpec: MasterReleaseSpecReport;
  versionComparison: AudioVersionComparison;
};

export type MasterReleaseSpecReport = {
  status: "pass" | "warning" | "fail" | "pending";
  label: string;
  summary: string;
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "warning" | "fail" | "pending";
    details: string;
  }>;
  recommendations: string[];
};

export type AudioVersionComparison = {
  summary: string;
  rows: Array<{
    id: string;
    fileName: string;
    fileType: string;
    versionName: string | null;
    qualityStatus: string;
    durationSeconds: number | null;
    peak: number | null;
    rms: number | null;
    lufs: number | null;
    commentsTotal: number;
    unresolvedComments: number;
    warnings: string[];
  }>;
  recommendations: string[];
};

export type CatalogStrategy = {
  generatedAt: string;
  priorityRelease: Array<{ songId: string; title: string; reason: string }>;
  needsRerecord: Array<{ songId: string; title: string; reason: string }>;
  pitchPackCandidates: Array<{ songId: string; title: string; reason: string }>;
  needsMetadata: Array<{ songId: string; title: string; reason: string }>;
  nextActions: string[];
};

function hasFile(song: SongDto, fileType: string) {
  return song.audioFiles.some((file) => file.fileType === fileType);
}

function primaryLyrics(song: SongDto) {
  return song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0] ?? null;
}

function latestReport(file: SongDto["audioFiles"][number]) {
  return file.qualityReports[0] ?? null;
}

function latestAnalysis(file: SongDto["audioFiles"][number]) {
  return file.analyses[0] ?? null;
}

function latestPerformanceReport(song: SongDto) {
  return song.recordingSessions
    .flatMap((session) => session.takes.flatMap((take) => take.reports))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null;
}

function isLosslessReleaseFormat(file: SongDto["audioFiles"][number]) {
  const report = latestReport(file);
  const format = `${report?.formatName ?? file.containerFormat ?? ""} ${file.fileName}`.toLowerCase();
  return ["wav", "wave", "aiff", "aif", "flac"].some((item) => format.includes(item));
}

function isCompressedFormat(file: SongDto["audioFiles"][number]) {
  const report = latestReport(file);
  const format = `${report?.formatName ?? file.containerFormat ?? ""} ${report?.codecName ?? file.codecName ?? ""} ${file.fileName}`.toLowerCase();
  return ["mp3", "aac", "m4a", "mp4", "opus", "vorbis"].some((item) => format.includes(item));
}

function worstStatus(statuses: Array<"pass" | "warning" | "fail" | "pending">) {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("pending")) return "pending";
  return "pass";
}

export function buildMasterReleaseSpecReport(song: SongDto): MasterReleaseSpecReport {
  const masterFiles = song.audioFiles.filter((file) => file.fileType === "master");
  const master =
    masterFiles.find((file) => file.qualityStatus === "pass") ??
    masterFiles.find((file) => file.isPrimary) ??
    masterFiles[0] ??
    null;

  if (!master) {
    return {
      status: "pending",
      label: "缺 Master",
      summary: "尚未有 master，還不能做正式發行規格檢查。",
      checks: [
        { id: "master", label: "Master 檔案", status: "pending", details: "先從 GarageBand 匯出或上傳 master。"}
      ],
      recommendations: ["先建立 master_v1，並以 WAV / AIFF 格式匯出。"]
    };
  }

  const report = latestReport(master);
  const formatPass = isLosslessReleaseFormat(master);
  const compressed = isCompressedFormat(master);
  const sampleRate = report?.sampleRate ?? master.sampleRate;
  const bitDepth = report?.bitDepth ?? master.bitDepth;
  const lufs = report?.integratedLufs ?? master.lufs;
  const truePeak = report?.truePeak ?? master.truePeak;
  const clippingRisk = Boolean(report?.clippingRisk) || master.qualityStatus === "fail";
  const fileProtected = Boolean(master.isProtectedOriginal && master.sha256);

  const checks: MasterReleaseSpecReport["checks"] = [
    {
      id: "protected-original",
      label: "原檔保護與 hash",
      status: fileProtected ? "pass" : "pending",
      details: fileProtected ? `SHA-256 已建立：${master.sha256?.slice(0, 12)}...` : "尚未產生 hash，請重新分析或上傳真實檔案。"
    },
    {
      id: "format",
      label: "發行格式",
      status: formatPass ? "pass" : compressed ? "fail" : "warning",
      details: formatPass
        ? "格式適合作為發行 master。"
        : compressed
          ? "偵測到壓縮格式，不建議作為發行 master。"
          : "格式無法完全確認，建議使用 WAV / AIFF。"
    },
    {
      id: "sample-rate",
      label: "Sample rate",
      status: sampleRate ? (sampleRate >= 44_100 ? "pass" : "fail") : "pending",
      details: sampleRate ? `${sampleRate} Hz` : "尚未分析 sample rate。"
    },
    {
      id: "bit-depth",
      label: "Bit depth",
      status: bitDepth ? (bitDepth >= 24 ? "pass" : bitDepth >= 16 ? "warning" : "fail") : "warning",
      details: bitDepth ? `${bitDepth}-bit${bitDepth < 24 ? "，發行 master 建議 24-bit。" : ""}` : "無法確認 bit depth，請人工檢查。"
    },
    {
      id: "clipping",
      label: "Clipping / peak",
      status: clippingRisk ? "fail" : report ? "pass" : "pending",
      details: clippingRisk
        ? "偵測到 clipping、peak 過高或品質未通過。"
        : report
          ? `True peak ${truePeak ?? "--"}，未偵測主要 clipping。`
          : "尚未完成 Audio QA。"
    },
    {
      id: "loudness",
      label: "LUFS 參考",
      status: typeof lufs === "number" ? (lufs > -8 || lufs < -22 ? "warning" : "pass") : "pending",
      details:
        typeof lufs === "number"
          ? `${Math.round(lufs * 10) / 10} LUFS。短影音/串流可人工確認是否過度壓縮。`
          : "尚未取得 LUFS。"
    }
  ];

  const status = worstStatus(checks.map((check) => check.status));
  const recommendations: string[] = [];
  if (!formatPass) recommendations.push("重新從 GarageBand 匯出 WAV / AIFF master，不用 MP3 / AAC 當發行母帶。");
  if (clippingRisk) recommendations.push("重新輸出時降低 master 輸出或 limiter ceiling，保留 headroom。");
  if (sampleRate && sampleRate < 44_100) recommendations.push("重新輸出至少 44.1kHz。");
  if (!bitDepth || bitDepth < 24) recommendations.push("正式 master 建議輸出 24-bit，若只有 16-bit 則標記人工確認。");
  if (typeof lufs === "number" && lufs > -8) recommendations.push("目前 LUFS 偏大，確認是否為刻意 loud master，避免平台轉碼後失真。");
  if (!recommendations.length) recommendations.push("Master 規格看起來可用，下一步確認封面、ISRC、發行文案與分潤。");

  return {
    status,
    label: status === "pass" ? "規格通過" : status === "fail" ? "規格未通過" : status === "warning" ? "需人工確認" : "待分析",
    summary: `${master.fileName}：${fileTypeLabel(master.fileType)} ${master.versionName ? `· ${master.versionName}` : ""}`,
    checks,
    recommendations: recommendations.slice(0, 5)
  };
}

function stageFor(song: SongDto): ProductionDirectorBrief["stage"] {
  const hasMaster = hasFile(song, "master");
  const hasMix = hasFile(song, "mix");
  const hasDemo = hasFile(song, "demo");
  const hasReleaseReadyMaster = song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pass");

  if (song.status === "RELEASED" || (song.status === "READY_FOR_RELEASE" && hasReleaseReadyMaster)) {
    return { id: "release", label: "發行", reason: "已有可用 master，作品重點轉向發行素材與時程。" };
  }
  if (hasMaster) return { id: "master", label: "Master", reason: "已有母帶版本，現在要先確認音質與發行資料。" };
  if (hasMix) return { id: "mix", label: "Mix", reason: "已有混音版本，適合用留言與版本比較推進下一輪混音。" };
  if (hasDemo) return { id: "demo", label: "Demo", reason: "已有 demo，可開始整理編曲與混音方向。" };
  return { id: "inspiration", label: "靈感", reason: "目前還在作品形成期，先把歌詞、demo 與核心情緒補齊。" };
}

function qualityGateFor(song: SongDto): ProductionDirectorBrief["qualityGate"] {
  const masterFiles = song.audioFiles.filter((file) => file.fileType === "master");
  if (!masterFiles.length) {
    return { status: "pending", label: "缺母帶", reasons: ["尚未有 master，不能進入正式發行檢查。"] };
  }

  const reasons = masterFiles.flatMap((file) => {
    const report = latestReport(file);
    const warnings = report?.warnings ?? [];
    if (file.qualityStatus === "fail") return [`${file.fileName} 音質未通過`, ...warnings];
    if (file.qualityStatus === "warning") return [`${file.fileName} 有音質警告`, ...warnings];
    if (file.qualityStatus === "pending") return [`${file.fileName} 尚未完成音質分析`];
    return [];
  });

  if (masterFiles.some((file) => file.qualityStatus === "fail")) return { status: "fail", label: "不可發行", reasons };
  if (masterFiles.some((file) => file.qualityStatus === "warning")) return { status: "warning", label: "需人工確認", reasons };
  if (masterFiles.some((file) => file.qualityStatus === "pass")) return { status: "pass", label: "音質通過", reasons: ["至少一個 master 通過音質檢查。"] };
  return { status: "pending", label: "待分析", reasons };
}

export function compareAudioVersions(song: SongDto): AudioVersionComparison {
  const candidates = song.audioFiles
    .filter((file) => ["demo", "mix", "master"].includes(file.fileType))
    .sort((a, b) => {
      const order = { demo: 1, mix: 2, master: 3 } as Record<string, number>;
      return (order[a.fileType] ?? 9) - (order[b.fileType] ?? 9) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

  const rows = candidates.map((file) => {
    const report = latestReport(file);
    const analysis = latestAnalysis(file);
    const unresolvedComments = file.comments.filter((comment) => comment.status !== "DONE").length;
    return {
      id: file.id,
      fileName: file.fileName,
      fileType: file.fileType,
      versionName: file.versionName,
      qualityStatus: file.qualityStatus,
      durationSeconds: report?.durationSeconds ?? analysis?.durationSeconds ?? file.durationSeconds,
      peak: report?.peak ?? analysis?.peak ?? null,
      rms: report?.rms ?? analysis?.rms ?? null,
      lufs: report?.integratedLufs ?? file.lufs,
      commentsTotal: file.comments.length,
      unresolvedComments,
      warnings: report?.warnings ?? []
    };
  });

  const recommendations: string[] = [];
  const latestMix = rows.filter((row) => row.fileType === "mix").at(-1);
  const latestMaster = rows.filter((row) => row.fileType === "master").at(-1);
  if (latestMix?.unresolvedComments) recommendations.push(`先處理 ${latestMix.fileName} 的 ${latestMix.unresolvedComments} 則未完成留言。`);
  if (latestMaster?.qualityStatus === "fail") recommendations.push("Master 音質未通過，先重新輸出或保留 headroom。");
  if (latestMix?.lufs && latestMaster?.lufs) {
    const diff = Math.round((latestMaster.lufs - latestMix.lufs) * 10) / 10;
    recommendations.push(`Master 與 Mix LUFS 差異約 ${diff}，請確認母帶是否過度推大。`);
  }
  if (!recommendations.length) recommendations.push("版本資料穩定，下一步可補 timestamp 聽感留言或發行資料。");

  return {
    summary: rows.length ? `已整理 ${rows.length} 個 demo / mix / master 版本。` : "尚無可比較音訊版本。",
    rows,
    recommendations
  };
}

export function buildProductionDirectorBrief(song: SongDto): ProductionDirectorBrief {
  const nextActions: string[] = [];
  const mixingCommands: string[] = [];
  const releaseBlockers: string[] = [];
  const qualityGate = qualityGateFor(song);
  const masterReleaseSpec = buildMasterReleaseSpecReport(song);
  const comparison = compareAudioVersions(song);
  const performanceReport = latestPerformanceReport(song);
  const mixFiles = song.audioFiles.filter((file) => file.fileType === "mix");
  const masterFiles = song.audioFiles.filter((file) => file.fileType === "master");

  if (!primaryLyrics(song)) nextActions.push("補主歌詞版本，讓 AI 可以穩定分析段落與 hook。");
  if (!hasFile(song, "demo")) nextActions.push("上傳 demo 或 voice memo，建立第一個聲音版本。");
  if (mixFiles.length && !mixFiles.some((file) => file.comments.length)) nextActions.push("在 Mix 檔案新增 timestamp 留言，讓下一輪混音有明確依據。");
  if (!hasFile(song, "cover")) nextActions.push("補封面或產生封面 prompt。");
  if (song.splitTotal !== 100) nextActions.push(`修正分潤比例，目前是 ${song.splitTotal}%。`);
  if (!masterFiles.length) nextActions.push("完成 master 版本並執行 Audio QA。");
  if (qualityGate.status === "fail") nextActions.push("重新輸出 master，先解決音質未通過項目。");
  if (performanceReport && performanceReport.overallScore < 70) {
    nextActions.push(`最近錄音偵測 ${performanceReport.overallScore} 分，先重錄 ${performanceReport.issues[0]?.title ?? "問題段落"}。`);
  }
  if (!song.promoAssets.length) nextActions.push("產生發行素材初稿，補齊文案、短影音與 pitch。");
  if (!nextActions.length) nextActions.push("作品狀態穩定，可以準備分享包或發行時程。");

  const unresolvedMixComments = mixFiles.flatMap((file) =>
    file.comments.filter((comment) => comment.status !== "DONE").map((comment) => `${file.fileName} ${Math.round(comment.timestampSeconds)} 秒：${comment.body}`)
  );
  mixingCommands.push(...unresolvedMixComments.slice(0, 5));
  if (performanceReport?.issues.length) {
    mixingCommands.push(
      `錄音偵測提醒：${performanceReport.issues
        .slice(0, 3)
        .map((issue) => `${Math.round(issue.timestampSeconds)} 秒 ${issue.title}`)
        .join("、")}。混音前先決定是否重錄。`
    );
  }
  if (!mixingCommands.length && mixFiles.length) mixingCommands.push("先完整聽 Mix 一次，新增至少 3 則 timestamp 留言：人聲、鼓/低頻、空間感。");
  if (song.garageBandLogs.length) {
    mixingCommands.push(`延續最近 GarageBand 操作：「${song.garageBandLogs[0].operation}」，確認結果是否已反映在新版本。`);
  }
  if (!mixingCommands.length) mixingCommands.push("先輸出 rough mix，再回到此頁建立混音指令。");

  releaseBlockers.push(...song.releaseReadiness.blockers, ...song.releaseReadiness.warnings);
  if (masterReleaseSpec.status === "fail" && !releaseBlockers.some((item) => item.includes("Master 音質"))) {
    releaseBlockers.push("Master 發行規格未通過。");
  }
  if (!song.releaseTracks.some((track) => track.isrc)) releaseBlockers.push("缺 ISRC。");

  return {
    stage: stageFor(song),
    nextActions: nextActions.slice(0, 8),
    mixingCommands: mixingCommands.slice(0, 8),
    releaseBlockers: releaseBlockers.slice(0, 8),
    qualityGate,
    masterReleaseSpec,
    versionComparison: comparison
  };
}

export function buildCatalogStrategy(songs: SongDto[]): CatalogStrategy {
  const briefs = songs.map((song) => ({ song, brief: buildProductionDirectorBrief(song) }));
  const priorityRelease = briefs
    .filter(({ song }) => song.releaseReadiness.ready)
    .slice(0, 5)
    .map(({ song, brief }) => ({
      songId: song.id,
      title: song.title,
      reason: `${song.readiness}% 完整度，階段：${brief.stage.label}。`
    }));
  const needsRerecord = briefs
    .filter(({ song, brief }) => {
      const performanceReport = latestPerformanceReport(song);
      return brief.qualityGate.status === "fail" || brief.nextActions.some((action) => action.includes("demo")) || Boolean(performanceReport && performanceReport.overallScore < 70);
    })
    .slice(0, 5)
    .map(({ song, brief }) => ({
      songId: song.id,
      title: song.title,
      reason: latestPerformanceReport(song)?.overallScore && latestPerformanceReport(song)!.overallScore < 70
        ? `最近錄音偵測 ${latestPerformanceReport(song)!.overallScore} 分，建議重錄問題段落。`
        : brief.qualityGate.status === "fail" ? "Master 音質未通過，建議重輸出或重錄。" : brief.nextActions[0]
    }));
  const pitchPackCandidates = briefs
    .filter(({ song }) => song.summary && (hasFile(song, "demo") || hasFile(song, "mix") || hasFile(song, "master")))
    .slice(0, 6)
    .map(({ song }) => ({
      songId: song.id,
      title: song.title,
      reason: song.summary ?? "已有可聆聽版本。"
    }));
  const needsMetadata = briefs
    .filter(({ song, brief }) => song.warnings.length || brief.releaseBlockers.length)
    .slice(0, 8)
    .map(({ song, brief }) => ({
      songId: song.id,
      title: song.title,
      reason: brief.releaseBlockers[0] ?? song.warnings[0] ?? "需要補資料。"
    }));

  return {
    generatedAt: new Date().toISOString(),
    priorityRelease,
    needsRerecord,
    pitchPackCandidates,
    needsMetadata,
    nextActions: [
      priorityRelease.length ? `先推進 ${priorityRelease[0].title} 的發行包。` : "先挑一首完整度最高的歌補 master 與封面。",
      needsMetadata.length ? `集中補 ${needsMetadata.length} 首歌的 metadata 缺口。` : "Metadata 狀態穩定，可以準備分享包。",
      pitchPackCandidates.length ? "建立一個 3 首歌的私密分享包給合作窗口。" : "先整理 demo/mix，累積可分享版本。"
    ]
  };
}

export function productionDirectorBriefToText(brief: ProductionDirectorBrief) {
  return [
    `目前階段：${brief.stage.label}。${brief.stage.reason}`,
    `音質狀態：${brief.qualityGate.label}`,
    `下一步：${brief.nextActions.slice(0, 3).join(" / ")}`,
    brief.releaseBlockers.length ? `發行阻塞：${brief.releaseBlockers.join(" / ")}` : "發行阻塞：目前沒有主要阻塞。"
  ].join("\n");
}
