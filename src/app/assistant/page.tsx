import Link from "next/link";

export default function AssistantPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">AI 製作助理</span>
        <h1>助理介面暫時收起</h1>
        <p className="muted">目前先不啟用這個工作區；作品與相關資料都保留，之後再依正式助理流程重做。</p>
      </div>
      <Link className="button primary" href="/music-db">前往音樂資料庫</Link>
    </section>
  );
}
