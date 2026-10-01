"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import { Archive, CheckCircle2, Download, ExternalLink, FileAudio, Filter, Plus, Search, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { SoundLibraryItemDto } from "@/lib/sound-library";
import { soundItemTypeOptions, soundStatusOptions } from "@/lib/sound-library";

type SoundFormState = {
  name: string;
  itemType: string;
  family: string;
  era: string;
  source: string;
  description: string;
  tags: string;
  character: string;
  useCases: string;
  chain: string;
  garageBandHint: string;
  notes: string;
  status: string;
};

const emptyForm: SoundFormState = {
  name: "",
  itemType: "instrument",
  family: "",
  era: "",
  source: "",
  description: "",
  tags: "",
  character: "",
  useCases: "",
  chain: "",
  garageBandHint: "",
  notes: "",
  status: "COLLECTED"
};

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusClass(status: string) {
  if (status === "ACTIVE") return "tag green";
  if (status === "TESTING") return "tag warn";
  if (status === "ARCHIVED") return "tag";
  return "tag";
}

function formatBytes(value: number | null | undefined) {
  if (!value) return "未記錄";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function patchItem(id: string, body: Partial<SoundLibraryItemDto>) {
  const response = await fetch(`/api/sound-library/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as SoundLibraryItemDto;
}

export function SoundLibraryWorkspace({ initialItems }: { initialItems: SoundLibraryItemDto[] }) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [family, setFamily] = useState("ALL");
  const [era, setEra] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [form, setForm] = useState<SoundFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const families = useMemo(() => [...new Set(items.map((item) => item.family).filter((value): value is string => Boolean(value)))], [items]);
  const eras = useMemo(() => [...new Set(items.map((item) => item.era).filter((value): value is string => Boolean(value)))], [items]);
  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) => item.status === "ACTIVE").length,
      favorites: items.filter((item) => item.favorite).length,
      eras: eras.length
    }),
    [items, eras.length]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.name,
        item.itemTypeLabel,
        item.family,
        item.era,
        item.source,
        item.description,
        item.assetPath,
        item.sourceUrl,
        item.licenseName,
        item.tags.join(" "),
        item.character.join(" "),
        item.useCases.join(" "),
        item.chain.join(" ")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (
        (!normalized || haystack.includes(normalized)) &&
        (type === "ALL" || item.itemType === type) &&
        (family === "ALL" || item.family === family) &&
        (era === "ALL" || item.era === era) &&
        (status === "ALL" || item.status === status)
      );
    });
  }, [items, query, type, family, era, status]);

  async function createItem() {
    if (!form.name.trim()) return;
    setSaving(true);
    setActionMessage("");
    try {
      const created = await requestJson<SoundLibraryItemDto>("/api/sound-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        name: form.name.trim(),
        itemType: form.itemType,
        family: form.family || null,
        era: form.era || null,
        source: form.source || null,
        description: form.description || null,
        tags: splitList(form.tags),
        character: splitList(form.character),
        useCases: splitList(form.useCases),
        chain: splitList(form.chain),
        garageBandHint: form.garageBandHint || null,
        notes: form.notes || null,
        status: form.status
        })
      });
      setItems((current) => [created, ...current]);
      setForm(emptyForm);
      setActionMessage(`音色「${created.name}」已加入資料庫。`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "新增音色失敗");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(id: string, body: Partial<SoundLibraryItemDto>) {
    const updated = await patchItem(id, body);
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
  }

  return (
    <>
      <header className="dashboard-hero sound-hero">
        <div className="stack">
          <span className="eyebrow">Sound Library</span>
          <h1>音色、樂器、效果與年代資料庫。</h1>
          <p className="subtle">先把想用的聲音收集成素材卡：來源、年代、特性、使用情境、效果鏈與 GarageBand 替代做法。</p>
          <div className="dashboard-actions">
            <a className="button" href="#sound-create">
              <Plus size={16} />
              新增素材
            </a>
            <a className="button" href="#sound-board">
              <SlidersHorizontal size={16} />
              查看清單
            </a>
          </div>
        </div>
        <div className="command-panel">
          <span className="muted">音色庫狀態</span>
          <strong>{stats.total}</strong>
          <div className="command-grid">
            <span>{stats.active} 可使用</span>
            <span>{stats.favorites} 收藏</span>
            <span>{items.filter((item) => item.assetPath).length} 音檔</span>
            <span>{stats.eras} 年代</span>
          </div>
        </div>
      </header>

      {actionMessage ? <p className="action-message" role="status">{actionMessage}</p> : null}

      <section className="section sound-layout">
        <div className="stack">
          <div className="panel pad stack catalog-filter-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <h2>篩選音色</h2>
                <p className="muted">用手機也能快速找：樂器、效果、年代、用途。</p>
              </div>
              <Filter size={18} color="var(--accent)" />
            </div>
            <div className="sound-filter-grid">
              <div className="field">
                <label>搜尋</label>
                <div className="search-field">
                  <Search size={16} />
                  <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：vocal、plate、80s、敬拜" />
                </div>
              </div>
              <div className="field">
                <label>類型</label>
                <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
                  <option value="ALL">全部</option>
                  {soundItemTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>家族</label>
                <select className="select" value={family} onChange={(event) => setFamily(event.target.value)}>
                  <option value="ALL">全部</option>
                  {families.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>年代</label>
                <select className="select" value={era} onChange={(event) => setEra(event.target.value)}>
                  <option value="ALL">全部</option>
                  {eras.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>狀態</label>
                <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="ALL">全部</option>
                  {soundStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="sound-card-grid" id="sound-board">
            {filtered.map((item) => (
              <article className="sound-card" key={item.id}>
                <div className="toolbar compact-toolbar">
                  <div className="stack">
                    <div className="tag-row">
                      <span className={statusClass(item.status)}>{item.statusLabel}</span>
                      <span className="tag">{item.itemTypeLabel}</span>
                      {item.era && <span className="tag">{item.era}</span>}
                    </div>
                    <h2>{item.name}</h2>
                  </div>
                  <button className={item.favorite ? "button primary" : "button"} onClick={() => updateItem(item.id, { favorite: !item.favorite })}>
                    <Star size={16} />
                    {item.favorite ? "收藏" : "收藏"}
                  </button>
                </div>
                <p className="muted">{item.description ?? "尚未填寫描述。"}</p>
                {(item.previewPath || item.assetPath) && (
                  <div className="sound-audio-panel">
                    <div className="toolbar compact-toolbar">
                      <span className="tag green">
                        <FileAudio size={13} />
                        已下載本機音檔
                      </span>
                      <span className="muted">{formatBytes(item.fileSizeBytes)}</span>
                    </div>
                    <CyberAudioPlayer controls preload="metadata" src={item.previewPath ?? item.assetPath ?? undefined} />
                    <div className="tag-row">
                      {item.assetPath && (
                        <a className="button ghost" href={item.assetPath} download>
                          <Download size={14} />
                          下載原檔
                        </a>
                      )}
                      {item.sourceUrl && (
                        <a className="button ghost" href={item.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          來源
                        </a>
                      )}
                    </div>
                  </div>
                )}
                <div className="sound-meta-grid">
                  <span>
                    <strong>{item.family ?? "未分類"}</strong>
                    家族
                  </span>
                  <span>
                    <strong>{item.source ?? "待補"}</strong>
                    來源
                  </span>
                  <span>
                    <strong>{item.useCases.length}</strong>
                    用途
                  </span>
                </div>
                {(item.licenseName || item.sha256) && (
                  <div className="sound-license">
                    {item.licenseName && (
                      <span>
                        <strong>授權</strong>
                        {item.licenseUrl ? (
                          <a href={item.licenseUrl} target="_blank" rel="noreferrer">
                            {item.licenseName}
                          </a>
                        ) : (
                          item.licenseName
                        )}
                      </span>
                    )}
                    {item.sha256 && (
                      <span>
                        <strong>SHA-256</strong>
                        {item.sha256.slice(0, 16)}...
                      </span>
                    )}
                  </div>
                )}
                <div className="tag-row">
                  {[...item.tags, ...item.character].slice(0, 8).map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="sound-chain">
                  <strong>效果鏈</strong>
                  {item.chain.length ? item.chain.map((step) => <span key={step}>{step}</span>) : <span>尚未建立</span>}
                </div>
                {item.garageBandHint && (
                  <div className="system-note">
                    <Sparkles size={17} />
                    <span>
                      <strong>GarageBand 做法</strong>
                      <br />
                      {item.garageBandHint}
                    </span>
                  </div>
                )}
                <div className="toolbar compact-toolbar">
                  <select className="select compact-select" value={item.status} onChange={(event) => updateItem(item.id, { status: event.target.value })}>
                    {soundStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="tag-row">
                    {item.status === "ACTIVE" && (
                      <span className="tag green">
                        <CheckCircle2 size={13} />
                        可用
                      </span>
                    )}
                    {item.status === "ARCHIVED" && (
                      <span className="tag">
                        <Archive size={13} />
                        封存
                      </span>
                    )}
                  </span>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && <div className="empty">沒有符合條件的音色素材。</div>}
        </div>

        <aside className="panel pad stack create-song-panel" id="sound-create">
          <div className="toolbar compact-toolbar">
            <div>
              <h2>新增音色素材</h2>
              <p className="muted">先記資料，之後再補音源檔、preset 或 GarageBand 設定。</p>
            </div>
            <Plus size={18} color="var(--accent)" />
          </div>
          <div className="field">
            <label>名稱</label>
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例：80s Synth Pad" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>類型</label>
              <select className="select" value={form.itemType} onChange={(event) => setForm({ ...form, itemType: event.target.value })}>
                {soundItemTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>狀態</label>
              <select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {soundStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>家族</label>
              <input className="input" value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value })} placeholder="鍵盤、人聲、空間" />
            </div>
            <div className="field">
              <label>年代</label>
              <input className="input" value={form.era} onChange={(event) => setForm({ ...form, era: event.target.value })} placeholder="1970s、Modern Worship" />
            </div>
          </div>
          <div className="field">
            <label>來源</label>
            <input className="input" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="GarageBand、參考歌、外部音源" />
          </div>
          <div className="field">
            <label>描述</label>
            <textarea className="textarea compact-textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
          <div className="field">
            <label>標籤</label>
            <input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="用逗號分隔" />
          </div>
          <div className="field">
            <label>聲音特性</label>
            <input className="input" value={form.character} onChange={(event) => setForm({ ...form, character: event.target.value })} placeholder="溫暖, 寬, 復古" />
          </div>
          <div className="field">
            <label>用途</label>
            <input className="input" value={form.useCases} onChange={(event) => setForm({ ...form, useCases: event.target.value })} placeholder="副歌, Bridge, 短影音" />
          </div>
          <div className="field">
            <label>效果鏈</label>
            <input className="input" value={form.chain} onChange={(event) => setForm({ ...form, chain: event.target.value })} placeholder="EQ, Compressor, Plate Reverb" />
          </div>
          <div className="field">
            <label>GarageBand 提示</label>
            <textarea className="textarea compact-textarea" value={form.garageBandHint} onChange={(event) => setForm({ ...form, garageBandHint: event.target.value })} />
          </div>
          <button className="button primary" onClick={createItem} disabled={!form.name.trim() || saving}>
            <Plus size={16} />
            {saving ? "新增中" : "新增素材"}
          </button>
        </aside>
      </section>
    </>
  );
}
