"use client";

import { CheckCircle2, Cloud, Copy, Globe2, KeyRound, LoaderCircle, Power, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ConnectOverview = {
  configured: boolean;
  enabled: boolean;
  state: "disabled" | "connecting" | "online" | "offline" | "error";
  relayUrl: string;
  localRelay: boolean;
  hostId: string | null;
  fingerprint: string | null;
  connectionUrl: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  quickTunnel: {
    available: boolean;
    installed: boolean;
    requested: boolean;
    state: "disabled" | "starting" | "online" | "error" | "unavailable";
    publicUrl: string | null;
    startedAt: string | null;
    lastError: string | null;
    temporary: boolean;
    changesOnRestart: boolean;
    provider: string;
  };
  security: { cipher: string; relayCanReadContent: boolean; originalFilesProtected: boolean };
};

const stateLabels: Record<ConnectOverview["state"], string> = {
  disabled: "尚未啟用",
  connecting: "正在連線",
  online: "外出連線就緒",
  offline: "等待 Mac 連接器",
  error: "連線需要處理"
};

export function SongzuConnectPanel() {
  const [overview, setOverview] = useState<ConnectOverview | null>(null);
  const [relayUrl, setRelayUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/songzu-connect", { cache: "no-store" });
    const body = (await response.json()) as ConnectOverview | { error?: string };
    if (!response.ok || !("state" in body)) throw new Error("error" in body ? body.error : "無法讀取頌祖 Connect 狀態。");
    setOverview(body);
    setRelayUrl((current) => current || body.relayUrl);
  }, []);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "無法讀取連線狀態。"));
    const timer = window.setInterval(() => void load().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function update(enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/songzu-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, relayUrl })
      });
      const body = (await response.json()) as ConnectOverview | { error?: string };
      if (!response.ok || !("state" in body)) throw new Error("error" in body ? body.error : "無法更新頌祖 Connect。");
      setOverview(body);
      setMessage(enabled ? "連線設定已保存，Mac 連接器正在登入中繼站。" : "外出連線已停用；同 Wi-Fi 直連不受影響。");
      window.setTimeout(() => void load().catch(() => undefined), 1_500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法更新頌祖 Connect。");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!overview?.connectionUrl) return;
    await navigator.clipboard?.writeText(overview.connectionUrl);
    setMessage("外出連線網址已複製。公開金鑰固定在網址片段，不會傳給中繼站。");
  }

  async function toggleQuickTunnel() {
    if (!overview) return;
    setBusy(true);
    setMessage("");
    const enabled = !overview.quickTunnel.requested;
    try {
      const response = await fetch("/api/songzu-connect/quick-tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const body = (await response.json()) as ConnectOverview | { error?: string };
      if (!response.ok || !("state" in body)) throw new Error("error" in body ? body.error : "無法切換臨時外出通路。");
      setOverview(body);
      setMessage(enabled ? "正在建立臨時 HTTPS 網址，通常需要 5 至 20 秒。" : "臨時外出通路正在安全關閉。");
      window.setTimeout(() => void load().catch(() => undefined), 2_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法切換臨時外出通路。");
    } finally {
      setBusy(false);
    }
  }

  const online = overview?.state === "online";

  return (
    <div className="install-app-panel songzu-connect-panel" id="songzu-connect">
      <div className="toolbar">
        <div>
          <span className="eyebrow">頌祖 Connect</span>
          <h2>手機在外面，也能安全連回這台 Mac</h2>
          <p className="muted">Mac 只建立向外連線，不開路由器連接埠；中繼站只看得到短效密文。</p>
        </div>
        <span className={`tag ${online ? "green" : overview?.state === "error" ? "danger" : "warn"}`}>
          {online ? <CheckCircle2 size={14} /> : busy || overview?.state === "connecting" ? <LoaderCircle className="spin" size={14} /> : <Cloud size={14} />}
          {overview ? stateLabels[overview.state] : "讀取中"}
        </span>
      </div>

      <div className="connect-status-grid">
        <span><Cloud size={18} /><strong>{overview?.state === "online" ? "已上線" : "待連線"}</strong>Mac 主機狀態</span>
        <span><KeyRound size={18} /><strong>{overview?.fingerprint || "尚未建立"}</strong>主機金鑰指紋</span>
        <span><ShieldCheck size={18} /><strong>AES-256-GCM</strong>端對端加密</span>
        <span><Smartphone size={18} /><strong>90 天</strong>可信裝置授權</span>
      </div>

      <section className="quick-tunnel-card" aria-labelledby="quick-tunnel-title">
        <div className="quick-tunnel-heading">
          <span className="quick-tunnel-icon"><Globe2 size={20} /></span>
          <span>
            <strong id="quick-tunnel-title">立即外出測試</strong>
            <small>免帳號建立臨時 HTTPS 網址，Mac 不開任何對外連接埠。</small>
          </span>
          <span className={`tag ${overview?.quickTunnel.state === "online" ? "green" : overview?.quickTunnel.state === "error" ? "danger" : "warn"}`}>
            {overview?.quickTunnel.state === "online" ? "已可外出連線" : overview?.quickTunnel.state === "starting" ? "建立中" : overview?.quickTunnel.state === "error" ? "需要處理" : overview?.quickTunnel.state === "unavailable" ? "請重開桌面 App" : "尚未啟動"}
          </span>
        </div>
        <div className="quick-tunnel-actions">
          <span>
            <b>{overview?.quickTunnel.provider || "Cloudflare Quick Tunnel"}</b>
            <small>{overview?.quickTunnel.installed ? "這台 Mac 已具備安全隧道工具" : "這台 Mac 尚未安裝 cloudflared"}</small>
          </span>
          <button
            className={overview?.quickTunnel.requested ? "button danger" : "button primary"}
            type="button"
            onClick={() => void toggleQuickTunnel()}
            disabled={busy || (!overview?.quickTunnel.requested && !overview?.quickTunnel.available)}
          >
            {busy || overview?.quickTunnel.state === "starting" ? <LoaderCircle className="spin" size={16} /> : <Power size={16} />}
            {overview?.quickTunnel.requested ? "停止臨時通路" : "建立臨時網址"}
          </button>
        </div>
        {overview?.quickTunnel.lastError && <p className="quick-tunnel-error">{overview.quickTunnel.lastError}</p>}
        <p className="quick-tunnel-note">臨時網址在 App 重啟後會改變，適合現在外出實測；歌曲內容仍由頌祖 Connect 端對端加密。固定網址請使用下方正式中繼站設定。</p>
      </section>

      <label className="connect-relay-field">
        <span>中繼站 HTTPS 網址</span>
        <div>
          <input value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://connect.example.com" disabled={overview?.quickTunnel.requested} />
          <button className="button" type="button" onClick={() => void load()} disabled={busy} aria-label="重新整理連線狀態"><RefreshCw size={16} /></button>
          <button className={overview?.enabled ? "button danger" : "button primary"} type="button" onClick={() => void update(!overview?.enabled)} disabled={busy || !relayUrl.trim() || overview?.quickTunnel.requested}>
            <Power size={16} />
            {overview?.enabled ? "停用" : "啟用"}
          </button>
        </div>
        <small>{overview?.localRelay ? "目前是本機驗證中繼，只能測試連線核心；部署到公開 HTTPS 後才可在外面使用。" : "公開中繼站只轉送密文，不保存歌曲、配對碼或裝置權杖。"}</small>
      </label>

      {overview?.connectionUrl && (
        <div className="connect-link-row">
          <span><strong>手機連線網址</strong><code>{overview.connectionUrl}</code></span>
          <button className="button" type="button" onClick={() => void copyLink()}><Copy size={16} />複製網址</button>
        </div>
      )}

      {overview?.lastError && <div className="system-note compact danger-note"><Cloud size={18} /><span>{overview.lastError}</span></div>}
      {message && <p className="muted connect-message" role="status">{message}</p>}

      <div className="connect-security-row">
        <span><b>1</b> 手機開啟連線網址</span>
        <span><b>2</b> 輸入 Mac 顯示的 6 位配對碼</span>
        <span><b>3</b> 之後由裝置權杖自動重連</span>
      </div>
    </div>
  );
}
