"use client";

import { BadgeCheck, Globe2, Landmark, Mail, Pencil, Phone, Plus, Save, Trash2, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";

export type ContributorDto = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  ipi: string | null;
  isni: string | null;
  proAffiliation: string | null;
  countryCode: string | null;
  defaultRoles: string | null;
  notes: string | null;
  credits: Array<{
    id: string;
    role: string;
    splitPercentage: number | null;
    ownershipType: string | null;
    confirmations: Array<{ status: string }>;
    song: { id: string; title: string };
  }>;
};

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  ipi: "",
  isni: "",
  proAffiliation: "",
  countryCode: "TW",
  defaultRoles: "",
  notes: ""
};

function rightsReadiness(item: ContributorDto) {
  let score = 0;
  const missing: string[] = [];
  if (item.email || item.phone) score += 25;
  else missing.push("聯絡方式");
  if (item.defaultRoles) score += 25;
  else missing.push("常用角色");
  if (item.countryCode) score += 20;
  else missing.push("國別");
  if (item.ipi || item.isni || item.proAffiliation) score += 30;
  else missing.push("IPI / ISNI / 權利組織");
  return { score, missing, ready: score >= 70 };
}

export function ContributorsWorkspace({ initialContributors }: { initialContributors: ContributorDto[] }) {
  const [contributors, setContributors] = useState(initialContributors);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const stats = useMemo(() => ({
    people: contributors.length,
    credits: contributors.reduce((total, item) => total + item.credits.length, 0),
    rightsReady: contributors.filter((item) => rightsReadiness(item).ready).length,
    pendingConfirmations: contributors.reduce(
      (total, item) => total + item.credits.filter((credit) => !credit.confirmations.some((confirmation) => confirmation.status === "CONFIRMED")).length,
      0
    )
  }), [contributors]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage("");
  }

  function startEdit(item: ContributorDto) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      email: item.email ?? "",
      phone: item.phone ?? "",
      ipi: item.ipi ?? "",
      isni: item.isni ?? "",
      proAffiliation: item.proAffiliation ?? "",
      countryCode: item.countryCode ?? "",
      defaultRoles: item.defaultRoles ?? "",
      notes: item.notes ?? ""
    });
    setMessage(`正在編輯「${item.name}」`);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        ipi: form.ipi.trim() || null,
        isni: form.isni.trim() || null,
        proAffiliation: form.proAffiliation.trim() || null,
        countryCode: form.countryCode.trim().toUpperCase() || null,
        defaultRoles: form.defaultRoles.trim() || null,
        notes: form.notes.trim() || null
      };
      const saved = await requestJson<ContributorDto>(editingId ? `/api/contributors/${editingId}` : "/api/contributors", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setContributors((current) => editingId
        ? current.map((item) => item.id === saved.id ? saved : item).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
        : [...current, saved].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
      );
      setEditingId(saved.id);
      setMessage(`已儲存「${saved.name}」`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存合作人失敗");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: ContributorDto) {
    setMessage("");
    try {
      await requestJson(`/api/contributors/${item.id}`, { method: "DELETE" });
      setContributors((current) => current.filter((candidate) => candidate.id !== item.id));
      if (editingId === item.id) startCreate();
      setMessage(`已移除「${item.name}」`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移除合作人失敗");
    }
  }

  return (
    <>
      <header className="catalog-hero">
        <div className="stack">
          <span className="eyebrow">合作人與權利名錄</span>
          <h1>把角色、聯絡方式與作品名單放在同一處。</h1>
          <p className="subtle">合作人的分潤與權利仍綁在各首作品；這裡管理共用聯絡資料與常用角色。</p>
        </div>
        <div className="catalog-summary">
          <span><strong>{stats.people}</strong>合作人</span>
          <span><strong>{stats.credits}</strong>作品名單</span>
          <span><strong>{stats.rightsReady}</strong>身分資料可用</span>
          <span><strong>{stats.pendingConfirmations}</strong>權利待確認</span>
        </div>
      </header>

      {message ? <p className="action-message" role="status">{message}</p> : null}

      <section className="catalog-layout section">
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>合作人名錄</h2>
              <p className="muted">點選編輯；已有作品名單紀錄的合作人不能直接刪除。</p>
            </div>
            <button className="button" type="button" onClick={startCreate}><Plus size={16} />新增合作人</button>
          </div>
          <div className="small-list">
            {contributors.map((item) => {
              const readiness = rightsReadiness(item);
              const pendingCredits = item.credits.filter((credit) => !credit.confirmations.some((confirmation) => confirmation.status === "CONFIRMED")).length;
              return (
              <article className="contributor-row" key={item.id}>
                <span className="contributor-avatar"><UserRound size={18} /></span>
                <span className="contributor-main">
                  <strong>{item.name}</strong>
                  <small>{item.defaultRoles || "未設定常用角色"}</small>
                  <span className="tag-row">
                    {item.email ? <span className="tag"><Mail size={12} />{item.email}</span> : null}
                    {item.phone ? <span className="tag"><Phone size={12} />{item.phone}</span> : null}
                    {item.proAffiliation ? <span className="tag"><Landmark size={12} />{item.proAffiliation}</span> : null}
                    {item.countryCode ? <span className="tag"><Globe2 size={12} />{item.countryCode}</span> : null}
                    <span className={readiness.ready ? "tag green" : "tag warn"}><BadgeCheck size={12} />權利資料 {readiness.score}%</span>
                  </span>
                  {!readiness.ready ? <small>待補：{readiness.missing.join("、")}</small> : null}
                </span>
                <span className="contributor-credits">
                  {item.credits.slice(0, 3).map((credit) => (
                    <Link className="tag" href={`/songs/${credit.song.id}`} key={credit.id}>
                      {credit.song.title} · {credit.role}{credit.splitPercentage != null ? ` ${credit.splitPercentage}%` : ""}
                    </Link>
                  ))}
                  {!item.credits.length ? <small>尚未綁定作品</small> : null}
                  {pendingCredits ? <span className="tag warn">{pendingCredits} 筆待確認</span> : null}
                </span>
                <span className="contributor-actions">
                  <button className="icon-button" type="button" aria-label={`編輯 ${item.name}`} onClick={() => startEdit(item)}><Pencil size={15} /></button>
                  <button className="icon-button danger" type="button" aria-label={`移除 ${item.name}`} onClick={() => remove(item)} disabled={item.credits.length > 0}><Trash2 size={15} /></button>
                </span>
              </article>
              );
            })}
            {!contributors.length ? <div className="empty"><Users size={18} />尚未建立合作人。</div> : null}
          </div>
        </div>

        <aside className="panel pad stack">
          <div>
            <h2>{editingId ? "編輯合作人" : "新增合作人"}</h2>
            <p className="muted">分潤比例請回到歌曲工作台設定，避免跨歌曲誤改。</p>
          </div>
          <div className="field"><label>姓名 / 名稱</label><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          <div className="field"><label>常用角色</label><input className="input" value={form.defaultRoles} onChange={(event) => setForm({ ...form, defaultRoles: event.target.value })} placeholder="作詞、作曲、演唱、混音" /></div>
          <div className="field-row">
            <div className="field"><label>Email</label><input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
            <div className="field"><label>電話</label><input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>IPI</label><input className="input" value={form.ipi} onChange={(event) => setForm({ ...form, ipi: event.target.value })} placeholder="詞曲作者識別碼，可稍後補" /></div>
            <div className="field"><label>ISNI</label><input className="input" value={form.isni} onChange={(event) => setForm({ ...form, isni: event.target.value })} placeholder="公開身分識別碼，可稍後補" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>權利組織 / PRO</label><input className="input" value={form.proAffiliation} onChange={(event) => setForm({ ...form, proAffiliation: event.target.value })} placeholder="例：MUST、ASCAP、BMI" /></div>
            <div className="field"><label>國別</label><input className="input" value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value.toUpperCase() })} placeholder="TW" maxLength={8} /></div>
          </div>
          <p className="muted">IPI、ISNI 與權利組織可在正式註冊後補上；缺少時只提醒，不會阻擋創作。</p>
          <div className="field"><label>備註</label><textarea className="textarea compact-textarea" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
          <button className="button primary" type="button" onClick={save} disabled={saving || !form.name.trim()}><Save size={16} />{saving ? "儲存中" : "儲存合作人"}</button>
        </aside>
      </section>
    </>
  );
}
