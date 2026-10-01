import Link from "next/link";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TheoryPage() {
  const savedRules = await prisma.personalTheoryRule.count();

  return (
    <section className="page-header">
      <div className="stack">
        <span className="eyebrow">樂理資料</span>
        <h1>樂理資料</h1>
        <p className="subtle">已保留 {savedRules} 筆規則。編輯介面暫時關閉。</p>
        <Link className="button" href="/music-db">回到音樂資料庫</Link>
      </div>
    </section>
  );
}
