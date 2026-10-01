"use client";

import { CheckCircle2, Clock3, Headphones, Music2, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { PublicSongPreviewDto } from "@/lib/storefront-public";

type Props = { preview: PublicSongPreviewDto };

type ClaimResult = {
  orderCode: string;
  status: string;
  amount: number;
  currency: string;
  reservationExpiresAt: string | null;
  paymentInstructions: string;
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function PublicClaimWorkspace({ preview }: Props) {
  const [selectedOfferId, setSelectedOfferId] = useState(preview.offers.find((offer) => offer.remaining > 0)?.id || "");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const playedRef = useRef(false);
  const selectedOffer = useMemo(
    () => preview.offers.find((offer) => offer.id === selectedOfferId) || null,
    [preview.offers, selectedOfferId]
  );

  async function recordPlay() {
    if (playedRef.current) return;
    playedRef.current = true;
    try {
      await fetch(`/api/listen/${preview.token}/play`, { method: "POST" });
    } catch {
      // Playback remains available when analytics cannot be recorded.
    }
  }

  async function submitClaim(formData: FormData) {
    if (!selectedOffer) return;
    setBusy(true);
    setNotice("");
    setResult(null);
    try {
      const response = await requestJson<ClaimResult>(`/api/listen/${preview.token}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: selectedOffer.id,
          customerName: String(formData.get("customerName") || ""),
          contactChannel: String(formData.get("contactChannel") || "email"),
          contactValue: String(formData.get("contactValue") || ""),
          message: String(formData.get("message") || ""),
          termsAccepted: formData.get("termsAccepted") === "on",
          website: String(formData.get("website") || "")
        })
      });
      setResult(response);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "認領單送出失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="public-listen-page">
      <header className="public-listen-nav">
        <Link href="/listen" className="public-listen-brand">
          <span><Music2 size={18} /></span>
          <strong>頌祖音樂</strong>
        </Link>
        <Link href="/listen" className="button ghost">全部試聽</Link>
      </header>

      <section className="public-listen-hero">
        <div className="public-cover-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.coverReady ? `/api/listen/${preview.token}/cover` : "/icon.svg"}
            alt={preview.coverReady ? `${preview.title} 封面` : "頌祖音樂"}
          />
        </div>
        <div className="public-listen-copy">
          <span className="eyebrow">30 秒作品試聽</span>
          <h1>{preview.title}</h1>
          {preview.description && <p>{preview.description}</p>}
          <div className="tag-row">
            {preview.genre && <span className="tag green">{preview.genre}</span>}
            {preview.mood.slice(0, 3).map((mood) => <span className="tag" key={mood}>{mood}</span>)}
          </div>
          <div className="public-player-wrap">
            <div className="public-player-label"><Headphones size={17} /> 限時 30 秒試聽</div>
            <audio controls preload="metadata" onPlay={recordPlay} src={`/api/listen/${preview.token}/preview`} />
          </div>
          {preview.releaseUrl && (
            <a className="button" href={preview.releaseUrl} target="_blank" rel="noreferrer">前往完整發行版本</a>
          )}
        </div>
      </section>

      <section className="public-offer-section" id="claim-options">
        <div className="public-section-heading">
          <span className="eyebrow">作品認領</span>
          <h2>選擇想支持或延伸的創作稿</h2>
          <p>認領單送出後，創作者會先確認用途、署名與授權範圍，再進行付款及交付。</p>
        </div>
        <div className="public-offer-grid">
          {preview.offers.map((offer) => {
            const unavailable = offer.remaining <= 0;
            const selected = offer.id === selectedOfferId;
            return (
              <button
                className={`public-offer-card${selected ? " selected" : ""}`}
                key={offer.id}
                type="button"
                disabled={unavailable}
                onClick={() => setSelectedOfferId(offer.id)}
              >
                <span className="public-offer-topline">
                  <strong>{offer.title}</strong>
                  <b>{formatMoney(offer.price, offer.currency)}</b>
                </span>
                <span>{offer.description}</span>
                <small><Clock3 size={14} /> {offer.deliveryDays ? `預計 ${offer.deliveryDays} 天內確認` : "交付時間另行確認"}</small>
                <small>{unavailable ? "目前已被認領" : `剩餘 ${offer.remaining} 個名額`}</small>
              </button>
            );
          })}
        </div>
      </section>

      {selectedOffer && !result && (
        <section className="public-claim-form-section">
          <div className="public-claim-summary">
            <span className="eyebrow">目前選擇</span>
            <h2>{selectedOffer.title}</h2>
            <strong className="public-price">{formatMoney(selectedOffer.price, selectedOffer.currency)}</strong>
            <p>{selectedOffer.rightsSummary}</p>
            <div className="public-trust-row"><ShieldCheck size={18} /> 送出認領單不會立即扣款，也不會自動移轉任何權利。</div>
          </div>
          <form action={submitClaim} className="public-claim-form">
            <label>稱呼<input name="customerName" required maxLength={80} autoComplete="name" /></label>
            <div className="form-grid two">
              <label>聯絡方式
                <select name="contactChannel" defaultValue="email">
                  <option value="email">Email</option>
                  <option value="line">LINE</option>
                  <option value="instagram">Instagram</option>
                  <option value="phone">電話</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label>聯絡帳號或地址<input name="contactValue" required minLength={3} maxLength={160} /></label>
            </div>
            <label>想怎麼使用這份創作稿<textarea name="message" rows={4} maxLength={1000} /></label>
            <label className="sr-only" aria-hidden="true">網站<input name="website" tabIndex={-1} autoComplete="off" /></label>
            <label className="check-row public-terms">
              <input type="checkbox" name="termsAccepted" required />
              <span>我了解價格、授權、是否獨家與署名方式，需由雙方確認後才成立。</span>
            </label>
            {notice && <p className="form-error" role="alert">{notice}</p>}
            <button className="button primary" type="submit" disabled={busy}>
              <Send size={17} /> {busy ? "送出中" : "送出認領單"}
            </button>
          </form>
        </section>
      )}

      {result && (
        <section className="public-claim-success" aria-live="polite">
          <CheckCircle2 size={32} />
          <div>
            <span className="eyebrow">認領單已建立</span>
            <h2>{result.orderCode}</h2>
            <p>{result.paymentInstructions}</p>
            <small>請保留認領編號。保留期限：{result.reservationExpiresAt ? new Date(result.reservationExpiresAt).toLocaleString("zh-TW") : "由創作者確認"}</small>
          </div>
        </section>
      )}

      <footer className="public-listen-footer">
        <strong>頌祖音樂</strong>
        <span>{preview.contactInfo || "原創作品試聽與認領"}</span>
      </footer>
    </main>
  );
}
