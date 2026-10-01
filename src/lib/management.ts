import { buildDailyWorkbench, type DailyWorkbenchItem } from "@/lib/daily-workbench";
import { getSongs } from "@/lib/data";
import { parseJsonValue, type SongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { buildCatalogStrategy } from "@/lib/production-director";
import { listSystemBackups } from "@/lib/system-backup";
import { buildSystemHealth } from "@/lib/system-health";

export type ManagementCycleType = "daily" | "weekly" | "monthly";
export type ManagementTone = "danger" | "warning" | "good" | "neutral";

export type ManagementAction = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: ManagementTone;
  category: string;
  dueAt?: string | null;
};

export type ManagementCycleReport = {
  type: ManagementCycleType;
  periodKey: string;
  label: string;
  title: string;
  summary: string;
  generatedAt: string;
  metrics: Array<{ label: string; value: string; detail: string; tone: ManagementTone }>;
  actions: ManagementAction[];
  suggestionId: string | null;
  reviewStatus: "live" | "pending" | "applied" | "dismissed" | "archived";
};

export type ManagementOverview = {
  generatedAt: string;
  metrics: {
    todayTasks: number;
    unscheduledTasks: number;
    upcomingReleases: number;
    releaseCandidates: number;
    qualityFailures: number;
    pendingRights: number;
    pendingOrders: number;
    monthRevenue: number;
    monthRevenueCurrency: string;
    systemRisks: number;
  };
  actionQueue: ManagementAction[];
  upcomingReleases: Array<{
    id: string;
    title: string;
    releaseDate: string | null;
    status: string;
    readiness: number;
    blockers: number;
  }>;
  releaseCandidates: Array<{
    id: string;
    title: string;
    releaseDate: string | null;
    status: string;
    readiness: number;
    blockers: number;
  }>;
  qualityFailures: Array<{ id: string; songId: string; songTitle: string; fileName: string }>;
  pendingRights: Array<{ creditId: string; songId: string; songTitle: string; contributorName: string; splitPercentage: number | null }>;
  pendingOrders: Array<{ id: string; orderCode: string; title: string; customerName: string; amount: number; currency: string; status: string }>;
  revenueByCurrency: Array<{ currency: string; amount: number; count: number }>;
  system: {
    highRisks: number;
    mediumRisks: number;
    latestBackupAt: string | null;
    backupAgeDays: number | null;
    issues: Array<{ id: string; severity: "high" | "medium" | "low"; title: string; detail: string; href?: string }>;
  };
  cycles: Record<ManagementCycleType, ManagementCycleReport>;
};

type ManagementContext = {
  now: Date;
  songs: SongDto[];
  daily: ReturnType<typeof buildDailyWorkbench>;
  releases: Array<{
    id: string;
    title: string;
    releaseDate: Date | null;
    status: string;
    tracks: Array<{ songId: string }>;
  }>;
  pendingOrders: ManagementOverview["pendingOrders"];
  revenueByCurrency: ManagementOverview["revenueByCurrency"];
  paidOrdersThisMonth: number;
  deliveredOrdersThisMonth: number;
  completedPublishesThisMonth: number;
  system: ManagementOverview["system"];
  persistedReports: Partial<Record<ManagementCycleType, ManagementCycleReport>>;
};

const cycleSuggestionTypes: Record<ManagementCycleType, string> = {
  daily: "management_daily",
  weekly: "management_weekly",
  monthly: "management_monthly"
};

const confirmedReleaseStatuses = new Set(["DISTRIBUTED"]);
const releaseCandidateStatuses = new Set(["PLANNING", "ASSET_PREP", "DISTRIBUTION_READY"]);

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfNextMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 1);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(value: Date) {
  return localDateKey(value).slice(0, 7);
}

