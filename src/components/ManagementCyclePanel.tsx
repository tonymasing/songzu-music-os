"use client";

import { CalendarCheck2, Check, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { requestJson } from "@/lib/client-request";
import type { ManagementCycleReport, ManagementCycleType } from "@/lib/management";

const cycleOrder: ManagementCycleType[] = ["daily", "weekly", "monthly"];

function toneClass(tone: string) {
  if (tone === "danger") return "tag danger";
  if (tone === "warning") return "tag warn";
  if (tone === "good") return "tag green";
  return "tag";
}

function reviewLabel(status: ManagementCycleReport["reviewStatus"]) {
  if (status === "applied") return "已檢視";
  if (status === "pending") return "待檢視";
  if (status === "archived") return "已封存";
  if (status === "dismissed") return "已略過";
  return "即時狀態";
}

function formatTaipeiDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  const hour = String(taipei.getUTCHours()).padStart(2, "0");
  const minute = String(taipei.getUTCMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export function ManagementCyclePanel({ initialCycles }: { initialCycles: Record<ManagementCycleType, ManagementCycleReport> }) {
  const [activeType, setActiveType] = useState<ManagementCycleType>("daily");
  const [cycles, setCycles] = useState(initialCycles);
  const [busy, setBusy] = useState<"generate" | "review" | "">("");
  const [message, setMessage] = useState("");
  const active = cycles[activeType];

  async function generate() {
    setBusy("generate");
    setMessage("");
    try {
      const report = await requestJson<ManagementCycleReport>("/api/management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeType })
      });
      setCycles((current) => ({ ...current, [activeType]: report }));
      setMessage(`${report.label}管理報告已更新並保存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "管理報告更新失敗。");
    } finally {
      setBusy("");
    }
  }

  async function markReviewed() {
    if (!active.suggestionId) return;
    setBusy("review");
    setMessage("");
    try {
      await requestJson(`/api/ai-suggestions/${active.suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "applied" })
      });
      setCycles((current) => ({
        ...current,
        [activeType]: { ...current[activeType], reviewStatus: "applied" }
      }));
      setMessage("這份管理報告已標記為完成檢視。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "報告狀態更新失敗。");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel pad management-cycle-panel">
      <div className="management-cycle-heading">
        <div>
          <span className="eyebrow">管理週期</span>
          <h2>每天執行、每週排序、每月結算</h2>
          <p className="muted">所有報告都讀取同一份作品、發行、收益與系統狀態。</p>
        </div>
        <span className={active.reviewStatus === "applied" ? "tag green" : active.reviewStatus === "pending" ? "tag warn" : "tag"}>
          {reviewLabel(active.reviewStatus)}
        </span>
      </div>

      <div className="management-cycle-tabs" role="tablist" aria-label="管理週期">
        {cycleOrder.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={activeType === type}
            className={activeType === type ? "active" : ""}
            onClick={() => {
              setActiveType(type);
              setMessage("");
            }}
          >
            {cycles[type].label}
          </button>
        ))}
      </div>

      <div className="management-cycle-copy">
        <CalendarCheck2 size={20} />
        <div>
          <strong>{active.title}</strong>
          <p>{active.summary}</p>
          <small>{active.periodKey} · {formatTaipeiDateTime(active.generatedAt)}</small>
        </div>
      </div>

      <div className="management-cycle-metrics">
        {active.metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
            <i className={toneClass(metric.tone)} aria-hidden="true" />
          </div>
        ))}
      </div>

      <div className="management-cycle-actions">
        <div className="management-cycle-actions-title">
          <strong>這個週期要完成的事</strong>
          <span>{active.actions.length} 項</span>
        </div>
        {active.actions.length ? active.actions.map((action) => (
          <Link href={action.href} key={action.id}>
            <span>
              <strong>{action.title}</strong>
              <small>{action.detail}</small>
            </span>
            <span className={toneClass(action.tone)}>{action.category}</span>
          </Link>
        )) : <p className="empty compact">這個週期目前沒有待處理事項。</p>}
      </div>

      <div className="management-cycle-controls">
        <button className="button" type="button" disabled={Boolean(busy)} onClick={() => void generate()}>
          <RefreshCw className={busy === "generate" ? "spin" : ""} size={16} />
          {activeType === "weekly" ? "重新整理 AI 優先級" : "更新這份報告"}
        </button>
        {active.suggestionId && active.reviewStatus !== "applied" ? (
          <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => void markReviewed()}>
            <Check size={16} />完成檢視
          </button>
        ) : null}
        {message ? <span className="management-cycle-message" role="status">{message}</span> : null}
      </div>
    </section>
  );
}
