"use client";

import { CheckCircle2, Copy, Download, MonitorSmartphone, ShieldAlert, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function InstallAppPanel() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [locationInfo, setLocationInfo] = useState({
    origin: "",
    secure: false,
    host: ""
  });

  useEffect(() => {
    setIsStandalone(isStandaloneMode());
    setLocationInfo({
      origin: window.location.origin,
      secure: window.isSecureContext,
      host: window.location.hostname
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(() => setServiceWorkerReady(true)).catch(() => setServiceWorkerReady(false));
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", () => setIsStandalone(true));
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const installStatus = useMemo(() => {
    if (isStandalone) return { label: "已用 App 模式開啟", className: "tag green" };
    if (installPrompt) return { label: "可安裝", className: "tag green" };
    if (!locationInfo.secure && locationInfo.host !== "localhost" && locationInfo.host !== "127.0.0.1") {
      return { label: "LAN 需 HTTPS 才能正式安裝", className: "tag warn" };
    }
    return { label: "可加入主畫面", className: "tag warn" };
  }, [installPrompt, isStandalone, locationInfo]);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setIsStandalone(isStandaloneMode());
  }

  async function copyCurrentUrl() {
    if (!locationInfo.origin) return;
    await navigator.clipboard?.writeText(locationInfo.origin);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="install-app-panel">
      <div className="toolbar">
        <div>
          <h2>安裝成 App</h2>
          <p className="muted">先把目前的本機工作台變成手機、平板、電腦都能開的安裝版。</p>
        </div>
        <span className={installStatus.className}>{installStatus.label}</span>
      </div>

      <div className="install-status-grid">
        <span>
          <MonitorSmartphone size={18} />
          <strong>{isStandalone ? "Standalone" : "Browser"}</strong>
          顯示模式
        </span>
        <span>
          <Wifi size={18} />
          <strong>{locationInfo.origin || "讀取中"}</strong>
          目前入口
        </span>
        <span>
          <CheckCircle2 size={18} />
          <strong>{serviceWorkerReady ? "已啟用" : "待啟用"}</strong>
          離線殼層
        </span>
      </div>

      <div className="tag-row">
        <button className="button primary" onClick={installApp} disabled={!installPrompt || isStandalone}>
          <Download size={16} />
          {isStandalone ? "已安裝" : installPrompt ? "安裝 App" : "用瀏覽器選單加入主畫面"}
        </button>
        <button className="button" onClick={copyCurrentUrl}>
          <Copy size={16} />
          {copied ? "已複製" : "複製目前入口"}
        </button>
      </div>

      {!locationInfo.secure && locationInfo.host !== "localhost" && locationInfo.host !== "127.0.0.1" && (
        <div className="system-note compact">
          <ShieldAlert size={18} color="var(--warn)" />
          <span>手機用區網 IP 開啟可以整理與播放；麥克風錄音、正式 PWA 安裝和離線功能需要 HTTPS。請使用本機 HTTPS 入口或桌面 App。</span>
        </div>
      )}
    </div>
  );
}
