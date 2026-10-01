"use client";

import { Mic2, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./DawOverview.module.css";

type DawOverviewRow = {
  songId: string;
  title: string;
  status: string;
  bpm: number | null;
  musicalKey: string | null;
  genre: string | null;
  audioFileCount: number;
  localAudioCount: number;
  recordingTakeCount: number;
  issueCount: number;
  project: {
    id: string;
    title: string;
    status: string;
    engineMode: string;
    trackCount: number;
    clipCount: number;
    updatedAt: string;
  } | null;
};

function statusBadge(row: DawOverviewRow) {
  if (!row.project) return { label: "未建立", tone: styles.warn };
  if (row.project.status === "READY_TO_EDIT") return { label: "可剪輯", tone: styles.ready };
  if (row.project.status === "NEEDS_AUDIO") return { label: "需要音檔", tone: styles.warn };
  if (row.project.status === "EXPORT_READY") return { label: "可匯出", tone: styles.ready };
  return { label: row.project.status, tone: "" };
}

export function DawOverviewWorkspace({ initialRows }: { initialRows: DawOverviewRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busySongId, setBusySongId] = useState<string | null>(null);

  const stats = useMemo(
    () => ({
      projects: rows.filter((row) => row.project).length,
      clips: rows.reduce((total, row) => total + (row.project?.clipCount ?? 0), 0),
      takes: rows.reduce((total, row) => total + row.recordingTakeCount, 0),
      fallback: rows.filter((row) => row.project?.engineMode === "web_fallback").length
    }),
    [rows]
  );
  const resumeRow = rows.find((row) => row.project) ?? null;

  async function createProject(row: DawOverviewRow) {
    setBusySongId(row.songId);
    try {
      const response = await fetch(`/api/songs/${row.songId}/daw-project`, { method: "POST" });
      const data = (await response.json()) as {
        project?: {
          id: string;
          title: string;
          status: string;
          engineMode: string;
          tracks: Array<{ clips: unknown[] }>;
          updatedAt: string;
        };
      };
      if (data.project) {
        const project = data.project;
        setRows((current) =>
          current.map((item) =>
            item.songId === row.songId
              ? {
                  ...item,
                  project: {
                    id: project.id,
                    title: project.title,
                    status: project.status,
                    engineMode: project.engineMode,
                    trackCount: project.tracks.length,
                    clipCount: project.tracks.reduce((total, track) => total + track.clips.length, 0),
                    updatedAt: project.updatedAt
                  }
                }
              : item
          )
        );
      }
    } finally {
      setBusySongId(null);
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h1>錄音室</h1>
          <p>選一首歌進入獨立錄音室；原始音檔不會被覆蓋。</p>
        </div>
        {resumeRow?.project ? (
          <Link className={`${styles.button} ${styles.primary}`} href={`/songs/${resumeRow.songId}/daw`}>
            <Play size={14} />
            繼續最近錄音室
          </Link>
        ) : (
          <span className={`${styles.status} ${styles.warn}`}>先為歌曲建立 DAW 專案</span>
        )}
      </header>

      <dl className={styles.stats}>
        <div><dt>專案</dt><dd>{stats.projects}</dd></div>
        <div><dt>片段</dt><dd>{stats.clips}</dd></div>
        <div><dt>Take</dt><dd>{stats.takes}</dd></div>
        <div><dt>Web 備援</dt><dd>{stats.fallback}</dd></div>
      </dl>

      <ul className={styles.list} aria-label="錄音室專案">
        {rows.map((row) => {
          const badge = statusBadge(row);
          return (
            <li className={styles.row} key={row.songId}>
              <div className={styles.info}>
                <div className={styles.titleLine}>
                  <h2>{row.title}</h2>
                  <span className={`${styles.status} ${badge.tone}`}>{badge.label}</span>
                </div>
                <p className={styles.meta}>
                  <span>{row.bpm ?? "--"} BPM</span>
                  <span>{row.musicalKey ?? "未設定調性"}</span>
                  <span>{row.genre ?? "未分類"}</span>
                  <span>{row.audioFileCount} 音檔</span>
                  <span>{row.recordingTakeCount} takes</span>
                  <span>{row.project?.trackCount ?? 0} tracks</span>
                </p>
              </div>
              <div className={styles.actions}>
                {row.project ? (
                  <Link className={`${styles.button} ${styles.primary}`} href={`/songs/${row.songId}/daw`}>
                    <Mic2 size={14} />
                    進入錄音室
                  </Link>
                ) : (
                  <button
                    className={`${styles.button} ${styles.primary}`}
                    type="button"
                    onClick={() => createProject(row)}
                    disabled={busySongId === row.songId}
                  >
                    <Plus size={14} />
                    {busySongId === row.songId ? "建立中" : "建立專案"}
                  </button>
                )}
                <Link className={styles.button} href={`/songs/${row.songId}`}>
                  作品工作台
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
