import Link from "next/link";

export default function PitchPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">私密分享包</span>
        <h1>分享包介面暫時收起</h1>
        <p className="muted">已建立的分享包與作品關聯保留；不會在這次整理中刪除或重新發布。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
