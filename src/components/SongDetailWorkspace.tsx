"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import {
  AudioLines,
  Bot,
  Check,
  Copy,
  Download,
  FileAudio,
  FileUp,
  Gauge,
  History,
  Library,
  Link2,
  ListChecks,
  ListPlus,
  Music2,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wand2
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AudioWorkbench } from "@/components/AudioWorkbench";
import { RecordingMonitor } from "@/components/RecordingMonitor";
import type { SongInsight } from "@/lib/ai";
import type { SongDto } from "@/lib/music";
import { fileTypeLabel, fileTypeOptions, statusOptions, toDateInput } from "@/lib/music";
import { analyzeSongHealth, buildSongAiTabs } from "@/lib/production";
import { buildProductionDirectorBrief, type ProductionDirectorBrief } from "@/lib/production-director";
import { promoAssetTypeLabel } from "@/lib/promo";
import type { RecordingKitExport } from "@/lib/recording-kit";
import { buildSoundRecommendations } from "@/lib/sound-recommender";
import type { SoundLibraryItemDto } from "@/lib/sound-library";
import { buildSongTimeline } from "@/lib/timeline";

type ContributorLite = {
  id: string;
  name: string;
  email: string | null;
  defaultRoles: string | null;
};

const aiProviderLabels: Record<string, string> = {
  local: "本機規則引擎",
  codex: "Codex"
};

const confirmationStatusLabels: Record<string, string> = {
  PENDING: "等待確認",
  CONFIRMED: "已確認",
  CANCELLED: "已取消"
};

const soundUseStatusOptions = [
  { value: "PLANNED", label: "已規劃" },
  { value: "TESTING", label: "待測試" },
  { value: "ACTIVE", label: "使用中" },
  { value: "REJECTED", label: "暫不使用" }
];

const setupStatusOptions = [
  { value: "TODO", label: "待確認" },
  { value: "READY", label: "已準備" },
  { value: "BLOCKED", label: "卡住" },
  { value: "SKIPPED", label: "略過" }
];

const setupPriorityOptions = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
];

const songWorkspaceSections = [
  { id: "overview", label: "總覽" },
  { id: "lyrics", label: "創作" },
  { id: "files", label: "音檔" },
  { id: "sound-blueprint", label: "製作" },
  { id: "audio-qa", label: "音質" },
  { id: "director", label: "AI 總監" },
  { id: "promo", label: "發行" },
  { id: "rights", label: "權利" },
  { id: "timeline", label: "時間軸" }
] as const;

function qualityStatusLabel(status: string | null | undefined) {
  if (status === "pass") return "音質通過";
  if (status === "warning") return "音質警告";
  if (status === "fail") return "音質未通過";
  return "待音質分析";
}

function qualityTagClass(status: string | null | undefined) {
  if (status === "pass") return "tag green";
  if (status === "fail") return "tag danger";
  if (status === "warning") return "tag warn";
  return "tag";
}

function soundUseTagClass(status: string | null | undefined) {
  if (status === "ACTIVE") return "tag green";
  if (status === "TESTING") return "tag warn";
  if (status === "REJECTED") return "tag danger";
  return "tag";
}

function setupStatusClass(status: string | null | undefined) {
  if (status === "READY") return "tag green";
  if (status === "BLOCKED") return "tag danger";
  if (status === "SKIPPED") return "tag";
  return "tag warn";
}

