import Link from "next/link";

export default function SoundsPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">音色資料庫</span>
        <h1>音色工作區暫時收起</h1>
        <p className="muted">這次只停用舊介面，不刪除已保存的音色資料或音檔。</p>
      </div>
      <Link className="button primary" href="/music-db">前往音樂資料庫</Link>
    </section>
  );
}
