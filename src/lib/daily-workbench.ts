import type { SongDto } from "@/lib/music";
import { buildCatalogStrategy, buildProductionDirectorBrief } from "@/lib/production-director";

export type DailyWorkbenchItem = {
  id: string;
  songId: string;
  title: string;
  lane: "release" | "quality" | "mix" | "metadata" | "garageband" | "catalog";
  label: string;
  priority: "high" | "medium" | "low";
  action: string;
  reason: string;
  href: string;
};

export type DailyWorkbench = {
  generatedAt: string;
  metrics: {
    focusItems: number;
    releaseCandidates: number;
    qualityRisks: number;
    pendingMasterQa: number;
    unresolvedMixComments: number;
    garageBandFollowUps: number;
  };
  focusItems: DailyWorkbenchItem[];
  lanes: Array<{
    id: DailyWorkbenchItem["lane"];
    label: string;
    items: DailyWorkbenchItem[];
  }>;
  catalogActions: string[];
};

const priorityRank = {
  high: 3,
  medium: 2,
  low: 1
} satisfies Record<DailyWorkbenchItem["priority"], number>;

function daysSince(value: string | null | undefined) {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function pushItem(
  items: DailyWorkbenchItem[],
  song: SongDto,
  patch: Omit<DailyWorkbenchItem, "id" | "songId" | "title" | "href">
) {
  items.push({
    id: `${song.id}-${patch.lane}-${items.length}`,
    songId: song.id,
    title: song.title,
    href: `/songs/${song.id}`,
    ...patch
  });
}

export function buildDailyWorkbench(songs: SongDto[]): DailyWorkbench {
  const items: DailyWorkbenchItem[] = [];
  const briefs = songs.map((song) => ({ song, brief: buildProductionDirectorBrief(song) }));

  for (const { song, brief } of briefs) {
    const unresolvedMixComments = song.audioFiles
      .filter((file) => file.fileType === "mix")
      .flatMap((file) => file.comments.filter((comment) => comment.status !== "DONE"));
    const pendingMaster = song.audioFiles.find((file) => file.fileType === "master" && file.qualityStatus === "pending");
    const failingMaster = song.audioFiles.find((file) => file.fileType === "master" && file.qualityStatus === "fail");
    const garageBandFollowUp = song.garageBandLogs.find((log) => log.resultStatus === "DONE" || log.resultStatus === "QUEUED");
    const ageDays = daysSince(song.updatedAt);

    if (failingMaster || brief.masterReleaseSpec.status === "fail") {
      pushItem(items, song, {
        lane: "quality",
        label: "音質修復",
        priority: "high",
        action: "重新輸出 master 或先處理 clipping / 格式問題。",
        reason: brief.masterReleaseSpec.recommendations[0] ?? "Master 音質未通過。"
      });
    } else if (pendingMaster) {
      pushItem(items, song, {
        lane: "quality",
        label: "Audio QA",
        priority: "high",
        action: "重新分析 master，建立 hash、LUFS、clipping 與發行規格。",
        reason: `${pendingMaster.fileName} 尚未完成音質分析。`
      });
    }

    if (brief.releaseBlockers.length && song.readiness >= 55) {
      pushItem(items, song, {
        lane: "release",
        label: "發行阻塞",
        priority: song.status === "READY_FOR_RELEASE" ? "high" : "medium",
        action: brief.releaseBlockers[0],
        reason: `${song.readiness}% 完整度，已值得補發行缺口。`
      });
    }

    if (unresolvedMixComments.length) {
      pushItem(items, song, {
        lane: "mix",
        label: "混音回合",
        priority: "medium",
        action: `處理 ${unresolvedMixComments.length} 則 timestamp 留言。`,
        reason: unresolvedMixComments[0]?.body ?? "Mix 還有未處理留言。"
      });
    } else if (brief.stage.id === "mix") {
      pushItem(items, song, {
        lane: "mix",
        label: "補混音留言",
        priority: "medium",
        action: "完整聽一次 mix，新增人聲、低頻、空間感三則留言。",
        reason: "Mix 階段需要可執行的聽感註記。"
      });
    }

    if (brief.nextActions.length && song.readiness < 70) {
      pushItem(items, song, {
        lane: "metadata",
        label: "補作品資料",
        priority: "medium",
        action: brief.nextActions[0],
        reason: song.warnings[0] ?? brief.stage.reason
      });
    }

    if (garageBandFollowUp) {
      pushItem(items, song, {
        lane: "garageband",
        label: "GarageBand 交接",
        priority: garageBandFollowUp.resultStatus === "DONE" ? "medium" : "low",
        action: "確認 GarageBand 操作結果，必要時匯入 export 為新版本。",
        reason: `${garageBandFollowUp.operation} · ${garageBandFollowUp.resultStatus}`
      });
    }

    if (ageDays >= 10 && song.status !== "RELEASED" && song.status !== "ARCHIVED") {
      pushItem(items, song, {
        lane: "catalog",
        label: "久未更新",
        priority: "low",
        action: "決定要推進、暫停或封存，避免作品庫堆積。",
        reason: `${ageDays} 天未更新。`
      });
    }
  }

  const sortedItems = items
    .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority] || a.title.localeCompare(b.title, "zh-Hant"))
    .slice(0, 18);
  const strategy = buildCatalogStrategy(songs);
  const releaseCandidates = briefs.filter(({ song }) => song.releaseReadiness.ready).length;
  const qualityRisks = briefs.filter(({ brief }) => ["fail", "warning"].includes(brief.masterReleaseSpec.status)).length;
  const pendingMasterQa = songs.filter((song) => song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pending")).length;
  const unresolvedMixComments = songs.reduce(
    (count, song) =>
      count +
      song.audioFiles
        .filter((file) => file.fileType === "mix")
        .flatMap((file) => file.comments.filter((comment) => comment.status !== "DONE")).length,
    0
  );
  const garageBandFollowUps = songs.reduce((count, song) => count + song.garageBandLogs.filter((log) => log.resultStatus !== "CANCELLED").length, 0);

  const laneDefs: Array<{ id: DailyWorkbenchItem["lane"]; label: string }> = [
    { id: "quality", label: "音質保護" },
    { id: "release", label: "發行準備" },
    { id: "mix", label: "混音工作" },
    { id: "garageband", label: "GarageBand" },
    { id: "metadata", label: "作品資料" },
    { id: "catalog", label: "作品庫策略" }
  ];

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      focusItems: sortedItems.length,
      releaseCandidates,
      qualityRisks,
      pendingMasterQa,
      unresolvedMixComments,
      garageBandFollowUps
    },
    focusItems: sortedItems.slice(0, 8),
    lanes: laneDefs.map((lane) => ({
      ...lane,
      items: sortedItems.filter((item) => item.lane === lane.id).slice(0, 4)
    })),
    catalogActions: strategy.nextActions
  };
}
