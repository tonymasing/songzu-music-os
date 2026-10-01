import Link from "next/link";

export default function ContributorsPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">合作人與分潤</span>
        <h1>合作資料介面暫時收起</h1>
        <p className="muted">合作人、權利、確認狀態和分潤資料均保留；本頁暫不提供編輯操作。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
