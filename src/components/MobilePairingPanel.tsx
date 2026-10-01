"use client";

import { CheckCircle2, Copy, KeyRound, RefreshCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Device = {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

type PairingStatus = {
  pairingRequired: boolean;
  pairingCodeActive: boolean;
  pairingCodeExpiresAt: string | null;
  activeDevices: Device[];
  revokedDevices: Device[];
};

type PairingCode = {
  code: string;
  expiresAt: string;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value)
  );
}

function platformLabel(value: string) {
  if (value.includes("ios")) return "iPhone / iPad";
  if (value.includes("android")) return "Android";
  return "行動裝置";
}

export function MobilePairingPanel() {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  async function loadStatus() {
    const response = await fetch("/api/mobile/pairing", { cache: "no-store" });
    const body = (await response.json()) as PairingStatus | { error?: string };
    if (!response.ok || !("activeDevices" in body)) throw new Error("error" in body ? body.error : "無法讀取可信裝置。");
    setStatus(body);
  }

  useEffect(() => {
    void loadStatus().catch((error) => setMessage(error instanceof Error ? error.message : "無法讀取可信裝置。"));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!pairing) return 0;
    return Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - now) / 1000));
  }, [now, pairing]);

  async function createCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/mobile/pairing", { method: "POST" });
      const body = (await response.json()) as PairingCode | { error?: string };
      if (!response.ok || !("code" in body)) throw new Error("error" in body ? body.error : "無法產生配對碼。");
      setPairing(body);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法產生配對碼。");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    await navigator.clipboard?.writeText(pairing.code);
    setMessage("配對碼已複製。");
    window.setTimeout(() => setMessage(""), 1600);
  }

  async function revoke(device: Device) {
    if (!window.confirm(`撤銷「${device.name}」？這台裝置必須重新配對才能讀取作品或同步錄音。`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/mobile/pairing", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id })
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "無法撤銷裝置。");
      await loadStatus();
      setMessage(`${device.name} 已撤銷。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法撤銷裝置。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="install-app-panel mobile-pairing-panel" id="mobile-pairing">
      <div className="toolbar">
        <div>
          <span className="eyebrow">可信裝置</span>
          <h2>手機與主機安全配對</h2>
          <p className="muted">同 Wi-Fi 與頌祖 Connect 共用這份授權；只有完成配對的裝置才能讀取作品與同步原始 WAV。</p>
        </div>
        <span className="tag green"><ShieldCheck size={14} />主機防護已啟用</span>
      </div>

      <div className="pairing-layout">
        <section className="pairing-code-panel">
          <div className="pairing-code-heading">
            <span><KeyRound size={18} />短效配對碼</span>
            <button className="button primary" type="button" disabled={busy} onClick={() => void createCode()}>
              <RefreshCw size={16} />
              {pairing ? "換一組" : "產生配對碼"}
            </button>
          </div>

          {pairing && remainingSeconds > 0 ? (
            <button className="pairing-code" type="button" onClick={() => void copyCode()} aria-label="複製配對碼">
              <strong>{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</strong>
              <span><Copy size={15} />{remainingSeconds} 秒後失效</span>
            </button>
          ) : (
            <div className="pairing-code empty-code">
              <strong>••• •••</strong>
              <span>{status?.pairingCodeActive ? "已有短效碼，重新產生即可顯示" : "需要時才產生，5 分鐘後自動失效"}</span>
            </div>
          )}

          <ol className="pairing-steps">
            <li><b>1</b><span>手機開啟頌祖音樂網頁或主畫面 App，輸入 Mac 主機位址。</span></li>
            <li><b>2</b><span>把這組 6 位數輸入「首次配對碼」。</span></li>
            <li><b>3</b><span>成功後裝置會保留專屬授權；錄音離線時仍可保存。</span></li>
          </ol>
        </section>

        <section className="trusted-device-panel">
          <div className="pairing-code-heading">
            <span><Smartphone size={18} />已信任裝置</span>
            <b>{status?.activeDevices.length ?? 0} 台</b>
          </div>
          <div className="trusted-device-list">
            {status?.activeDevices.length ? (
              status.activeDevices.map((device) => (
                <article className="trusted-device-row" key={device.id}>
                  <span className="trusted-device-icon"><CheckCircle2 size={18} /></span>
                  <div>
                    <strong>{device.name}</strong>
                    <span>{platformLabel(device.platform)} · 配對於 {formatTime(device.createdAt)}</span>
                  </div>
                  <button className="icon-button danger" type="button" disabled={busy} onClick={() => void revoke(device)} aria-label={`撤銷 ${device.name}`} title="撤銷裝置">
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <p className="empty-state">目前沒有已配對裝置。產生配對碼後，在手機網頁完成第一次連線。</p>
            )}
          </div>
        </section>
      </div>

      {message && <div className="system-note compact" role="status"><ShieldCheck size={17} /><span>{message}</span></div>}
      <p className="pairing-security-note">配對碼最多嘗試 8 次；主機只保存裝置 token 的 SHA-256，不保存可直接登入的原始 token。撤銷後立即失效。</p>
    </div>
  );
}
