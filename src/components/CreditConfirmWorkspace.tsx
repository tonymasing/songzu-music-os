"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

type CreditConfirmationView = {
  token: string;
  status: string;
  confirmedAt: string | null;
  displayName: string | null;
  notes: string | null;
  songTitle: string;
  contributorName: string;
  role: string;
  splitPercentage: number | null;
  ownershipType: string | null;
};

export function CreditConfirmWorkspace({ confirmation }: { confirmation: CreditConfirmationView }) {
  const [status, setStatus] = useState(confirmation.status);
  const [displayName, setDisplayName] = useState(confirmation.displayName ?? confirmation.contributorName);
  const [notes, setNotes] = useState(confirmation.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const response = await fetch(`/api/credit-confirmations/${confirmation.token}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, notes })
    });
    if (!response.ok) {
      setSaving(false);
      throw new Error(await response.text());
    }
    const result = (await response.json()) as { status: string };
    setStatus(result.status);
    setSaving(false);
  }

  return (
    <>
      <header className="page-header">
        <div className="stack">
          <span className="eyebrow">合作人確認</span>
          <h1>{confirmation.songTitle}</h1>
          <p className="subtle">請確認你的角色、分潤與權利類型。這會記錄在本機資料庫的創作證據鏈中。</p>
        </div>
      </header>

      <section className="split-layout section">
        <div className="panel pad stack">
          <h2>確認內容</h2>
          <div className="grid-2">
            <div className="panel pad" style={{ boxShadow: "none" }}>
              <p className="muted">合作人</p>
              <h3>{confirmation.contributorName}</h3>
            </div>
            <div className="panel pad" style={{ boxShadow: "none" }}>
              <p className="muted">角色</p>
              <h3>{confirmation.role}</h3>
            </div>
            <div className="panel pad" style={{ boxShadow: "none" }}>
              <p className="muted">分潤比例</p>
              <h3>{confirmation.splitPercentage ?? 0}%</h3>
            </div>
            <div className="panel pad" style={{ boxShadow: "none" }}>
              <p className="muted">權利類型</p>
              <h3>{confirmation.ownershipType ?? "未填"}</h3>
            </div>
          </div>

          <div className="field">
            <label>顯示名稱</label>
            <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <div className="field">
            <label>備註</label>
            <textarea className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          <button className="button primary" onClick={confirm} disabled={saving || status === "CONFIRMED"}>
            <CheckCircle2 size={16} />
            {status === "CONFIRMED" ? "已確認" : saving ? "確認中" : "確認分潤與角色"}
          </button>
        </div>

        <aside className="panel pad stack">
          <h2>狀態</h2>
          <span className={status === "CONFIRMED" ? "tag green" : "tag warn"}>
            {status === "CONFIRMED" ? "已確認" : "等待確認"}
          </span>
          <p className="muted">第一版不寄 email，只使用這個 token 頁完成確認。</p>
        </aside>
      </section>
    </>
  );
}