function formatBytes(value: number | null | undefined) {
  if (!value) return "大小待確認";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function sourceKindLabel(value: string | null | undefined) {
  if (value === "upload") return "本機上傳";
  if (value === "garageband_export") return "GarageBand 匯出";
  if (value === "external_path") return "外部路徑";
  return value ?? "來源待確認";
}

async function jsonRequest<T>(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export function SongDetailWorkspace({
  initialSong,
  initialSoundLibraryItems,
  contributors
}: {
  initialSong: SongDto;
  initialSoundLibraryItems: SoundLibraryItemDto[];
  contributors: ContributorLite[];
}) {
  const [song, setSong] = useState(initialSong);
  const [soundLibraryItems] = useState(initialSoundLibraryItems);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [directorLoading, setDirectorLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [promoGenerating, setPromoGenerating] = useState(false);
  const [recordingKitLoading, setRecordingKitLoading] = useState(false);
  const [recordingKitExport, setRecordingKitExport] = useState<RecordingKitExport | null>(null);
  const [recordingKitMessage, setRecordingKitMessage] = useState("");
  const [insight, setInsight] = useState<SongInsight | null>(null);
  const [directorBrief, setDirectorBrief] = useState<ProductionDirectorBrief | null>(null);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [activeAiTab, setActiveAiTab] = useState("health");
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState("overview");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [confirmationLinks, setConfirmationLinks] = useState<Record<string, string>>({});
  const [editingPromoAssets, setEditingPromoAssets] = useState<Record<string, string>>({});
  const [overview, setOverview] = useState({
    title: initialSong.title,
    workingTitle: initialSong.workingTitle ?? "",
    status: initialSong.status,
    bpm: initialSong.bpm?.toString() ?? "",
    musicalKey: initialSong.musicalKey ?? "",
    genre: initialSong.genre ?? "",
    subgenre: initialSong.subgenre ?? "",
    mood: initialSong.mood.join(", "),
    targetReleaseDate: toDateInput(initialSong.targetReleaseDate),
    summary: initialSong.summary ?? "",
    notes: initialSong.notes ?? ""
  });
  const [lyricsForm, setLyricsForm] = useState({
    versionName: "新歌詞版本",
    content: "",
    isPrimary: true
  });
  const [fileForm, setFileForm] = useState({
    fileName: "",
    filePath: "",
    fileType: "demo",
    versionName: "",
    isPrimary: true,
    notes: ""
  });
  const [uploadForm, setUploadForm] = useState({
    fileType: "auto",
    versionName: "",
    isPrimary: true,
    notes: ""
  });
  const [creditForm, setCreditForm] = useState({
    contributorId: contributors[0]?.id ?? "",
    role: "詞 / 曲",
    splitPercentage: "100",
    ownershipType: "詞曲"
  });
  const [taskForm, setTaskForm] = useState({
    title: "",
    category: "發行"
  });
  const [soundUseForm, setSoundUseForm] = useState({
    soundLibraryItemId: initialSoundLibraryItems[0]?.id ?? "",
    role: "主音色 / 效果",
    section: "全曲",
    status: "PLANNED",
    notes: ""
  });
  const [setupForm, setSetupForm] = useState({
    title: "",
    category: "錄音準備",
    priority: "medium",
    status: "TODO",
    notes: ""
  });

  useEffect(() => {
    const sections = songWorkspaceSections
      .map((item) => document.getElementById(item.id))
      .filter((item): item is HTMLElement => Boolean(item));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveWorkspaceSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: [0.05, 0.2, 0.5] }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const primaryLyrics = useMemo(
    () => song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0],
    [song.lyricsVersions]
  );
  const health = useMemo(() => analyzeSongHealth(song), [song]);
  const aiTabs = useMemo(() => buildSongAiTabs(song), [song]);
  const activeAiTabContent = aiTabs.find((tab) => tab.id === activeAiTab) ?? aiTabs[0];
  const timeline = useMemo(() => buildSongTimeline(song), [song]);
  const liveDirectorBrief = useMemo(() => buildProductionDirectorBrief(song), [song]);
  const displayedDirectorBrief = directorBrief ?? liveDirectorBrief;
  const localFiles = useMemo(() => song.audioFiles.filter((file) => file.storageProvider === "local_upload" && file.filePath), [song.audioFiles]);
  const protectedOriginals = useMemo(() => song.audioFiles.filter((file) => file.isProtectedOriginal).length, [song.audioFiles]);
  const openMixNotes = useMemo(
    () => song.audioFiles.reduce((total, file) => total + file.comments.filter((comment) => comment.status !== "DONE").length, 0),
    [song.audioFiles]
  );
  const masterFile = useMemo(() => song.audioFiles.find((file) => file.fileType === "master" && file.isPrimary) ?? song.audioFiles.find((file) => file.fileType === "master"), [song.audioFiles]);
  const soundRecommendations = useMemo(() => buildSoundRecommendations(song, soundLibraryItems, 4), [song, soundLibraryItems]);
  const selectedSoundItem = useMemo(
    () => soundLibraryItems.find((item) => item.id === soundUseForm.soundLibraryItemId),
    [soundLibraryItems, soundUseForm.soundLibraryItemId]
  );
  const setupReadyCount = useMemo(() => song.setupChecklistItems.filter((item) => item.status === "READY").length, [song.setupChecklistItems]);
  const setupProgress = song.setupChecklistItems.length ? Math.round((setupReadyCount / song.setupChecklistItems.length) * 100) : 0;
  const recordingKitStats = useMemo(() => {
    const withAudio = song.soundUsages.filter((usage) => usage.soundLibraryItem.previewPath || usage.soundLibraryItem.assetPath);
    return {
      total: song.soundUsages.length,
      active: song.soundUsages.filter((usage) => usage.status === "ACTIVE").length,
      withAudio: withAudio.length,
      missingAudio: song.soundUsages.length - withAudio.length,
      effectChains: song.soundUsages.filter((usage) => usage.soundLibraryItem.chain.length > 0).length
    };
  }, [song.soundUsages]);
  const setupSuggestions = useMemo(() => {
    const base = [
      {
        title: `確認 BPM ${song.bpm ?? "未設定"} 與 metronome 音量`,
        category: "節拍",
        priority: "high",
        notes: "錄音前先確認 click 不會滲進麥克風。"
      },
      {
        title: `確認調性 ${song.musicalKey ?? "未設定"} 與參考音`,
        category: "音準",
        priority: "high",
        notes: "Vocal / 吉他 / 鋼琴錄製前先對基準音。"
      },
      {
        title: "確認輸入 gain，不 clipping",
        category: "音質",
        priority: "high",
        notes: "保留 headroom，避免錄進來就爆音。"
      },
      {
        title: "確認監聽延遲與耳機音量",
        category: "監聽",
        priority: "medium",
        notes: "外出使用手機或平板工作時，先測耳機與介面延遲。"
      }
    ];
    const hasVocalPlan = song.soundUsages.some((usage) => `${usage.role ?? ""} ${usage.soundLibraryItem.family ?? ""}`.includes("人聲"));
    const hasKeyboardPlan = song.soundUsages.some((usage) => `${usage.role ?? ""} ${usage.soundLibraryItem.family ?? ""}`.includes("鍵盤"));
    return [
      ...base,
      ...(hasVocalPlan
        ? [
            {
              title: "Vocal 麥克風距離與防噴罩定位",
              category: "Vocal",
              priority: "medium",
              notes: "先固定距離，讓之後的音準/節拍偵測結果更可靠。"
            }
          ]
        : []),
      ...(hasKeyboardPlan
        ? [
            {
              title: "鋼琴/鍵盤音源延遲與踏板確認",
              category: "樂器",
              priority: "medium",
              notes: "確認 MIDI 或軟體音源沒有明顯延遲。"
            }
          ]
        : [])
    ].filter((suggestion) => !song.setupChecklistItems.some((item) => item.title === suggestion.title));
  }, [song]);

  async function refreshSong() {
    const response = await fetch(`/api/songs/${song.id}`);
    setSong((await response.json()) as SongDto);
  }

  async function saveOverview() {
    setSaving(true);
    try {
      const updated = await jsonRequest<SongDto>(
        `/api/songs/${song.id}`,
        {
          title: overview.title,
          workingTitle: overview.workingTitle || null,
          status: overview.status,
          bpm: overview.bpm ? Number(overview.bpm) : null,
          musicalKey: overview.musicalKey || null,
          genre: overview.genre || null,
          subgenre: overview.subgenre || null,
          mood: overview.mood
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          targetReleaseDate: overview.targetReleaseDate || null,
          summary: overview.summary || null,
          notes: overview.notes || null
        },
        "PATCH"
      );
      setSong(updated);
      setLastSavedAt(new Date().toISOString());
    } finally {
      setSaving(false);
    }
  }

  async function runAiInsight() {
    setAiLoading(true);
    const result = await jsonRequest<SongInsight>("/api/ai/song-insight", { songId: song.id });
    setInsight(result);
    await refreshSong();
    setAiLoading(false);
  }

  async function runProductionDirector() {
    setDirectorLoading(true);
    const result = await jsonRequest<{ brief: ProductionDirectorBrief }>(`/api/songs/${song.id}/production-director/run`, {});
    setDirectorBrief(result.brief);
    await refreshSong();
    setDirectorLoading(false);
  }

  async function applyInsight() {
    if (!insight) return;
    const updated = await jsonRequest<SongDto>(
      `/api/songs/${song.id}`,
      {
        summary: insight.summary,
        genre: insight.genreTags[0] ?? overview.genre,
        mood: insight.moodTags
      },
      "PATCH"
    );
    setSong(updated);
    setOverview((current) => ({
      ...current,
      summary: insight.summary,
      genre: insight.genreTags[0] ?? current.genre,
      mood: insight.moodTags.join(", ")
    }));
  }

  async function addLyrics() {
    if (!lyricsForm.content.trim()) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/lyrics`, lyricsForm);
    setSong(updated);
    setLyricsForm({ versionName: "新歌詞版本", content: "", isPrimary: true });
  }

  async function addFile() {
    if (!fileForm.fileName.trim()) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/files`, fileForm);
    setSong(updated);
    setFileForm({ fileName: "", filePath: "", fileType: "demo", versionName: "", isPrimary: true, notes: "" });
  }

  async function addCredit() {
    if (!creditForm.contributorId || !creditForm.role.trim()) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/credits`, {
      ...creditForm,
      splitPercentage: creditForm.splitPercentage ? Number(creditForm.splitPercentage) : null
    });
    setSong(updated);
  }

  async function addTask() {
    if (!taskForm.title.trim()) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/tasks`, {
      title: taskForm.title,
      category: taskForm.category,
      status: "TODO"
    });
    setSong(updated);
    setTaskForm({ title: "", category: "發行" });
  }

  async function addSoundUse(
    override?: Partial<{
      soundLibraryItemId: string;
      role: string;
      section: string;
      status: string;
      notes: string;
    }>
  ) {
    const payload = {
      soundLibraryItemId: override?.soundLibraryItemId ?? soundUseForm.soundLibraryItemId,
      role: override?.role ?? soundUseForm.role,
      section: override?.section ?? soundUseForm.section,
      status: override?.status ?? soundUseForm.status,
      notes: override?.notes ?? soundUseForm.notes
    };
    if (!payload.soundLibraryItemId) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/sound-uses`, payload);
    setSong(updated);
    setSoundUseForm((current) => ({ ...current, role: "主音色 / 效果", section: "全曲", notes: "" }));
  }

  async function updateSoundUse(
    usageId: string,
    body: Partial<{
      role: string;
      section: string;
      status: string;
      notes: string;
    }>
  ) {
    const updated = await jsonRequest<SongDto>(`/api/song-sound-uses/${usageId}`, body, "PATCH");
    setSong(updated);
  }

  async function deleteSoundUse(usageId: string) {
    const response = await fetch(`/api/song-sound-uses/${usageId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    setSong((await response.json()) as SongDto);
  }

  async function addSetupItem(
    override?: Partial<{
      title: string;
      category: string;
      priority: string;
      status: string;
      notes: string;
    }>
  ) {
    const payload = {
      title: override?.title ?? setupForm.title,
      category: override?.category ?? setupForm.category,
      priority: override?.priority ?? setupForm.priority,
      status: override?.status ?? setupForm.status,
      notes: override?.notes ?? setupForm.notes
    };
    if (!payload.title.trim()) return;
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/setup-checklist`, payload);
    setSong(updated);
    setSetupForm({ title: "", category: "錄音準備", priority: "medium", status: "TODO", notes: "" });
  }

  async function updateSetupItem(
    itemId: string,
    body: Partial<{
      title: string;
      category: string;
      priority: string;
      status: string;
      notes: string;
    }>
  ) {
    const updated = await jsonRequest<SongDto>(`/api/setup-checklist/${itemId}`, body, "PATCH");
    setSong(updated);
  }

  async function deleteSetupItem(itemId: string) {
    const response = await fetch(`/api/setup-checklist/${itemId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    setSong((await response.json()) as SongDto);
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    await jsonRequest(`/api/tasks/${taskId}`, { status: currentStatus === "DONE" ? "TODO" : "DONE" }, "PATCH");
    await refreshSong();
  }

  async function uploadFile(fileOverride?: File) {
    const fileToUpload = fileOverride ?? selectedUploadFile;
    if (!fileToUpload) return;
    setUploading(true);
    setUploadError("");
    const formData = new FormData();
    formData.set("file", fileToUpload);
    formData.set("fileType", uploadForm.fileType);
    formData.set("versionName", uploadForm.versionName);
    formData.set("notes", uploadForm.notes);
    formData.set("isPrimary", String(uploadForm.isPrimary));

    try {
      const response = await fetch(`/api/songs/${song.id}/upload`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setSong((await response.json()) as SongDto);
      setSelectedUploadFile(null);
      setUploadForm({ fileType: "auto", versionName: "", isPrimary: true, notes: "" });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  async function createCreditConfirmation(creditId: string) {
    const confirmation = await jsonRequest<{ token: string; status: string }>(`/api/credits/${creditId}/confirmation`, {});
    const link = `${window.location.origin}/confirm-credit/${confirmation.token}`;
    setConfirmationLinks((current) => ({ ...current, [creditId]: link }));
    await navigator.clipboard?.writeText(link);
    await refreshSong();
  }

  async function generatePromoAssets() {
    setPromoGenerating(true);
    const updated = await jsonRequest<SongDto>(`/api/songs/${song.id}/promo-assets/generate`, {});
    setSong(updated);
    setEditingPromoAssets({});
    setPromoGenerating(false);
  }

  async function savePromoAsset(assetId: string) {
    const currentAsset = song.promoAssets.find((asset) => asset.id === assetId);
    const content = editingPromoAssets[assetId] ?? currentAsset?.content ?? "";
    if (!content.trim()) return;
    const updated = await jsonRequest<SongDto["promoAssets"][number]>(
      `/api/promo-assets/${assetId}`,
      { content, status: "READY" },
      "PATCH"
    );
    setSong((current) => ({
      ...current,
      promoAssets: current.promoAssets.map((asset) => (asset.id === updated.id ? updated : asset))
    }));
  }

  async function rerunQualityReport(audioFileId: string) {
    await fetch(`/api/audio-files/${audioFileId}/quality-report`, { method: "POST" });
    await refreshSong();
    setDirectorBrief(null);
  }

  async function exportRecordingKit() {
    setRecordingKitLoading(true);
    setRecordingKitMessage("");
    try {
      const result = await jsonRequest<RecordingKitExport>(`/api/songs/${song.id}/recording-kit`, {});
      setRecordingKitExport(result);
      await refreshSong();
    } catch (error) {
      setRecordingKitMessage(error instanceof Error ? error.message : "錄音素材包匯出失敗");
    } finally {
      setRecordingKitLoading(false);
    }
  }

  async function copyRecordingKitBrief() {
    const lines = [
      `${song.title} 錄音素材包`,
      `BPM: ${song.bpm ?? "待設定"} / Key: ${song.musicalKey ?? "待設定"}`,
      "",
      ...song.soundUsages.map((usage, index) =>
        [
          `${index + 1}. ${usage.soundLibraryItem.name}`,
          `   角色: ${usage.role ?? "未設定"} / 段落: ${usage.section ?? "全曲"} / 狀態: ${usage.statusLabel}`,
          usage.soundLibraryItem.chain.length ? `   效果鏈: ${usage.soundLibraryItem.chain.join(" -> ")}` : "   效果鏈: 待建立",
          usage.soundLibraryItem.garageBandHint ? `   GarageBand: ${usage.soundLibraryItem.garageBandHint}` : "   GarageBand: 待補"
        ].join("\n")
      )
    ];
    await navigator.clipboard?.writeText(lines.join("\n"));
    setRecordingKitMessage("錄音素材清單已複製。");
  }

  return (
    <>
      <header className="page-header song-hero">
        <div className="stack">
          <Link className="muted" href="/songs">
            ← 回作品庫
          </Link>
          <span className="eyebrow">單曲工作台</span>
          <h1>{song.title}</h1>
          <div className="tag-row">
            <span className={song.status === "READY_FOR_RELEASE" ? "status-badge ready" : "status-badge"}>
              {song.statusLabel}
            </span>
            <span className="tag">{song.readiness}% 完整度</span>
            <span className={health.level === "READY" ? "tag green" : health.level === "BLOCKED" ? "tag danger" : "tag warn"}>
              AI 健檢：{health.levelLabel}
            </span>
            {song.warnings.slice(0, 3).map((warning) => (
              <span key={warning} className="tag warn">
                {warning}
              </span>
            ))}
          </div>
          <div className="song-hero-meta">
            <span>
              <strong>{song.readiness}%</strong>
              完整度
            </span>
            <span>
              <strong>{localFiles.length}</strong>
              本機檔案
            </span>
            <span>
              <strong>{openMixNotes}</strong>
              待處理留言
            </span>
            <span>
              <strong>{displayedDirectorBrief.releaseBlockers.length}</strong>
              發行阻塞
            </span>
          </div>
        </div>
        <div className="song-hero-actions">
          <button className="button primary" onClick={runAiInsight} disabled={aiLoading}>
            <Sparkles size={16} />
            {aiLoading ? "AI 整理中" : "AI 整理"}
          </button>
          <Link className="button" href={`/songs/${song.id}/daw`}>
            <AudioLines size={16} />
            DAW Core
          </Link>
          <Link className="button" href="/publishing">
            <Upload size={16} />
            輸出素材
          </Link>
          <span className="song-save-indicator" role="status">
            <span className={saving ? "saving" : ""} />
            {saving
              ? "正在儲存"
              : lastSavedAt
                ? `已儲存 ${new Date(lastSavedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`
                : song.updatedAt
                  ? `資料更新 ${new Date(song.updatedAt).toLocaleDateString("zh-TW")}`
                  : "尚未有更新紀錄"}
          </span>
        </div>
      </header>

      <nav className="song-subnav" aria-label="歌曲工作台區塊">
        <div className="song-subnav-sections">
          {songWorkspaceSections.map((section) => (
            <a
              className={activeWorkspaceSection === section.id ? "active" : ""}
              href={`#${section.id}`}
              key={section.id}
              aria-current={activeWorkspaceSection === section.id ? "location" : undefined}
              onClick={() => setActiveWorkspaceSection(section.id)}
            >
              {section.label}
            </a>
          ))}
        </div>
        <Link className="song-subnav-daw" href={`/songs/${song.id}/daw`}><AudioLines size={14} />DAW</Link>
      </nav>

      <section className="grid-4 section studio-metrics">
        <div className="panel metric">
          <span>BPM</span>
          <strong>{song.bpm ?? "--"}</strong>
        </div>
        <div className="panel metric">
          <span>調性</span>
          <strong>{song.musicalKey ?? "--"}</strong>
        </div>
        <div className="panel metric">
          <span>分潤比例</span>
          <strong>{song.splitTotal}%</strong>
        </div>
        <div className="panel metric">
          <span>檔案數</span>
          <strong>{song.audioFiles.length}</strong>
        </div>
      </section>

      <section className="split-layout section">
        <div className="stack song-workspace-main">
          <div className="panel pad stack workbench-section" id="overview">
            <div className="toolbar">
              <div>
                <h2>作品總覽</h2>
                <p className="muted">作品核心資料與 AI 可套用欄位。</p>
              </div>
              <button className="button primary" onClick={saveOverview} disabled={saving}>
                <Save size={16} />
                {saving ? "儲存中" : "儲存"}
              </button>
            </div>
            <div className="field-row">
              <div className="field">
                <label>歌名</label>
                <input className="input" value={overview.title} onChange={(event) => setOverview({ ...overview, title: event.target.value })} />
              </div>
              <div className="field">
                <label>暫定歌名</label>
                <input
                  className="input"
                  value={overview.workingTitle}
                  onChange={(event) => setOverview({ ...overview, workingTitle: event.target.value })}
                />
              </div>
            </div>
            <div className="field-row three">
              <div className="field">
                <label>狀態</label>
                <select className="select" value={overview.status} onChange={(event) => setOverview({ ...overview, status: event.target.value })}>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>BPM</label>
                <input className="input" value={overview.bpm} onChange={(event) => setOverview({ ...overview, bpm: event.target.value })} />
              </div>
              <div className="field">
                <label>調性</label>
                <input
                  className="input"
                  value={overview.musicalKey}
                  onChange={(event) => setOverview({ ...overview, musicalKey: event.target.value })}
                />
              </div>
            </div>
            <div className="field-row three">
              <div className="field">
                <label>曲風</label>
                <input className="input" value={overview.genre} onChange={(event) => setOverview({ ...overview, genre: event.target.value })} />
              </div>
              <div className="field">
                <label>子曲風</label>
                <input
                  className="input"
                  value={overview.subgenre}
                  onChange={(event) => setOverview({ ...overview, subgenre: event.target.value })}
                />
              </div>
              <div className="field">
                <label>目標發行日</label>
                <input
                  className="input"
                  type="date"
                  value={overview.targetReleaseDate}
                  onChange={(event) => setOverview({ ...overview, targetReleaseDate: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>情緒標籤</label>
              <input className="input" value={overview.mood} onChange={(event) => setOverview({ ...overview, mood: event.target.value })} />
            </div>
            <div className="field">
              <label>摘要</label>
              <textarea
                className="textarea"
                value={overview.summary}
                onChange={(event) => setOverview({ ...overview, summary: event.target.value })}
              />
            </div>
          </div>

          <div className="panel pad stack workbench-section" id="lyrics">
            <div className="toolbar">
              <div>
                <h2>歌詞版本</h2>
                <p className="muted">主版本會進入 AI 分析。</p>
              </div>
            </div>
            {primaryLyrics ? (
              <div className="panel pad" style={{ boxShadow: "none" }}>
                <div className="toolbar">
                  <strong>{primaryLyrics.versionName}</strong>
                  {primaryLyrics.isPrimary && <span className="tag green">主版本</span>}
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{primaryLyrics.content}</pre>
              </div>
            ) : (
              <div className="empty">還沒有歌詞。</div>
            )}
            <div className="field-row">
              <div className="field">
                <label>版本名稱</label>
                <input
                  className="input"
                  value={lyricsForm.versionName}
                  onChange={(event) => setLyricsForm({ ...lyricsForm, versionName: event.target.value })}
                />
              </div>
              <div className="field">
                <label>設為主版本</label>
                <select
                  className="select"
                  value={lyricsForm.isPrimary ? "yes" : "no"}
                  onChange={(event) => setLyricsForm({ ...lyricsForm, isPrimary: event.target.value === "yes" })}
                >
                  <option value="yes">是</option>
                  <option value="no">否</option>
                </select>
              </div>
            </div>
            <textarea
              className="textarea"
              placeholder="貼上新歌詞版本"
              value={lyricsForm.content}
              onChange={(event) => setLyricsForm({ ...lyricsForm, content: event.target.value })}
            />
            <button className="button" onClick={addLyrics}>
              <ListPlus size={16} />
              新增歌詞版本
            </button>
          </div>

          <div className="panel pad stack workbench-section" id="files">
            <div className="toolbar">
              <div>
                <h2>檔案與版本</h2>
                <p className="muted">上傳、版本、播放、留言與品質狀態集中管理。</p>
              </div>
              <FileAudio size={18} color="var(--accent)" />
            </div>
            <div className="file-stats-strip">
              <span>
                <strong>{localFiles.length}</strong>
                可播放本機檔
              </span>
              <span>
                <strong>{protectedOriginals}</strong>
                原檔保護
              </span>
              <span>
                <strong>{masterFile ? qualityStatusLabel(masterFile.qualityStatus) : "缺母帶"}</strong>
                Master 狀態
              </span>
            </div>
            <div className="upload-zone-wrap">
              <label
                className={`upload-zone${uploadDragActive ? " active" : ""}`}
                htmlFor="song-upload-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setUploadDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setUploadDragActive(true);
                }}
                onDragLeave={() => setUploadDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setUploadDragActive(false);
                  const droppedFile = event.dataTransfer.files?.[0];
                  if (droppedFile) setSelectedUploadFile(droppedFile);
                }}
              >
                <span className="upload-zone-icon">
                  <FileUp size={22} />
                </span>
                <span>
                  <strong>{selectedUploadFile ? selectedUploadFile.name : "拖拉音檔或點擊選擇檔案"}</strong>
                  <small>{selectedUploadFile ? formatBytes(selectedUploadFile.size) : "支援 demo、mix、master、stem、影片、封面與文件；上傳後保留原檔並建立音質報告。"}</small>
                </span>
                <input
                  id="song-upload-file"
                  type="file"
                  accept="audio/*,video/*,image/*,.wav,.wave,.aiff,.aif,.flac,.mp3,.m4a,.aac,.ogg,.webm,.mp4,.mov,.jpg,.jpeg,.png,.webp,.pdf,.txt,.md,.doc,.docx"
                  onChange={(event) => {
                    setSelectedUploadFile(event.target.files?.[0] ?? null);
                    setUploadError("");
                  }}
                />
              </label>
              <div className="upload-controls">
                <div className="field">
                  <label>分類</label>
                  <select
                    className="select"
                    value={uploadForm.fileType}
                    onChange={(event) => setUploadForm({ ...uploadForm, fileType: event.target.value })}
                  >
                    <option value="auto">AI 自動判斷</option>
                    {fileTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>版本名稱</label>
                  <input
                    className="input"
                    placeholder="例：mix_v2"
                    value={uploadForm.versionName}
                    onChange={(event) => setUploadForm({ ...uploadForm, versionName: event.target.value })}
                  />
                </div>
                <button className="button primary" onClick={() => uploadFile()} disabled={!selectedUploadFile || uploading}>
                  <Upload size={16} />
                  {uploading ? "上傳中" : "上傳"}
                </button>
              </div>
              <div className="field">
                <label>上傳備註</label>
                <input
                  className="input"
                  placeholder="例：GarageBand 匯出後第一次完整 mix"
                  value={uploadForm.notes}
                  onChange={(event) => setUploadForm({ ...uploadForm, notes: event.target.value })}
                />
              </div>
              {uploadError && <p className="tag danger">{uploadError}</p>}
            </div>
            <div className="small-list">
              {song.audioFiles.map((file) => (
                <div className="file-workspace version-card" key={file.id}>
                  <div className="toolbar compact-toolbar">
                    <span>
                      <strong>{file.fileName}</strong>
                      <br />
                      <span className="muted">
                        {fileTypeLabel(file.fileType)} {file.versionName ? `· ${file.versionName}` : ""}
                      </span>
                    </span>
                    <span className="tag-row">
                      <span className={qualityTagClass(file.qualityStatus)}>{qualityStatusLabel(file.qualityStatus)}</span>
                      {file.filePath && file.storageProvider === "local_upload" && (
                        <a className="button" href={`/api/files/${file.id}`} target="_blank">
                          <Download size={14} />
                          開啟
                        </a>
                      )}
                      {file.isPrimary && <span className="tag green">主版本</span>}
                    </span>
                  </div>
                  <div className="file-meta-grid">
                    <span>{fileTypeLabel(file.fileType)}</span>
                    <span>{file.versionName ?? "版本未命名"}</span>
                    <span>{sourceKindLabel(file.sourceKind)}</span>
                    <span>{formatBytes(file.fileSizeBytes)}</span>
                  </div>
                  {file.filePath && file.storageProvider === "local_upload" ? (
                    <AudioWorkbench songId={song.id} file={file} onSongUpdated={setSong} />
                  ) : (
                    <div className="empty compact">這筆是外部路徑或文件紀錄；上傳本機音檔後可產生 waveform 與 timestamp 留言。</div>
                  )}
                </div>
              ))}
            </div>
            <div className="manual-file-panel">
              <div>
                <h3>外部路徑紀錄</h3>
                <p className="muted">用來記錄 GarageBand 專案、雲端檔案或尚未匯入的素材位置。</p>
              </div>
              <div className="field-row three">
              <div className="field">
                <label>檔名</label>
                <input className="input" value={fileForm.fileName} onChange={(event) => setFileForm({ ...fileForm, fileName: event.target.value })} />
              </div>
              <div className="field">
                <label>類型</label>
                <select className="select" value={fileForm.fileType} onChange={(event) => setFileForm({ ...fileForm, fileType: event.target.value })}>
                  {fileTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>版本</label>
                <input
                  className="input"
                  value={fileForm.versionName}
                  onChange={(event) => setFileForm({ ...fileForm, versionName: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>路徑</label>
              <input className="input" value={fileForm.filePath} onChange={(event) => setFileForm({ ...fileForm, filePath: event.target.value })} />
            </div>
            <button className="button" onClick={addFile}>
              <ListPlus size={16} />
              新增檔案紀錄
            </button>
            </div>
          </div>

          <div className="panel pad stack workbench-section" id="sound-blueprint">
            <div className="toolbar">
              <div>
                <h2>音色藍圖</h2>
                <p className="muted">把樂器、效果、年代參考和 GarageBand 替代做法綁到這首歌。</p>
              </div>
              <Library size={18} color="var(--accent)" />
            </div>
            <div className="file-stats-strip">
              <span>
                <strong>{song.soundUsages.length}</strong>
                已加入音色
              </span>
              <span>
                <strong>{song.soundUsages.filter((usage) => usage.status === "ACTIVE").length}</strong>
                使用中
              </span>
              <span>
                <strong>{soundRecommendations.length}</strong>
                AI 推薦
              </span>
            </div>

            <div className="recording-kit-panel" id="recording-kit">
              <div className="toolbar">
                <div>
                  <h3>錄音素材包</h3>
                  <p className="muted">錄音前快速拿取這首歌要用的音色、效果鏈、preview 與 GarageBand 設定。</p>
                </div>
                <div className="tag-row">
                  <button className="button" onClick={copyRecordingKitBrief} disabled={!song.soundUsages.length}>
                    <Copy size={15} />
                    複製清單
                  </button>
                  <button className="button primary" onClick={exportRecordingKit} disabled={!song.soundUsages.length || recordingKitLoading}>
                    <Download size={15} />
                    {recordingKitLoading ? "匯出中" : "匯出素材包"}
                  </button>
                </div>
              </div>
              <div className="recording-kit-stats">
                <span>
                  <strong>{recordingKitStats.withAudio}</strong>
                  可預聽 / 下載
                </span>
                <span>
                  <strong>{recordingKitStats.effectChains}</strong>
                  效果鏈
                </span>
                <span>
                  <strong>{recordingKitStats.active}</strong>
                  使用中
                </span>
                <span className={recordingKitStats.missingAudio ? "warn" : ""}>
                  <strong>{recordingKitStats.missingAudio}</strong>
                  待補音檔
                </span>
              </div>
              {recordingKitMessage && <p className={recordingKitMessage.includes("失敗") ? "tag danger" : "tag green"}>{recordingKitMessage}</p>}
              {recordingKitExport?.downloadUrl && (
                <div className="system-note compact">
                  <FileAudio size={18} color="var(--accent)" />
                  <span>
                    <strong>{recordingKitExport.zipFileName}</strong>
                    <br />
                    已複製 {recordingKitExport.copiedAudioCount} 個音訊檔，{recordingKitExport.missingAudioCount} 個素材只有設定卡。
                  </span>
                  <a className="button primary" href={recordingKitExport.downloadUrl}>
                    <Download size={15} />
                    下載 ZIP
                  </a>
                </div>
              )}
              {song.soundUsages.length ? (
                <div className="recording-kit-list">
                  {song.soundUsages.map((usage) => {
                    const item = usage.soundLibraryItem;
                    const audioUrl = item.previewPath ?? item.assetPath;
                    return (
                      <article className="recording-kit-row" key={usage.id}>
                        <div className="recording-kit-row-head">
                          <div>
                            <div className="tag-row">
                              <span className={soundUseTagClass(usage.status)}>{usage.statusLabel}</span>
                              <span className="tag">{item.itemTypeLabel}</span>
                              {usage.section && <span className="tag">{usage.section}</span>}
                            </div>
                            <h4>{item.name}</h4>
                            <p className="muted">
                              {usage.role ?? "角色未設定"} · {item.family ?? "未分類"} · {item.era ?? "年代未設定"}
                            </p>
                          </div>
                          <div className="recording-kit-actions">
                            {item.assetPath && (
                              <a className="button ghost" href={item.assetPath} download>
                                <Download size={14} />
                                原檔
                              </a>
                            )}
                            {item.sourceUrl && (
                              <a className="button ghost" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                來源
                              </a>
                            )}
                          </div>
                        </div>
                        {audioUrl ? (
                          <CyberAudioPlayer controls preload="metadata" src={audioUrl} />
                        ) : (
                          <div className="empty compact">這張素材目前是效果設定卡，尚未綁定本機音檔。</div>
                        )}
                        {item.chain.length ? (
                          <div className="sound-chain compact-chain">
                            <strong>效果鏈</strong>
                            {item.chain.map((step) => (
                              <span key={step}>{step}</span>
                            ))}
                          </div>
                        ) : null}
                        {item.garageBandHint && (
                          <div className="system-note compact">
                            <Settings2 size={17} color="var(--accent)" />
                            <span>{item.garageBandHint}</span>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty">先從下方 AI 推薦或手動加入音色，素材包就會自動形成。</div>
              )}
            </div>

            {song.soundUsages.length ? (
              <div className="sound-blueprint-grid">
                {song.soundUsages.map((usage) => (
                  <article className="song-sound-card" key={usage.id}>
                    <div className="toolbar compact-toolbar">
                      <div>
                        <div className="tag-row">
                          <span className={soundUseTagClass(usage.status)}>{usage.statusLabel}</span>
                          <span className="tag">{usage.soundLibraryItem.itemTypeLabel}</span>
                          {usage.section && <span className="tag">{usage.section}</span>}
                        </div>
                        <h3>{usage.soundLibraryItem.name}</h3>
                      </div>
                      <button
                        className="button ghost"
                        onClick={() => deleteSoundUse(usage.id)}
                        title="移出藍圖"
                        aria-label={`將 ${usage.soundLibraryItem.name} 移出音色藍圖`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <p className="muted">{usage.soundLibraryItem.description ?? "尚未填寫音色描述。"}</p>
                    <div className="sound-meta-grid">
                      <span>
                        <strong>{usage.role ?? "角色未設定"}</strong>
                        角色
                      </span>
                      <span>
                        <strong>{usage.soundLibraryItem.family ?? "未分類"}</strong>
                        家族
                      </span>
                      <span>
                        <strong>{usage.soundLibraryItem.era ?? "年代未設定"}</strong>
                        年代
                      </span>
                    </div>
                    {usage.soundLibraryItem.chain.length ? (
                      <div className="sound-chain">
                        <strong>效果鏈</strong>
                        {usage.soundLibraryItem.chain.map((step) => (
                          <span key={step}>{step}</span>
                        ))}
                      </div>
                    ) : null}
                    {usage.soundLibraryItem.garageBandHint && (
                      <div className="system-note compact">
                        <Settings2 size={18} color="var(--accent)" />
                        <span>{usage.soundLibraryItem.garageBandHint}</span>
                      </div>
                    )}
                    <div className="field-row">
                      <div className="field">
                        <label>狀態</label>
                        <select className="select" value={usage.status} onChange={(event) => updateSoundUse(usage.id, { status: event.target.value })}>
                          {soundUseStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>段落</label>
                        <input className="input" defaultValue={usage.section ?? ""} onBlur={(event) => updateSoundUse(usage.id, { section: event.target.value })} />
                      </div>
                    </div>
                    <div className="field">
                      <label>使用備註</label>
                      <input className="input" defaultValue={usage.notes ?? ""} onBlur={(event) => updateSoundUse(usage.id, { notes: event.target.value })} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty">還沒有音色藍圖。可先套用下方推薦，或從音色資料庫手動加入。</div>
            )}

            <div className="recommendation-grid">
              <div className="panel pad stack recommendation-panel">
                <div className="toolbar compact-toolbar">
                  <div>
                    <h3>AI 本機推薦</h3>
                    <p className="muted">依曲風、情緒、BPM、歌詞與現有藍圖推薦，不呼叫外部 API。</p>
                  </div>
                  <Sparkles size={17} color="var(--accent)" />
                </div>
                <div className="small-list">
                  {soundRecommendations.map((recommendation) => (
                    <div className="recommendation-row" key={recommendation.item.id}>
                      <span>
                        <strong>{recommendation.item.name}</strong>
                        <br />
                        <span className="muted">
                          {recommendation.suggestedRole} · {recommendation.suggestedSection}
                        </span>
                        <br />
                        <span className="muted">{recommendation.reason}</span>
                      </span>
                      <button
                        className="button"
                        onClick={() =>
                          addSoundUse({
                            soundLibraryItemId: recommendation.item.id,
                            role: recommendation.suggestedRole,
                            section: recommendation.suggestedSection,
                            status: "PLANNED",
                            notes: recommendation.reason
                          })
                        }
                      >
                        <Link2 size={15} />
                        加入
                      </button>
                    </div>
                  ))}
                  {!soundRecommendations.length && <div className="empty compact">目前推薦都已在藍圖中。</div>}
                </div>
              </div>

              <div className="panel pad stack recommendation-panel">
                <div className="toolbar compact-toolbar">
                  <div>
                    <h3>手動加入音色</h3>
                    <p className="muted">從音色資料庫選一張素材卡，指定段落與用途。</p>
                  </div>
                  <Music2 size={17} color="var(--accent)" />
                </div>
                <div className="field">
                  <label>音色素材</label>
                  <select
                    className="select"
                    value={soundUseForm.soundLibraryItemId}
                    onChange={(event) => setSoundUseForm({ ...soundUseForm, soundLibraryItemId: event.target.value })}
                  >
                    {soundLibraryItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.itemTypeLabel}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedSoundItem && <p className="muted">{selectedSoundItem.description ?? selectedSoundItem.garageBandHint ?? "可加入藍圖後再補備註。"}</p>}
                <div className="field-row">
                  <div className="field">
                    <label>角色</label>
                    <input className="input" value={soundUseForm.role} onChange={(event) => setSoundUseForm({ ...soundUseForm, role: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>段落</label>
                    <input className="input" value={soundUseForm.section} onChange={(event) => setSoundUseForm({ ...soundUseForm, section: event.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>備註</label>
                  <input className="input" value={soundUseForm.notes} onChange={(event) => setSoundUseForm({ ...soundUseForm, notes: event.target.value })} />
                </div>
                <button className="button primary" onClick={() => addSoundUse()} disabled={!soundUseForm.soundLibraryItemId}>
                  <Link2 size={16} />
                  加入單曲藍圖
                </button>
              </div>
            </div>
          </div>

          <div className="panel pad stack workbench-section" id="setup-checklist">
            <div className="toolbar">
              <div>
                <h2>設備與錄音準備</h2>
                <p className="muted">先把手機、平板、電腦與外出錄音會用到的準備項目整理好。</p>
              </div>
              <ListChecks size={18} color="var(--accent)" />
            </div>
            <div className="setup-progress">
              <span>
                <strong>{setupProgress}%</strong>
                準備完成
              </span>
              <div className="progress">
                <span style={{ width: `${setupProgress}%` }} />
              </div>
              <span>
                {setupReadyCount}/{song.setupChecklistItems.length || 0}
              </span>
            </div>

            {setupSuggestions.length ? (
              <div className="tag-row">
                {setupSuggestions.slice(0, 6).map((suggestion) => (
                  <button className="button" key={suggestion.title} onClick={() => addSetupItem(suggestion)}>
                    <ListPlus size={15} />
                    {suggestion.title}
                  </button>
                ))}
              </div>
            ) : (
              <div className="tag green">基本準備建議都已加入</div>
            )}

            <div className="setup-board">
              {song.setupChecklistItems.map((item) => (
                <div className="setup-row" key={item.id}>
                  <button
                    className={item.status === "READY" ? "setup-check ready" : "setup-check"}
                    type="button"
                    onClick={() => updateSetupItem(item.id, { status: item.status === "READY" ? "TODO" : "READY" })}
                    title="切換準備狀態"
                    aria-label={`${item.title}：${item.status === "READY" ? "標記為待處理" : "標記為已準備"}`}
                  >
                    <Check size={16} />
                  </button>
                  <div className="stack">
                    <div className="toolbar compact-toolbar">
                      <div>
                        <strong>{item.title}</strong>
                        <p className="muted">{item.notes ?? "尚未填寫備註。"}</p>
                      </div>
                      <div className="tag-row">
                        <span className={setupStatusClass(item.status)}>{item.statusLabel}</span>
                        <span className={item.priority === "high" ? "tag warn" : "tag"}>優先：{item.priorityLabel}</span>
                        <span className="tag">{item.category}</span>
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>狀態</label>
                        <select className="select" value={item.status} onChange={(event) => updateSetupItem(item.id, { status: event.target.value })}>
                          {setupStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>備註</label>
                        <input className="input" defaultValue={item.notes ?? ""} onBlur={(event) => updateSetupItem(item.id, { notes: event.target.value })} />
                      </div>
                    </div>
                  </div>
                  <button className="button ghost" onClick={() => deleteSetupItem(item.id)} title="刪除準備項目">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {!song.setupChecklistItems.length && <div className="empty">還沒有準備清單。可先加入上方建議。</div>}
            </div>

            <div className="manual-file-panel setup-create-panel">
              <div>
                <h3>新增自訂準備項目</h3>
                <p className="muted">例：外出錄吉他要帶介面、線材、轉接頭、備用電源。</p>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>項目</label>
                  <input className="input" value={setupForm.title} onChange={(event) => setSetupForm({ ...setupForm, title: event.target.value })} />
                </div>
                <div className="field">
                  <label>分類</label>
                  <input className="input" value={setupForm.category} onChange={(event) => setSetupForm({ ...setupForm, category: event.target.value })} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>優先級</label>
                  <select className="select" value={setupForm.priority} onChange={(event) => setSetupForm({ ...setupForm, priority: event.target.value })}>
                    {setupPriorityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>備註</label>
                  <input className="input" value={setupForm.notes} onChange={(event) => setSetupForm({ ...setupForm, notes: event.target.value })} />
                </div>
              </div>
              <button className="button" onClick={() => addSetupItem()}>
                <ListPlus size={16} />
                新增準備項目
              </button>
            </div>
          </div>

          <RecordingMonitor key={song.id} song={song} onSongUpdated={setSong} />

          <div className="panel pad stack workbench-section" id="audio-qa">
            <div className="toolbar">
              <div>
                <h2>Audio QA 音質保護</h2>
                <p className="muted">原檔保留、不覆蓋；用本機 ffmpeg 產生 hash、格式、LUFS、clipping 與發行門檻。</p>
              </div>
              <span className={qualityTagClass(displayedDirectorBrief.qualityGate.status)}>
                {displayedDirectorBrief.qualityGate.label}
              </span>
            </div>
            <div className="release-spec">
              <div className="toolbar compact-toolbar">
                <div>
                  <h3>Master 發行規格</h3>
                  <p className="muted">{displayedDirectorBrief.masterReleaseSpec.summary}</p>
                </div>
                <span className={qualityTagClass(displayedDirectorBrief.masterReleaseSpec.status)}>
                  {displayedDirectorBrief.masterReleaseSpec.label}
                </span>
              </div>
              <div className="spec-grid">
                {displayedDirectorBrief.masterReleaseSpec.checks.map((check) => (
                  <div className="spec-check" key={check.id}>
                    <span className={qualityTagClass(check.status)}>{check.label}</span>
                    <p className="muted">{check.details}</p>
                  </div>
                ))}
              </div>
              <div className="tag-row">
                {displayedDirectorBrief.masterReleaseSpec.recommendations.map((recommendation) => (
                  <span className="tag" key={recommendation}>
                    {recommendation}
                  </span>
                ))}
              </div>
            </div>
            <div className="small-list">
              {song.audioFiles.map((file) => {
                const report = file.qualityReports[0];
                return (
                  <div className="qa-row" key={file.id}>
                    <div className="stack">
                      <div className="toolbar compact-toolbar">
                        <div>
                          <strong>{file.fileName}</strong>
                          <p className="muted">
                            {fileTypeLabel(file.fileType)} · {file.sourceKind} · {file.isProtectedOriginal ? "原檔保護" : "未標記原檔"}
                          </p>
                        </div>
                        <span className={qualityTagClass(file.qualityStatus)}>{qualityStatusLabel(file.qualityStatus)}</span>
                      </div>
                      <div className="qa-grid">
                        <span>SHA-256：{file.sha256 ? `${file.sha256.slice(0, 18)}…` : "待產生"}</span>
                        <span>格式：{report?.formatName ?? file.containerFormat ?? "待分析"}</span>
                        <span>Codec：{report?.codecName ?? file.codecName ?? "待分析"}</span>
                        <span>Sample rate：{report?.sampleRate ?? file.sampleRate ?? "--"} Hz</span>
                        <span>Bit depth：{report?.bitDepth ?? file.bitDepth ?? "--"}</span>
                        <span>LUFS：{report?.integratedLufs ?? file.lufs ?? "--"}</span>
                        <span>Peak：{report?.truePeak ?? file.truePeak ?? "--"}</span>
                        <span>Clipping：{report?.clippingRisk ? "有風險" : report ? "未偵測" : "待分析"}</span>
                      </div>
                      {report?.warnings.length ? (
                        <div className="tag-row">
                          {report.warnings.map((warning) => (
                            <span className="tag warn" key={warning}>
                              {warning}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button className="button" onClick={() => rerunQualityReport(file.id)}>
                      重新分析
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="stack song-workspace-rail">
          <div className="panel pad stack workbench-section director-panel" id="director">
            <div className="toolbar">
              <div>
                <h2>AI 製作總監</h2>
                <p className="muted">本機規則引擎判斷階段、下一步、混音指令、發行阻塞與版本比較。</p>
              </div>
              <button className="button" onClick={runProductionDirector} disabled={directorLoading}>
                <Sparkles size={16} />
                {directorLoading ? "整理中" : "存成建議"}
              </button>
            </div>
            <div className="tag-row">
              <span className="tag green">目前階段：{displayedDirectorBrief.stage.label}</span>
              <span className={qualityTagClass(displayedDirectorBrief.qualityGate.status)}>
                {displayedDirectorBrief.qualityGate.label}
              </span>
              <span className={qualityTagClass(displayedDirectorBrief.masterReleaseSpec.status)}>
                Master {displayedDirectorBrief.masterReleaseSpec.label}
              </span>
            </div>
            <p className="muted">{displayedDirectorBrief.stage.reason}</p>
            <div className="director-focus">
              <span>
                <Gauge size={16} />
                {health.score}% 健康度
              </span>
              <span>
                <ShieldCheck size={16} />
                {displayedDirectorBrief.masterReleaseSpec.label}
              </span>
            </div>

            <div className="stack">
              <h3>下一步</h3>
              {displayedDirectorBrief.nextActions.map((action) => (
                <p className="muted" key={action}>
                  {action}
                </p>
              ))}
            </div>

            <div className="stack">
              <h3>下一次混音指令</h3>
              {displayedDirectorBrief.mixingCommands.map((command) => (
                <p className="muted" key={command}>
                  {command}
                </p>
              ))}
            </div>

            <div className="stack">
              <h3>發行阻塞</h3>
              {displayedDirectorBrief.releaseBlockers.length ? (
                <div className="tag-row">
                  {displayedDirectorBrief.releaseBlockers.map((blocker) => (
                    <span className="tag warn" key={blocker}>
                      {blocker}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="tag green">目前沒有主要阻塞</span>
              )}
            </div>

            <div className="stack">
              <h3>版本比較</h3>
              <p className="muted">{displayedDirectorBrief.versionComparison.summary}</p>
              <div className="small-list">
                {displayedDirectorBrief.versionComparison.rows.slice(0, 4).map((row) => (
                  <div className="list-row" key={row.id}>
                    <span>
                      <strong>{row.fileName}</strong>
                      <br />
                      <span className="muted">
                        {fileTypeLabel(row.fileType)} · LUFS {row.lufs ?? "--"} · RMS {row.rms ? row.rms.toFixed(3) : "--"}
                      </span>
                    </span>
                    <span className={qualityTagClass(row.qualityStatus)}>{qualityStatusLabel(row.qualityStatus)}</span>
                  </div>
                ))}
              </div>
              {displayedDirectorBrief.versionComparison.recommendations.map((item) => (
                <p className="muted" key={item}>
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="panel pad stack workbench-section">
            <div className="toolbar">
              <div>
                <h2>AI 工作台</h2>
                <p className="muted">依作品資料即時整理健檢、歌詞、編曲、混音、發行與內容方向。</p>
              </div>
              <Sparkles size={18} color="var(--accent)" />
            </div>
            <div className="tab-list">
              {aiTabs.map((tab) => (
                <button
                  className={tab.id === activeAiTabContent.id ? "tab-button active" : "tab-button"}
                  key={tab.id}
                  onClick={() => setActiveAiTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="ai-output">
              <div className="tag-row">
                <span className={health.level === "READY" ? "tag green" : health.level === "BLOCKED" ? "tag danger" : "tag warn"}>
                  {health.score}% · {health.levelLabel}
                </span>
              </div>
              <h3>{activeAiTabContent.summary}</h3>
              <div className="small-list">
                {activeAiTabContent.bullets.map((bullet) => (
                  <p className="muted" key={bullet}>
                    {bullet}
                  </p>
                ))}
              </div>
              <div className="tag green">{activeAiTabContent.action}</div>
            </div>
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>AI 作品分析</h2>
                <p className="muted">用 AI 把資料整理成下一步。</p>
              </div>
              <Bot size={18} color="var(--accent)" />
            </div>
            {insight ? (
              <div className="ai-output">
                <div className="tag-row">
                  <span className="tag green">{aiProviderLabels[insight.provider] ?? insight.provider}</span>
                  <span className="tag">{Math.round(insight.confidence * 100)}% 信心</span>
                </div>
                <p>{insight.summary}</p>
                <div className="tag-row">
                  {insight.genreTags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                  {insight.moodTags.map((tag) => (
                    <span className="tag green" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="stack">
                  <h3>編曲方向</h3>
                  {insight.arrangementIdeas.map((item) => (
                    <p className="muted" key={item}>
                      {item}
                    </p>
                  ))}
                </div>
                <div className="stack">
                  <h3>發行待辦</h3>
                  {insight.releaseTasks.map((item) => (
                    <p className="muted" key={item}>
                      {item}
                    </p>
                  ))}
                </div>
                {insight.note && <p className="muted">{insight.note}</p>}
                <button className="button primary" onClick={applyInsight}>
                  <Check size={16} />
                  套用摘要與標籤
                </button>
              </div>
            ) : (
              <div className="empty">按下 AI 整理，系統會分析歌詞、檔案、製作名單和缺漏資料。</div>
            )}
          </div>

          <div className="panel pad stack workbench-section" id="timeline">
            <div className="toolbar">
              <div>
                <h2>版本時間軸</h2>
                <p className="muted">自動彙整靈感、歌詞、檔案、留言、分析、分潤與 GarageBand 紀錄。</p>
              </div>
              <History size={18} color="var(--accent)" />
            </div>
            <div className="timeline-list">
              {timeline.slice(0, 14).map((item) => (
                <div className="timeline-item" key={item.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="toolbar compact-toolbar">
                      <strong>{item.title}</strong>
                      <span className="tag">{item.source}</span>
                    </div>
                    <p className="muted">{item.description}</p>
                    <p className="muted">{item.createdAt ? item.createdAt.slice(0, 10) : "時間待確認"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel pad stack workbench-section" id="promo">
            <div className="toolbar">
              <div>
                <h2>發行素材</h2>
                <p className="muted">本機規則引擎產生文案初稿，可直接編輯存回資料庫。</p>
              </div>
              <button className="button" onClick={generatePromoAssets} disabled={promoGenerating}>
                <Wand2 size={16} />
                {promoGenerating ? "產生中" : "產生 7 種素材"}
              </button>
            </div>
            {song.promoAssets.length ? (
              <div className="small-list">
                {song.promoAssets.map((asset) => (
                  <div className="promo-editor" key={asset.id}>
                    <div className="toolbar compact-toolbar">
                      <div>
                        <strong>{asset.title}</strong>
                        <p className="muted">{promoAssetTypeLabel(asset.assetType)}</p>
                      </div>
                      <span className={asset.status === "READY" ? "tag green" : "tag"}>{asset.status}</span>
                    </div>
                    <textarea
                      className="textarea compact-textarea"
                      value={editingPromoAssets[asset.id] ?? asset.content}
                      onChange={(event) => setEditingPromoAssets((current) => ({ ...current, [asset.id]: event.target.value }))}
                    />
                    <button className="button" onClick={() => savePromoAsset(asset.id)}>
                      <Save size={15} />
                      儲存文案
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">還沒有發行素材。按上方按鈕會產生發行文案、IG、YouTube、Spotify、Email、封面 prompt 與短影音腳本。</div>
            )}
          </div>

          <div className="panel pad stack workbench-section" id="rights">
            <h2>製作名單</h2>
            <div className="small-list">
              {song.credits.map((credit) => {
                const latestConfirmation = credit.confirmations[0];
                const link = confirmationLinks[credit.id];
                return (
                  <div className="list-row" key={credit.id}>
                    <span>
                      <strong>{credit.contributor.name}</strong>
                      <br />
                      <span className="muted">
                        {credit.role} · {credit.ownershipType ?? "權利類型待填"}
                      </span>
                      {link && (
                        <>
                          <br />
                          <span className="muted">{link}</span>
                        </>
                      )}
                    </span>
                    <span className="tag-row">
                      <span className={song.splitTotal === 100 ? "tag green" : "tag warn"}>{credit.splitPercentage ?? 0}%</span>
                      <span className={latestConfirmation?.status === "CONFIRMED" ? "tag green" : "tag warn"}>
                        {latestConfirmation ? confirmationStatusLabels[latestConfirmation.status] ?? latestConfirmation.status : "未產生確認"}
                      </span>
                      <button className="button" onClick={() => createCreditConfirmation(credit.id)}>
                        <Copy size={15} />
                        確認連結
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="field">
              <label>合作人</label>
              <select
                className="select"
                value={creditForm.contributorId}
                onChange={(event) => setCreditForm({ ...creditForm, contributorId: event.target.value })}
              >
                {contributors.map((contributor) => (
                  <option key={contributor.id} value={contributor.id}>
                    {contributor.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>角色</label>
                <input className="input" value={creditForm.role} onChange={(event) => setCreditForm({ ...creditForm, role: event.target.value })} />
              </div>
              <div className="field">
                <label>比例</label>
                <input
                  className="input"
                  value={creditForm.splitPercentage}
                  onChange={(event) => setCreditForm({ ...creditForm, splitPercentage: event.target.value })}
                />
              </div>
            </div>
            <button className="button" onClick={addCredit}>
              <ListPlus size={16} />
              新增名單
            </button>
          </div>

          <div className="panel pad stack">
            <h2>待辦事項</h2>
            <div className="small-list">
              {song.tasks.map((task) => (
                <button className="list-row" key={task.id} onClick={() => toggleTask(task.id, task.status)}>
                  <span>{task.title}</span>
                  <span className={task.status === "DONE" ? "tag green" : "tag"}>{task.statusLabel}</span>
                </button>
              ))}
            </div>
            <div className="field-row">
              <div className="field">
                <label>任務</label>
                <input className="input" value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} />
              </div>
              <div className="field">
                <label>分類</label>
                <input
                  className="input"
                  value={taskForm.category}
                  onChange={(event) => setTaskForm({ ...taskForm, category: event.target.value })}
                />
              </div>
            </div>
            <button className="button" onClick={addTask}>
              <ListPlus size={16} />
              新增任務
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}
