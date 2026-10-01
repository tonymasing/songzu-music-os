"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderSync,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useState } from "react";

import type {
  StorageMigrationPlan,
  StorageMigrationResult,
  StorageMigrationTargets,
  StorageStatus
} from "@/lib/storage-layout";

function formatBytes(value: number | null) {
  if (value === null) return "無法讀取";
  if (value >= 1024 ** 4) return `${Math.round((value / 1024 ** 4) * 10) / 10} TB`;
  if (value >= 1024 ** 3) return `${Math.round((value / 1024 ** 3) * 10) / 10} GB`;
  if (value >= 1024 ** 2) return `${Math.round((value / 1024 ** 2) * 10) / 10} MB`;
  if (value >= 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${value} B`;
}

function statusLabel(severity: "ok" | "warning" | "danger") {
  if (severity === "danger") return "需要處理";
  if (severity === "warning") return "空間偏低";
  return "正常";
}

export function StorageLayoutPanel({
  initialStatus,
  recommended
}: {
  initialStatus: StorageStatus;
  recommended: StorageMigrationTargets;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [targets, setTargets] = useState(recommended);
  const [plan, setPlan] = useState<StorageMigrationPlan | null>(null);
  const [result, setResult] = useState<StorageMigrationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "plan" | "migrate" | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    setBusy("refresh");
    setMessage("");
    try {
      const response = await fetch("/api/storage", { cache: "no-store" });
      const payload = (await response.json()) as { status?: StorageStatus; error?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error || "無法重新讀取儲存狀態。");
      setStatus(payload.status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法重新讀取儲存狀態。");
    } finally {
      setBusy(null);
    }
  }

  async function run(action: "plan" | "migrate") {
    setBusy(action);
    setMessage(action === "plan" ? "正在計算檔案、容量與磁碟狀態..." : "正在建立安全副本並逐檔驗證，請保持外接硬碟連線...");
    try {
      const response = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targets })
      });
      const payload = (await response.json()) as StorageMigrationPlan | StorageMigrationResult | { error?: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error || "操作失敗。" : "操作失敗。");
      if (action === "plan") {
        setPlan(payload as StorageMigrationPlan);
        setMessage((payload as StorageMigrationPlan).ready ? "搬移計畫已通過前置檢查。" : "計畫仍有阻塞項目，尚未搬移任何檔案。");
      } else {
        setResult(payload as StorageMigrationResult);
        setMessage("安全副本與新資料庫已完成。請結束並重新開啟桌面 App 套用新配置。");
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存操作失敗。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel storage-workspace" id="storage-layout">
      <div className="storage-workspace-head">
        <div>
          <span className="eyebrow">分離式儲存核心</span>
          <h2>{status.mode === "hybrid" ? "混合式架構已啟用" : "將程式、資料庫與大型音檔分工"}</h2>
          <p className="muted">資料庫留在 Mac；錄音、輸出、音色與備份使用外接磁碟。任何搬移都先建立副本，不刪除舊資料。</p>
        </div>
        <div className="storage-mode-state">
          {status.mode === "hybrid" ? <ShieldCheck size={20} /> : <FolderSync size={20} />}
          <span>{status.mode === "hybrid" ? "混合式" : "相容模式"}</span>
        </div>
      </div>

      {status.restartRequired || result ? (
        <div className="storage-restart-notice" role="status">
          <RefreshCw size={18} />
          <span>
            <strong>等待重新啟動</strong>
            新資料已驗證完成；結束並重新開啟桌面 App 後才會切換。舊資料仍完整保留。
          </span>
        </div>
      ) : null}

      <div className="storage-root-list">
        {status.roots.map((root) => (
          <div className="storage-root-row" key={root.zone}>
            <span className="storage-root-icon">
              {root.zone === "database" ? <Database size={17} /> : <HardDrive size={17} />}
            </span>
            <span className="storage-root-copy">
              <strong>{root.label}</strong>
              <small>{root.description}</small>
              <code>{root.path}</code>
            </span>
            <span className="storage-root-meta">
              <span className={`tag ${root.severity === "ok" ? "green" : root.severity === "warning" ? "warn" : "danger"}`}>
                {statusLabel(root.severity)}
              </span>
              <small>{root.location === "external" ? "外接" : "Mac"} · {root.fileSystem || "檔案系統未知"}</small>
              <small>{root.usedPercent === null ? "容量未知" : `剩餘 ${formatBytes(root.freeBytes)} · 已用 ${root.usedPercent}%`}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="storage-actions-row">
        <button className="button" type="button" onClick={refresh} disabled={Boolean(busy)}>
          {busy === "refresh" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          重新檢查
        </button>
        {status.mode !== "hybrid" || status.restartRequired ? (
          <button className="button primary" type="button" onClick={() => run("plan")} disabled={Boolean(busy) || status.restartRequired}>
            {busy === "plan" ? <Loader2 className="spin" size={16} /> : <FolderSync size={16} />}
            建立安全搬移計畫
          </button>
        ) : null}
      </div>

      {status.mode !== "hybrid" && !status.restartRequired ? (
        <details className="storage-advanced">
          <summary>查看建議位置</summary>
          <div className="storage-advanced-grid">
            <label>
              <span>Mac 內建資料庫</span>
              <input value={targets.databasePath} onChange={(event) => setTargets((current) => ({ ...current, databasePath: event.target.value }))} />
            </label>
            <label>
              <span>外接媒體根目錄</span>
              <input value={targets.mediaRoot} onChange={(event) => setTargets((current) => ({ ...current, mediaRoot: event.target.value }))} />
            </label>
            <label>
              <span>Mac 快取</span>
              <input value={targets.cacheRoot} onChange={(event) => setTargets((current) => ({ ...current, cacheRoot: event.target.value }))} />
            </label>
            <label>
              <span>啟動配置</span>
              <input value={targets.configPath} onChange={(event) => setTargets((current) => ({ ...current, configPath: event.target.value }))} />
            </label>
          </div>
        </details>
      ) : null}

      {plan ? (
        <div className="storage-plan">
          <div className="storage-plan-summary">
            <span><strong>{plan.inventory.totalFiles}</strong> 個檔案</span>
            <span><strong>{formatBytes(plan.inventory.totalBytes)}</strong> 驗證量</span>
            <span><strong>{formatBytes(plan.inventory.mediaBytes)}</strong> 外接資料</span>
          </div>
          {plan.blockers.length ? (
            <div className="storage-message danger">
              <AlertTriangle size={17} />
              <span>{plan.blockers.join(" ")}</span>
            </div>
          ) : (
            <div className="storage-message success">
              <CheckCircle2 size={17} />
              <span>目標磁碟、容量與資料庫來源均通過檢查。</span>
            </div>
          )}
          {plan.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
          <ol className="storage-step-list">
            {plan.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {plan.ready ? (
            <div className="storage-confirm-row">
              <label>
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>我了解搬移完成後要重新啟動；舊資料會保留，不會自動刪除。</span>
              </label>
              <button className="button primary" type="button" onClick={() => run("migrate")} disabled={!confirmed || Boolean(busy)}>
                {busy === "migrate" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                {busy === "migrate" ? "安全搬移與驗證中" : "建立安全副本"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="action-message" role="status">{message}</p> : null}
    </section>
  );
}
