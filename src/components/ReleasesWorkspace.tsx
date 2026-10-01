"use client";

import { CheckCircle2, ListPlus, Megaphone, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { requestJson } from "@/lib/client-request";
import { releaseStatusLabels } from "@/lib/music";
import type { ReleaseDto } from "@/lib/releases";

const categoryLabels: Record<string, string> = {
  metadata: "資料",
  rights: "版權",
  asset: "素材",
  copy: "文案",
  marketing: "宣傳"
};

function qualityStatusLabel(status: string) {
  if (status === "pass") return "母帶音質通過";
  if (status === "warning") return "母帶音質警告";
  if (status === "fail") return "母帶音質未通過";
  if (status === "missing") return "缺母帶";
  return "母帶音質待分析";
}

function qualityTagClass(status: string) {
  if (status === "pass") return "tag green";
  if (status === "fail" || status === "missing") return "tag danger";
  if (status === "warning") return "tag warn";
  return "tag";
}

export function ReleasesWorkspace({
  initialReleases,
  songs
}: {
  initialReleases: ReleaseDto[];
  songs: Array<{ id: string; title: string; status: string }>;
}) {
  const [releases, setReleases] = useState(initialReleases);
  const [newItemByRelease, setNewItemByRelease] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(initialReleases.length === 0);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    releaseType: "SINGLE",
    releaseDate: "",
    songIds: songs[0]?.id ? [songs[0].id] : [] as string[]
  });
  const totalTracks = releases.reduce((sum, release) => sum + release.tracks.length, 0);
  const totalChecklist = releases.reduce((sum, release) => sum + release.checklistItems.length, 0);
  const doneChecklist = releases.reduce(
    (sum, release) => sum + release.checklistItems.filter((item) => item.status === "DONE").length,
    0
  );
  const masterBlockers = releases.reduce(
    (sum, release) => sum + release.tracks.filter((track) => track.song.masterQualityStatus !== "pass").length,
    0
  );
  const portfolioReadiness = releases.length
    ? Math.round(releases.reduce((sum, release) => sum + release.readiness.score, 0) / releases.length)
    : 0;

  async function toggleItem(releaseId: string, itemId: string, status: string) {
    const nextStatus = status === "DONE" ? "TODO" : "DONE";
    setMessage("");
    try {
      await requestJson(`/api/release-checklist/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      setReleases((current) =>
        current.map((release) =>
          release.id === releaseId
            ? { ...release, checklistItems: release.checklistItems.map((item) => item.id === itemId ? { ...item, status: nextStatus } : item) }
            : release
        )
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新發行清單失敗");
    }
  }

  async function addChecklistItem(releaseId: string) {
    const title = newItemByRelease[releaseId]?.trim();
    if (!title) return;
    setMessage("");
    try {
      const item = await requestJson<ReleaseDto["checklistItems"][number]>(`/api/releases/${releaseId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category: "自訂" })
      });
      setReleases((current) => current.map((release) => release.id === releaseId ? { ...release, checklistItems: [...release.checklistItems, item] } : release));
      setNewItemByRelease((current) => ({ ...current, [releaseId]: "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新增發行事項失敗");
    }
  }

  function toggleSong(songId: string) {
    setCreateForm((current) => ({
      ...current,
      songIds: current.songIds.includes(songId)
        ? current.songIds.filter((id) => id !== songId)
        : [...current.songIds, songId]
    }));
  }

  async function createRelease() {
    if (!createForm.title.trim() || !createForm.songIds.length) return;
    setCreating(true);
    setMessage("");
    try {
      const created = await requestJson<ReleaseDto>("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createForm.title.trim(),
          releaseType: createForm.releaseType,
          releaseDate: createForm.releaseDate || null,
          songIds: createForm.songIds
        })
      });
      setReleases((current) => [created, ...current]);
      setCreateForm({ title: "", releaseType: "SINGLE", releaseDate: "", songIds: [] });
      setShowCreate(false);
      setMessage(`已建立發行專案「${created.title}」。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立發行專案失敗");
    } finally {
      setCreating(false);
    }
  }

  async function updateReleaseStatus(releaseId: string, status: string) {
    setMessage("");
    try {
      const updated = await requestJson<ReleaseDto>(`/api/releases/${releaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      setReleases((current) => current.map((release) => release.id === releaseId ? updated : release));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新發行狀態失敗");
    }
  }

  return (
    <>
      <header className="dashboard-hero">
        <div className="stack">
          <span className="eyebrow">發行規劃</span>
          <h1>把每次發行變成可交付的正式專案。</h1>
          <p className="subtle">每個發行專案追蹤曲目、ISRC、UPC、封面、文案、權利與母帶音質門檻。</p>
          <div className="dashboard-actions">
            <button className="button primary" type="button" onClick={() => setShowCreate((current) => !current)}>
              {showCreate ? <X size={16} /> : <Plus size={16} />}
              {showCreate ? "收起建立表單" : "新增發行專案"}
            </button>
          </div>
        </div>
        <div className="command-panel">
          <div>
            <span className="muted">發行準備度</span>
            <strong>{portfolioReadiness}%</strong>
          </div>
          <div className="progress">
            <span style={{ width: `${portfolioReadiness}%` }} />
          </div>
          <div className="command-grid">
            <span>{releases.length} 專案</span>
            <span>{totalTracks} 曲目</span>
            <span>{doneChecklist}/{totalChecklist} 清單完成</span>
            <span>{masterBlockers} 母帶阻塞</span>
          </div>
        </div>
      </header>
      {showCreate ? (
        <section className="panel pad stack release-create-panel">
          <div>
            <h2>建立發行專案</h2>
            <p className="muted">選好曲目後會自動建立資料、權利、母帶、文案與宣傳清單。</p>
          </div>
          <div className="field-row three">
            <div className="field"><label>專案名稱</label><input className="input" value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} placeholder="例：清晨敬拜 EP" /></div>
            <div className="field"><label>類型</label><select className="select" value={createForm.releaseType} onChange={(event) => setCreateForm({ ...createForm, releaseType: event.target.value })}><option value="SINGLE">單曲</option><option value="EP">EP</option><option value="ALBUM">專輯</option><option value="COLLECTION">合集</option></select></div>
            <div className="field"><label>預計發行日</label><input className="input" type="date" value={createForm.releaseDate} onChange={(event) => setCreateForm({ ...createForm, releaseDate: event.target.value })} /></div>
          </div>
          <fieldset className="song-selector">
            <legend>選擇曲目</legend>
            <div className="song-selector-grid">
              {songs.map((song) => (
                <label key={song.id}>
                  <input type="checkbox" checked={createForm.songIds.includes(song.id)} onChange={() => toggleSong(song.id)} />
                  <span><strong>{song.title}</strong><small>{song.status}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="button primary" type="button" onClick={createRelease} disabled={creating || !createForm.title.trim() || !createForm.songIds.length}>
            <Plus size={16} />{creating ? "建立中" : `建立專案（${createForm.songIds.length} 首）`}
          </button>
        </section>
      ) : null}
      <section className="section stack">
        {message ? <p className="action-message error" role="alert">{message}</p> : null}
        {releases.map((release) => {
          const qualityDoneCount = release.tracks.filter((track) => track.song.masterQualityStatus === "pass").length;
          const progress = release.readiness.score;
          const automaticBlockers = release.tracks.flatMap((track) =>
            track.song.releaseReadiness.gates
              .filter((gate) => gate.critical && gate.status !== "pass")
              .map((gate) => ({ track, gate }))
          );

          return (
            <div className="panel pad stack release-workbench" key={release.id}>
              <div className="toolbar">
                <div>
                  <h2>{release.title}</h2>
                  <p className="muted">
                    {release.releaseTypeLabel} · {release.statusLabel}
                  </p>
                </div>
                <div className="tag-row">
                  <select className="select compact-select" value={release.status} onChange={(event) => updateReleaseStatus(release.id, event.target.value)} aria-label={`${release.title} 發行狀態`}>
                    {Object.entries(releaseStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <span className="tag green">{release.tracks.length} 首曲目</span>
                  <span className={progress >= 80 ? "tag green" : "tag warn"}>{progress}% 發行準備</span>
                  {release.readiness.blockers.length ? <span className="tag danger">{release.readiness.blockers.length} 個阻塞</span> : <span className="tag green">可送發行</span>}
                </div>
              </div>

              <div className="release-readiness-strip">
                <span>
                  <strong>{release.tracks.length}</strong>
                  曲目
                </span>
                <span>
                  <strong>{qualityDoneCount}</strong>
                  母帶通過
                </span>
                <span>
                  <strong>{release.readiness.trackReadiness}%</strong>
                  自動門檻
                </span>
                <span>
                  <strong>{release.releaseDate ? release.releaseDate.slice(0, 10) : "未定"}</strong>
                  發行日
                </span>
              </div>

              <div className="grid-2">
                <div className="stack">
                  <h3>曲目</h3>
                  {release.tracks.map((track) => (
                    <Link className="list-row" key={track.id} href={`/songs/${track.songId}`}>
                      <span>
                        {track.trackNumber}. {track.displayTitle ?? track.song.title}
                        <br />
                        <span className="muted">{track.song.readiness}% · {track.song.releaseReadiness.label}</span>
                        {track.song.warnings.includes("Master 音質未通過") && (
                          <>
                            <br />
                            <span className="muted">發行阻擋：母帶音質未通過</span>
                          </>
                        )}
                      </span>
                      <span className="tag-row">
                        <span className={qualityTagClass(track.song.masterQualityStatus)}>
                          {qualityStatusLabel(track.song.masterQualityStatus)}
                        </span>
                        <span className="muted">{track.isrc ?? "尚無 ISRC"}</span>
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="stack">
                  <div className="toolbar">
                    <div>
                      <h3>發行 Checklist</h3>
                      <p className="muted">點一下可切換完成狀態。</p>
                    </div>
                    <Megaphone size={18} color="var(--accent)" />
                  </div>
                  <div className="progress">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <div className="small-list">
                    {automaticBlockers.slice(0, 8).map(({ track, gate }) => (
                      <div className="list-row" key={`auto-${track.id}-${gate.id}`}>
                        <span>
                          <strong>{track.displayTitle ?? track.song.title}：{gate.label}</strong>
                          <br />
                          <span className="muted">自動同步 · 必修 · {gate.detail}</span>
                        </span>
                        <span className="tag danger">阻塞</span>
                      </div>
                    ))}
                    {release.checklistItems
                      .slice()
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((item) => (
                        <button className="list-row" key={item.id} onClick={() => toggleItem(release.id, item.id, item.status)}>
                          <span>
                            <strong>{item.title}</strong>
                            <br />
                            <span className="muted">{categoryLabels[item.category] ?? item.category}</span>
                          </span>
                          <span className={item.status === "DONE" ? "tag green" : "tag"}>
                            {item.status === "DONE" ? "完成" : "待辦"}
                          </span>
                        </button>
                      ))}
                  </div>
                  <div className="field-row">
                    <input
                      className="input"
                      placeholder="新增發行事項"
                      value={newItemByRelease[release.id] ?? ""}
                      onChange={(event) => setNewItemByRelease((current) => ({ ...current, [release.id]: event.target.value }))}
                    />
                    <button className="button" onClick={() => addChecklistItem(release.id)}>
                      <ListPlus size={16} />
                      新增事項
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!releases.length && (
          <div className="empty">
            <CheckCircle2 size={18} /> 還沒有發行專案。
          </div>
        )}
      </section>
    </>
  );
}
