"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  async function repairAndReload() {
    try {
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update()));
      }
    } catch {
      window.location.reload();
      return;
    }
    window.location.reload();
  }

  return (
    <section className="state-page" role="alert">
      <AlertTriangle size={28} />
      <span className="eyebrow">工作台發生錯誤</span>
      <h1>這個區塊暫時沒有載入成功。</h1>
      <p className="subtle">資料不會因此被刪除或覆蓋。可以重新載入，若持續發生再到系統健康頁檢查。</p>
      <button className="button primary" type="button" onClick={repairAndReload}>
        <RefreshCw size={16} />
        修復並重新載入
      </button>
    </section>
  );
}
