"use client";

import { AudioLines, ClipboardCheck, Gauge, Music, Volume2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import type { SongDto } from "@/lib/music";

const instruments = [
  ["vocal", "Vocal"], ["guitar", "吉他"], ["piano", "鋼琴"],
  ["bass", "Bass"], ["drums", "節奏"], ["other", "其他"]
];
const modes = [["timing_pitch", "拍子 + 音準"], ["timing", "只偵測拍子"], ["pitch", "只偵測音準"]];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function RecordingMonitor({ song, onSongUpdated }: { song: SongDto; onSongUpdated: (song: SongDto) => void }) {
  const [instrument, setInstrument] = useState("vocal");
  const [mode, setMode] = useState("timing_pitch");
  const [bpm, setBpm] = useState(song.bpm?.toString() ?? "");
  const [targetKey, setTargetKey] = useState(song.musicalKey ?? "");
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const currentSongId = useRef(song.id);
  currentSongId.current = song.id;

  const report = useMemo(() => song.recordingSessions.flatMap(session => session.takes.flatMap(take => take.reports))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0], [song.recordingSessions]);
  const recentTakes = useMemo(() => song.recordingSessions.flatMap(session => session.takes.map(take => ({ ...take, session })))
    .slice(0, 6), [song.recordingSessions]);
  const plannedSessions = useMemo(() => song.recordingSessions.filter(session => session.takes.length === 0).slice(0, 4), [song.recordingSessions]);

  async function saveSetup() {
    if (savingRef.current) return;
    const targetBpm = bpm.trim() ? Number(bpm) : null;
    if (targetBpm !== null && (!Number.isInteger(targetBpm) || targetBpm < 20 || targetBpm > 300)) {
      setError("BPM 請填入 20 到 300 的整數，或留白。");
      return;
    }
    const songId = song.id;
    savingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${songId}/recording-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetInstrument: instrument, detectionMode: mode, targetBpm,
          targetKey: targetKey.trim() || null, metronomeEnabled, notes: notes.trim() || null })
      });
      if (!response.ok) throw new Error("錄音設定未儲存，請稍後再試。");
      const updated = await response.json() as SongDto;
      if (currentSongId.current === songId) onSongUpdated(updated);
    } catch (saveError) {
      if (currentSongId.current === songId) setError(saveError instanceof Error ? saveError.message : "錄音設定儲存失敗。");
    } finally {
      savingRef.current = false;
      if (currentSongId.current === songId) setBusy(false);
    }
  }

  return (
    <div className="panel pad stack workbench-section recording-monitor" id="recording-detect">
      <div className="toolbar">
        <h2>錄音設定與紀錄</h2>
        <span className="tag">{plannedSessions.length} 張設定卡</span>
      </div>
      <div className="recording-detect-grid">
        <div className="recording-control-panel">
          <div className="field-row three">
            <div className="field"><label htmlFor="recording-setup-instrument">錄製項目</label>
              <select id="recording-setup-instrument" className="select" value={instrument} onChange={event => setInstrument(event.target.value)}>
                {instruments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="recording-setup-mode">偵測模式</label>
              <select id="recording-setup-mode" className="select" value={mode} onChange={event => setMode(event.target.value)}>
                {modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="recording-setup-click">節拍器</label>
              <select id="recording-setup-click" className="select" value={metronomeEnabled ? "on" : "off"} onChange={event => setMetronomeEnabled(event.target.value === "on")}>
                <option value="on">開啟</option><option value="off">關閉</option>
              </select>
            </div>
          </div>
          <div className="field-row three">
            <div className="field"><label htmlFor="recording-setup-bpm">BPM</label>
              <input id="recording-setup-bpm" className="input" type="number" min={20} max={300} step={1} value={bpm} onChange={event => setBpm(event.target.value)} />
            </div>
            <div className="field"><label htmlFor="recording-setup-key">調性</label>
              <input id="recording-setup-key" className="input" value={targetKey} onChange={event => setTargetKey(event.target.value)} placeholder="例：G" />
            </div>
            <div className="field"><label htmlFor="recording-setup-notes">備註</label>
              <input id="recording-setup-notes" className="input" value={notes} onChange={event => setNotes(event.target.value)} placeholder="例：副歌 vocal" />
            </div>
          </div>
          <div className="recording-transport">
            <button className="button" type="button" onClick={() => void saveSetup()} disabled={busy}>
              <ClipboardCheck size={16} />{busy ? "儲存中" : "儲存設定卡"}
            </button>
            <Link className="button primary" href={`/songs/${song.id}/daw`}><AudioLines size={16} />前往 DAW 錄音</Link>
          </div>
          {error ? <p className="tag danger" role="alert">{error}</p> : null}
        </div>
        <div className="recording-report-panel">
          {report ? <>
            <div className="recording-score"><strong>{report.overallScore}</strong><span>最近錄音報告</span></div>
            <div className="recording-score-grid">
              <span><Gauge size={15} />拍點 {report.timingScore ?? "--"}</span>
              <span><Music size={15} />音準 {report.pitchScore ?? "--"}</span>
              <span><Volume2 size={15} />音量 {report.levelScore ?? "--"}</span>
            </div>
            <p className="muted">{report.summary}</p>
            <div className="small-list">{report.issues.slice(0, 5).map(issue => <div className="recording-issue-row" key={issue.id}>
              <span className={issue.severity === "high" ? "tag danger" : "tag warn"}>{formatTime(issue.timestampSeconds)}</span>
              <span><strong>{issue.title}</strong><br /><span className="muted">{issue.detail}</span></span>
            </div>)}</div>
            <div className="tag-row">{report.recommendations.slice(0, 3).map(item => <span className="tag" key={item}>{item}</span>)}</div>
          </> : <div className="empty compact">尚無錄音分析報告</div>}
        </div>
      </div>
      <div className="recording-take-list">
        {plannedSessions.map(session => <div className="recording-take-row" key={session.id}>
          <span><strong>{session.targetInstrument} 錄音設定</strong><br /><span className="muted">{session.targetBpm ?? "--"} BPM · {session.targetKey ?? "調性待定"} · {session.detectionMode}</span></span>
          <span className="tag-row"><span className="tag green">已規劃</span><span className="tag">{session.metronomeEnabled ? "節拍器" : "不開節拍器"}</span></span>
        </div>)}
        {recentTakes.map(take => <div className="recording-take-row" key={take.id}>
          <span><strong>{take.label}</strong><br /><span className="muted">{take.session.targetInstrument} · {take.session.targetBpm ?? "--"} BPM · {take.audioFile?.fileName ?? "音檔待確認"}</span></span>
          <span className="tag-row">
            {take.audioFileId ? <a className="button" href={`/api/files/${take.audioFileId}`} target="_blank" rel="noopener noreferrer">播放</a> : null}
            <span className="tag">{take.reports[0] ? `${take.reports[0].overallScore} 分` : "待分析"}</span><span className="tag">{take.status}</span>
          </span>
        </div>)}
        {!recentTakes.length && !plannedSessions.length ? <div className="empty compact">尚無錄音設定</div> : null}
      </div>
    </div>
  );
}
