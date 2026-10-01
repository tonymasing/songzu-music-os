"use client";

import { BookOpen, BrainCircuit, CheckCircle2, CircleDashed, Gauge, Pencil, Plus, SlidersHorizontal, Sparkles, Target, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { PersonalTheoryRuleDto } from "@/lib/music-database";
import { buildTheoryProfileSummary, evaluateTheoryRuleReadiness, theoryDomainDefinitions } from "@/lib/theory-profile";

type RuleFormState = {
  title: string;
  ruleType: string;
  scope: string;
  statement: string;
  examples: string;
  avoid: string;
  tags: string;
  priority: string;
  isActive: boolean;
};

const emptyRuleForm: RuleFormState = {
  title: "",
  ruleType: "identity",
  scope: "",
  statement: "",
  examples: "",
  avoid: "",
  tags: "",
  priority: "3",
  isActive: true
};

function splitList(value: string) {
  return value
    .split(/[,\n，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function priorityLabel(priority: number) {
  if (priority <= 1) return "核心";
  if (priority === 2) return "重要";
  if (priority === 3) return "標準";
  return "參考";
}

async function patchRule(id: string, body: Partial<PersonalTheoryRuleDto>) {
  const response = await fetch(`/api/theory-rules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as PersonalTheoryRuleDto;
}

export function TheoryLogicWorkspace({ initialRules }: { initialRules: PersonalTheoryRuleDto[] }) {
  const [rules, setRules] = useState(initialRules);
  const [form, setForm] = useState<RuleFormState>(emptyRuleForm);
  const [type, setType] = useState("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guidingQuestion, setGuidingQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const profile = useMemo(() => buildTheoryProfileSummary(rules), [rules]);
  const stats = useMemo(
    () => ({
      total: rules.length,
      active: rules.filter((rule) => rule.isActive).length,
      core: rules.filter((rule) => rule.priority <= 2 && rule.isActive).length,
      categories: new Set(rules.map((rule) => rule.ruleType)).size,
      aiReady: rules.filter((rule) => rule.aiReady).length
    }),
    [rules]
  );

  const filteredRules = useMemo(() => {
    return rules.filter((rule) => type === "ALL" || rule.ruleType === type);
  }, [rules, type]);

  const activeCoreRules = useMemo(() => rules.filter((rule) => rule.aiReady && rule.priority <= 2).slice(0, 4), [rules]);
  const selectedDomain = theoryDomainDefinitions.find((domain) => domain.value === form.ruleType) ?? theoryDomainDefinitions[0];
  const formReadiness = useMemo(
    () => evaluateTheoryRuleReadiness({
      statement: form.statement,
      scope: form.scope,
      examples: splitList(form.examples),
      avoid: splitList(form.avoid),
      tags: splitList(form.tags),
      priority: Number(form.priority) || 3,
      isActive: form.isActive
    }),
    [form]
  );

  function resetForm() {
    setEditingId(null);
    setGuidingQuestion("");
    setForm(emptyRuleForm);
  }

  function focusDomain(ruleType: string, question = "") {
    setEditingId(null);
    setGuidingQuestion(question);
    setForm({ ...emptyRuleForm, ruleType });
    requestAnimationFrame(() => document.querySelector("#theory-create")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function editRule(rule: PersonalTheoryRuleDto) {
    setEditingId(rule.id);
    setGuidingQuestion("");
    setForm({
      title: rule.title,
      ruleType: rule.ruleType,
      scope: rule.scope ?? "",
      statement: rule.statement,
      examples: rule.examples.join("\n"),
      avoid: rule.avoid.join("\n"),
      tags: rule.tags.join("、"),
      priority: String(rule.priority),
      isActive: rule.isActive
    });
    requestAnimationFrame(() => document.querySelector("#theory-create")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function saveRule() {
    if (!form.title.trim() || !form.statement.trim()) return;
    setSaving(true);
    setActionMessage("");
    try {
      const payload = {
        title: form.title.trim(),
        ruleType: form.ruleType,
        scope: form.scope || null,
        statement: form.statement.trim(),
        examples: splitList(form.examples),
        avoid: splitList(form.avoid),
        tags: splitList(form.tags),
        priority: Number(form.priority) || 3,
        isActive: form.isActive
      };
      if (editingId) {
        const updated = await patchRule(editingId, payload);
        setRules((current) => current.map((rule) => (rule.id === editingId ? updated : rule)));
        setActionMessage(`規則「${updated.title}」已更新。`);
      } else {
        const created = await requestJson<PersonalTheoryRuleDto>("/api/theory-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        setRules((current) => [created, ...current]);
        setActionMessage(`規則「${created.title}」已建立。`);
      }
      resetForm();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "儲存樂理規則失敗");
    } finally {
      setSaving(false);
    }
  }

  async function updateRule(id: string, body: Partial<PersonalTheoryRuleDto>) {
    const updated = await patchRule(id, body);
    setRules((current) => current.map((rule) => (rule.id === id ? updated : rule)));
  }

  return (
    <>
      <header className="dashboard-hero theory-hero">
        <div className="stack">
          <span className="eyebrow">個人音樂邏輯</span>
          <h1>建立專屬你的音樂樂理邏輯。</h1>
          <p className="subtle">
            這裡不是一般教科書，而是你的創作共識：主歌怎麼留白、副歌怎麼打開、人聲怎麼優先、哪些技巧不要過度使用。之後 AI
            生成、混音指令、發行建議都可以引用這套邏輯。
          </p>
          <div className="dashboard-actions">
            <a className="button primary" href="#theory-create">
              <Plus size={16} />
              新增規則
            </a>
            <Link className="button" href="/music-db">
              <Sparkles size={16} />
              回音樂資料庫生成
            </Link>
          </div>
        </div>
        <div className="command-panel">
          <span className="muted">個人語法完成度</span>
          <strong>{profile.overallCompletion}%</strong>
          <div className="theory-progress" aria-label={`個人語法完成度 ${profile.overallCompletion}%`}>
            <span style={{ width: `${profile.overallCompletion}%` }} />
          </div>
          <div className="command-grid">
            <span>{profile.coveredDomains}/{profile.totalDomains} 領域</span>
            <span>{stats.aiReady} AI 可用</span>
            <span>{stats.core} 核心</span>
            <span>{stats.active} 啟用</span>
          </div>
        </div>
      </header>

      {actionMessage ? <p className="action-message" role="status">{actionMessage}</p> : null}

      <section className="section panel pad stack theory-profile-panel">
        <div className="toolbar compact-toolbar">
          <div>
            <span className="eyebrow">創作語法地圖</span>
            <h2>逐項建立你的判斷標準</h2>
            <p className="muted">綠色代表已有可供 AI 使用的規則；草稿仍會保留，但不會被當成你的正式偏好。</p>
          </div>
          <div className="theory-profile-summary">
            <Target size={17} />
            <strong>{profile.coveredDomains} 項就緒</strong>
            <span>{profile.totalDomains - profile.coveredDomains} 項待定義</span>
          </div>
        </div>
        <div className="theory-domain-grid">
          {profile.domains.map((domain) => (
            <button
              className={`theory-domain-card ${domain.status}`}
              key={domain.value}
              type="button"
              onClick={() => focusDomain(domain.value, domain.prompts[0])}
            >
              <span className="theory-domain-head">
                <strong>{domain.label}</strong>
                <span>{domain.completion}%</span>
              </span>
              <span className="theory-domain-description">{domain.description}</span>
              <span className="theory-domain-meter" aria-hidden="true">
                <span style={{ width: `${domain.completion}%` }} />
              </span>
              <span className="theory-domain-foot">
                {domain.status === "ready" ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                {domain.status === "ready" ? `${domain.readyRuleCount} 條可用` : domain.status === "draft" ? "規則待補完整" : "尚未定義"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="section theory-layout">
        <div className="stack">
          <div className="panel pad stack logic-strip-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <h2>目前最核心的創作共識</h2>
                <p className="muted">優先級 1-2 且啟用的規則，會在生成草稿時優先被引用。</p>
              </div>
              <BrainCircuit size={18} color="var(--accent)" />
            </div>
            <div className="logic-strip">
              {activeCoreRules.map((rule) => (
                <div className="logic-tile" key={rule.id}>
                  <span className="tag green">{rule.ruleTypeLabel}</span>
                  <strong>{rule.title}</strong>
                  <p>{rule.statement}</p>
                </div>
              ))}
              {!activeCoreRules.length && <div className="empty compact">還沒有核心規則。新增時把優先級設為 1 或 2。</div>}
            </div>
          </div>

          <div className="panel pad stack catalog-filter-panel">
            <div className="toolbar compact-toolbar">
              <div>
                <h2>規則篩選</h2>
                <p className="muted">用類別整理：和聲、旋律、歌詞、節奏、編曲、混音、個人語彙。</p>
              </div>
              <SlidersHorizontal size={18} color="var(--accent)" />
            </div>
            <div className="status-chip-row">
              <button className={type === "ALL" ? "tab-button active" : "tab-button"} onClick={() => setType("ALL")}>
                全部
              </button>
              {theoryDomainDefinitions.map((option) => (
                <button className={type === option.value ? "tab-button active" : "tab-button"} key={option.value} onClick={() => setType(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="theory-rule-grid">
            {filteredRules.map((rule) => (
              <article className={rule.isActive ? "theory-rule-card active" : "theory-rule-card"} key={rule.id}>
                <div className="toolbar compact-toolbar">
                  <div className="stack">
                    <div className="tag-row">
                      <span className={rule.isActive ? "tag green" : "tag"}>{rule.isActive ? "啟用" : "停用"}</span>
                      <span className="tag">{rule.ruleTypeLabel}</span>
                      <span className={rule.priority <= 2 ? "tag green" : "tag"}>
                        <Gauge size={13} />
                        {priorityLabel(rule.priority)}
                      </span>
                      <span className={rule.aiReady ? "tag green" : "tag"}>{rule.aiReady ? "AI 可用" : `待補 ${rule.completion}%`}</span>
                    </div>
                    <h2>{rule.title}</h2>
                  </div>
                  <div className="toolbar-actions compact-actions">
                    <button className="icon-button" onClick={() => editRule(rule)} aria-label={`編輯 ${rule.title}`} title="編輯規則">
                      <Pencil size={16} />
                    </button>
                    <button className={rule.isActive ? "icon-button active" : "icon-button"} onClick={() => updateRule(rule.id, { isActive: !rule.isActive })} aria-label="切換規則啟用狀態" title={rule.isActive ? "停用規則" : "啟用規則"}>
                      <CheckCircle2 size={16} />
                    </button>
                  </div>
                </div>
                <p className="subtle">{rule.statement}</p>
                <div className="theory-rule-readiness">
                  <span><span style={{ width: `${rule.completion}%` }} /></span>
                  <strong>{rule.completion}%</strong>
                  <small>{rule.missingFields.length ? `還缺：${rule.missingFields.join("、")}` : "內容完整，可供 AI 使用"}</small>
                </div>
                {rule.scope && (
                  <div className="system-note compact">
                    <BookOpen size={16} />
                    <span>{rule.scope}</span>
                  </div>
                )}
                {!!rule.examples.length && (
                  <div className="generation-section-list">
                    <h3>可以這樣用</h3>
                    {rule.examples.map((example) => (
                      <p key={example}>{example}</p>
                    ))}
                  </div>
                )}
                {!!rule.avoid.length && (
                  <div className="generation-section-list">
                    <h3>避免</h3>
                    {rule.avoid.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                )}
                <div className="tag-row">
                  {rule.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>優先級</label>
                    <select className="select" value={rule.priority} onChange={(event) => updateRule(rule.id, { priority: Number(event.target.value) })}>
                      {[1, 2, 3, 4, 5].map((item) => (
                        <option value={item} key={item}>
                          {item} - {priorityLabel(item)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>類別</label>
                    <select className="select" value={rule.ruleType} onChange={(event) => updateRule(rule.id, { ruleType: event.target.value })}>
                      {theoryDomainDefinitions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel pad stack theory-create-panel" id="theory-create">
          <div className="toolbar compact-toolbar">
            <div>
              <span className="eyebrow">{selectedDomain.label}</span>
              <h2>{editingId ? "編輯樂理規則" : "建立樂理規則"}</h2>
              <p className="muted">寫成你自己的話；資料完整並啟用後，AI 才會把它當成正式偏好。</p>
            </div>
            {editingId ? (
              <button className="icon-button" type="button" onClick={resetForm} aria-label="取消編輯" title="取消編輯"><X size={17} /></button>
            ) : <Plus size={18} color="var(--accent)" />}
          </div>
          <div className="theory-guidance">
            <strong>先回答一題</strong>
            <div className="theory-question-list">
              {selectedDomain.prompts.map((question) => (
                <button className={guidingQuestion === question ? "active" : ""} type="button" key={question} onClick={() => setGuidingQuestion(question)}>
                  {question}
                </button>
              ))}
            </div>
            {guidingQuestion ? <p className="theory-current-question">{guidingQuestion}</p> : null}
          </div>
          <div className="field">
            <label>規則名稱</label>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={`我的${selectedDomain.shortLabel}原則`} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>類別</label>
              <select className="select" value={form.ruleType} onChange={(event) => setForm({ ...form, ruleType: event.target.value })}>
                {theoryDomainDefinitions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>優先級</label>
              <select className="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                {[1, 2, 3, 4, 5].map((item) => (
                  <option value={item} key={item}>
                    {item} - {priorityLabel(item)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>規則內容</label>
            <textarea
              className="textarea"
              value={form.statement}
              onChange={(event) => setForm({ ...form, statement: event.target.value })}
              placeholder="例：主歌的和弦可以簡單，但副歌第一拍要讓聽的人覺得空間打開。"
            />
          </div>
          <div className="field">
            <label>適用範圍</label>
            <input className="input" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} placeholder="例：敬拜流行、慢歌副歌、鋼琴 demo" />
          </div>
          <div className="field">
            <label>例子</label>
            <textarea className="textarea compact-textarea" value={form.examples} onChange={(event) => setForm({ ...form, examples: event.target.value })} placeholder="每行或逗號分隔" />
          </div>
          <div className="field">
            <label>避免</label>
            <textarea className="textarea compact-textarea" value={form.avoid} onChange={(event) => setForm({ ...form, avoid: event.target.value })} placeholder="例：不要主歌就塞滿 pad、不要讓效果蓋過人聲" />
          </div>
          <div className="field">
            <label>標籤</label>
            <input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="逗號分隔" />
          </div>
          <label className="check-row">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            立即啟用，讓音樂資料庫生成器可以引用
          </label>
          <div className="theory-form-readiness">
            <div className="toolbar compact-toolbar">
              <span>內容完整度</span>
              <strong>{formReadiness.completion}%</strong>
            </div>
            <span className="theory-domain-meter"><span style={{ width: `${formReadiness.completion}%` }} /></span>
            <small>{formReadiness.missingFields.length ? `還缺：${formReadiness.missingFields.join("、")}` : form.isActive ? "儲存後可供 AI 使用" : "內容完整；啟用後可供 AI 使用"}</small>
          </div>
          <button className="button primary" onClick={saveRule} disabled={saving || !form.title.trim() || !form.statement.trim()}>
            {editingId ? <CheckCircle2 size={16} /> : <Plus size={16} />}
            {saving ? "儲存中" : editingId ? "更新規則" : "新增規則"}
          </button>
          {editingId ? <button className="button" type="button" onClick={resetForm}><X size={16} />取消編輯</button> : null}
        </aside>
      </section>
    </>
  );
}
