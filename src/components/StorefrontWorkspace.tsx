"use client";

import {
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Headphones,
  Link2,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  ShoppingBag,
  Users
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { SongDto } from "@/lib/music";
import type { SongPreviewDto } from "@/lib/storefront";

type View = "previews" | "orders" | "offers";
type Props = { songs: SongDto[]; initialPreviews: SongPreviewDto[] };

const previewStatusLabels: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "公開中",
  PAUSED: "已暫停"
};

const claimOrderStatusLabels: Record<string, string> = {
  REQUESTED: "新認領單",
  AWAITING_PAYMENT: "等待付款",
  PAID: "已付款",
  IN_PROGRESS: "製作中",
  DELIVERED: "已交付",
  CANCELLED: "已取消"
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function statusClass(status: string) {
  if (["PUBLISHED", "PAID", "DELIVERED", "ACTIVE"].includes(status)) return "tag green";
  if (["REQUESTED", "AWAITING_PAYMENT", "IN_PROGRESS", "DRAFT"].includes(status)) return "tag warn";
  if (["PAUSED", "CANCELLED", "SOLD_OUT"].includes(status)) return "tag danger";
  return "tag";
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function StorefrontWorkspace({ songs, initialPreviews }: Props) {
  const [activeView, setActiveView] = useState<View>("previews");
  const [previews, setPreviews] = useState(initialPreviews);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [createDraft, setCreateDraft] = useState({
    songId: songs[0]?.id || "",
    startSeconds: "",
    releaseUrl: "",
    contactInfo: "",
    paymentInstructions: "",
    publish: true
  });

  const allOrders = useMemo(
    () =>
      previews.flatMap((preview) =>
        preview.offers.flatMap((offer) =>
          offer.orders.map((order) => ({ ...order, previewTitle: preview.title, offerTitle: offer.title }))
        )
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [previews]
  );
  const totals = useMemo(
    () => ({
      published: previews.filter((preview) => preview.status === "PUBLISHED").length,
      plays: previews.reduce((sum, preview) => sum + preview.playCount, 0),
      pending: allOrders.filter((order) => ["REQUESTED", "AWAITING_PAYMENT"].includes(order.status)).length,
      paid: allOrders.filter((order) => ["PAID", "IN_PROGRESS", "DELIVERED"].includes(order.status)).length
    }),
    [allOrders, previews]
  );

  async function refresh() {
    setPreviews(await requestJson<SongPreviewDto[]>("/api/storefront"));
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusyKey(key);
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失敗。");
    } finally {
      setBusyKey("");
    }
  }

  async function createPreview() {
    await run(
      "create",
      async () => {
        await requestJson("/api/storefront", jsonInit("POST", {
          songId: createDraft.songId,
          releaseUrl: createDraft.releaseUrl,
          contactInfo: createDraft.contactInfo,
          paymentInstructions: createDraft.paymentInstructions,
          ...(createDraft.startSeconds.trim() ? { startSeconds: Number(createDraft.startSeconds) } : {}),
          generate: true,
          publish: createDraft.publish
        }));
      },
      createDraft.publish ? "30 秒試聽檔已產生並公開。" : "30 秒試聽檔已產生為草稿。"
    );
  }

  async function updatePreview(id: string, body: unknown, success: string) {
    await run(`preview-${id}`, async () => {
      await requestJson(`/api/storefront/${id}`, jsonInit("PATCH", body));
    }, success);
  }

  async function regenerate(preview: SongPreviewDto, formData?: FormData) {
    const startRaw = String(formData?.get("startSeconds") || preview.previewStartSeconds);
    await run(`generate-${preview.id}`, async () => {
      await requestJson(`/api/storefront/${preview.id}/preview`, jsonInit("POST", {
        startSeconds: Number(startRaw),
        publish: preview.status === "PUBLISHED"
      }));
    }, "30 秒試聽檔已重新產生並完成長度驗證。");
  }

  async function updateOrder(id: string, status: string) {
    await run(`order-${id}`, async () => {
      await requestJson(`/api/claim-orders/${id}`, jsonInit("PATCH", { status }));
    }, status === "PAID" ? "付款已確認，收入已自動寫入收益帳本。" : "認領單狀態已更新。");
  }

  async function updateOffer(id: string, formData: FormData) {
    await run(`offer-${id}`, async () => {
      await requestJson(`/api/claim-offers/${id}`, jsonInit("PATCH", {
        title: String(formData.get("title") || ""),
        price: Number(formData.get("price") || 0),
        deliveryDays: Number(formData.get("deliveryDays") || 7),
        maxClaims: Number(formData.get("maxClaims") || 1),
        status: String(formData.get("status") || "ACTIVE"),
        rightsSummary: String(formData.get("rightsSummary") || "")
      }));
    }, "認領方案已更新。");
  }

  async function createCustomOffer(previewId: string, formData: FormData) {
    await run(`custom-${previewId}`, async () => {
      await requestJson(`/api/storefront/${previewId}/offers`, jsonInit("POST", {
        offerType: "CUSTOM",
        title: String(formData.get("title") || ""),
        description: String(formData.get("description") || ""),
        price: Number(formData.get("price") || 0),
        currency: "TWD",
        rightsSummary: String(formData.get("rightsSummary") || ""),
        deliveryDays: Number(formData.get("deliveryDays") || 7),
        maxClaims: Number(formData.get("maxClaims") || 1)
      }));
    }, "自訂認領方案已新增。");
  }

  async function copyPublicLink(preview: SongPreviewDto) {
    const link = `${window.location.origin}${preview.publicUrl}`;
    await navigator.clipboard.writeText(link);
    setNotice(`已複製公開連結：${link}`);
  }

  return (
    <>
      <header className="page-header storefront-page-header">
        <div className="stack">
          <span className="eyebrow">LISTENING & CLAIMS</span>
          <h1>試聽與認領工作台</h1>
          <p className="subtle">把正式作品轉成受控 30 秒試聽頁，管理認領方案、名額、付款與收入。</p>
        </div>
        <Link className="button" href="/listen" target="_blank"><ExternalLink size={17} /> 查看公開目錄</Link>
      </header>

      <section className="metric-grid storefront-metrics">
        <article className="metric"><span>公開試聽</span><strong>{totals.published}</strong><small>頁面</small></article>
        <article className="metric"><span>累計播放</span><strong>{totals.plays}</strong><small>次</small></article>
        <article className="metric"><span>待處理認領</span><strong>{totals.pending}</strong><small>單</small></article>
        <article className="metric"><span>已付款認領</span><strong>{totals.paid}</strong><small>單</small></article>
      </section>

      <nav className="workspace-tabs" aria-label="試聽與認領分類">
        <button className={activeView === "previews" ? "active" : ""} onClick={() => setActiveView("previews")}><Headphones size={17} /> 試聽頁</button>
        <button className={activeView === "orders" ? "active" : ""} onClick={() => setActiveView("orders")}><ShoppingBag size={17} /> 認領訂單</button>
        <button className={activeView === "offers" ? "active" : ""} onClick={() => setActiveView("offers")}><BadgeDollarSign size={17} /> 方案設定</button>
      </nav>

      {notice && <div className="notice-bar" role="status">{notice}</div>}

      {activeView === "previews" && (
        <section className="storefront-layout section">
          <aside className="panel pad stack storefront-create-panel">
            <div><span className="eyebrow">建立流程</span><h2>產生 30 秒試聽頁</h2><p className="muted">優先使用通過 Audio QA 的 master，再依序使用 mix、demo。</p></div>
            <label>歌曲
              <select value={createDraft.songId} onChange={(event) => setCreateDraft({ ...createDraft, songId: event.target.value })}>
                {songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}
              </select>
            </label>
            <label>試聽起點（秒，可留空自動選）<input type="number" min="0" step="0.1" value={createDraft.startSeconds} onChange={(event) => setCreateDraft({ ...createDraft, startSeconds: event.target.value })} placeholder="自動取作品前段重點" /></label>
            <label>完整發行連結<input type="url" value={createDraft.releaseUrl} onChange={(event) => setCreateDraft({ ...createDraft, releaseUrl: event.target.value })} placeholder="YouTube、Spotify 或其他平台" /></label>
            <label>公開聯絡資訊<input value={createDraft.contactInfo} onChange={(event) => setCreateDraft({ ...createDraft, contactInfo: event.target.value })} placeholder="Email、IG 或聯絡方式" /></label>
            <label>認領後付款說明<textarea rows={3} value={createDraft.paymentInstructions} onChange={(event) => setCreateDraft({ ...createDraft, paymentInstructions: event.target.value })} placeholder="留空時由你另行聯絡確認" /></label>
            <label className="check-row"><input type="checkbox" checked={createDraft.publish} onChange={(event) => setCreateDraft({ ...createDraft, publish: event.target.checked })} /><span>產生完成後立即公開</span></label>
            <button className="button primary" type="button" onClick={createPreview} disabled={!createDraft.songId || busyKey === "create"}>
              {busyKey === "create" ? <Loader2 className="spin" size={17} /> : <PlayCircle size={17} />} 產生並驗證試聽檔
            </button>
          </aside>

          <div className="stack storefront-preview-list">
            {previews.length ? previews.map((preview) => (
              <article className="panel pad storefront-preview-card" key={preview.id}>
                <div className="storefront-preview-head">
                  <div><span className={statusClass(preview.status)}>{previewStatusLabels[preview.status] || preview.status}</span><h2>{preview.title}</h2><p>{preview.description || "尚未填寫試聽介紹。"}</p></div>
                  <div className="storefront-preview-actions">
                    <button className="icon-button" type="button" title="複製公開連結" onClick={() => copyPublicLink(preview)}><Copy size={17} /></button>
                    <Link className="icon-button" title="開啟公開頁" href={preview.publicUrl} target="_blank"><ExternalLink size={17} /></Link>
                  </div>
                </div>
                <div className="storefront-preview-statusline">
                  <span><Headphones size={16} /> {preview.previewReady ? `${preview.previewDurationSeconds.toFixed(1)} 秒試聽已完成` : "尚未產生試聽"}</span>
                  <span><Users size={16} /> {preview.playCount} 次播放</span>
                  <span><Link2 size={16} /> {preview.offers.length} 種方案</span>
                </div>
                {preview.status === "PUBLISHED" && preview.previewReady && <audio controls preload="metadata" src={`/api/listen/${preview.token}/preview`} />}
                <form action={(formData) => regenerate(preview, formData)} className="storefront-regenerate-row">
                  <label>起點<input name="startSeconds" type="number" min="0" step="0.1" defaultValue={preview.previewStartSeconds.toFixed(1)} /></label>
                  <button className="button" disabled={busyKey === `generate-${preview.id}`}><RefreshCw size={16} /> 重新產生</button>
                  {preview.status === "PUBLISHED" ? (
                    <button className="button ghost" type="button" onClick={() => updatePreview(preview.id, { status: "PAUSED" }, "試聽頁已暫停公開。") }><PauseCircle size={16} /> 暫停</button>
                  ) : (
                    <button className="button" type="button" disabled={!preview.previewReady} onClick={() => updatePreview(preview.id, { status: "PUBLISHED" }, "試聽頁已公開。") }><PlayCircle size={16} /> 公開</button>
                  )}
                </form>
                <div className="storefront-integrity-row">
                  <ShieldLine ok={preview.previewReady} label="30 秒長度驗證" />
                  <ShieldLine ok={Boolean(preview.previewSha256)} label="試聽檔 SHA-256" />
                  <ShieldLine ok={Boolean(preview.sourceSha256)} label="來源檔雜湊保留" />
                </div>
              </article>
            )) : <div className="panel pad empty-state"><Headphones size={28} /><h2>尚未建立試聽頁</h2><p>選一首至少 30 秒的本機音檔開始。</p></div>}
          </div>
        </section>
      )}

      {activeView === "orders" && (
        <section className="section stack">
          <div className="section-heading"><div><span className="eyebrow">認領流程</span><h2>訂單與付款確認</h2></div><p>確認付款時會自動新增一筆「直接認領」收入紀錄。</p></div>
          {allOrders.length ? allOrders.map((order) => (
            <article className="panel pad claim-order-row" key={order.id}>
              <div><span className={statusClass(order.status)}>{claimOrderStatusLabels[order.status] || order.status}</span><h3>{order.previewTitle} · {order.offerTitle}</h3><p>{order.orderCode} · {order.customerName} · {order.contactChannel}: {order.contactValue}</p>{order.message && <blockquote>{order.message}</blockquote>}</div>
              <div className="claim-order-side"><strong>{formatMoney(order.amountSnapshot, order.currency)}</strong><small>{new Date(order.createdAt).toLocaleString("zh-TW")}</small><select value={order.status} onChange={(event) => updateOrder(order.id, event.target.value)} disabled={busyKey === `order-${order.id}`}>
                {Object.entries(claimOrderStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select></div>
            </article>
          )) : <div className="panel pad empty-state"><ShoppingBag size={28} /><h2>還沒有認領單</h2><p>公開試聽頁收到認領後會出現在這裡。</p></div>}
        </section>
      )}

      {activeView === "offers" && (
        <section className="section stack">
          <div className="section-heading"><div><span className="eyebrow">價格與權利</span><h2>認領方案設定</h2></div><p>預設含歌詞 200、曲子 300、詞曲組合 450，也能新增自己的方案。</p></div>
          {previews.map((preview) => (
            <article className="panel pad stack storefront-offer-group" key={preview.id}>
              <div className="toolbar"><div><h2>{preview.title}</h2><p className="muted">{preview.offers.length} 種方案</p></div><span className={statusClass(preview.status)}>{previewStatusLabels[preview.status]}</span></div>
              <div className="storefront-offer-table">
                {preview.offers.map((offer) => (
                  <form action={(formData) => updateOffer(offer.id, formData)} className="storefront-offer-editor" key={offer.id}>
                    <label>方案<input name="title" defaultValue={offer.title} /></label>
                    <label>價格<input name="price" type="number" min="0" defaultValue={offer.price} /></label>
                    <label>交付天數<input name="deliveryDays" type="number" min="1" defaultValue={offer.deliveryDays || 7} /></label>
                    <label>名額<input name="maxClaims" type="number" min="1" defaultValue={offer.maxClaims} /></label>
                    <label>狀態<select name="status" defaultValue={offer.status}><option value="ACTIVE">開放</option><option value="PAUSED">暫停</option><option value="SOLD_OUT">額滿</option></select></label>
                    <label className="offer-rights-field">授權說明<textarea name="rightsSummary" rows={2} defaultValue={offer.rightsSummary} /></label>
                    <button className="icon-button" title="儲存方案" disabled={busyKey === `offer-${offer.id}`}><Save size={17} /></button>
                  </form>
                ))}
              </div>
              <details className="storefront-custom-offer">
                <summary><Plus size={16} /> 新增自訂方案</summary>
                <form action={(formData) => createCustomOffer(preview.id, formData)} className="form-grid two">
                  <label>方案名稱<input name="title" required placeholder="例如：作品支持席" /></label>
                  <label>價格<input name="price" required type="number" min="0" defaultValue="100" /></label>
                  <label>說明<input name="description" placeholder="交付內容或支持方式" /></label>
                  <label>交付天數<input name="deliveryDays" type="number" min="1" defaultValue="7" /></label>
                  <label>名額<input name="maxClaims" type="number" min="1" defaultValue="10" /></label>
                  <label>權利與使用範圍<textarea name="rightsSummary" required rows={3} defaultValue="此方案為作品支持，不包含著作權或商用授權；如需使用作品，須另行確認。" /></label>
                  <button className="button" disabled={busyKey === `custom-${preview.id}`}><Plus size={16} /> 新增方案</button>
                </form>
              </details>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ShieldLine({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "storefront-check ok" : "storefront-check"}>{ok ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{label}</span>;
}
