import { Headphones, Music2 } from "lucide-react";
import Link from "next/link";

import { listPublicSongPreviews } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function ListenCatalogPage() {
  const previews = await listPublicSongPreviews();
  return (
    <main className="public-listen-page public-catalog-page">
      <header className="public-listen-nav">
        <Link href="/listen" className="public-listen-brand">
          <span><Music2 size={18} /></span>
          <strong>頌祖音樂</strong>
        </Link>
        <span className="public-catalog-count">{previews.length} 首公開試聽</span>
      </header>
      <section className="public-catalog-heading">
        <span className="eyebrow">原創作品目錄</span>
        <h1>先聽 30 秒，再找到你想認領的創作。</h1>
        <p>每首歌只公開受控試聽檔，完整母帶與創作資料仍由創作者保管。</p>
      </section>
      {previews.length ? (
        <section className="public-catalog-grid">
          {previews.map((preview) => (
            <article className="public-catalog-card" key={preview.token}>
              <Link href={`/listen/${preview.token}`} className="public-catalog-cover">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.coverReady ? `/api/listen/${preview.token}/cover` : "/icon.svg"}
                  alt={preview.coverReady ? `${preview.title} 封面` : "頌祖音樂"}
                />
              </Link>
              <div className="public-catalog-card-copy">
                <span className="eyebrow"><Headphones size={14} /> 30 秒試聽</span>
                <h2>{preview.title}</h2>
                <p>{preview.description || "原創歌曲試聽與認領。"}</p>
                <div className="public-catalog-meta">
                  <span>{preview.genre || "原創音樂"}</span>
                  <span>{preview.offers.length} 種認領方案</span>
                </div>
                <Link className="button primary" href={`/listen/${preview.token}`}>試聽與查看方案</Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="public-empty-state">
          <Headphones size={30} />
          <h2>第一首作品正在準備</h2>
          <p>完成發行與 30 秒試聽檔後，作品就會出現在這裡。</p>
        </section>
      )}
      <footer className="public-listen-footer"><strong>頌祖音樂</strong><span>原創作品試聽與認領</span></footer>
    </main>
  );
}
