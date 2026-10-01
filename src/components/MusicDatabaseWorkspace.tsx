"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Database, Plus, Search, Star, X } from "lucide-react";
import Link from "next/link";

import type { MusicMaterialDto } from "@/lib/music-database";
import styles from "./LibraryWorkspace.module.css";

const materialTypes = [
  ["style_reference", "風格參考歌曲"],
  ["lyric_seed", "歌詞片語"],
  ["melodic_motif", "旋律動機"],
  ["chord_progression", "和弦進行"],
  ["rhythm_pattern", "節奏語彙"],
  ["arrangement_reference", "編曲參考"],
  ["production_note", "製作指令"],
  ["sound_palette", "音色素材"],
  ["concept", "概念"]
] as const;

const materialStatuses = [
  ["COLLECTED", "已收集"],
  ["ACTIVE", "可供參考"],
  ["TESTING", "測試中"],
  ["ARCHIVED", "封存"]
] as const;

type MaterialForm = {
  title: string;
  materialType: string;
  content: string;
  summary: string;
  source: string;
  sourceUrl: string;
  genre: string;
  moods: string;
  tags: string;
  musicalKey: string;
  bpm: string;
  meter: string;
};

const emptyForm: MaterialForm = {
  title: "",
  materialType: "style_reference",
  content: "",
  summary: "",
  source: "",
  sourceUrl: "",
  genre: "",
  moods: "",
  tags: "",
  musicalKey: "",
  bpm: "",
  meter: ""
};

function splitTags(value: string) {
  return value.split(/[\n,，、]+/).map((tag) => tag.trim()).filter(Boolean);
}

function optionLabel(options: readonly (readonly [string, string])[], value: string) {
  return options.find(([key]) => key === value)?.[1] ?? value;
}

