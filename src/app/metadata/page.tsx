import Link from "next/link";

export default function MetadataPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">發行資料</span>
        <h1>發行資料介面暫停整理</h1>
        <p className="muted">已收集的歌曲資料保留；這次只收起舊操作頁，沒有刪除作品或發行資訊。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
