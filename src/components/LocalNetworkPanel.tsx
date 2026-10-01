"use client";

import { CheckCircle2, Copy, Lock, Router, Terminal, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type LocalNetworkInfo = {
  currentOrigin: string;
  currentProtocol: string;
  port: string;
  secureContextExpected: boolean;
  httpsReady: boolean;
  hasLocalCa: boolean;
  certPath: string | null;
  caPath: string | null;
  lanIps: string[];
  httpUrls: string[];
  httpsUrls: string[];
  localhostUrls: string[];
};

export function LocalNetworkPanel() {
  const [info, setInfo] = useState<LocalNetworkInfo | null>(null);
  const [copied, setCopied] = useState("");
  const isHttpsServer = info?.httpsReady && info.currentProtocol === "https";

  useEffect(() => {
    fetch("/api/local-network")
      .then((response) => response.json())
      .then((data) => setInfo(data as LocalNetworkInfo))
      .catch(() => setInfo(null));
  }, []);

  const recommendedUrls = useMemo(() => {
    if (!info) return [];
    return isHttpsServer ? info.httpsUrls : info.httpUrls;
  }, [info, isHttpsServer]);

  async function copyText(value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(""), 1400);
  }

  return (
    <div className="panel pad stack local-network-panel">
      <div className="toolbar">
        <div>
          <h2>同 Wi-Fi 直接連線</h2>
          <p className="muted">這裡列出目前區網入口；離開同一個網路時，改用上方的頌祖 Connect。</p>
        </div>
        <span className={isHttpsServer ? "tag green" : info?.httpsReady ? "tag" : "tag warn"}>
          {isHttpsServer ? "HTTPS 已啟動" : info?.httpsReady ? "HTTPS 憑證已準備" : "HTTP 僅管理功能"}
        </span>
      </div>

      <div className="install-status-grid">
        <span>
          <Wifi size={18} />
          <strong>{info?.currentOrigin ?? "讀取中"}</strong>
          目前入口
        </span>
        <span>
          <Lock size={18} />
          <strong>{info?.currentProtocol?.toUpperCase() ?? "--"}</strong>
          目前協定
        </span>
        <span>
          <Router size={18} />
          <strong>{info?.lanIps.length ?? 0}</strong>
          區網 IP
        </span>
      </div>

      <div className="local-url-list">
        {recommendedUrls.length ? (
          recommendedUrls.map((url) => (
            <button className="local-url-row" key={url} onClick={() => copyText(url)}>
              <span>
                <strong>{url}</strong>
                <small>{isHttpsServer ? "可用於手機錄音與安裝 PWA" : "可整理、播放與上傳；錄音及安裝請改用 npm run dev:https"}</small>
              </span>
              <span className="tag">{copied === url ? "已複製" : "複製"}</span>
            </button>
          ))
        ) : (
          <div className="empty compact">目前沒有偵測到區網 IP。請確認 Wi‑Fi 或網路介面。</div>
        )}
      </div>

      <div className="local-command-grid">
        <button className="local-command" onClick={() => copyText("npm run dev:https")}>
          <Terminal size={17} />
          <span>
            <strong>npm run dev:https</strong>
            <small>用 HTTPS 啟動，手機 PWA 安裝優先用這個。</small>
          </span>
        </button>
        <button className="local-command" onClick={() => copyText("npm run local:access")}>
          <CheckCircle2 size={17} />
          <span>
            <strong>npm run local:access</strong>
            <small>只查看目前電腦與手機可用網址。</small>
          </span>
        </button>
      </div>

      {info?.caPath && (
        <div className="system-note compact">
          <Lock size={18} color="var(--accent)" />
          <span>已偵測到本機 CA：{info.caPath}。若手機仍顯示不受信任，需要把這個 CA 安裝到手機並手動信任。</span>
        </div>
      )}
    </div>
  );
}
