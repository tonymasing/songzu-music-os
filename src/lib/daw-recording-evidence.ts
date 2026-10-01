import type { DawProjectDto } from "@/lib/daw";

type Track = DawProjectDto["tracks"][number];

export function dawRecordingEvidence(track: Track, selectedClipId: string, playheadSeconds: number) {
  const clip = track.clips.find(item => item.id === selectedClipId)
    ?? track.clips.find(item => playheadSeconds >= item.startSeconds && playheadSeconds < item.startSeconds + (item.durationSeconds ?? item.audioFile.durationSeconds ?? 0))
    ?? (track.clips.length === 1 ? track.clips[0] : null);
  const lane = clip ? track.takeLanes.find(item => item.recordingTake.audioFile?.id === clip.audioFileId) ?? null : null;
  const report = lane?.recordingTake.reports[0] ?? null;
  const duration = clip ? clip.durationSeconds ?? clip.audioFile.durationSeconds ?? 0 : 0;
  const issues = clip && report ? report.issues.filter(issue =>
    issue.timestampSeconds >= clip.offsetSeconds && issue.timestampSeconds < clip.offsetSeconds + duration
  ).map(issue => ({
    ...issue,
    timelineSeconds: clip.startSeconds + issue.timestampSeconds - clip.offsetSeconds,
    startSeconds: Math.max(clip.startSeconds, clip.startSeconds + issue.timestampSeconds - clip.offsetSeconds - 1.5),
    endSeconds: Math.min(clip.startSeconds + duration, clip.startSeconds + issue.timestampSeconds - clip.offsetSeconds + 2.5)
  })) : [];
  return { clip, lane, report, issues };
}

export const RECORDING_ENGINEER_RULES = [
  "本機創作者 是製作人，你是錄音執行與檢查助手，不是學生評分系統。",
  "只使用目前選取片段的分析證據。沒有對應 Take 報告時，明確說無法判斷演奏失誤，不可借用另一個 Take 的分數。",
  "沒有標準旋律或節奏參照時，不能確定漏拍或彈錯音；最近半音偏差不等於旋律正確，八分格線偏差不等於漏拍。",
  "滑音、揉弦、切分與刻意留白只能列待回聽疑點；不得直接宣判錯誤或自動改寫演奏。",
  "只提出一個可批准的通道設定方案。不操作硬體、不覆寫原音、不開始錄音、不自動套用。",
  "人聲貼近、空間感等形容只能當調整目標，不可聲稱已親耳聽見效果。",
  "錄音中只回報既有技術狀態，停止錄音後才安排回聽與調整。"
].join("\n");
