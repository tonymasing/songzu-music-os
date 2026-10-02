"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";
import styles from "./MusicReferenceWorkspace.module.css";
import { ReferenceMotionCard } from "@/components/ReferenceMotionCard";
import { ReferenceVideoBackdrop } from "@/components/ReferenceVideoBackdrop";

import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ChevronDown,
  Film,
  FolderLock,
  Headphones,
  RefreshCw,
  Search,
  Star
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { MusicReferenceDto } from "@/lib/reference-library";

type ReferenceHealth = {
  available: boolean;
  bundledCount: number;
  root: string;
  audioCount: number;
  noteCount: number;
  matchedCount: number;
  noteOnlyCount: number;
  audioOnlyCount: number;
  error?: string;
};

type ImportReport = {
  created: number;
  updated: number;
  sourceUnchanged: boolean;
  filesystemChanges: number;
  unmatched: Array<{ status: string; title: string }>;
};

const purposeOptions = [
  { value: "lyrics", label: "歌詞" },
  { value: "arrangement", label: "編曲 / 音色" },
  { value: "chords", label: "和弦" },
  { value: "vocal", label: "人聲" },
  { value: "mood", label: "情緒" },
  { value: "chorus", label: "副歌 / Hook" },
  { value: "rhythm", label: "節奏" },
  { value: "general", label: "整體參考" }
];

