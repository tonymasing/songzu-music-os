"use client";

import { useMemo, useRef, useState } from "react";
import { Activity, AudioLines, ChevronLeft, ChevronRight, Database, Grid2X2, Plug, SlidersHorizontal, Workflow, X } from "lucide-react";
import styles from "./LibraryWorkspace.module.css";
import cyber from "./SystemRecordsWorkspace.module.css";

export type SystemRecord = {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  status: string;
  date: string;
  fields: [string, string][];
};

const groups = [["all", "全部"], ["analysis", "音訊分析"], ["plugins", "外掛"], ["effects", "效果鏈"], ["automation", "自動化"], ["knowledge", "資料索引"], ["health", "錄音健康"]] as const;
const groupIcons = { all: Grid2X2, analysis: AudioLines, plugins: Plug, effects: SlidersHorizontal, automation: Workflow, knowledge: Database, health: Activity };
const labels: Record<string, string> = { COMPLETED: "已完成", FAILED: "失敗", QUEUED: "排隊中", RUNNING: "執行中", PROPOSED: "待確認", APPROVED: "已核准", ROLLED_BACK: "已復原", SAVED: "已保存", ACTIVE: "已登錄", UNVALIDATED: "未驗證", VALIDATED: "已驗證", QUARANTINED: "已隔離", CLIPPING: "有剪波", healthy: "正常" };
const dateFormat = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Taipei" });
const timeFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" });
const pageSize = 20;

export function SystemRecordsWorkspace({ records }: { records: SystemRecord[] }) {
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SystemRecord | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return records.filter((record) => (group === "all" || record.group === group) && (!failedOnly || ["FAILED", "QUARANTINED", "CLIPPING"].includes(record.status)) && (!search || [record.title, record.subtitle, labels[record.status] ?? record.status, ...record.fields.flat()].join(" ").toLocaleLowerCase().includes(search)));
  }, [records, group, query, failedOnly]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return <div className={`${styles.workspace} ${cyber.records}`}>
    <header className={styles.header}><div><h1>音樂智慧核心</h1><p>{records.length} 筆系統紀錄 · 歷史資料</p></div></header>
    <div className={`${styles.tabs} ${cyber.tabs}`} role="tablist" aria-label="紀錄分類">
      {groups.map(([key, label], index) => { const Icon = groupIcons[key]; return <button key={key} id={`records-tab-${key}`} role="tab" type="button" aria-controls="records-panel" aria-selected={group === key} tabIndex={group === key ? 0 : -1} onClick={() => { setGroup(key); setPage(0); }} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? groups.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + groups.length) % groups.length;
        setGroup(groups[next][0]); setPage(0);
        document.getElementById(`records-tab-${groups[next][0]}`)?.focus();
      }}><Icon className={cyber.tabIcon} size={15} aria-hidden="true" /><span>{label}</span><small className={cyber.tabCount}>{key === "all" ? records.length : records.filter((record) => record.group === key).length}</small></button>; })}
    </div>
    <div className={`${styles.recordFilters} ${cyber.filters}`}>
      <input className="input" aria-label="搜尋系統紀錄" placeholder="搜尋作品、引擎或紀錄" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      <label><input type="checkbox" checked={failedOnly} onChange={(event) => { setFailedOnly(event.target.checked); setPage(0); }} /> 只看異常</label>
    </div>
    <section className={cyber.list} id="records-panel" role="tabpanel" aria-labelledby={`records-tab-${group}`}>
      {visible.map((record) => <button type="button" className={`${styles.recordRow} ${cyber.row}`} key={`${record.group}-${record.id}`} onClick={() => { setSelected(record); dialog.current?.showModal(); }}>
        <span><strong>{record.title}</strong><small>{record.subtitle}</small></span>
        <span className={`${styles.badge} ${cyber.status} ${["FAILED", "CLIPPING", "QUARANTINED"].includes(record.status) ? styles.failed : ""}`}>{labels[record.status] ?? record.status}</span>
        <time dateTime={record.date}>{dateFormat.format(new Date(record.date))}</time><ChevronRight size={16} />
      </button>)}
      {!visible.length ? <p className={styles.empty}>{records.some((record) => group === "all" || record.group === group) ? "沒有符合條件的紀錄" : "尚無紀錄"}</p> : null}
    </section>
    <footer className={styles.pager}><span role="status">{filtered.length} 筆 · 第 {page + 1} / {pageCount} 頁</span><div><button type="button" className="icon-button" aria-label="上一頁紀錄" title="上一頁" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><button type="button" className="icon-button" aria-label="下一頁紀錄" title="下一頁" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="record-title">
      <div className={styles.header}><h2 id="record-title">{selected?.title}</h2><button type="button" className="icon-button" aria-label="關閉紀錄" title="關閉" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {selected ? <><p>{selected.subtitle}</p><dl className={styles.metadata}><div><dt>狀態</dt><dd>{labels[selected.status] ?? selected.status}</dd></div><div><dt>紀錄時間</dt><dd>{timeFormat.format(new Date(selected.date))}</dd></div>{selected.fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></> : null}
    </dialog>
  </div>;
}
