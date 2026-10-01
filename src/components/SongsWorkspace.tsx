"use client";

import { ArrowUpDown, ArrowUpRight, Check, Filter, LayoutGrid, List, ListMusic, Plus, Save, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { SongDto } from "@/lib/music";
import { statusOptions } from "@/lib/music";

type CreateSongState = {
  title: string;
  workingTitle: string;
  status: string;
  bpm: string;
  musicalKey: string;
  genre: string;
  mood: string;
  summary: string;
};

const emptySong: CreateSongState = {
  title: "",
  workingTitle: "",
  status: "IDEA",
  bpm: "",
  musicalKey: "",
  genre: "",
  mood: "",
  summary: ""
};

function qualityStatusLabel(song: SongDto) {
  const master = song.audioFiles.find((file) => file.fileType === "master" && file.isPrimary) ?? song.audioFiles.find((file) => file.fileType === "master");
  if (!master) return { label: "缺母帶", className: "tag warn" };
  if (master.qualityStatus === "pass") return { label: "Master 通過", className: "tag green" };
  if (master.qualityStatus === "fail") return { label: "音質未通過", className: "tag danger" };
  if (master.qualityStatus === "warning") return { label: "音質警告", className: "tag warn" };
  return { label: "Master 待分析", className: "tag warn" };
}

function firstUsefulWarning(song: SongDto) {
  return song.warnings[0] ?? "資料完整，適合進下一步。";
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit" }).format(date);
}

export function SongsWorkspace({
  initialSongs,
  initialStatus
}: {
  initialSongs: SongDto[];
  initialStatus: string;
}) {
  const [songs, setSongs] = useState(initialSongs);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [genre, setGenre] = useState("ALL");
  const [form, setForm] = useState<CreateSongState>(emptySong);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [sortBy, setSortBy] = useState("updated-desc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>(statusOptions[0]?.value ?? "IDEA");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("songzu-catalog-view");
      if (!raw) {
        if (window.matchMedia("(max-width: 760px)").matches) setViewMode("cards");
        return;
      }
      const saved = JSON.parse(raw) as { query?: string; status?: string; genre?: string; sortBy?: string; viewMode?: string };
      if (typeof saved.query === "string") setQuery(saved.query);
      if (typeof saved.status === "string") setStatus(saved.status);
      if (typeof saved.genre === "string") setGenre(saved.genre);
      if (typeof saved.sortBy === "string") setSortBy(saved.sortBy);
      if (saved.viewMode === "cards" || saved.viewMode === "table") setViewMode(saved.viewMode);
    } catch {
      window.localStorage.removeItem("songzu-catalog-view");
    }
  }, []);

  const genres = useMemo(
    () => [...new Set(songs.map((song) => song.genre).filter((item): item is string => Boolean(item)))],
    [songs]
  );
  const statusCounts = useMemo(
    () =>
      statusOptions
        .map((option) => ({
          ...option,
          count: songs.filter((song) => song.status === option.value).length
        }))
        .filter((option) => option.count > 0),
    [songs]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return songs.filter((song) => {
      const haystack = `${song.title} ${song.workingTitle ?? ""} ${song.genre ?? ""} ${song.mood.join(" ")}`.toLowerCase();
      const matchesQuery = !normalized || haystack.includes(normalized);
      const matchesStatus = status === "ALL" || song.status === status;
      const matchesGenre = genre === "ALL" || song.genre === genre;
      return matchesQuery && matchesStatus && matchesGenre;
    });
  }, [songs, query, status, genre]);
  const visibleSongs = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "readiness-desc") return b.readiness - a.readiness;
      if (sortBy === "readiness-asc") return a.readiness - b.readiness;
      if (sortBy === "title") return a.title.localeCompare(b.title, "zh-Hant");
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [filtered, sortBy]);
  const catalogStats = useMemo(() => {
    const averageReadiness = songs.length ? Math.round(songs.reduce((total, song) => total + song.readiness, 0) / songs.length) : 0;
    return {
      total: songs.length,
      averageReadiness,
      releaseCandidates: songs.filter((song) => song.readiness >= 70).length,
      qualityRisks: songs.filter((song) => song.audioFiles.some((file) => ["fail", "warning", "pending"].includes(file.qualityStatus ?? ""))).length,
      localFiles: songs.reduce((total, song) => total + song.audioFiles.filter((file) => file.storageProvider === "local_upload").length, 0)
    };
  }, [songs]);

  async function createSong() {
    if (!form.title.trim()) return;
    setSaving(true);
    setFormMessage("");
    try {
      const created = await requestJson<SongDto>("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          workingTitle: form.workingTitle || null,
          status: form.status,
          bpm: form.bpm ? Number(form.bpm) : null,
          musicalKey: form.musicalKey || null,
          genre: form.genre || null,
          mood: form.mood.split(",").map((item) => item.trim()).filter(Boolean),
          summary: form.summary || null
        })
      });
      setSongs((current) => [created, ...current]);
      setForm(emptySong);
      setFormMessage(`已建立「${created.title}」`);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "建立作品失敗");
    } finally {
      setSaving(false);
    }
  }

  function saveCatalogView() {
    window.localStorage.setItem("songzu-catalog-view", JSON.stringify({ query, status, genre, sortBy, viewMode }));
    setCatalogMessage("目前的篩選、排序與檢視方式已儲存。");
  }

  function toggleSelected(songId: string) {
    setSelectedIds((current) => current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]);
  }

  function toggleAllVisible() {
    const visibleIds = visibleSongs.map((song) => song.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  }

  async function applyBulkStatus() {
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    setCatalogMessage("");
    try {
      const updated = await Promise.all(selectedIds.map((id) => requestJson<SongDto>(`/api/songs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: bulkStatus })
      })));
      const updatedMap = new Map(updated.map((song) => [song.id, song]));
      setSongs((current) => current.map((song) => updatedMap.get(song.id) ?? song));
      setCatalogMessage(`已更新 ${updated.length} 首作品的階段。`);
      setSelectedIds([]);
    } catch (error) {
      setCatalogMessage(error instanceof Error ? error.message : "批次更新失敗。");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <header className="catalog-hero">
        <div className="stack">
          <span className="eyebrow">作品資料庫</span>
          <h1>用作品庫決定下一首要推進的歌。</h1>
          <p className="subtle">每首歌都顯示狀態、音質、完整度、警告與下一步，方便快速掃描 catalog。</p>
        </div>
        <div className="catalog-summary">
          <span>
            <strong>{catalogStats.total}</strong>
            作品
          </span>
          <span>
            <strong>{catalogStats.averageReadiness}%</strong>
            平均完整度
          </span>
          <span>
            <strong>{catalogStats.releaseCandidates}</strong>
            發行候選
          </span>
          <span>
            <strong>{catalogStats.localFiles}</strong>
            本機檔案
          </span>
        </div>
      </header>

      <section className="section catalog-layout">
        <div className="stack">
          <div className="panel pad stack catalog-filter-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <h2>篩選作品庫</h2>
                <p className="muted">找歌、看狀態、切曲風。</p>
              </div>
              <div className="catalog-view-tools">
                <label className="catalog-sort-control">
                  <ArrowUpDown size={15} />
                  <select aria-label="作品排序" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                    <option value="updated-desc">最近更新</option>
                    <option value="readiness-desc">完整度高到低</option>
                    <option value="readiness-asc">完整度低到高</option>
                    <option value="title">歌名排序</option>
                  </select>
                </label>
                <div className="segmented-control" role="group" aria-label="作品檢視方式">
                  <button className={viewMode === "table" ? "active" : ""} type="button" onClick={() => setViewMode("table")} aria-label="表格檢視" aria-pressed={viewMode === "table"}>
                    <List size={16} />
                  </button>
                  <button className={viewMode === "cards" ? "active" : ""} type="button" onClick={() => setViewMode("cards")} aria-label="卡片檢視" aria-pressed={viewMode === "cards"}>
                    <LayoutGrid size={16} />
                  </button>
                </div>
                <button className="icon-button" type="button" onClick={saveCatalogView} aria-label="儲存目前作品庫檢視" title="儲存目前檢視">
                  <Save size={16} />
                </button>
                <Filter size={18} color="var(--accent)" />
              </div>
            </div>
            <div className="catalog-filter-grid">
              <div className="field">
                <label>搜尋</label>
                <div className="search-field">
                  <Search size={16} />
                <input
                  className="input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="歌名、曲風、情緒"
                />
              </div>
            </div>

              <div className="field">
                <label>狀態</label>
                <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="ALL">全部</option>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>曲風</label>
                <select className="select" value={genre} onChange={(event) => setGenre(event.target.value)}>
                  <option value="ALL">全部</option>
                  {genres.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="status-chip-row">
              <button className={status === "ALL" ? "tab-button active" : "tab-button"} onClick={() => setStatus("ALL")} type="button">
                全部 {songs.length}
              </button>
              {statusCounts.map((option) => (
                <button
                  className={status === option.value ? "tab-button active" : "tab-button"}
                  key={option.value}
                  onClick={() => setStatus(option.value)}
                  type="button"
                >
                  {option.label} {option.count}
                </button>
              ))}
            </div>
            {catalogMessage ? <p className="action-message" role="status">{catalogMessage}</p> : null}
          </div>

          {selectedIds.length ? (
            <div className="catalog-bulk-bar" role="region" aria-label="作品批次操作">
              <span><Check size={16} /><strong>{selectedIds.length}</strong> 首已選取</span>
              <select className="select compact-select" aria-label="批次作品階段" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button className="button primary" type="button" disabled={bulkBusy} onClick={() => void applyBulkStatus()}>{bulkBusy ? "更新中" : "套用階段"}</button>
              <Link className="button" href="/metadata">前往補資料</Link>
              <button className="icon-button" type="button" onClick={() => setSelectedIds([])} aria-label="清除作品選取"><X size={16} /></button>
            </div>
          ) : null}

          {visibleSongs.length ? viewMode === "cards" ? (
            <div className="catalog-board">
              {visibleSongs.map((song) => {
                const quality = qualityStatusLabel(song);
                return (
                  <Link className="catalog-card" href={`/songs/${song.id}`} key={song.id}>
                    <div className="catalog-card-top">
                      <span className={song.status === "READY_FOR_RELEASE" ? "status-badge ready" : "status-badge"}>{song.statusLabel}</span>
                      <ArrowUpRight size={17} />
                    </div>
                    <div className="stack">
                      <strong>{song.title}</strong>
                      <span className="muted">{song.genre ?? "未分類"} {song.subgenre ? `· ${song.subgenre}` : ""}</span>
                    </div>
                    <div className="catalog-card-meta">
                      <span>{song.bpm ?? "--"} BPM</span>
                      <span>{song.musicalKey ?? "--"}</span>
                      <span>{song.audioFiles.length} 檔案</span>
                    </div>
                    <div className="stack">
                      <div className="catalog-progress-line">
                        <span>{song.readiness}%</span>
                        <div className="progress">
                          <span style={{ width: `${song.readiness}%` }} />
                        </div>
                      </div>
                      <div className="tag-row">
                        <span className={quality.className}>
                          <ShieldCheck size={13} />
                          {quality.label}
                        </span>
                        {song.splitTotal === 100 ? <span className="tag green">分潤 100%</span> : <span className="tag warn">分潤 {song.splitTotal}%</span>}
                      </div>
                    </div>
                    <p className="muted">{firstUsefulWarning(song)}</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="catalog-table-shell panel">
              <table className="table catalog-table">
                <thead>
                  <tr>
                    <th className="catalog-select-cell">
                      <input
                        type="checkbox"
                        aria-label="選取目前顯示的所有作品"
                        checked={visibleSongs.every((song) => selectedIds.includes(song.id))}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th>作品</th>
                    <th>階段</th>
                    <th>Master</th>
                    <th>完整度</th>
                    <th>分潤</th>
                    <th>檔案</th>
                    <th>更新</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSongs.map((song) => {
                    const quality = qualityStatusLabel(song);
                    return (
                      <tr className={selectedIds.includes(song.id) ? "selected" : ""} key={song.id}>
                        <td className="catalog-select-cell">
                          <input type="checkbox" aria-label={`選取 ${song.title}`} checked={selectedIds.includes(song.id)} onChange={() => toggleSelected(song.id)} />
                        </td>
                        <td>
                          <Link className="catalog-table-title" href={`/songs/${song.id}`}>
                            <strong>{song.title}</strong>
                            <small>{song.genre ?? "未分類"}{song.subgenre ? ` · ${song.subgenre}` : ""}</small>
                            <span>{firstUsefulWarning(song)}</span>
                          </Link>
                        </td>
                        <td><span className={song.status === "READY_FOR_RELEASE" ? "status-badge ready" : "status-badge"}>{song.statusLabel}</span></td>
                        <td><span className={quality.className}>{quality.label}</span></td>
                        <td>
                          <div className="catalog-table-progress"><strong>{song.readiness}%</strong><div className="progress"><span style={{ width: `${song.readiness}%` }} /></div></div>
                        </td>
                        <td><span className={song.splitTotal === 100 ? "tag green" : "tag warn"}>{song.splitTotal}%</span></td>
                        <td>{song.audioFiles.length}</td>
                        <td>{formatUpdatedAt(song.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">沒有符合條件的歌曲。</div>
          )}
        </div>

        <aside className="panel pad stack create-song-panel">
          <div className="toolbar compact-toolbar">
            <div>
            <h2>新增作品</h2>
            <p className="muted">先建立作品卡，細節之後進歌頁補。</p>
          </div>
            <ListMusic size={18} color="var(--accent)" />
          </div>
          <div className="field">
            <label>歌名</label>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="field">
            <label>暫定歌名</label>
            <input
              className="input"
              value={form.workingTitle}
              onChange={(event) => setForm({ ...form, workingTitle: event.target.value })}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>狀態</label>
              <select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>BPM</label>
              <input className="input" inputMode="numeric" value={form.bpm} onChange={(event) => setForm({ ...form, bpm: event.target.value })} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>調性</label>
              <input
                className="input"
                value={form.musicalKey}
                onChange={(event) => setForm({ ...form, musicalKey: event.target.value })}
              />
            </div>
            <div className="field">
              <label>曲風</label>
              <input className="input" value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>情緒標籤，用逗號分隔</label>
            <input className="input" value={form.mood} onChange={(event) => setForm({ ...form, mood: event.target.value })} />
          </div>
          <div className="field">
            <label>摘要</label>
            <textarea
              className="textarea"
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </div>
          <button className="button primary" onClick={createSong} disabled={saving || !form.title.trim()}>
            <Plus size={16} />
            {saving ? "建立中" : "建立作品"}
          </button>
          {formMessage ? <p className="action-message" role="status">{formMessage}</p> : null}
          <div className="catalog-side-note">
            <strong>{catalogStats.qualityRisks}</strong>
            <span>首作品有待確認音質；建立新歌後建議先上傳 demo 或 GarageBand 匯出版本。</span>
          </div>
        </aside>
      </section>
    </>
  );
}
