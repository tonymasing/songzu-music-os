"use client";

import { Inbox, Music2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { requestJson } from "@/lib/client-request";

type InspirationDto = {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  status: string;
  aiCategory: string | null;
  moods: string[];
  suggestedTitle: string | null;
  createdAt: string;
  linkedSong: { id: string; title: string } | null;
};

export function InboxWorkspace({ initialItems }: { initialItems: InspirationDto[] }) {
  const [items, setItems] = useState(initialItems);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function addInspiration() {
    if (!content.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const created = await requestJson<InspirationDto>("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, sourceType: "text" })
      });
      setItems((current) => [created, ...current]);
      setContent("");
      setMessage("靈感已加入收件箱。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入靈感失敗");
    } finally {
      setSaving(false);
    }
  }

  async function promote(id: string) {
    setPromotingId(id);
    setMessage("");
    try {
      const song = await requestJson<{ id: string; title: string }>(`/api/inbox/${id}/promote`, { method: "POST" });
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "PROMOTED", linkedSong: { id: song.id, title: song.title } } : item
        )
      );
      setMessage(`已建立作品「${song.title}」。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "轉成作品失敗");
    } finally {
      setPromotingId(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="stack">
          <span className="eyebrow">靈感收件箱</span>
          <h1>先收下靈感，再讓 AI 幫你分類。</h1>
          <p className="subtle">歌詞片段、編曲念頭、混音備註、短影音點子，都先丟進來。</p>
        </div>
      </header>

      <section className="split-layout section">
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>新增靈感</h2>
              <p className="muted">貼一句旋律想法、歌詞、voice memo 描述或宣傳點子。</p>
            </div>
            <Inbox size={18} color="var(--accent)" />
          </div>
          <textarea
            className="textarea"
            placeholder="例如：副歌想要有一種清晨禱告、城市慢慢亮起來的感覺..."
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <button className="button primary" onClick={addInspiration} disabled={saving || !content.trim()}>
            <Plus size={16} />
            {saving ? "整理中" : "加入收件箱"}
          </button>
          {message ? <p className="action-message" role="status">{message}</p> : null}
        </div>

        <aside className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>AI 分類規則</h2>
              <p className="muted">離線時用本機規則；需要推理時只交給這台 Mac 已登入的 Codex。</p>
            </div>
            <Sparkles size={18} color="var(--accent)" />
          </div>
          <div className="tag-row">
            <span className="tag">新歌靈感</span>
            <span className="tag">歌詞片段</span>
            <span className="tag">編曲想法</span>
            <span className="tag">混音備註</span>
            <span className="tag">宣傳素材</span>
          </div>
        </aside>
      </section>

      <section className="section stack">
        <div className="toolbar">
          <div>
            <h2>收件列表</h2>
            <p className="muted">可直接把靈感升級成作品卡。</p>
          </div>
        </div>
        <div className="grid-3">
          {items.map((item) => (
            <article className="panel pad stack" key={item.id}>
              <div className="toolbar">
                <span className={item.status === "PROMOTED" ? "tag green" : "tag warn"}>
                  {item.status === "PROMOTED" ? "已成作品" : "待整理"}
                </span>
                <span className="tag">{item.aiCategory ?? "未分類"}</span>
              </div>
              <div className="stack">
                <h2>{item.title}</h2>
                <p className="muted">{item.content}</p>
              </div>
              <div className="tag-row">
                {item.moods.map((mood) => (
                  <span className="tag green" key={mood}>
                    {mood}
                  </span>
                ))}
              </div>
              {item.linkedSong ? (
                <Link className="button" href={`/songs/${item.linkedSong.id}`}>
                  <Music2 size={16} />
                  開啟作品
                </Link>
              ) : (
                <button className="button primary" onClick={() => promote(item.id)} disabled={promotingId === item.id}>
                  <Music2 size={16} />
                  {promotingId === item.id ? "建立中" : "轉成作品卡"}
                </button>
              )}
            </article>
          ))}
          {!items.length && <div className="empty">還沒有靈感，先丟一段文字進來。</div>}
        </div>
      </section>
    </>
  );
}
