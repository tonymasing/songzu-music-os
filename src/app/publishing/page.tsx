import Link from "next/link";

export default function PublishingPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">發佈與收益</span>
        <h1>發行操作介面暫時收起</h1>
        <p className="muted">YouTube 連線、收益、發布紀錄與相關資料都保留；本頁不再自動建立預設連線或資料。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
