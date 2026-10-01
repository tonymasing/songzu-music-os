import Link from "next/link";

export default function SongsPage() {
  return (
    <section className="page-header">
      <div>
        <span className="eyebrow">作品庫</span>
        <h1>作品列表介面暫時收起</h1>
        <p className="muted">歌曲、錄音、正式譜和檔案沒有刪除。單曲頁與 DAW 仍可從錄音室或既有連結進入。</p>
      </div>
      <Link className="button primary" href="/daw">前往 DAW 錄音室</Link>
    </section>
  );
}
