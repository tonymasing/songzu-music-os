import { SystemWorkspace } from "@/components/SystemWorkspace";
import { ArrowUpRight, AudioLines, CircleAlert, FileAudio, FolderArchive, HardDrive, ShieldCheck } from "lucide-react";
import styles from "./Maintenance.module.css";
import Link from "next/link";

import { StorageLayoutPanel } from "@/components/StorageLayoutPanel";
import { SystemBackupPanel } from "@/components/SystemBackupPanel";
import { getSongs } from "@/lib/data";
import { listSystemBackups } from "@/lib/system-backup";
import { buildSystemHealth } from "@/lib/system-health";
import { recommendedStorageTargets } from "@/lib/storage-layout";

export const dynamic = "force-dynamic";

function formatBytes(value: number) {
  if (value > 1024 * 1024 * 1024) return `${Math.round((value / 1024 / 1024 / 1024) * 10) / 10} GB`;
  if (value > 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
  if (value > 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${value} B`;
}

function issueClass(severity: "high" | "medium" | "low") {
  if (severity === "high") return "tag danger";
  if (severity === "medium") return "tag warn";
  return "tag";
}

export default async function SettingsPage() {
  const songs = await getSongs();
  const [health, backups] = await Promise.all([buildSystemHealth(songs), listSystemBackups()]);
  const backupSize = health.database.totalBytes + health.uploads.totalBytes + health.exports.totalBytes + health.sounds.totalBytes;
  const qualityPending = health.audio.pendingQuality + health.audio.missingQualityReport;

  return (
    <div className={styles.page}><SystemWorkspace area="maintenance" current="/settings">
      <div className={styles.console}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>DATA / MAINTENANCE</span><h1>音檔與備份總覽</h1>
          <p>找回缺檔、建立備份，或查看磁碟與資料位置。</p></div>
          <span className={styles.readOnly}><ShieldCheck size={14} aria-hidden="true" />資料狀態</span>
        </header>

        <dl className={styles.summary} aria-label="資料狀態摘要">
          <div data-tone="green"><dt><FileAudio size={15} aria-hidden="true" />可管理音檔</dt><dd>{health.audio.localFiles}<small>個</small></dd></div>
          <div data-attention={health.audio.missingLocalFiles > 0}><dt><CircleAlert size={15} aria-hidden="true" />需要找回</dt><dd>{health.audio.missingLocalFiles}<small>個音檔</small></dd></div>
          <div data-attention={qualityPending > 0} data-tone="green"><dt><AudioLines size={15} aria-hidden="true" />待音質檢查</dt><dd>{qualityPending}<small>項</small></dd></div>
          <div data-tone="purple"><dt><FolderArchive size={15} aria-hidden="true" />已有備份</dt><dd>{backups.length}<small>份</small></dd></div>
        </dl>

        <section className={styles.actions} aria-label="選擇維護工作">
          <Link className={styles.action} href="/audio-repair" data-tone="gold">
            <span className={styles.actionTop}><span className={styles.actionIcon}><CircleAlert size={22} aria-hidden="true" /></span><small>01 / AUDIO</small></span>
            <h2>找回與檢查音檔</h2><p>音檔不能播放、路徑遺失，或需要重新檢查音質時使用。</p>
            <span className={styles.actionNote}>{health.audio.missingLocalFiles > 0 ? `${health.audio.missingLocalFiles} 個音檔需要找回` : "可搜尋音檔、查看音質報告"}</span>
            <strong className={styles.actionLink}>進入音檔修復 <ArrowUpRight size={16} aria-hidden="true" /></strong>
          </Link>
          <a className={styles.action} href="#backup-plan" data-tone="purple">
            <span className={styles.actionTop}><span className={styles.actionIcon}><FolderArchive size={22} aria-hidden="true" /></span><small>02 / BACKUP</small></span>
            <h2>保存一份完整備份</h2><p>把作品資料、原始音檔與輸出檔封裝保存，也能下載已完成的備份。</p>
            <span className={styles.actionNote}>{backups.length ? `已有 ${backups.length} 份備份可查看` : "尚未建立備份"}</span>
            <strong className={styles.actionLink}>查看與建立備份 <ArrowUpRight size={16} aria-hidden="true" /></strong>
          </a>
          <a className={styles.action} href="#storage-layout" data-tone="green">
            <span className={styles.actionTop}><span className={styles.actionIcon}><HardDrive size={22} aria-hidden="true" /></span><small>03 / STORAGE</small></span>
            <h2>確認資料存放位置</h2><p>查看資料在哪個磁碟、剩餘空間與連線狀態，需要時再調整儲存位置。</p>
            <span className={styles.actionNote}>搬移前會先建立副本並驗證</span>
            <strong className={styles.actionLink}>查看磁碟與路徑 <ArrowUpRight size={16} aria-hidden="true" /></strong>
          </a>
        </section>

        <section className={styles.issues} aria-labelledby="maintenance-issues-title">
          <div className={styles.sectionHead}><div><span className={styles.kicker}>CHECK / REVIEW</span><h2 id="maintenance-issues-title">需要處理的項目</h2></div><span>{health.issues.length} 項檢查結果</span></div>
          <p className={styles.sectionHint}>先查看原因，再進入對應工作區；這份清單不會自動修改音檔。</p>
          {health.issues.length ? (
            <div className="small-list">
              {health.issues.map((issue) => {
                const content = (
                  <>
                    <span>
                      <strong>{issue.title}</strong>
                      <br />
                      <span className="muted">{issue.detail}</span>
                    </span>
                    <span className={issueClass(issue.severity)}>{issue.severity === "high" ? "優先" : issue.severity === "medium" ? "本週" : "觀察"}</span>
                  </>
                );
                return issue.href ? (
                  <Link className="workbench-item focus-item" href={issue.href} key={issue.id}>
                    {content}
                  </Link>
                ) : (
                  <div className="workbench-item focus-item" key={issue.id}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">目前沒有高風險檔案問題。</div>
          )}
        </section>

        <section className={styles.backupArea} aria-label="建立與下載備份">
          <div className={styles.backupMain}><SystemBackupPanel initialBackups={backups} estimatedBytes={backupSize} /></div>
          <aside className={styles.backupContents}>
            <h3>這份備份包含什麼？</h3>
            <p>完成完整性與 ZIP 校驗後，才會提供下載。</p>
            <div className="lane-grid">
              <div className="lane-tile">
                <span className="tag green">資料庫</span>
                <strong>作品與設定資料</strong>
                <small>{health.database.exists ? formatBytes(health.database.totalBytes) : "儲存路徑待確認"}</small>
              </div>
              <div className="lane-tile">
                <span className="tag green">原始上傳</span>
                <strong>{health.uploads.fileCount} 個檔案</strong>
                <small>{health.uploads.exists ? formatBytes(health.uploads.totalBytes) : "儲存路徑待確認"}</small>
              </div>
              <div className="lane-tile">
                <span className="tag green">輸出檔</span>
                <strong>{health.exports.fileCount} 個檔案</strong>
                <small>{formatBytes(health.exports.totalBytes)}</small>
              </div>
              {health.sounds.exists ? (
                <div className="lane-tile">
                  <span className="tag green">音色素材</span>
                  <strong>{health.sounds.fileCount} 個檔案</strong>
                  <small>{formatBytes(health.sounds.totalBytes)}</small>
                </div>
              ) : null}
              <div className="lane-tile">
                <span className="tag green">可建立</span>
                <strong>全站備份包</strong>
                <small>預估 {formatBytes(backupSize)}</small>
              </div>
            </div>
          </aside>
        </section>
      <div className="section">
        <StorageLayoutPanel
          initialStatus={health.storage}
          recommended={recommendedStorageTargets(health.storage.layout)}
        />
      </div>
      </div>
    </SystemWorkspace></div>
  );
}
