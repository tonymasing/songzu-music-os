import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./SystemWorkspace.module.css";

const taskHints: Record<string, string> = {
  "/settings": "保留資料副本、查看磁碟位置",
  "/audio-repair": "找回缺檔、重新檢查音質",
  "/local-app": "配對手機、設定連線與安裝",
  "/integrations": "設定 GarageBand 與 AI 工具"
};

const sections = {
  maintenance: {
    label: "資料維護", code: "01 / DATA CARE",
    description: "儲存與備份集中管理；缺檔與音質問題交由音檔修復處理。",
    links: [["/settings", "儲存與備份"], ["/audio-repair", "音檔檢查與修復"]]
  },
  devices: {
    label: "裝置與整合", code: "02 / CONNECTIONS",
    description: "裝置連回主機在這裡設定；外部軟體與 AI 通路另有專屬工作區。",
    links: [["/local-app", "裝置連線與安裝"], ["/integrations", "軟體與 AI 通路"]]
  },
  reference: {
    label: "系統說明", code: "03 / SYSTEM GUIDE",
    description: "查看各工作台的責任、功能規劃與開源邊界。操作設定請使用資料維護或裝置與整合。",
    links: [["/system", "架構與功能規劃"]]
  }
} as const;

export function SystemWorkspace({ area, current, children }: {
  area: keyof typeof sections; current: string; children: ReactNode;
}) {
  const section = sections[area];
  return (
    <div className={styles.workspace} data-system-area={area}>
      <div className={styles.index}>
        <div><span className={styles.code}>{section.code}</span><strong>{section.label}</strong></div>
        <p>{section.description}</p>
      </div>
      {section.links.length > 1 ? <nav className={styles.tabs} aria-label={`${section.label}功能`}>
        {section.links.map(([href, label]) => <Link key={href} href={href} aria-label={label} aria-current={current === href ? "page" : undefined}><strong>{label}</strong><small>{taskHints[href]}</small></Link>)}
      </nav> : null}
      {children}
    </div>
  );
}
