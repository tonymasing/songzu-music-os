"use client";

import { CyberAudioPlayer } from "@/components/CyberAudioPlayer";

import { Check, Clock, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SongDto } from "@/lib/music";

type AudioFileDto = SongDto["audioFiles"][number];
type AudioCommentDto = AudioFileDto["comments"][number];
type AudioAnalysisDto = AudioFileDto["analyses"][number];

const categoryOptions = ["混音", "編曲", "人聲", "節奏", "母帶", "其他"];
const statusOptions = [
  { value: "TODO", label: "待處理" },
  { value: "DONE", label: "已處理" },
  { value: "WATCH", label: "保留觀察" }
];

async function jsonRequest<T>(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const rest = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${rest}`;
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

function getLocalMood(rms: number, peak: number) {
  const mood = [rms > 0.16 ? "高能量" : rms > 0.07 ? "中等能量" : "安靜"];
  if (peak > 0.92) mood.push("峰值偏高");
  if (rms < 0.04) mood.push("動態保守");
  return mood;
}

function getLocalUseCases(file: AudioFileDto, durationSeconds: number) {
  const useCases = new Set<string>();
  if (file.fileType === "demo") useCases.add("創作評估");
  if (file.fileType === "mix") useCases.add("混音修訂");
  if (file.fileType === "master") useCases.add("發行前檢查");
  if (durationSeconds <= 45) useCases.add("短影音片段");
  if (!useCases.size) useCases.add("作品整理");
  return [...useCases];
}

function buildBars(data: Float32Array, count: number) {
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((data.length / count) * index);
    const end = Math.floor((data.length / count) * (index + 1));
    const stride = Math.max(1, Math.floor((end - start) / 700));
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += stride) {
      peak = Math.max(peak, Math.abs(data[sampleIndex] ?? 0));
    }
    bars.push(roundMetric(peak));
  }
  return bars;
}

export function AudioWorkbench({
  songId,
  file,
  onSongUpdated
}: {
  songId: string;
  file: AudioFileDto;
  onSongUpdated: (song: SongDto) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [comments, setComments] = useState(file.comments);
  const [analyses, setAnalyses] = useState(file.analyses);
  const [currentTime, setCurrentTime] = useState(0);
  const [commentBody, setCommentBody] = useState("");
  const [category, setCategory] = useState("混音");
  const [status, setStatus] = useState("TODO");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    setComments(file.comments);
    setAnalyses(file.analyses);
  }, [file.comments, file.analyses]);

  const latestAnalysis = analyses[0];
  const waveform = latestAnalysis?.waveform ?? [];
  const canAnalyze = file.storageProvider === "local_upload" && Boolean(file.filePath);

  const statusLabels = useMemo(
    () => Object.fromEntries(statusOptions.map((option) => [option.value, option.label])),
    []
  );

  function seekTo(seconds: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    void audioRef.current.play();
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    const created = await jsonRequest<AudioCommentDto>(`/api/audio-files/${file.id}/comments`, {
      timestampSeconds: audioRef.current?.currentTime ?? currentTime,
      body: commentBody,
      category,
      status
    });
    setComments((current) => [...current, created]);
    setCommentBody("");
  }

  async function patchComment(commentId: string, patch: Partial<AudioCommentDto>) {
    const updated = await jsonRequest<AudioCommentDto>(`/api/audio-comments/${commentId}`, patch, "PATCH");
    setComments((current) => current.map((comment) => (comment.id === commentId ? updated : comment)));
  }

  async function analyzeAudio() {
    if (!canAnalyze) return;
    setAnalyzing(true);
    try {
      const response = await fetch(`/api/files/${file.id}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const audioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audioContextConstructor) {
        throw new Error("此瀏覽器不支援 Web Audio API");
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new audioContextConstructor();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      const data = buffer.getChannelData(0);
      const stride = Math.max(1, Math.floor(data.length / 500_000));
      let peak = 0;
      let sumSquares = 0;
      let counted = 0;

      for (let index = 0; index < data.length; index += stride) {
        const sample = data[index] ?? 0;
        const absolute = Math.abs(sample);
        peak = Math.max(peak, absolute);
        sumSquares += sample * sample;
        counted += 1;
      }

      const rms = Math.sqrt(sumSquares / Math.max(1, counted));
      const durationSeconds = buffer.duration;
      const analysis = await jsonRequest<AudioAnalysisDto>(`/api/audio-files/${file.id}/analysis`, {
        durationSeconds: roundMetric(durationSeconds),
        peak: roundMetric(peak),
        rms: roundMetric(rms),
        waveform: buildBars(data, 96),
        energy: buildBars(data, 16),
        suggestedBpm: null,
        suggestedMood: getLocalMood(rms, peak),
        suggestedUseCase: getLocalUseCases(file, durationSeconds)
      });
      setAnalyses((current) => [analysis, ...current]);
      await audioContext.close();
    } finally {
      setAnalyzing(false);
    }
  }

  async function applyMoodTags(analysis: AudioAnalysisDto) {
    if (!analysis.suggestedMood.length) return;
    const updated = await jsonRequest<SongDto>(
      `/api/songs/${songId}`,
      {
        mood: analysis.suggestedMood
      },
      "PATCH"
    );
    onSongUpdated(updated);
  }

  return (
    <div className="audio-workbench">
      <CyberAudioPlayer
        ref={audioRef}
        controls
        src={`/api/files/${file.id}`}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />

      <div className="toolbar">
        <div className="tag-row">
          <span className="tag">
            <Clock size={13} />
            {formatTime(currentTime)}
          </span>
          {latestAnalysis ? (
            <>
              <span className="tag green">RMS {latestAnalysis.rms ?? "--"}</span>
              <span className="tag">Peak {latestAnalysis.peak ?? "--"}</span>
              <span className="tag">{latestAnalysis.durationSeconds ? formatTime(latestAnalysis.durationSeconds) : "長度待確認"}</span>
            </>
          ) : (
            <span className="tag warn">尚未分析</span>
          )}
        </div>
        <button className="button" onClick={analyzeAudio} disabled={!canAnalyze || analyzing}>
          <Sparkles size={16} />
          {analyzing ? "分析中" : "本機分析"}
        </button>
      </div>

      {waveform.length ? (
        <div className="waveform" aria-label="音檔波形">
          {waveform.map((bar, index) => (
            <button
              aria-label={`跳到 ${index + 1} 段`}
              className="waveform-bar"
              key={`${file.id}-${index}`}
              onClick={() => {
                const duration = latestAnalysis?.durationSeconds ?? audioRef.current?.duration ?? 0;
                seekTo((duration * index) / waveform.length);
              }}
              style={{ height: `${Math.max(10, bar * 76)}px` }}
              type="button"
            />
          ))}
        </div>
      ) : (
        <div className="empty compact">按「本機分析」後會在這裡產生 waveform。</div>
      )}

      {latestAnalysis && (
        <div className="tag-row">
          {latestAnalysis.suggestedMood.map((item) => (
            <span className="tag green" key={item}>
              {item}
            </span>
          ))}
          {latestAnalysis.suggestedUseCase.map((item) => (
            <span className="tag" key={item}>
              {item}
            </span>
          ))}
          <button className="button" onClick={() => applyMoodTags(latestAnalysis)}>
            <Check size={15} />
            套用情緒標籤
          </button>
        </div>
      )}

      <div className="field-row three">
        <div className="field">
          <label>留言分類</label>
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>狀態</label>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>目前時間</label>
          <button className="button" onClick={() => setCommentBody((current) => current || `${formatTime(currentTime)} `)}>
            <Play size={15} />
            插入時間
          </button>
        </div>
      </div>
      <div className="field">
        <label>時間點留言</label>
        <textarea
          className="textarea compact-textarea"
          placeholder="例：人聲太後面、鼓進來太突兀、這裡可以留空間"
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
        />
      </div>
      <button className="button primary" onClick={addComment} disabled={!commentBody.trim()}>
        <Plus size={16} />
        在 {formatTime(currentTime)} 新增留言
      </button>

      <div className="small-list">
        {comments.length ? (
          comments.map((comment) => (
            <div className="list-row" key={comment.id}>
              <button className="timestamp-button" onClick={() => seekTo(comment.timestampSeconds)}>
                {formatTime(comment.timestampSeconds)}
              </button>
              <span>
                <strong>{comment.body}</strong>
                <br />
                <span className="muted">{comment.category}</span>
              </span>
              <select
                className="select compact-select"
                value={comment.status}
                onChange={(event) => patchComment(comment.id, { status: event.target.value })}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {statusLabels[option.value]}
                  </option>
                ))}
              </select>
            </div>
          ))
        ) : (
          <div className="empty compact">還沒有 timestamp 留言。</div>
        )}
      </div>
    </div>
  );
}