const matchLabels: Record<string, string> = {
  MATCHED: "音檔與筆記已配對",
  NOTE_ONLY: "只有筆記",
  AUDIO_ONLY: "只有音檔",
  OFFLINE: "來源離線"
};

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "待分析";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "待確認";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeHttpUrl(value: string | null) {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

export function MusicReferenceWorkspace({
  initialItems,
  initialHealth
}: {
  initialItems: MusicReferenceDto[];
  initialHealth: ReferenceHealth;
}) {
  const [items, setItems] = useState(initialItems);
  const [health, setHealth] = useState(initialHealth);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("ALL");
  const [purpose, setPurpose] = useState("ALL");
  const [matchStatus, setMatchStatus] = useState("ALL");
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [lastReport, setLastReport] = useState<ImportReport | null>(null);
  const [expandedMvs, setExpandedMvs] = useState<Set<string>>(() => new Set());

  const genres = useMemo(
    () => [...new Set(items.flatMap((item) => item.genres).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant")),
    [items]
  );

  const stats = useMemo(
    () => ({
      total: items.length,
      playable: items.filter((item) => item.audioAvailable).length,
      matched: items.filter((item) => item.matchStatus === "MATCHED").length,
      preferences: items.filter((item) => item.preferenceNotes.length > 0).length
    }),
    [items]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.artist,
        item.genre,
        item.language,
        item.summary,
        item.suggestedCollection,
        ...item.referenceUses,
        ...item.preferenceNotes,
        ...item.priorityNotes,
        ...item.styleFeatures,
        ...item.tags
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!needle || haystack.includes(needle)) &&
        (genre === "ALL" || item.genres.includes(genre)) &&
        (purpose === "ALL" || item.tags.includes(purpose)) &&
        (matchStatus === "ALL" || item.matchStatus === matchStatus)
      );
    });
  }, [genre, items, matchStatus, purpose, query]);

  async function refreshLibrary() {
    setScanning(true);
    setMessage("");
    try {
      const response = await fetch("/api/music-references", { method: "POST" });
      const payload = (await response.json()) as {
        error?: string;
        report: ImportReport;
        health: ReferenceHealth;
        items: MusicReferenceDto[];
      };
      if (!response.ok) throw new Error(payload.error || "索引更新失敗");
      setItems(payload.items);
      setHealth(payload.health);
      setLastReport(payload.report);
      setMessage(
        `索引已更新：新增 ${payload.report.created} 筆、更新 ${payload.report.updated} 筆；外部來源檔案變更 ${payload.report.filesystemChanges} 筆。`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "索引更新失敗");
    } finally {
      setScanning(false);
    }
  }

  async function toggleFavorite(item: MusicReferenceDto) {
    const response = await fetch(`/api/music-materials/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !item.favorite })
    });
    if (!response.ok) {
      setMessage("偏好標記更新失敗。");
      return;
    }
    const updated = (await response.json()) as { favorite: boolean };
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, favorite: updated.favorite } : row)));
  }

  return (
    <>
      <ReferenceVideoBackdrop items={items} />
      <header className="dashboard-hero reference-library-hero">
        <div className="stack">
          <div className="reference-library-backline">
            <Link className="text-link" href="/music-db">
              <ArrowLeft size={15} />
              音樂資料庫
            </Link>
            <span className={health.available ? "tag green" : "tag danger"}>
              {health.available ? "資料庫已連線" : "外接資料庫離線"}
            </span>
          </div>
          <span className="eyebrow">Tony 的音樂風格資料庫</span>
          <h1>風格參考、偏好筆記與可用方向，都集中在這裡。</h1>
          <p className="subtle">參考音檔與 Markdown 維持原位；App 只建立唯讀索引、試聽通道與分類資料。</p>
          <div className="dashboard-actions">
            <button className="button primary" onClick={refreshLibrary} disabled={scanning || !health.available}>
              <RefreshCw size={16} className={scanning ? "spin" : undefined} />
              {scanning ? "掃描與分析中" : "重新掃描並更新索引"}
            </button>
            <a className="button" href="#reference-list">
              <Headphones size={16} />
              開始試聽
            </a>
          </div>
        </div>
        <div className="reference-source-panel">
          <div className="reference-source-title">
            <FolderLock size={18} />
            <span>唯讀來源</span>
          </div>
          <code>{health.root}</code>
          <div className="reference-source-checks">
            <span><CheckCircle2 size={15} />不刪除</span>
            <span><CheckCircle2 size={15} />不改名</span>
            <span><CheckCircle2 size={15} />不移動</span>
          </div>
        </div>
      </header>

      <section className="reference-metrics" aria-label="風格資料庫統計">
        <div><strong>{stats.total}</strong><span>索引歌曲</span></div>
        <div><strong>{stats.playable}</strong><span>可直接試聽</span></div>
        <div><strong>{stats.matched}</strong><span>完整配對</span></div>
        <div><strong>{stats.preferences}</strong><span>有偏好筆記</span></div>
      </section>

      {message ? (
        <div className="notice-bar reference-import-notice" role="status">
          {lastReport?.sourceUnchanged ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
          <span>{message}</span>
        </div>
      ) : null}

      {!health.available ? (
        <div className="system-note warn">
          <CircleAlert size={18} />
          <span>{health.error || "請接上外接硬碟後再重新整理頁面。"}</span>
        </div>
      ) : null}

      <section className="section reference-library-section" id="reference-list">
        <div className="reference-filterbar">
          <label className="searchbox reference-searchbox">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋歌曲、歌手、曲風或 Tony 的筆記" />
          </label>
          <select className="select" value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="曲風篩選">
            <option value="ALL">所有曲風</option>
            {genres.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
          <select className="select" value={purpose} onChange={(event) => setPurpose(event.target.value)} aria-label="參考用途篩選">
            <option value="ALL">所有參考用途</option>
            {purposeOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
          <select className="select" value={matchStatus} onChange={(event) => setMatchStatus(event.target.value)} aria-label="資料狀態篩選">
            <option value="ALL">所有資料狀態</option>
            {Object.entries(matchLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>

        <div className="reference-resultline">
          <span>顯示 {filtered.length} / {items.length} 首</span>
          <span>{health.noteOnlyCount + health.audioOnlyCount} 筆待補配對</span>
        </div>

        <div className={`${styles.referenceList} reference-list`}>
          {filtered.map((item) => {
            const sourceUrl = safeHttpUrl(item.sourceUrl);
            return (
              <ReferenceMotionCard key={item.id}>
                <div className="reference-card-head">
                  <div className="reference-title-block">
                    <div className="tag-row">
                      <span className={item.matchStatus === "MATCHED" ? "tag green" : "tag warn"}>
                        {matchLabels[item.matchStatus || ""] || "待確認"}
                      </span>
                      {item.genre ? <span className="tag">{item.genre}</span> : null}
                      {item.language ? <span className="tag">{item.language}</span> : null}
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.artist || "歌手待補"}</p>
                  </div>
                  <div className={styles.cardActions}>
                  {item.audioUrl ? <button
                    type="button"
                    className={`${styles.mvToggle} icon-button`}
                    aria-label={expandedMvs.has(item.id) ? "收起 MV" : "展開 MV"}
                    aria-expanded={expandedMvs.has(item.id)}
                    aria-controls={`reference-mv-${item.id}`}
                    title={expandedMvs.has(item.id) ? "收起 MV，僅顯示音樂播放器" : "展開 MV 影片區"}
                    onClick={() => {
                      setExpandedMvs(current => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                        return next;
                      });
                    }}
                  ><Film size={16} aria-hidden="true" /><span>MV</span></button> : null}
                  <button
                    className={item.favorite ? "icon-button active" : "icon-button"}
                    onClick={() => toggleFavorite(item)}
                    aria-label={item.favorite ? "取消偏好" : "標記為偏好"}
                    title={item.favorite ? "取消偏好" : "標記為偏好"}
                  >
                    <Star size={17} />
                  </button>
                  </div>
                </div>

                <div className={`${styles.listeningRow} reference-listening-row`}>
                  {item.audioUrl ? (
                    <CyberAudioPlayer
                      controls
                      preload="metadata"
                      src={item.audioUrl}
                      aria-label={`試聽 ${item.title}`}
                      data-reference-id={item.id}
                      videoSrc={item.videoUrl ?? undefined}
                      visual={expandedMvs.has(item.id) ?
                        <div id={`reference-mv-${item.id}`} className={styles.mvViewport} role="region" aria-label={`${item.title} MV 影片區`}>
                          <span className={styles.mvLabel}>MV <span>SCREEN</span></span>
                          {!item.videoUrl ? <div className={styles.mvPlaceholder}>
                            <Film size={28} aria-hidden="true" />
                            <span>MV 影片區</span>
                            <small>尚未加入影片</small>
                          </div> : null}
                        </div>
                      : null}
                      trackInfo={{
                        fileName: item.externalFileName || item.title,
                        duration: formatDuration(item.externalDurationSeconds),
                        size: formatBytes(item.externalFileSizeBytes),
                        format: item.externalCodec?.toUpperCase() || "待分析"
                      }}
                    />
                  ) : (
                    <div className={styles.missingAudio}>
                      <div><strong>{item.matchStatus === "OFFLINE" ? "音檔來源目前離線" : "尚未找到對應音檔"}</strong><p>{item.matchStatus === "OFFLINE" ? "重新連接音檔所在磁碟後，即可再試播放。" : "目前只有歌曲筆記；加入音檔並重新掃描後，即可在這裡播放。"}</p></div>
                      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">開啟原曲 <ExternalLink size={14} /></a> : null}
                    </div>
                  )}
                </div>

                <details className={styles.noteDisclosure}>
                  <summary>
                    <ChevronDown size={16} aria-hidden="true" />
                    <span className={styles.whenClosed}>展開筆記與分類</span>
                    <span className={styles.whenOpen}>收納筆記與分類</span>
                  </summary>
                  <div className={styles.disclosureBody}>
                <div className="reference-note-grid">
                  <section>
                    <h3>{item.notesAuthor ? `${item.notesAuthor} 喜歡` : "我喜歡"}</h3>
                    {item.preferenceNotes.length ? item.preferenceNotes.map((note) => <p key={note}>{note}</p>) : <p className="muted">尚未記錄偏好。</p>}
                  </section>
                  <section>
                    <h3>可參考用途</h3>
                    {item.referenceUses.length ? item.referenceUses.map((note) => <p key={note}>{note}</p>) : <p className="muted">尚未指定用途。</p>}
                  </section>
                  <section>
                    <h3>創作時要注意</h3>
                    {item.priorityNotes.length ? item.priorityNotes.map((note) => <p key={note}>{note}</p>) : <p className="muted">尚未記錄注意事項。</p>}
                  </section>
                </div>

                <div className="reference-card-footer">
                  <div className="tag-row">
                    {item.tags.slice(0, 8).map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                  <div className="reference-footer-actions">
                    {sourceUrl && item.audioUrl ? (
                      <a className="text-link" href={sourceUrl} target="_blank" rel="noreferrer">
                        原始來源 <ExternalLink size={14} />
                      </a>
                    ) : null}
                    <details>
                      <summary>索引資訊</summary>
                      <div className="reference-index-detail">
                        <span>建議分類：{item.suggestedCollection || "10_待分類"}</span>
                        <span>音檔：{item.externalAudioPath || "未配對"}</span>
                        <span>筆記：{item.externalNotePath || "未配對"}</span>
                        <span>SHA-256：{item.externalAudioSha256?.slice(0, 16) || "無音檔"}</span>
                      </div>
                    </details>
                  </div>
                </div>
                  </div>
                </details>
              </ReferenceMotionCard>
            );
          })}
          {!filtered.length ? <div className="empty">沒有符合目前篩選條件的風格參考。</div> : null}
        </div>
      </section>
    </>
  );
}
