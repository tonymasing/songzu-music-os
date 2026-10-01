import Link from "next/link";

export default function ReleasesPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">發行專案</span>
        <h1>發行工作區暫時收起</h1>
        <p className="muted">既有發行清單和歌曲關聯保留，舊操作畫面暫時停用。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