export function MusicDatabaseWorkspace({ initialMaterials }: { initialMaterials: MusicMaterialDto[] }) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(initialMaterials[0]?.id ?? null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [favoritePending, setFavoritePending] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const filteredMaterials = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return materials.filter((item) => {
      const searchable = [item.title, item.materialTypeLabel, item.content, item.summary, item.genre, item.artist, item.source, ...item.moods, ...item.tags, ...item.preferenceNotes, ...item.priorityNotes, ...item.styleFeatures]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return (!normalized || searchable.includes(normalized)) &&
        (type === "ALL" || item.materialType === type) &&
        (status === "ALL" || item.status === status) && (!favoritesOnly || item.favorite);
    });
  }, [materials, query, status, type, favoritesOnly]);

  const selected = filteredMaterials.find((item) => item.id === selectedId) ?? filteredMaterials[0] ?? null;

  async function toggleFavorite(item: MusicMaterialDto) {
    if (favoritePending) return;
    setFavoritePending(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/music-materials/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !item.favorite })
      });
      if (!response.ok) throw new Error("收藏狀態更新失敗");
      const updated = (await response.json()) as MusicMaterialDto;
      setMaterials((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "收藏狀態更新失敗");
    } finally {
      setFavoritePending(null);
    }
  }

  async function addMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/music-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          materialType: form.materialType,
          content: form.content.trim(),
          summary: form.summary.trim() || null,
          source: form.source.trim() || null,
          sourceUrl: form.sourceUrl.trim() || null,
          genre: form.genre.trim() || null,
          moods: splitTags(form.moods),
          tags: splitTags(form.tags),
          musicalKey: form.musicalKey.trim() || null,
          bpm: form.bpm ? Number(form.bpm) : null,
          meter: form.meter.trim() || null,
          status: "COLLECTED"
        })
      });
      if (!response.ok) throw new Error("素材新增失敗，請檢查必填內容");
      const created = (await response.json()) as MusicMaterialDto;
      setMaterials((current) => [created, ...current]);
      setSelectedId(created.id);
      setQuery("");
      setType("ALL");
      setStatus("ALL");
      setFavoritesOnly(false);
      setShowDetail(true);
      setForm(emptyForm);
      dialogRef.current?.close();
      setMessage(`已保存「${created.title}」。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "素材新增失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div><h1>音樂資料庫</h1><p>{materials.length} 筆素材 · {materials.filter((item) => item.favorite).length} 筆收藏</p></div>
        <div className={styles.actions}>
          <Link className="button" href="/music-db/references">歌曲與樂團 <ArrowUpRight size={16} /></Link>
          <button ref={newButtonRef} className="button primary" type="button" onClick={() => { setMessage(""); dialogRef.current?.showModal(); }}><Plus size={16} />新增素材</button>
        </div>
      </header>

      {message ? <p className="action-message" role="status">{message}</p> : null}

      <section className={`${styles.catalog} ${showDetail ? styles.detailOpen : ""}`} aria-label="音樂素材目錄">
        <div className={styles.directory}>
          <div className={styles.filters}>
          <div className="field">
            <label htmlFor="music-material-search">搜尋素材</label>
            <div className="search-field">
              <Search size={16} />
              <input id="music-material-search" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌曲、樂團、曲風、情緒或內容" />
            </div>
          </div>
          <div className={styles.filterRow}>
            <div className="field">
              <label htmlFor="music-material-type">類型</label>
              <select id="music-material-type" className="select" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="ALL">所有類型</option>
                {materialTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="music-material-status">狀態</label>
              <select id="music-material-status" className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="ALL">所有狀態</option>
                {materialStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.listHeading}>
            <span role="status">{filteredMaterials.length} 筆素材</span>
            <button type="button" className={styles.quietButton} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}><Star size={15} fill={favoritesOnly ? "currentColor" : "none"} />只看收藏</button>
          </div>
          </div>
          <div className={styles.results} aria-label="素材結果">
            {filteredMaterials.map((item) => (
              <button className={styles.result} type="button" key={item.id} onClick={() => { setSelectedId(item.id); setShowDetail(true); }} aria-pressed={selected?.id === item.id}>
                <span><strong>{item.title}</strong><small>{item.materialTypeLabel}{item.genre ? ` · ${item.genre}` : ""}</small></span>
                {item.favorite ? <Star size={14} fill="currentColor" aria-label="已收藏" /> : null}
              </button>
            ))}
            {!filteredMaterials.length ? <p className="empty">目前沒有符合條件的素材。</p> : null}
          </div>
        </div>

        <article className={styles.detail} aria-label="素材詳情" aria-live="polite">
          <button type="button" className={`${styles.quietButton} ${styles.backButton}`} onClick={() => setShowDetail(false)}><ArrowLeft size={16} />素材列表</button>
          {selected ? (
            <>
              <div className="toolbar">
                <div className="stack">
                  <div className="tag-row"><span className="tag">{selected.materialTypeLabel}</span><span className={selected.status === "ACTIVE" ? "tag green" : "tag"}>{optionLabel(materialStatuses, selected.status)}</span></div>
                  <h2>{selected.title}</h2>
                  {selected.artist ? <p className="muted">{selected.artist}</p> : null}
                </div>
                <button className={selected.favorite ? "icon-button active" : "icon-button"} disabled={favoritePending !== null} type="button" onClick={() => void toggleFavorite(selected)} aria-label={selected.favorite ? "取消收藏" : "收藏素材"} aria-pressed={selected.favorite} title={selected.favorite ? "取消收藏" : "收藏素材"}><Star size={17} fill={selected.favorite ? "currentColor" : "none"} /></button>
              </div>
              {selected.summary ? <p className="subtle">{selected.summary}</p> : null}
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.content}</p>
              <dl className={styles.metadata}>
                {[["曲風", selected.genre], ["調性", selected.musicalKey], ["BPM", selected.bpm], ["拍號", selected.meter], ["段落", selected.sectionRole], ["語言", selected.language]].filter(([, value]) => value !== null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              {[["重點筆記", selected.priorityNotes], ["個人偏好", selected.preferenceNotes], ["風格特徵", selected.styleFeatures], ["參考用途", selected.referenceUses]].map(([label, values]) => (values as string[]).length ? <section className={styles.noteSection} key={label as string}><h3>{label as string}</h3><ul>{Array.from(new Set(values as string[])).map((value) => <li key={value}>{value}</li>)}</ul></section> : null)}
              {selected.moods.length || selected.tags.length ? <div className="tag-row">{Array.from(new Set([...selected.moods, ...selected.tags])).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div> : null}
              {selected.relatedSong ? <p className="muted">關聯作品：{selected.relatedSong.title}</p> : null}
              {selected.relatedSound ? <div className="stack"><p className="muted">關聯音色：{selected.relatedSound.name}{selected.relatedSound.family ? ` · ${selected.relatedSound.family}` : ""}</p>{selected.relatedSound.previewPath || selected.relatedSound.assetPath ? <CyberAudioPlayer controls preload="none" src={selected.relatedSound.previewPath ?? selected.relatedSound.assetPath ?? undefined}><track kind="captions" /></CyberAudioPlayer> : null}</div> : null}
              {selected.source || selected.sourceUrl ? <div className={styles.source}><span><strong>{selected.source || "資料來源"}</strong><small>{selected.sourceUrl}</small></span>{selected.sourceUrl && /^https?:\/\//i.test(selected.sourceUrl) ? <a className="icon-button" href={selected.sourceUrl} target="_blank" rel="noreferrer" aria-label="開啟來源網址" title="開啟來源網址"><ArrowUpRight size={16} /></a> : null}</div> : null}
            </>
          ) : (
            <div className="empty"><Database size={18} /><span>選一筆素材查看內容；目前資料會完整保留。</span></div>
          )}
        </article>
      </section>

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="new-material-title" onClose={() => newButtonRef.current?.focus()} onCancel={(event) => { if (saving) event.preventDefault(); }}>
        <div className={styles.header}><h2 id="new-material-title">新增素材</h2><button className="icon-button" type="button" title="關閉" aria-label="關閉新增素材" disabled={saving} onClick={() => dialogRef.current?.close()}><X size={18} /></button></div>
        {message ? <p role="status">{message}</p> : null}
        <form className="stack" onSubmit={addMaterial}>
          <div className="field-row">
            <div className="field"><label htmlFor="material-title">名稱</label><input id="material-title" className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="歌曲、樂團或參考概念" /></div>
            <div className="field"><label htmlFor="material-type">資料類型</label><select id="material-type" className="select" value={form.materialType} onChange={(event) => setForm({ ...form, materialType: event.target.value })}>{materialTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="material-content">內容 / 觀察筆記</label><textarea id="material-content" className="textarea" required value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="記下歌曲特色、樂團聲音、編曲、和弦或你想參考的細節" /></div>
          <div className="field"><label htmlFor="material-summary">摘要</label><input id="material-summary" className="input" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="這筆資料最值得記住的地方" /></div>
          <div className="field-row three">
            <div className="field"><label htmlFor="material-genre">曲風</label><input id="material-genre" className="input" value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} /></div>
            <div className="field"><label htmlFor="material-key">調性</label><input id="material-key" className="input" value={form.musicalKey} onChange={(event) => setForm({ ...form, musicalKey: event.target.value })} /></div>
            <div className="field"><label htmlFor="material-bpm">BPM</label><input id="material-bpm" className="input" type="number" min="1" max="999" step="1" value={form.bpm} onChange={(event) => setForm({ ...form, bpm: event.target.value })} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label htmlFor="material-moods">情緒</label><input id="material-moods" className="input" value={form.moods} onChange={(event) => setForm({ ...form, moods: event.target.value })} placeholder="逗號分隔" /></div>
            <div className="field"><label htmlFor="material-tags">標籤</label><input id="material-tags" className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="逗號分隔" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label htmlFor="material-source">來源</label><input id="material-source" className="input" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="藝人、專輯或網站" /></div>
            <div className="field"><label htmlFor="material-url">來源網址</label><input id="material-url" className="input" type="url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://..." /></div>
          </div>
          <button className="button primary" type="submit" disabled={saving}><Plus size={16} />{saving ? "保存中" : "保存素材"}</button>
        </form>
      </dialog>
    </div>
  );
}
