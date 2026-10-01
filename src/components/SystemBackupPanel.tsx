"use client";

import { CheckCircle2, Download, Loader2, PackagePlus, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { SystemBackupRecord } from "@/lib/system-backup";

function formatBytes(value: number) {
  if (value > 1024 * 1024 * 1024) return `${Math.round((value / 1024 / 1024 / 1024) * 10) / 10} GB`;
  if (value > 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
  if (value > 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${value} B`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function SystemBackupPanel({
  initialBackups,
  estimatedBytes
}: {
  initialBackups: SystemBackupRecord[];
  estimatedBytes: number;
}) {
  const [backups, setBackups] = useState(initialBackups);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function createBackup() {
    setBusy(true);
    setMessage("正在整理資料庫、原始音檔與輸出檔...");
    try {
      const response = await fetch("/api/system/backup", { method: "POST" });
      const result = (await response.json()) as SystemBackupRecord | { error?: string };
      if (!response.ok || !("fileName" in result)) {
        throw new Error("error" in result ? result.error || "建立備份失敗" : "建立備份失敗");
      }
      setBackups((current) => [result, ...current.filter((item) => item.fileName !== result.fileName)]);
      setMessage(`備份完成：${result.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立備份失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" id="backup-plan">
      <div className="toolbar">
        <div>
          <h2>全站備份</h2>
          <p className="muted">資料庫、原始錄音、輸出檔與外接音色庫會一起封裝；舊備份不會重複包入。</p>
        </div>
        <ShieldCheck size={18} color="var(--accent)" />
      </div>
      <div className="system-note">
        <strong>預估內容</strong>
        <span>{formatBytes(estimatedBytes)} · 建立過程不會更動或壓縮原始音檔。</span>
      </div>
      <button className="button primary" type="button" onClick={createBackup} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : <PackagePlus size={16} />}
        {busy ? "建立備份中" : "建立全站備份包"}
      </button>
      {message ? <p className="action-message" role="status">{message}</p> : null}
      <div className="small-list">
        {backups.slice(0, 5).map((backup) => (
          <div className="list-row" key={backup.fileName}>
            <span>
              <strong>{backup.fileName}</strong>
              <br />
              <span className="muted">{formatDate(backup.createdAt)} · {formatBytes(backup.fileSizeBytes)}</span>
              {backup.sha256 ? (
                <>
                  <br />
                  <span className="muted">SHA-256 {backup.sha256.slice(0, 16)}...</span>
                </>
              ) : null}
            </span>
            <a className="button" href={backup.downloadUrl}>
              <Download size={15} />
              下載
            </a>
          </div>
        ))}
        {!backups.length ? (
          <div className="empty compact"><CheckCircle2 size={16} /> 尚未建立備份包。</div>
        ) : null}
      </div>
    </div>
  );
}
