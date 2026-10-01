import Link from "next/link";

export default function StorefrontPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">試聽與認領</span>
        <h1>試聽與認領介面暫停整理</h1>
        <p className="muted">既有試聽素材、認領資料和訂單紀錄保留，這次沒有變更對外權限或資料。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
