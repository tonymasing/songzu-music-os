import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <section className="panel pad stack offline-page">
      <span className="eyebrow">Local App</span>
      <div className="offline-icon">
        <WifiOff size={28} />
      </div>
      <h1>目前連不到本機音樂主機。</h1>
      <p className="subtle">請確認電腦上的頌祖音樂 OS 伺服器正在執行，手機/平板與電腦在同一個 Wi‑Fi，然後重新整理。</p>
      <div className="tag-row">
        <Link className="button primary" href="/">
          回工作台
        </Link>
        <Link className="button" href="/local-app">
          查看本機 App 設定
        </Link>
      </div>
    </section>
  );
}
