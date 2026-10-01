"use client";

import {
  BadgeDollarSign,
  CheckCircle2,
  CirclePlay,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  FileAudio,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Video,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { MonetizationProfileDto, RevenueRecordDto } from "@/lib/monetization";
import type { SongDto } from "@/lib/music";
import type { PublishingPlan } from "@/lib/platform-publishing";
import { publishingStatusLabel } from "@/lib/platform-publishing";
import { generateLocalPromoAssets } from "@/lib/promo";
import type { YoutubeConnectionDto, YoutubePublishJobDto } from "@/lib/youtube-publishing";

type WorkspaceView = "youtube" | "outputs" | "revenue";
type MediaExportTarget = "youtube_video" | "instagram_reel" | "audio_original";

type MediaExportFile = {
  target: MediaExportTarget | "unknown";
  label: string;
  fileName: string;
  fileSizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  probe: {
    formatName: string | null;
    durationSeconds: number | null;
    bitRate: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    sampleRate: number | null;
    channels: number | null;
  } | null;
};

type PublishingItem = {
  song: SongDto;
  plan: PublishingPlan;
  outputs: MediaExportFile[];
};

type RevenueSummary = {
  count: number;
  totalsByCurrency: Record<string, number>;
  latestPeriod: string | null;
};

type Props = {
  initialItems: PublishingItem[];
  initialConnection: YoutubeConnectionDto;
  initialJobs: YoutubePublishJobDto[];
  initialMonetization: MonetizationProfileDto;
  initialRevenueRecords: RevenueRecordDto[];
  initialRevenueSummary: RevenueSummary;
};

const targetOptions: Array<{
  value: MediaExportTarget;
  label: string;
  description: string;
  icon: "video" | "audio";
}> = [
  {
    value: "youtube_video",
    label: "YouTube MP4",
    description: "1920x1080 H.264 / AAC，輸出後可建立發布工作。",
    icon: "video"
  },
  {
    value: "instagram_reel",
    label: "IG Reels MP4",
    description: "1080x1920 直式 MP4，可下載後發佈 Reels。",
    icon: "video"
  },
  {
    value: "audio_original",
    label: "音訊原檔",
    description: "複製原始本機音檔，不轉檔、不壓縮。",
    icon: "audio"
  }
];

const jobStatusLabels: Record<string, string> = {
  AWAITING_APPROVAL: "待核准",
  UPLOADING: "上傳中",
  PROCESSING: "YouTube 處理中",
  PUBLISHED: "平台完成",
  FAILED: "失敗，可重試",
  CANCELLED: "已取消"
};

const yppStatusLabels: Record<string, string> = {
  NOT_APPLIED: "尚未申請",
  ELIGIBLE: "符合資格",
  APPLIED: "審核中",
  APPROVED: "已加入 YPP",
  REJECTED: "未通過"
};

const contentIdStatusLabels: Record<string, string> = {
  NOT_CONFIGURED: "尚未建立",
  REVIEWING: "申請審核中",
  ACTIVE: "已啟用",
  INELIGIBLE: "目前不符合"
};

function statusClass(status: string) {
  if (["ready_manual", "PUBLISHED", "CONNECTED", "APPROVED", "ACTIVE"].includes(status)) return "tag green";
  if (["setup_required", "AWAITING_APPROVAL", "PROCESSING", "UPLOADING", "APPLIED", "REVIEWING"].includes(status)) return "tag warn";
  if (["FAILED", "RECONNECT_REQUIRED", "REJECTED", "INELIGIBLE"].includes(status)) return "tag danger";
  return "tag";
}

function formatBytes(value: number | null | undefined) {
  if (!value) return "--";
  if (value > 1024 * 1024 * 1024) return `${Math.round((value / 1024 / 1024 / 1024) * 10) / 10} GB`;
  if (value > 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
  if (value > 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${value} B`;
}

function formatDuration(value: number | null | undefined) {
  if (!value) return "--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function probeSummary(output: MediaExportFile) {
  if (!output.probe) return "尚未取得驗證資訊";
  const size = output.probe.width && output.probe.height ? `${output.probe.width}x${output.probe.height}` : "音訊";
  const codec = [output.probe.videoCodec, output.probe.audioCodec].filter(Boolean).join(" / ") || output.probe.formatName || "未知 codec";
  return `${size} · ${formatDuration(output.probe.durationSeconds)} · ${codec}`;
}

function outputFor(outputs: MediaExportFile[], target: MediaExportTarget) {
  return outputs.find((output) => output.target === target);
}

function youtubeDescription(song: SongDto) {
  return (
    song.promoAssets.find((asset) => asset.assetType === "youtube_description")?.content ||
    generateLocalPromoAssets(song).find((asset) => asset.assetType === "youtube_description")?.content ||
    ""
  );
}

function suggestedTags(song: SongDto) {
  return [song.genre, song.subgenre, "原創音樂", "頌祖音樂"].filter((tag): tag is string => Boolean(tag));
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartInput() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

export function PublishingWorkspace({
  initialItems,
  initialConnection,
  initialJobs,
  initialMonetization,
  initialRevenueRecords,
  initialRevenueSummary
}: Props) {
  const [activeView, setActiveView] = useState<WorkspaceView>("youtube");
  const [items, setItems] = useState(initialItems);
  const [connection, setConnection] = useState(initialConnection);
  const [jobs, setJobs] = useState(initialJobs);
  const [monetization, setMonetization] = useState(initialMonetization);
  const [revenueRecords, setRevenueRecords] = useState(initialRevenueRecords);
  const [clientId, setClientId] = useState(initialConnection.clientId || "");
  const [hostCanPublish, setHostCanPublish] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, string>>({});

  const youtubeReadyItems = useMemo(
    () => items.filter((item) => item.outputs.some((output) => output.target === "youtube_video")),
    [items]
  );
  const [publishSongId, setPublishSongId] = useState(youtubeReadyItems[0]?.song.id || "");
  const selectedPublishItem = youtubeReadyItems.find((item) => item.song.id === publishSongId) || null;
  const youtubeOutputs = selectedPublishItem?.outputs.filter((output) => output.target === "youtube_video") || [];
  const [publishFileName, setPublishFileName] = useState(youtubeOutputs[0]?.fileName || "");
  const [publishTitle, setPublishTitle] = useState(selectedPublishItem?.song.title || "");
  const [publishDescription, setPublishDescription] = useState(selectedPublishItem ? youtubeDescription(selectedPublishItem.song) : "");
  const [publishTags, setPublishTags] = useState(selectedPublishItem ? suggestedTags(selectedPublishItem.song).join(", ") : "");
  const [privacyStatus, setPrivacyStatus] = useState<"private" | "unlisted" | "public">("private");
  const [scheduledAt, setScheduledAt] = useState("");
  const [madeForKids, setMadeForKids] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState({
    songId: "",
    platform: "youtube",
    revenueType: "ads",
    periodStart: monthStartInput(),
    periodEnd: todayInput(),
    grossAmount: "",
    currency: "TWD",
    notes: ""
  });

  const totals = useMemo(
    () => ({
      songs: items.length,
      localFiles: items.filter((item) => item.plan.exportPackage.availableLocalFiles > 0).length,
      outputFiles: items.reduce((total, item) => total + item.outputs.length, 0),
      youtubeReady: youtubeReadyItems.length,
      pendingJobs: jobs.filter((job) => ["AWAITING_APPROVAL", "UPLOADING", "PROCESSING", "FAILED"].includes(job.status)).length,
      publishedJobs: jobs.filter((job) => job.status === "PUBLISHED").length
    }),
    [items, jobs, youtubeReadyItems.length]
  );
  const metadataReady = useMemo(() => items.filter((item) => item.song.readiness >= 70).length, [items]);
  const masterQualityReady = useMemo(
    () => items.filter((item) => item.song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pass")).length,
    [items]
  );

  const currentRevenueSummary = useMemo(() => {
    if (revenueRecords === initialRevenueRecords) return initialRevenueSummary;
    return {
      count: revenueRecords.length,
      totalsByCurrency: revenueRecords.reduce<Record<string, number>>((result, record) => {
        result[record.currency] = (result[record.currency] || 0) + record.grossAmount;
        return result;
      }, {}),
      latestPeriod: revenueRecords[0]?.periodEnd || null
    };
  }, [initialRevenueRecords, initialRevenueSummary, revenueRecords]);

  useEffect(() => {
    setHostCanPublish(["127.0.0.1", "localhost", "::1", "[::1]"].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const youtube = query.get("youtube");
    if (!youtube) return;
    setActiveView("youtube");
    if (youtube === "connected") setNotice("YouTube 頻道已安全連線。");
    else if (youtube === "host-required") setNotice("Google 授權必須在執行頌祖音樂 OS 的 Mac 主機上完成。");
    else setNotice(query.get("message") || "YouTube 授權沒有完成。");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  function choosePublishSong(songId: string) {
    const item = youtubeReadyItems.find((candidate) => candidate.song.id === songId);
    setPublishSongId(songId);
    setPublishFileName(item?.outputs.find((output) => output.target === "youtube_video")?.fileName || "");
    setPublishTitle(item?.song.title || "");
    setPublishDescription(item ? youtubeDescription(item.song) : "");
    setPublishTags(item ? suggestedTags(item.song).join(", ") : "");
  }

  function replaceJob(updated: YoutubePublishJobDto) {
    setJobs((current) => [updated, ...current.filter((job) => job.id !== updated.id)]);
  }

  async function generate(songId: string, target: MediaExportTarget) {
    const key = `${songId}:${target}`;
    setBusyKey(key);
    setStatusByKey((current) => ({ ...current, [key]: "輸出中，正在驗證媒體規格。" }));
    try {
      const output = await requestJson<MediaExportFile>(`/api/songs/${songId}/media-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      setItems((current) =>
        current.map((item) => (item.song.id === songId ? { ...item, outputs: [output, ...item.outputs] } : item))
      );
      setStatusByKey((current) => ({ ...current, [key]: `已完成：${output.fileName}` }));
      if (target === "youtube_video" && !publishSongId) choosePublishSong(songId);
    } catch (error) {
      setStatusByKey((current) => ({ ...current, [key]: error instanceof Error ? error.message : "輸出失敗。" }));
    } finally {
      setBusyKey("");
    }
  }

  async function saveYoutubeClientId() {
    setBusyKey("youtube-config");
    setNotice("");
    try {
      const updated = await requestJson<YoutubeConnectionDto>("/api/youtube/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId })
      });
      setConnection(updated);
      setNotice("Desktop OAuth Client ID 已保存，可以開始 Google 授權。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "YouTube 設定失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function verifyConnection() {
    setBusyKey("youtube-verify");
    try {
      const updated = await requestJson<YoutubeConnectionDto>("/api/youtube/connection", { method: "PATCH" });
      setConnection(updated);
      setNotice(`已確認頻道：${updated.accountName || "YouTube"}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "YouTube 驗證失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function disconnectConnection() {
    if (!window.confirm("確定要撤銷 YouTube 授權並清除本機 Keychain token？")) return;
    setBusyKey("youtube-disconnect");
    try {
      const updated = await requestJson<YoutubeConnectionDto>("/api/youtube/connection", { method: "DELETE" });
      setConnection(updated);
      setNotice("YouTube 已中斷連線，發布工作與輸出檔仍保留。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "YouTube 中斷連線失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function createPublishJob() {
    if (!publishSongId || !publishFileName || !publishTitle.trim()) {
      setNotice("請先選擇歌曲、YouTube MP4 與影片標題。");
      return;
    }
    setBusyKey("create-job");
    try {
      const job = await requestJson<YoutubePublishJobDto>("/api/youtube/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: publishSongId,
          exportFileName: publishFileName,
          title: publishTitle,
          description: publishDescription,
          tags: publishTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
          privacyStatus,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          madeForKids
        })
      });
      replaceJob(job);
      setNotice("發布工作已建立；內容尚未送出，等待你核准上傳。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "建立發布工作失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function uploadJob(job: YoutubePublishJobDto) {
    const confirmed = window.confirm(
      `核准上傳「${job.title}」到 ${connection.accountName || "YouTube"}？\n\n隱私：${job.privacyStatus}\n檔案：${job.exportFileName}`
    );
    if (!confirmed) return;
    setBusyKey(`upload:${job.id}`);
    replaceJob({ ...job, status: "UPLOADING", progress: Math.max(1, job.progress), lastError: null });
    try {
      replaceJob(
        await requestJson<YoutubePublishJobDto>(`/api/youtube/jobs/${job.id}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true })
        })
      );
      setNotice("影片已送達 YouTube，正在等待平台處理。");
    } catch (error) {
      try {
        setJobs(await requestJson<YoutubePublishJobDto[]>("/api/youtube/jobs"));
      } catch {
        replaceJob({ ...job, status: "FAILED", lastError: error instanceof Error ? error.message : "上傳失敗。" });
      }
      setNotice(error instanceof Error ? error.message : "YouTube 上傳失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function syncJob(job: YoutubePublishJobDto) {
    setBusyKey(`sync:${job.id}`);
    try {
      replaceJob(await requestJson<YoutubePublishJobDto>(`/api/youtube/jobs/${job.id}/sync`, { method: "POST" }));
      setNotice("YouTube 處理狀態已更新。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "同步狀態失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function cancelJob(job: YoutubePublishJobDto) {
    setBusyKey(`cancel:${job.id}`);
    try {
      replaceJob(await requestJson<YoutubePublishJobDto>(`/api/youtube/jobs/${job.id}`, { method: "DELETE" }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "取消工作失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function saveMonetization() {
    setBusyKey("save-monetization");
    try {
      setMonetization(
        await requestJson<MonetizationProfileDto>("/api/monetization/youtube", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriberCount: monetization.subscriberCount,
            publicWatchHours: monetization.publicWatchHours,
            shortsViews90Days: monetization.shortsViews90Days,
            validPublicUploads90Days: monetization.validPublicUploads90Days,
            yppStatus: monetization.yppStatus,
            fanFundingEnabled: monetization.fanFundingEnabled,
            adsRevenueEnabled: monetization.adsRevenueEnabled,
            contentIdStatus: monetization.contentIdStatus,
            distributorName: monetization.distributorName,
            publishingAdmin: monetization.publishingAdmin,
            notes: monetization.notes
          })
        })
      );
      setNotice("營利進度已更新。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "儲存營利進度失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function addRevenueRecord() {
    const amount = Number(revenueDraft.grossAmount);
    if (!Number.isFinite(amount)) {
      setNotice("請填入收入金額。");
      return;
    }
    setBusyKey("add-revenue");
    try {
      const record = await requestJson<RevenueRecordDto>("/api/revenue-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...revenueDraft, songId: revenueDraft.songId || null, grossAmount: amount })
      });
      setRevenueRecords((current) => [record, ...current]);
      setRevenueDraft((current) => ({ ...current, grossAmount: "", notes: "" }));
      setNotice("收入紀錄已加入本機帳本。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "新增收入紀錄失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function removeRevenueRecord(id: string) {
    setBusyKey(`revenue:${id}`);
    try {
      await requestJson<{ ok: boolean }>(`/api/revenue-records/${id}`, { method: "DELETE" });
      setRevenueRecords((current) => current.filter((record) => record.id !== id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "刪除收入紀錄失敗。");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <>
      <header className="dashboard-hero publishing-hero">
        <div className="stack">
          <span className="eyebrow">發佈與收益中心</span>
          <h1>從本機母帶，到平台與收入。</h1>
          <p className="subtle">素材先在本機驗證；平台上傳必須經過帳號授權與你的發布確認。</p>
          <div className="dashboard-actions">
            <button className="button primary" type="button" onClick={() => setActiveView("youtube")}>
              <CirclePlay size={17} />
              YouTube 發布
            </button>
            <button className="button" type="button" onClick={() => setActiveView("outputs")}>
              <Video size={17} />
              素材輸出
            </button>
            <button className="button" type="button" onClick={() => setActiveView("revenue")}>
              <CircleDollarSign size={17} />
              收入路徑
            </button>
          </div>
        </div>
        <div className="command-panel">
          <div>
            <span className="muted">YouTube 通路</span>
            <strong>{connection.connected ? "已連線" : connection.configured ? "待授權" : "待設定"}</strong>
          </div>
          <div className="command-grid">
            <span><Video size={15} />可發布 {totals.youtubeReady}</span>
            <span><Clock3 size={15} />待處理 {totals.pendingJobs}</span>
            <span><CheckCircle2 size={15} />平台完成 {totals.publishedJobs}</span>
            <span><WalletCards size={15} />收入 {currentRevenueSummary.count}</span>
          </div>
        </div>
      </header>

      <section className="publishing-pipeline" aria-label="發行流程進度">
        <Link className={metadataReady === items.length && items.length ? "done" : ""} href="/metadata">
          <span className="publishing-step-number">1</span>
          <span><strong>發行資料</strong><small>{metadataReady} / {items.length} 首達標</small></span>
          {metadataReady === items.length && items.length ? <CheckCircle2 size={16} /> : <FileAudio size={16} />}
        </Link>
        <Link className={masterQualityReady === items.length && items.length ? "done" : ""} href="/audio-repair">
          <span className="publishing-step-number">2</span>
          <span><strong>母帶 QA</strong><small>{masterQualityReady} / {items.length} 首通過</small></span>
          {masterQualityReady === items.length && items.length ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}
        </Link>
        <button className={`${activeView === "outputs" ? "active " : ""}${totals.outputFiles ? "done" : ""}`} type="button" onClick={() => setActiveView("outputs")}>
          <span className="publishing-step-number">3</span>
          <span><strong>素材輸出</strong><small>{totals.outputFiles} 個驗證檔案</small></span>
          <Video size={16} />
        </button>
        <button className={`${activeView === "youtube" ? "active " : ""}${totals.publishedJobs ? "done" : ""}`} type="button" onClick={() => setActiveView("youtube")}>
          <span className="publishing-step-number">4</span>
          <span><strong>平台發布</strong><small>{totals.publishedJobs} 完成 · {totals.pendingJobs} 待辦</small></span>
          <UploadCloud size={16} />
        </button>
        <button className={`${activeView === "revenue" ? "active " : ""}${currentRevenueSummary.count ? "done" : ""}`} type="button" onClick={() => setActiveView("revenue")}>
          <span className="publishing-step-number">5</span>
          <span><strong>收益追蹤</strong><small>{currentRevenueSummary.count} 筆帳目</small></span>
          <CircleDollarSign size={16} />
        </button>
      </section>

      <nav className="publishing-view-tabs" aria-label="發佈工作台分類">
        <button className={activeView === "youtube" ? "active" : ""} type="button" onClick={() => setActiveView("youtube")}>
          <CirclePlay size={16} />YouTube 發布
        </button>
        <button className={activeView === "outputs" ? "active" : ""} type="button" onClick={() => setActiveView("outputs")}>
          <Video size={16} />素材輸出
        </button>
        <button className={activeView === "revenue" ? "active" : ""} type="button" onClick={() => setActiveView("revenue")}>
          <BadgeDollarSign size={16} />收入路徑
        </button>
      </nav>

      {notice ? (
        <div className="system-note publishing-notice" role="status">
          <RadioTower size={17} />
          <span>{notice}</span>
        </div>
      ) : null}

      {activeView === "youtube" ? (
        <div className="publishing-workspace section">
          <section className="panel pad stack youtube-connection-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <span className="eyebrow">頻道連線</span>
                <h2>{connection.accountName || "YouTube 頻道"}</h2>
              </div>
              <span className={statusClass(connection.status)}>
                {connection.connected ? "安全連線" : connection.configured ? "等待 Google 授權" : "尚未設定"}
              </span>
            </div>

            {hostCanPublish === false ? (
              <div className="system-note compact">
                <LockKeyhole size={16} />
                <span>手機與平板可建立發布工作；Google 授權與最終上傳需回到 Mac 主機核准。</span>
              </div>
            ) : null}
            {!connection.configured && hostCanPublish !== false ? (
              <div className="youtube-setup-grid">
                <label className="field">
                  <span>Desktop OAuth Client ID</span>
                  <input className="input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="1234567890-....apps.googleusercontent.com" />
                </label>
                <button className="button primary" type="button" disabled={busyKey === "youtube-config"} onClick={saveYoutubeClientId}>
                  {busyKey === "youtube-config" ? <Loader2 size={16} /> : <KeyRound size={16} />}
                  保存設定
                </button>
              </div>
            ) : connection.connected ? (
              <div className="connection-status-grid">
                <span><strong>頻道 ID</strong><small>{connection.accountId || "--"}</small></span>
                <span><strong>Token</strong><small>macOS Keychain</small></span>
                <span><strong>上次確認</strong><small>{connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString("zh-TW") : "尚未確認"}</small></span>
                <div className="tag-row">
                  <button className="button" type="button" disabled={hostCanPublish !== true || busyKey === "youtube-verify"} onClick={verifyConnection}>
                    <RefreshCw size={16} />驗證連線
                  </button>
                  <button className="button danger" type="button" disabled={hostCanPublish !== true || busyKey === "youtube-disconnect"} onClick={disconnectConnection}>
                    <Trash2 size={16} />中斷
                  </button>
                </div>
              </div>
            ) : connection.configured && hostCanPublish !== false ? (
              <div className="youtube-authorize-row">
                <div>
                  <strong>授權回呼網址</strong>
                  <code>{connection.redirectUri}</code>
                </div>
                <a className="button primary" href="/api/youtube/oauth/start">
                  <Link2 size={16} />連接 Google 帳號
                </a>
              </div>
            ) : null}
            {connection.lastError ? <p className="danger-copy">{connection.lastError}</p> : null}
          </section>

          <section className="panel pad stack youtube-compose-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <span className="eyebrow">建立發布工作</span>
                <h2>影片與平台資料</h2>
              </div>
              <span className="tag warn"><LockKeyhole size={13} />建立後仍需核准</span>
            </div>

            {youtubeReadyItems.length ? (
              <div className="youtube-publish-form">
                <label className="field">
                  <span>歌曲</span>
                  <select className="select" value={publishSongId} onChange={(event) => choosePublishSong(event.target.value)}>
                    {youtubeReadyItems.map((item) => <option key={item.song.id} value={item.song.id}>{item.song.title}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>已驗證 MP4</span>
                  <select className="select" value={publishFileName} onChange={(event) => setPublishFileName(event.target.value)}>
                    {youtubeOutputs.map((output) => <option key={output.fileName} value={output.fileName}>{output.fileName}</option>)}
                  </select>
                </label>
                <label className="field youtube-title-field">
                  <span>影片標題</span>
                  <input className="input" maxLength={100} value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} />
                </label>
                <label className="field youtube-description-field">
                  <span>Description</span>
                  <textarea className="textarea" maxLength={5000} value={publishDescription} onChange={(event) => setPublishDescription(event.target.value)} />
                </label>
                <label className="field youtube-tags-field">
                  <span>Tags（逗號分隔）</span>
                  <input className="input" value={publishTags} onChange={(event) => setPublishTags(event.target.value)} />
                </label>
                <label className="field">
                  <span>隱私</span>
                  <select className="select" value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value as typeof privacyStatus)}>
                    <option value="private">私人</option>
                    <option value="unlisted">不公開</option>
                    <option value="public">公開</option>
                  </select>
                </label>
                <label className="field">
                  <span>排程時間（選填）</span>
                  <input className="input" type="datetime-local" disabled={privacyStatus !== "private"} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                </label>
                <label className="check-row youtube-kids-check">
                  <input type="checkbox" checked={madeForKids} onChange={(event) => setMadeForKids(event.target.checked)} />
                  <span>這是兒童內容</span>
                </label>
                <button className="button primary youtube-create-job" type="button" disabled={busyKey === "create-job"} onClick={createPublishJob}>
                  {busyKey === "create-job" ? <Loader2 size={16} /> : <Send size={16} />}
                  建立待核准工作
                </button>
              </div>
            ) : (
              <div className="empty compact">
                <Video size={18} />
                尚無 YouTube MP4。先到「素材輸出」產生橫式影片。
              </div>
            )}
          </section>

          <section className="panel pad stack youtube-queue-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <span className="eyebrow">發布佇列</span>
                <h2>核准、上傳與平台處理</h2>
              </div>
              <span className="tag">{jobs.length} 個工作</span>
            </div>
            {jobs.length ? (
              <div className="publish-job-list">
                {jobs.map((job) => (
                  <article className="publish-job-row" key={job.id}>
                    <div className="publish-job-main">
                      <div className="tag-row">
                        <span className={statusClass(job.status)}>{jobStatusLabels[job.status] || job.status}</span>
                        <span className="tag">{job.privacyStatus}</span>
                      </div>
                      <strong>{job.title}</strong>
                      <small>{job.songTitle} · {formatBytes(job.fileSizeBytes)} · 嘗試 {job.attempts} 次</small>
                      {job.status === "UPLOADING" ? <div className="progress"><span style={{ width: `${job.progress}%` }} /></div> : null}
                      {job.lastError ? <p className="danger-copy">{job.lastError}</p> : null}
                    </div>
                    <div className="publish-job-actions">
                      {["AWAITING_APPROVAL", "FAILED"].includes(job.status) ? (
                        <button className="button primary" type="button" disabled={hostCanPublish !== true || !connection.connected || busyKey === `upload:${job.id}`} onClick={() => uploadJob(job)}>
                          {busyKey === `upload:${job.id}` ? <Loader2 size={16} /> : <UploadCloud size={16} />}
                          核准並上傳
                        </button>
                      ) : null}
                      {job.status === "PROCESSING" ? (
                        <button className="button" type="button" disabled={busyKey === `sync:${job.id}`} onClick={() => syncJob(job)}>
                          <RefreshCw size={16} />同步狀態
                        </button>
                      ) : null}
                      {job.platformUrl ? <a className="button" href={job.platformUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />YouTube</a> : null}
                      {["AWAITING_APPROVAL", "FAILED"].includes(job.status) ? (
                        <button className="button danger" type="button" disabled={busyKey === `cancel:${job.id}`} onClick={() => cancelJob(job)} aria-label={`取消 ${job.title}`}>
                          <Trash2 size={16} />取消
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="empty compact">尚未建立發布工作。</div>}
          </section>
        </div>
      ) : null}

      {activeView === "outputs" ? (
        <div className="section stack">
          <section className="grid-4 publishing-metrics">
            <div className="panel metric"><span>作品數</span><strong>{totals.songs}</strong></div>
            <div className="panel metric"><span>有本機音檔</span><strong>{totals.localFiles}</strong></div>
            <div className="panel metric"><span>YouTube 可發布</span><strong>{totals.youtubeReady}</strong></div>
            <div className="panel metric"><span>輸出檔案</span><strong>{totals.outputFiles}</strong></div>
          </section>

          {items.map(({ song, plan, outputs }) => {
            const hasLocalFile = plan.exportPackage.availableLocalFiles > 0;
            return (
              <article className="panel pad stack publishing-card" key={song.id}>
                <div className="toolbar compact-toolbar">
                  <div><h2>{song.title}</h2><p className="muted">本機檔案 {plan.exportPackage.availableLocalFiles} · 文字素材 {plan.exportPackage.textAssets}</p></div>
                  <span className="tag-row">
                    <Link className="button" href={`/songs/${song.id}`}><ExternalLink size={16} />作品</Link>
                    <a className="button" href={`/api/songs/${song.id}/export-package?format=zip`}><Download size={16} />發佈包</a>
                  </span>
                </div>

                <div className="media-export-grid">
                  {targetOptions.map((target) => {
                    const key = `${song.id}:${target.value}`;
                    const existing = outputFor(outputs, target.value);
                    const Icon = target.icon === "video" ? Video : FileAudio;
                    return (
                      <div className="media-export-action" key={target.value}>
                        <div className="tag-row"><span className={existing ? "tag green" : hasLocalFile ? "tag warn" : "tag danger"}>{existing ? "已輸出" : hasLocalFile ? "待輸出" : "缺音檔"}</span></div>
                        <div><h3>{target.label}</h3><p className="muted">{target.description}</p></div>
                        <button className="button primary" type="button" disabled={!hasLocalFile || busyKey === key} onClick={() => generate(song.id, target.value)}>
                          {busyKey === key ? <Loader2 size={16} /> : <Icon size={16} />}{existing ? "重新輸出" : "產生"}
                        </button>
                        {statusByKey[key] ? <p className="muted">{statusByKey[key]}</p> : null}
                      </div>
                    );
                  })}
                </div>

                <div className="platform-grid">
                  {plan.platforms.map((platform) => {
                    const target = platform.platform === "youtube" ? "youtube_video" : "instagram_reel";
                    const output = outputFor(outputs, target);
                    return (
                      <div className="platform-panel" key={platform.platform}>
                        <div className="toolbar compact-toolbar">
                          <div><h3>{platform.label}</h3><p className="muted">{output ? "平台素材已完成。" : platform.summary}</p></div>
                          <span className={statusClass(output ? "ready_manual" : platform.status)}>{output ? "素材完成" : publishingStatusLabel(platform.status)}</span>
                        </div>
                        {output ? (
                          <div className="list-row">
                            <span><strong>{output.fileName}</strong><br /><span className="muted">{formatBytes(output.fileSizeBytes)} · {probeSummary(output)}</span></span>
                            <a className="button primary" href={output.downloadUrl}><Download size={16} />下載</a>
                          </div>
                        ) : <div className="empty compact">尚未輸出平台檔案。</div>}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {activeView === "revenue" ? (
        <div className="revenue-workspace section">
          <section className="panel pad stack monetization-panel">
            <div className="toolbar compact-toolbar">
              <div><span className="eyebrow">YouTube 營利進度</span><h2>YPP 與 Content ID</h2></div>
              <span className={statusClass(monetization.yppStatus)}>{yppStatusLabels[monetization.yppStatus] || monetization.yppStatus}</span>
            </div>
            <div className="monetization-progress-grid">
              <div><span>訂閱者</span><strong>{monetization.subscriberCount.toLocaleString()}</strong><div className="progress"><span style={{ width: `${monetization.progress.ads.subscriberProgress}%` }} /></div><small>廣告門檻 1,000</small></div>
              <div><span>公開觀看小時</span><strong>{monetization.publicWatchHours.toLocaleString()}</strong><div className="progress"><span style={{ width: `${monetization.progress.ads.watchProgress}%` }} /></div><small>廣告門檻 4,000</small></div>
              <div><span>Shorts 90 天觀看</span><strong>{monetization.shortsViews90Days.toLocaleString()}</strong><div className="progress"><span style={{ width: `${monetization.progress.ads.shortsProgress}%` }} /></div><small>替代門檻 1,000 萬</small></div>
              <div><span>90 天公開影片</span><strong>{monetization.validPublicUploads90Days}</strong><div className="progress"><span style={{ width: `${monetization.progress.fanFunding.uploadProgress}%` }} /></div><small>早期 YPP 門檻 3 支</small></div>
            </div>
            <div className="monetization-form-grid">
              <label className="field"><span>訂閱者</span><input className="input" type="number" min="0" value={monetization.subscriberCount} onChange={(event) => setMonetization({ ...monetization, subscriberCount: Number(event.target.value) })} /></label>
              <label className="field"><span>公開觀看小時</span><input className="input" type="number" min="0" step="0.1" value={monetization.publicWatchHours} onChange={(event) => setMonetization({ ...monetization, publicWatchHours: Number(event.target.value) })} /></label>
              <label className="field"><span>Shorts 90 天觀看</span><input className="input" type="number" min="0" value={monetization.shortsViews90Days} onChange={(event) => setMonetization({ ...monetization, shortsViews90Days: Number(event.target.value) })} /></label>
              <label className="field"><span>90 天公開影片</span><input className="input" type="number" min="0" value={monetization.validPublicUploads90Days} onChange={(event) => setMonetization({ ...monetization, validPublicUploads90Days: Number(event.target.value) })} /></label>
              <label className="field"><span>YPP 狀態</span><select className="select" value={monetization.yppStatus} onChange={(event) => setMonetization({ ...monetization, yppStatus: event.target.value })}>{Object.entries(yppStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field"><span>Content ID</span><select className="select" value={monetization.contentIdStatus} onChange={(event) => setMonetization({ ...monetization, contentIdStatus: event.target.value })}>{Object.entries(contentIdStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field"><span>發行商</span><input className="input" value={monetization.distributorName || ""} onChange={(event) => setMonetization({ ...monetization, distributorName: event.target.value })} placeholder="尚未選定" /></label>
              <label className="field"><span>Publishing 管理</span><input className="input" value={monetization.publishingAdmin || ""} onChange={(event) => setMonetization({ ...monetization, publishingAdmin: event.target.value })} placeholder="自行管理 / 管理商" /></label>
            </div>
            <div className="tag-row">
              <label className="check-row"><input type="checkbox" checked={monetization.fanFundingEnabled} onChange={(event) => setMonetization({ ...monetization, fanFundingEnabled: event.target.checked })} /><span>粉絲贊助已啟用</span></label>
              <label className="check-row"><input type="checkbox" checked={monetization.adsRevenueEnabled} onChange={(event) => setMonetization({ ...monetization, adsRevenueEnabled: event.target.checked })} /><span>廣告分潤已啟用</span></label>
            </div>
            <button className="button primary" type="button" disabled={busyKey === "save-monetization"} onClick={saveMonetization}><ShieldCheck size={16} />儲存營利進度</button>
          </section>

          <section className="panel pad stack income-path-panel">
            <div><span className="eyebrow">收入路徑</span><h2>每條通路的下一個動作</h2></div>
            <div className="income-path-list">
              <div><CirclePlay size={18} /><span><strong>YouTube 粉絲贊助</strong><small>500 訂閱、3 支公開影片，加上觀看或 Shorts 門檻。</small></span><b className={monetization.progress.fanFunding.eligible ? "tag green" : "tag warn"}>{monetization.progress.fanFunding.eligible ? "可申請" : "累積中"}</b></div>
              <div><BadgeDollarSign size={18} /><span><strong>YouTube 廣告與 Premium</strong><small>追蹤 1,000 訂閱與觀看門檻。</small></span><b className={monetization.progress.ads.eligible ? "tag green" : "tag warn"}>{monetization.adsRevenueEnabled ? "已啟用" : monetization.progress.ads.eligible ? "可申請" : "累積中"}</b></div>
              <div><ShieldCheck size={18} /><span><strong>Content ID</strong><small>確認作品與素材的獨家權利，再透過權利管理通路申請。</small></span><b className={statusClass(monetization.contentIdStatus)}>{contentIdStatusLabels[monetization.contentIdStatus]}</b></div>
              <div><RadioTower size={18} /><span><strong>Spotify / Apple Music</strong><small>由發行商送件並回收錄音版稅。</small></span><b className={monetization.distributorName ? "tag green" : "tag warn"}>{monetization.distributorName || "待選發行商"}</b></div>
              <div><Send size={18} /><span><strong>授權、分享包與委託</strong><small>用私密分享包管理同步授權、合作與直接報價。</small></span><Link className="button" href="/pitch">分享包</Link></div>
            </div>
          </section>

          <section className="panel pad stack revenue-ledger-panel">
            <div className="toolbar compact-toolbar">
              <div><span className="eyebrow">本機收入帳本</span><h2>平台與版稅紀錄</h2></div>
              <div className="tag-row">{Object.entries(currentRevenueSummary.totalsByCurrency).map(([currency, amount]) => <span className="tag green" key={currency}>{formatMoney(amount, currency)}</span>)}</div>
            </div>
            <div className="revenue-entry-form">
              <label className="field"><span>平台</span><select className="select" value={revenueDraft.platform} onChange={(event) => setRevenueDraft({ ...revenueDraft, platform: event.target.value })}><option value="youtube">YouTube</option><option value="youtube_content_id">YouTube Content ID</option><option value="spotify">Spotify</option><option value="apple_music">Apple Music</option><option value="licensing">授權</option><option value="direct_sale">直接銷售</option></select></label>
              <label className="field"><span>收入類型</span><select className="select" value={revenueDraft.revenueType} onChange={(event) => setRevenueDraft({ ...revenueDraft, revenueType: event.target.value })}><option value="ads">廣告 / Premium</option><option value="streaming">串流版稅</option><option value="publishing">詞曲版稅</option><option value="content_id">Content ID</option><option value="license">授權費</option><option value="commission">委託製作</option></select></label>
              <label className="field"><span>歌曲（選填）</span><select className="select" value={revenueDraft.songId} onChange={(event) => setRevenueDraft({ ...revenueDraft, songId: event.target.value })}><option value="">整體 / 未分配</option>{items.map((item) => <option key={item.song.id} value={item.song.id}>{item.song.title}</option>)}</select></label>
              <label className="field"><span>金額</span><input className="input" type="number" step="0.01" value={revenueDraft.grossAmount} onChange={(event) => setRevenueDraft({ ...revenueDraft, grossAmount: event.target.value })} /></label>
              <label className="field"><span>幣別</span><select className="select" value={revenueDraft.currency} onChange={(event) => setRevenueDraft({ ...revenueDraft, currency: event.target.value })}><option value="TWD">TWD</option><option value="USD">USD</option><option value="JPY">JPY</option></select></label>
              <label className="field"><span>開始日</span><input className="input" type="date" value={revenueDraft.periodStart} onChange={(event) => setRevenueDraft({ ...revenueDraft, periodStart: event.target.value })} /></label>
              <label className="field"><span>結束日</span><input className="input" type="date" value={revenueDraft.periodEnd} onChange={(event) => setRevenueDraft({ ...revenueDraft, periodEnd: event.target.value })} /></label>
              <label className="field revenue-notes-field"><span>備註</span><input className="input" value={revenueDraft.notes} onChange={(event) => setRevenueDraft({ ...revenueDraft, notes: event.target.value })} /></label>
              <button className="button primary revenue-add-button" type="button" disabled={busyKey === "add-revenue"} onClick={addRevenueRecord}><CircleDollarSign size={16} />加入收入</button>
            </div>
            {revenueRecords.length ? (
              <div className="revenue-record-list">
                {revenueRecords.map((record) => (
                  <div className="revenue-record-row" key={record.id}>
                    <span><strong>{formatMoney(record.grossAmount, record.currency)}</strong><small>{record.platform} · {record.revenueType} · {record.songTitle || "未分配歌曲"}</small></span>
                    <span className="muted">{record.periodStart?.slice(0, 10)} - {record.periodEnd?.slice(0, 10)}</span>
                    <button className="icon-button danger" type="button" disabled={busyKey === `revenue:${record.id}`} onClick={() => removeRevenueRecord(record.id)} aria-label="刪除收入紀錄"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            ) : <div className="empty compact">還沒有收入紀錄。</div>}
          </section>
        </div>
      ) : null}
    </>
  );
}
