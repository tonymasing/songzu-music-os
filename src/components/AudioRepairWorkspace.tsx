"use client";

import { Archive, ChevronDown, FileAudio, FileUp, FolderInput, RefreshCw, Save, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import type { AudioRepairItemDto } from "@/lib/audio-repair";
import { audioRepairState, isManagedAudioProvider } from "@/lib/audio-repair-policy";

type View = "repair" | "review" | "all" | "archived";
type VersionDraft = Pick<AudioRepairItemDto, "versionName" | "fileType" | "parentAudioFileId" | "isPrimary" | "notes">;
type BulkResponse = { items: AudioRepairItemDto[]; summary: {
  processed: number; skipped: number; failed: Array<{ id: string; error: string }>;
} };
const views: Array<[View, string]> = [["repair", "待修復"], ["review", "音質提醒"], ["all", "所有音檔"], ["archived", "已封存"]];
const stateLabels = { repair: "需要處理", review: "音質提醒", healthy: "檔案正常", archived: "已封存" };
const fileTypes = ["voice_memo", "demo", "mix", "master", "stem", "reference", "preview", "other"];

function draftOf(item: AudioRepairItemDto): VersionDraft {
  const { versionName, fileType, parentAudioFileId, isPrimary, notes } = item;
  return { versionName, fileType, parentAudioFileId, isPrimary, notes };
}

function formatBytes(value: number | null) {
  if (value === null) return "大小未記錄";
  return value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(1) + " MB" : Math.ceil(value / 1024) + " KB";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "工作未完成，請稍後再試。");
  return result as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function AudioRepairWorkspace({ initialItems }: { initialItems: AudioRepairItemDto[] }) {
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState<View>("repair");
  const [query, setQuery] = useState("");
  const [songId, setSongId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, VersionDraft>>({});
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bulkErrors, setBulkErrors] = useState<Array<{ id: string; error: string }>>([]);

  const counts = useMemo(() => ({
    repair: items.filter(item => audioRepairState(item) === "repair").length,
    review: items.filter(item => audioRepairState(item) === "review").length,
    all: items.filter(item => !item.archivedAt).length,
    archived: items.filter(item => item.archivedAt).length,
    healthy: items.filter(item => audioRepairState(item) === "healthy").length,
    missing: items.filter(item => !item.archivedAt && !item.exists).length
  }), [items]);
  const songs = useMemo(() => Array.from(new Map(items.map(item => [item.songId, item.songTitle]))), [items]);
  const filtered = useMemo(() => items.filter(item => {
    const state = audioRepairState(item);
    if (view === "all" ? state === "archived" : state !== view) return false;
    if (songId && item.songId !== songId) return false;
    const text = [item.songTitle, item.fileName, item.fileTypeLabel, item.versionName, ...item.issues, ...item.versionIssues].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [items, view, songId, query]);
  const selected = filtered.filter(item => selectedIds.includes(item.id));
  const analyzable = selected.filter(item => item.exists && !item.archivedAt);
  const missing = selected.filter(item => !item.exists && !item.archivedAt);

  function filterChanged(change: () => void) { change(); setSelectedIds([]); }

  async function run(label: string, action: () => Promise<string>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError(""); setBulkErrors([]); setMessage(label + "中…");
    try { setMessage(await action()); }
    catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "工作未完成。"); }
    finally { operation.current = false; setBusy(false); }
  }

  async function refresh() {
    const updated = await request<AudioRepairItemDto[]>("/api/audio-repair");
    if (!Array.isArray(updated)) throw new Error("無法讀取音檔清單。");
    setItems(updated);
    setSelectedIds(current => current.filter(id => updated.some(item => item.id === id)));
  }

  function updateItem(updated: AudioRepairItemDto) {
    setItems(current => current.map(item => item.id === updated.id ? updated : item));
  }

  async function repair(item: AudioRepairItemDto, action: string) {
    await run(action === "reanalyze" ? "音質檢查" : action === "archive" ? "封存缺檔" : "找回原檔", async () => {
      const updated = await request<AudioRepairItemDto>("/api/audio-files/" + item.id + "/repair", json("POST", {
        action, sourcePath: paths[item.id] || "", reason: "音檔修復：封存未使用的缺檔紀錄"
      }));
      updateItem(updated);
      if (action === "reanalyze" && updated.latestReport?.errorMessage) throw new Error(updated.latestReport.errorMessage);
      return action === "reanalyze" ? "音質檢查完成，結果已更新。" : action === "archive" ? "缺檔紀錄已封存。" : "已確認音訊一致，原檔連結已恢復。";
    });
  }

  async function upload(item: AudioRepairItemDto, file: File | undefined) {
    if (!file) return;
    await run("找回原檔", async () => {
      const form = new FormData(); form.set("file", file);
      updateItem(await request<AudioRepairItemDto>("/api/audio-files/" + item.id + "/replace-upload", { method: "POST", body: form }));
      return "已確認音訊一致，原檔連結已恢復。";
    });
  }

  async function bulk(action: "reanalyze_selected" | "archive_missing_selected") {
    const targets = action === "reanalyze_selected" ? analyzable : missing;
    if (!targets.length) return;
    await run("批次處理", async () => {
      const result = await request<BulkResponse>("/api/audio-repair", json("POST", { action, ids: targets.map(item => item.id) }));
      const updates = new Map(result.items.map(item => [item.id, item]));
      setItems(current => current.map(item => updates.get(item.id) || item));
      setBulkErrors(result.summary.failed);
      setSelectedIds(result.summary.failed.map(item => item.id));
      return "完成 " + result.summary.processed + " 個，略過 " + result.summary.skipped + " 個" + (result.summary.failed.length ? "，未完成 " + result.summary.failed.length + " 個" : "") + "。";
    });
  }

  async function saveVersion(item: AudioRepairItemDto) {
    const draft = drafts[item.id] || draftOf(item);
    await run("儲存版本", async () => {
      updateItem(await request<AudioRepairItemDto>("/api/audio-files/" + item.id, json("PATCH", draft)));
      setDrafts(current => { const next = { ...current }; delete next[item.id]; return next; });
      try { await refresh(); }
      catch { return "版本已儲存；清單更新失敗，請重新整理。"; }
      return "版本設定已儲存。";
    });
  }

  function edit(item: AudioRepairItemDto, patch: Partial<VersionDraft>) {
    setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] || draftOf(item)), ...patch } }));
  }

  return (
    <div className="audio-repair-workspace">
      <header className="audio-repair-heading">
        <div><span className="eyebrow">檔案維護</span><h1>音檔修復</h1></div>
        <div className="repair-heading-actions">
          <Link className="button" href="/songs"><FileAudio size={16} />作品庫</Link>
          <button type="button" className="button" disabled={busy} onClick={() => run("重新整理", async () => { await refresh(); return "清單已更新。"; })}><RefreshCw size={16} />重新整理</button>
        </div>
      </header>
      <div className="repair-health-strip" aria-label="音檔狀態摘要">
        <span><strong>{counts.all}</strong> 個音檔</span>
        <span className={counts.missing ? "repair-danger" : ""}><strong>{counts.missing}</strong> 個缺檔</span>
        <span><strong>{counts.repair}</strong> 個待修復</span>
        <span><strong>{counts.review}</strong> 個音質提醒</span>
        <span><ShieldCheck size={16} /><strong>{counts.healthy}</strong> 個檔案正常</span>
      </div>
      <div className="repair-filter-bar">
        <div className="repair-views" role="group" aria-label="音檔分類">
          {views.map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} disabled={busy}
            onClick={() => filterChanged(() => setView(key))}>{label}<span>{counts[key]}</span></button>)}
        </div>
        <div className="repair-search-controls">
          <label className="repair-search"><Search size={16} /><input aria-label="搜尋音檔" value={query} disabled={busy}
            onChange={event => filterChanged(() => setQuery(event.target.value))} placeholder="搜尋歌曲或音檔" /></label>
          <select className="select" aria-label="作品篩選" value={songId} disabled={busy} onChange={event => filterChanged(() => setSongId(event.target.value))}>
            <option value="">所有作品</option>{songs.map(([id, title]) => <option value={id} key={id}>{title}</option>)}
          </select>
        </div>
      </div>
      {filtered.length > 0 && <div className="repair-selection-bar">
        <label><input type="checkbox" aria-label="選取目前清單" disabled={busy || view === "archived"}
          checked={selected.length === filtered.length} onChange={event => setSelectedIds(event.target.checked ? filtered.map(item => item.id) : [])} />已選 {selected.length} 個</label>
        <button className="button" type="button" disabled={busy || !analyzable.length} onClick={() => bulk("reanalyze_selected")}><RefreshCw size={15} />檢查所選音質</button>
        {missing.length > 0 && <button className="button" type="button" disabled={busy} onClick={() => bulk("archive_missing_selected")}><Archive size={15} />封存未使用缺檔</button>}
      </div>}
      {message && <p className="repair-message" role="status">{message}</p>}
      {error && <p className="repair-error" role="alert">{error}</p>}
      {bulkErrors.length > 0 && <ul className="repair-error" role="alert">{bulkErrors.map(item => <li key={item.id}>{items.find(file => file.id === item.id)?.fileName || item.id}：{item.error}</li>)}</ul>}
      {!filtered.length && <div className="repair-empty">
        <ShieldCheck size={32} />
        <h2>{query || songId ? "沒有符合條件的音檔" : view === "repair" ? "目前沒有需要修復的音檔" : view === "review" ? "目前沒有音質提醒" : view === "archived" ? "沒有封存紀錄" : "尚無音檔"}</h2>
        {view === "repair" && !query && !songId && <p>{counts.all} 個音檔已檢查可用狀態{counts.review ? "，另有 " + counts.review + " 個音質提醒。" : "。"}</p>}
      </div>}
      <div className="repair-file-list">
        {filtered.map(item => {
          const state = audioRepairState(item), draft = drafts[item.id] || draftOf(item);
          const external = !isManagedAudioProvider(item.storageProvider);
          return <article className="repair-file" key={item.id}>
            <label className="repair-file-select"><input type="checkbox" aria-label={"選取 " + item.fileName} disabled={busy || Boolean(item.archivedAt)}
              checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /></label>
            <details className="repair-file-details">
              <summary><div className="repair-file-name"><strong>{item.fileName}</strong><span>{item.songTitle} · {item.fileTypeLabel} · {formatBytes(item.fileSizeBytes)}</span></div>
                <span className={"repair-state repair-state-" + state}>{stateLabels[state]}</span><ChevronDown size={16} /></summary>
              <div className="repair-file-body">
                {item.issues.length > 0 && <ul className="repair-issues">{item.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
                {item.latestReport?.errorMessage && <p className="repair-error">{item.latestReport.errorMessage}</p>}
                <fieldset disabled={busy || Boolean(item.archivedAt)}>
                  <div className="repair-file-actions">
                    <Link className="button" href={"/songs/" + item.songId + "/daw"}><FileAudio size={15} />開啟 DAW</Link>
                    <button className="button" type="button" disabled={!item.exists} onClick={() => repair(item, "reanalyze")}><RefreshCw size={15} />檢查音質</button>
                    {!item.exists && <label className="button repair-upload"><FileUp size={15} />找回原檔<input type="file" aria-label={"找回 " + item.fileName} disabled={busy || Boolean(item.archivedAt)} accept="audio/*,video/*,.wav,.aiff,.flac,.mp3,.m4a,.webm"
                      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(item, file); }} /></label>}
                  </div>
                  {(!item.exists || external) && <div className="repair-import-row">
                    <label className="field"><span>原檔完整路徑</span><input className="input" value={paths[item.id] || ""} onChange={event => setPaths(current => ({ ...current, [item.id]: event.target.value }))} placeholder="/Volumes/…/原檔.wav" /></label>
                    <button type="button" className="button" disabled={!paths[item.id]?.trim()} onClick={() => repair(item, "import_path")}><FolderInput size={15} />驗證並匯入</button>
                  </div>}
                  <details className="repair-advanced"><summary>檔案與版本設定<ChevronDown size={15} /></summary>
                    <div className="repair-advanced-body">
                      <dl className="repair-file-metadata"><div><dt>目前路徑</dt><dd>{item.filePath || "未設定"}</dd></div><div><dt>檔案指紋</dt><dd>{item.sha256 || "未建立"}</dd></div></dl>
                      {item.versionIssues.length > 0 && <p className="muted">整理建議：{item.versionIssues.join("、")}</p>}
                      <label className="field"><span>版本名稱</span><input className="input" value={draft.versionName || ""} onChange={event => edit(item, { versionName: event.target.value || null })} /></label>
                      <div className="repair-version-row">
                        <label className="field"><span>檔案類型</span><select className="select" value={draft.fileType} onChange={event => edit(item, { fileType: event.target.value })}>{Array.from(new Set([item.fileType, ...fileTypes])).map(type => <option key={type} value={type}>{type === item.fileType ? item.fileTypeLabel : type}</option>)}</select></label>
                        <label className="field"><span>來源版本</span><select className="select" value={draft.parentAudioFileId || ""} onChange={event => edit(item, { parentAudioFileId: event.target.value || null })}>
                          <option value="">未連結</option>{items.filter(other => other.songId === item.songId && other.id !== item.id && !other.archivedAt).map(other => <option value={other.id} key={other.id}>{other.versionName || other.fileName}</option>)}
                        </select></label>
                      </div>
                      <label className="repair-checkbox"><input type="checkbox" checked={draft.isPrimary} onChange={event => edit(item, { isPrimary: event.target.checked })} />此類型的主要版本</label>
                      <label className="field"><span>備註</span><textarea className="textarea" rows={2} value={draft.notes || ""} onChange={event => edit(item, { notes: event.target.value || null })} /></label>
                      <div className="repair-file-actions"><button type="button" className="button primary" onClick={() => saveVersion(item)} disabled={!drafts[item.id]}><Save size={15} />儲存版本</button>
                        {!item.exists && <button type="button" className="button" onClick={() => repair(item, "archive")}><Archive size={15} />封存未使用缺檔</button>}</div>
                    </div>
                  </details>
                </fieldset>
              </div>
            </details>
          </article>;
        })}
      </div>
    </div>
  );
}
