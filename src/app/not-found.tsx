import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="state-page">
      <SearchX size={28} />
      <span className="eyebrow">找不到頁面</span>
      <h1>這個作品或功能入口不存在。</h1>
      <p className="subtle">它可能已被封存、網址已變更，或資料尚未建立。</p>
      <Link className="button primary" href="/">
        <ArrowLeft size={16} />
        回工作台
      </Link>
    </section>
  );
}
