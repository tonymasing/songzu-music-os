"use client";

import { Copy, Link as LinkIcon, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { SongDto } from "@/lib/music";
import type { PitchPackDto } from "@/lib/pitch";

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

export function PitchWorkspace({ songs, initialPacks }: { songs: SongDto[]; initialPacks: PitchPackDto[] }) {
  const [packs, setPacks] = useState(initialPacks);
  const [form, setForm] = useState({
    title: "新分享包",
    description: "",
    songIds: songs.slice(0, 2).map((song) => song.id),
    allowDownload: false,
    showLyrics: true,
    showCredits: true,
    showContact: true,
    contactInfo: "請填入聯絡方式"
  });
  const [saving, setSaving] = useState(false);

  const selectedSongs = useMemo(
    () => songs.filter((song) => form.songIds.includes(song.id)),
    [form.songIds, songs]
  );
  const publicReadyPacks = packs.filter((pack) => pack.songs.length > 0).length;
  const downloadablePacks = packs.filter((pack) => pack.allowDownload).length;

  function toggleSong(songId: string) {
    setForm((current) => ({
      ...current,
      songIds: current.songIds.includes(songId)
        ? current.songIds.filter((id) => id !== songId)
        : [...current.songIds, songId]
    }));
  }

  function shareUrl(token: string) {
    if (typeof window === "undefined") return `/share/${token}`;
    return `${window.location.origin}/share/${token}`;
  }

  async function createPack() {
    if (!form.title.trim() || !form.songIds.length) return;
    setSaving(true);
    const created = await jsonRequest<PitchPackDto>("/api/pitch-packs", form);
    setPacks((current) => [created, ...current]);
    setForm((current) => ({ ...current, title: "新分享包", description: "" }));
    setSaving(false);
  }

  async function copyShareLink(token: string) {
    await navigator.clipboard.writeText(shareUrl(token));
  }

  return (
    <>
      <header className="dashboard-hero">
        <div className="stack">
          <span className="eyebrow">Pitch / 分享包</span>
          <h1>把作品整理成可直接給人的私密包。</h1>
          <p className="subtle">選歌、填介紹、設定權限、取得 token 連結；目前適合本機、內網或私下預覽。</p>
        </div>
        <div className="command-panel">
          <div>
            <span className="muted">Pitch packs</span>
            <strong>{packs.length}</strong>
          </div>
          <div className="command-grid">
            <span>{publicReadyPacks} 可開啟</span>
            <span>{downloadablePacks} 允許下載</span>
            <span>{songs.length} 首可選</span>
            <span>{selectedSongs.length} 首已選</span>
          </div>
        </div>
      </header>

      <section className="split-layout section">
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>建立分享包</h2>
              <p className="muted">選幾首歌，決定是否顯示歌詞、credits、下載與聯絡資訊。</p>
            </div>
            <Send size={18} color="var(--accent)" />
          </div>

          <div className="release-readiness-strip">
            <span>
              <strong>1</strong>
              選歌
            </span>
            <span>
              <strong>2</strong>
              填介紹
            </span>
            <span>
              <strong>3</strong>
              設權限
            </span>
            <span>
              <strong>4</strong>
              複製連結
            </span>
          </div>

          <div className="field">
            <label>分享包標題</label>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="field">
            <label>短介紹</label>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>

          <div className="field">
            <label>選取歌曲</label>
            <div className="small-list">
              {songs.map((song) => (
                <label className="check-row" key={song.id}>
                  <input checked={form.songIds.includes(song.id)} type="checkbox" onChange={() => toggleSong(song.id)} />
                  <span>
                    <strong>{song.title}</strong>
                    <br />
                    <span className="muted">
                      {song.genre ?? "曲風待填"} · {song.bpm ?? "--"} BPM · {song.musicalKey ?? "調性待填"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label className="check-row">
              <input
                checked={form.allowDownload}
                type="checkbox"
                onChange={(event) => setForm({ ...form, allowDownload: event.target.checked })}
              />
              允許下載
            </label>
            <label className="check-row">
              <input
                checked={form.showLyrics}
                type="checkbox"
                onChange={(event) => setForm({ ...form, showLyrics: event.target.checked })}
              />
              顯示歌詞
            </label>
            <label className="check-row">
              <input
                checked={form.showCredits}
                type="checkbox"
                onChange={(event) => setForm({ ...form, showCredits: event.target.checked })}
              />
              顯示 credits
            </label>
            <label className="check-row">
              <input
                checked={form.showContact}
                type="checkbox"
                onChange={(event) => setForm({ ...form, showContact: event.target.checked })}
              />
              顯示聯絡資訊
            </label>
          </div>

          <div className="field">
            <label>聯絡資訊</label>
            <input
              className="input"
              value={form.contactInfo}
              onChange={(event) => setForm({ ...form, contactInfo: event.target.value })}
            />
          </div>

          <button className="button primary" onClick={createPack} disabled={saving || !form.songIds.length}>
            <Plus size={16} />
            {saving ? "建立中" : "建立分享包"}
          </button>
        </div>

        <aside className="stack">
          <div className="panel pad stack">
            <h2>即將包含</h2>
            <div className="small-list">
              {selectedSongs.map((song) => (
                <div className="list-row" key={song.id}>
                  <span>
                    <strong>{song.title}</strong>
                    <br />
                    <span className="muted">{song.summary ?? "尚未填摘要"}</span>
                  </span>
                  <span className="tag">{song.readiness}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>已建立分享包</h2>
                <p className="muted">複製 token 連結即可分享。</p>
              </div>
              <LinkIcon size={18} color="var(--accent)" />
            </div>
            <div className="pitch-pack-grid">
              {packs.map((pack) => (
                <div className="pitch-pack-card" key={pack.id}>
                  <div className="toolbar compact-toolbar">
                    <div>
                      <strong>{pack.title}</strong>
                      <p className="muted">{pack.songs.length} 首歌 · /share/{pack.token}</p>
                    </div>
                    <span className="tag green">token</span>
                  </div>
                  <div className="tag-row">
                    <span className={pack.allowDownload ? "tag warn" : "tag"}>{pack.allowDownload ? "可下載" : "不可下載"}</span>
                    <span className={pack.showLyrics ? "tag green" : "tag"}>{pack.showLyrics ? "歌詞" : "隱藏歌詞"}</span>
                    <span className={pack.showCredits ? "tag green" : "tag"}>{pack.showCredits ? "Credits" : "隱藏 Credits"}</span>
                    <span className={pack.showContact ? "tag green" : "tag"}>{pack.showContact ? "聯絡資訊" : "隱藏聯絡"}</span>
                  </div>
                  <div className="tag-row">
                    <Link className="button" href={`/share/${pack.token}`}>
                      開啟
                    </Link>
                    <button className="button" onClick={() => copyShareLink(pack.token)}>
                      <Copy size={15} />
                      複製
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
