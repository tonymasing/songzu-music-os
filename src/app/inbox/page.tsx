import Link from "next/link";

export default function InboxPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">靈感收件箱</span>
        <h1>收件介面暫時收起</h1>
        <p className="muted">舊介面已停用；既有靈感紀錄保留，沒有清除資料。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