function isoWeekKey(value: Date) {
  const utc = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function ageInDays(now: Date, value: string | null) {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000));
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("zh-TW")}`;
  }
}

function actionFromDaily(item: DailyWorkbenchItem): ManagementAction {
  return {
    id: `daily-${item.id}`,
    title: `${item.title} · ${item.label}`,
    detail: item.action,
    href: item.href,
    tone: item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "neutral",
    category: item.label
  };
}

function reportWithPersistence(
  report: Omit<ManagementCycleReport, "suggestionId" | "reviewStatus">,
  persisted: ManagementCycleReport | undefined
): ManagementCycleReport {
  if (persisted?.periodKey === report.periodKey) {
    return { ...report, suggestionId: persisted.suggestionId, reviewStatus: persisted.reviewStatus };
  }
  return { ...report, suggestionId: null, reviewStatus: "live" };
}

function buildCycleReports(context: ManagementContext, actionQueue: ManagementAction[]): ManagementOverview["cycles"] {
  const { now, songs, daily, releases, pendingOrders, revenueByCurrency, system, persistedReports } = context;
  const today = startOfDay(now);
  const weekHorizon = addDays(today, 7);
  const strategy = buildCatalogStrategy(songs);
  const dueToday = songs.flatMap((song) => song.tasks.filter((task) => task.status !== "DONE" && task.dueDate && new Date(task.dueDate) < addDays(today, 1)));
  const weekReleases = releases.filter(
    (release) => confirmedReleaseStatuses.has(release.status) && release.releaseDate && release.releaseDate >= today && release.releaseDate < weekHorizon
  );
  const releaseCandidates = releases.filter((release) => releaseCandidateStatuses.has(release.status));
  const monthRevenue = revenueByCurrency[0] ?? { currency: "TWD", amount: 0, count: 0 };

  const dailyReport = reportWithPersistence({
    type: "daily",
    periodKey: localDateKey(now),
    label: "每日",
    title: "今天先清掉真正的阻塞",
    summary: actionQueue.length
      ? `今天有 ${actionQueue.length} 個管理訊號，先處理音質、已確認期限與對外承諾。`
      : "今天沒有高優先阻塞，可以推進創作或整理作品庫。",
    generatedAt: now.toISOString(),
    metrics: [
      { label: "到期待辦", value: String(dueToday.length), detail: "含逾期與今天到期", tone: dueToday.length ? "danger" : "good" },
      { label: "今日焦點", value: String(daily.metrics.focusItems), detail: "由作品與音質自動判斷", tone: daily.metrics.focusItems ? "warning" : "good" },
      { label: "待處理認領", value: String(pendingOrders.length), detail: "新單與等待付款", tone: pendingOrders.length ? "warning" : "good" },
      { label: "系統風險", value: String(system.highRisks), detail: "高風險檔案或儲存問題", tone: system.highRisks ? "danger" : "good" }
    ],
    actions: actionQueue.slice(0, 6)
  }, persistedReports.daily);

  const weeklyActions: ManagementAction[] = [
    ...strategy.priorityRelease.slice(0, 2).map((item, index) => ({
      id: `weekly-release-${item.songId}`,
      title: `${index + 1}. 優先推進 ${item.title}`,
      detail: item.reason,
      href: `/songs/${item.songId}`,
      tone: "good" as const,
      category: "作品優先級"
    })),
    ...strategy.needsMetadata.slice(0, 2).map((item) => ({
      id: `weekly-metadata-${item.songId}`,
      title: `${item.title} · 補發行缺口`,
      detail: item.reason,
      href: `/songs/${item.songId}`,
      tone: "warning" as const,
      category: "Metadata"
    })),
    ...weekReleases.slice(0, 2).map((release) => ({
      id: `weekly-deadline-${release.id}`,
      title: `${release.title} · 本週已確認發行`,
      detail: release.releaseDate ? `已確認 ${localDateKey(release.releaseDate)}` : "尚未設定日期",
      href: "/releases",
      tone: "danger" as const,
      category: "正式排程",
      dueAt: release.releaseDate?.toISOString() ?? null
    }))
  ];
  const weeklyReport = reportWithPersistence({
    type: "weekly",
    periodKey: isoWeekKey(now),
    label: "每週 AI",
    title: "本週作品優先級與交付順序",
    summary: strategy.priorityRelease.length
      ? `本機 AI 從 ${songs.length} 首作品中挑出 ${strategy.priorityRelease.length} 首優先候選。`
      : "目前沒有可直接推進發行的作品，先補 Master、Metadata 與權利資料。",
    generatedAt: now.toISOString(),
    metrics: [
      { label: "優先候選", value: String(strategy.priorityRelease.length), detail: "完整度與音質門檻較高，尚非承諾", tone: strategy.priorityRelease.length ? "good" : "warning" },
      { label: "需要重錄", value: String(strategy.needsRerecord.length), detail: "錄音或 Master 需處理", tone: strategy.needsRerecord.length ? "warning" : "good" },
      { label: "補齊資料", value: String(strategy.needsMetadata.length), detail: "Metadata 或權利缺口", tone: strategy.needsMetadata.length ? "warning" : "good" },
      { label: "七日內正式排程", value: String(weekReleases.length), detail: `${releaseCandidates.length} 個候選不列期限`, tone: weekReleases.length ? "danger" : "good" }
    ],
    actions: weeklyActions.length ? weeklyActions.slice(0, 6) : actionQueue.slice(0, 4)
  }, persistedReports.weekly);

  const monthlyActions: ManagementAction[] = [];
  if (monthRevenue.count === 0) {
    monthlyActions.push({ id: "monthly-revenue", title: "核對本月平台與直接收入", detail: "目前本月尚未登錄收入，確認是否有待匯入報表。", href: "/publishing", tone: "warning", category: "收益" });
  }
  if (system.backupAgeDays === null || system.backupAgeDays > 30) {
    monthlyActions.push({ id: "monthly-backup", title: "建立本月完整備份", detail: system.backupAgeDays === null ? "尚未找到系統備份。" : `最近備份距今 ${system.backupAgeDays} 天。`, href: "/settings", tone: "danger", category: "資料安全" });
  }
  if (context.pendingOrders.length) {
    monthlyActions.push({ id: "monthly-orders", title: "結清尚未完成的認領單", detail: `${context.pendingOrders.length} 張訂單仍在等待付款或處理。`, href: "/storefront", tone: "warning", category: "認領" });
  }
  if (!monthlyActions.length) {
    monthlyActions.push({ id: "monthly-review", title: "完成本月事業回顧", detail: "收入、訂單與備份目前沒有主要異常。", href: "/publishing", tone: "good", category: "月結" });
  }
  const monthlyReport = reportWithPersistence({
    type: "monthly",
    periodKey: monthKey(now),
    label: "每月",
    title: "收入、授權、交付與資料安全月結",
    summary: `本月已記錄 ${formatMoney(monthRevenue.amount, monthRevenue.currency)}，並完成 ${context.completedPublishesThisMonth} 次平台發布。`,
    generatedAt: now.toISOString(),
    metrics: [
      { label: "本月收入", value: formatMoney(monthRevenue.amount, monthRevenue.currency), detail: `${monthRevenue.count} 筆帳目`, tone: monthRevenue.amount > 0 ? "good" : "neutral" },
      { label: "已付款認領", value: String(context.paidOrdersThisMonth), detail: "本月確認付款", tone: context.paidOrdersThisMonth ? "good" : "neutral" },
      { label: "已交付", value: String(context.deliveredOrdersThisMonth), detail: "本月完成認領交付", tone: context.deliveredOrdersThisMonth ? "good" : "neutral" },
      { label: "最近備份", value: system.backupAgeDays === null ? "尚無" : `${system.backupAgeDays} 天前`, detail: system.latestBackupAt ? localDateKey(new Date(system.latestBackupAt)) : "請建立第一份備份", tone: system.backupAgeDays === null || system.backupAgeDays > 30 ? "danger" : "good" }
    ],
    actions: monthlyActions.slice(0, 6)
  }, persistedReports.monthly);

  return { daily: dailyReport, weekly: weeklyReport, monthly: monthlyReport };
}

async function loadManagementContext(now = new Date(), providedSongs?: SongDto[]): Promise<ManagementContext> {
  const songs = providedSongs ?? await getSongs();
  const monthStart = startOfMonth(now);
  const nextMonth = startOfNextMonth(now);
  const [releases, claimOrders, revenues, completedPublishesThisMonth, backups, health, savedSuggestions] = await Promise.all([
    prisma.release.findMany({
      select: { id: true, title: true, releaseDate: true, status: true, tracks: { select: { songId: true } } },
      orderBy: [{ releaseDate: "asc" }, { updatedAt: "desc" }]
    }),
    prisma.claimOrder.findMany({
      where: { status: { in: ["REQUESTED", "AWAITING_PAYMENT", "IN_PROGRESS"] } },
      include: { offer: { include: { preview: true } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.revenueRecord.findMany({
      where: { periodStart: { gte: monthStart, lt: nextMonth } },
      orderBy: { periodStart: "desc" }
    }),
    prisma.platformPublishJob.count({ where: { status: "COMPLETED", completedAt: { gte: monthStart, lt: nextMonth } } }),
    listSystemBackups(),
    buildSystemHealth(songs),
    prisma.aiSuggestion.findMany({
      where: { suggestionType: { in: Object.values(cycleSuggestionTypes) } },
      orderBy: { createdAt: "desc" },
      take: 18
    })
  ]);

  const revenueMap = new Map<string, { currency: string; amount: number; count: number }>();
  for (const record of revenues) {
    const current = revenueMap.get(record.currency) ?? { currency: record.currency, amount: 0, count: 0 };
    current.amount += record.grossAmount;
    current.count += 1;
    revenueMap.set(record.currency, current);
  }
  const revenueByCurrency = [...revenueMap.values()].sort((a, b) => b.amount - a.amount);
  const latestBackupAt = backups[0]?.createdAt ?? null;
  const persistedReports: ManagementContext["persistedReports"] = {};
  for (const suggestion of savedSuggestions) {
    const type = (Object.entries(cycleSuggestionTypes).find(([, value]) => value === suggestion.suggestionType)?.[0] ?? null) as ManagementCycleType | null;
    if (!type || persistedReports[type]) continue;
    const report = parseJsonValue<ManagementCycleReport | null>(suggestion.outputPayloadJson, null);
    if (!report) continue;
    persistedReports[type] = {
      ...report,
      suggestionId: suggestion.id,
      reviewStatus: suggestion.status as ManagementCycleReport["reviewStatus"]
    };
  }

  return {
    now,
    songs,
    daily: buildDailyWorkbench(songs),
    releases,
    pendingOrders: claimOrders.map((order) => ({
      id: order.id,
      orderCode: order.orderCode,
      title: order.offer.preview.title || order.offer.title,
      customerName: order.customerName,
      amount: order.amountSnapshot,
      currency: order.currency,
      status: order.status
    })),
    revenueByCurrency,
    paidOrdersThisMonth: await prisma.claimOrder.count({ where: { paidAt: { gte: monthStart, lt: nextMonth } } }),
    deliveredOrdersThisMonth: await prisma.claimOrder.count({ where: { completedAt: { gte: monthStart, lt: nextMonth } } }),
    completedPublishesThisMonth,
    system: {
      highRisks: health.issues.filter((issue) => issue.severity === "high").length,
      mediumRisks: health.issues.filter((issue) => issue.severity === "medium").length,
      latestBackupAt,
      backupAgeDays: ageInDays(now, latestBackupAt),
      issues: health.issues
    },
    persistedReports
  };
}

export async function getManagementOverview(now = new Date(), providedSongs?: SongDto[]): Promise<ManagementOverview> {
  const context = await loadManagementContext(now, providedSongs);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const releaseHorizon = addDays(today, 30);
  const songMap = new Map(context.songs.map((song) => [song.id, song]));
  const todayTasks = context.songs.flatMap((song) =>
    song.tasks
      .filter((task) => task.status !== "DONE" && task.dueDate && new Date(task.dueDate) < tomorrow)
      .map((task) => ({ song, task }))
  );
  const unscheduledTasks = context.songs.flatMap((song) =>
    song.tasks
      .filter((task) => task.status !== "DONE" && !task.dueDate)
      .map((task) => ({ song, task }))
  );
  const upcomingReleases = context.releases
    .filter(
      (release) => confirmedReleaseStatuses.has(release.status) && release.releaseDate && release.releaseDate >= today && release.releaseDate < releaseHorizon
    )
    .map((release) => {
      const trackStates = release.tracks.map((track) => songMap.get(track.songId)?.releaseReadiness).filter(Boolean) as SongDto["releaseReadiness"][];
      return {
        id: release.id,
        title: release.title,
        releaseDate: release.releaseDate?.toISOString() ?? null,
        status: release.status,
        readiness: trackStates.length ? Math.round(trackStates.reduce((sum, state) => sum + state.score, 0) / trackStates.length) : 0,
        blockers: trackStates.reduce((sum, state) => sum + state.blockers.length, 0)
      };
    });
  const releaseCandidates = context.releases
    .filter((release) => releaseCandidateStatuses.has(release.status))
    .map((release) => {
      const trackStates = release.tracks.map((track) => songMap.get(track.songId)?.releaseReadiness).filter(Boolean) as SongDto["releaseReadiness"][];
      return {
        id: release.id,
        title: release.title,
        releaseDate: release.releaseDate?.toISOString() ?? null,
        status: release.status,
        readiness: trackStates.length ? Math.round(trackStates.reduce((sum, state) => sum + state.score, 0) / trackStates.length) : 0,
        blockers: trackStates.reduce((sum, state) => sum + state.blockers.length, 0)
      };
    });
  const qualityFailures = context.songs.flatMap((song) =>
    song.audioFiles
      .filter((file) => !file.archivedAt && file.qualityStatus === "fail")
      .map((file) => ({ id: file.id, songId: song.id, songTitle: song.title, fileName: file.fileName }))
  );
  const pendingRights = context.songs.flatMap((song) =>
    song.credits
      .filter((credit) => !credit.confirmations.some((confirmation) => confirmation.status === "CONFIRMED"))
      .map((credit) => ({
        creditId: credit.id,
        songId: song.id,
        songTitle: song.title,
        contributorName: credit.contributor.name,
        splitPercentage: credit.splitPercentage
      }))
  );

  const actionQueue: ManagementAction[] = [
    ...todayTasks.map(({ song, task }) => ({
      id: `task-${task.id}`,
      title: `${song.title} · ${task.title}`,
      detail: task.status === "BLOCKED" ? "目前標記為卡住。" : new Date(task.dueDate as string) < today ? "已逾期，請重新安排或完成。" : "今天到期。",
      href: `/songs/${song.id}`,
      tone: "danger" as const,
      category: "待辦",
      dueAt: task.dueDate
    })),
    ...(unscheduledTasks.length
      ? [{
          id: "tasks-unscheduled",
          title: `${unscheduledTasks.length} 項工作尚未安排日期`,
          detail: "先挑本週真正要做的；其餘保留在作品內，不視為逾期。",
          href: "/songs",
          tone: "neutral" as const,
          category: "排程"
        }]
      : []),
    ...qualityFailures.map((item) => ({ id: `quality-${item.id}`, title: `${item.songTitle} · Master 音質`, detail: `${item.fileName} 未通過 Audio QA。`, href: `/songs/${item.songId}`, tone: "danger" as const, category: "音質" })),
    ...context.pendingOrders.map((order) => ({ id: `order-${order.id}`, title: `${order.orderCode} · ${order.customerName}`, detail: `${order.title} · ${formatMoney(order.amount, order.currency)} · ${order.status}`, href: "/storefront", tone: "warning" as const, category: "認領訂單" })),
    ...upcomingReleases.filter((release) => release.blockers > 0).map((release) => ({ id: `release-${release.id}`, title: `${release.title} · 發行阻塞`, detail: `${release.readiness}% 準備度，仍有 ${release.blockers} 個必修門檻。`, href: "/releases", tone: "warning" as const, category: "發行", dueAt: release.releaseDate })),
    ...context.system.issues.filter((issue) => issue.severity === "high").map((issue) => ({ id: `system-${issue.id}`, title: issue.title, detail: issue.detail, href: issue.href || "/settings", tone: "danger" as const, category: "系統" })),
    ...context.daily.focusItems.map(actionFromDaily)
  ];
  const dedupedActions = [...new Map(actionQueue.map((action) => [`${action.href}-${action.title}`, action])).values()].slice(0, 14);
  const primaryRevenue = context.revenueByCurrency[0] ?? { currency: "TWD", amount: 0, count: 0 };
  const cycles = buildCycleReports(context, dedupedActions);

  return {
    generatedAt: now.toISOString(),
    metrics: {
      todayTasks: todayTasks.length,
      unscheduledTasks: unscheduledTasks.length,
      upcomingReleases: upcomingReleases.length,
      releaseCandidates: releaseCandidates.length,
      qualityFailures: qualityFailures.length,
      pendingRights: pendingRights.length,
      pendingOrders: context.pendingOrders.length,
      monthRevenue: primaryRevenue.amount,
      monthRevenueCurrency: primaryRevenue.currency,
      systemRisks: context.system.highRisks + context.system.mediumRisks
    },
    actionQueue: dedupedActions,
    upcomingReleases,
    releaseCandidates,
    qualityFailures,
    pendingRights,
    pendingOrders: context.pendingOrders,
    revenueByCurrency: context.revenueByCurrency,
    system: context.system,
    cycles
  };
}

export async function generateManagementCycle(type: ManagementCycleType) {
  const overview = await getManagementOverview();
  const report = { ...overview.cycles[type], suggestionId: null, reviewStatus: "pending" as const };
  await prisma.aiSuggestion.updateMany({
    where: { suggestionType: cycleSuggestionTypes[type], status: "pending" },
    data: { status: "archived" }
  });
  const suggestion = await prisma.aiSuggestion.create({
    data: {
      songId: null,
      suggestionType: cycleSuggestionTypes[type],
      status: "pending",
      inputSnapshotJson: JSON.stringify({ cycleType: type, periodKey: report.periodKey, generatedBy: "local_management_director" }),
      outputPayloadJson: JSON.stringify(report)
    }
  });
  return { ...report, suggestionId: suggestion.id, generatedAt: suggestion.createdAt.toISOString() };
}
