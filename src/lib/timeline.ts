import type { SongDto } from "@/lib/music";
import { fileTypeLabel } from "@/lib/music";

export type SongTimelineItem = {
  id: string;
  title: string;
  description: string;
  createdAt: string | null;
  source: string;
};

function push(items: SongTimelineItem[], item: SongTimelineItem) {
  if (item.createdAt) {
    items.push(item);
  }
}

export function buildSongTimeline(song: SongDto): SongTimelineItem[] {
  const items: SongTimelineItem[] = [];

  push(items, {
    id: `song-${song.id}`,
    title: "建立作品卡",
    description: song.summary || "作品已加入頌祖音樂 OS。",
    createdAt: song.createdAt,
    source: "作品"
  });

  for (const event of song.timelineEvents) {
    push(items, {
      id: `event-${event.id}`,
      title: event.title,
      description: event.description ?? "已記錄重要創作事件。",
      createdAt: event.createdAt,
      source: "證據鏈"
    });
  }

  for (const version of song.lyricsVersions) {
    push(items, {
      id: `lyrics-${version.id}`,
      title: `新增歌詞：${version.versionName}`,
      description: version.isPrimary ? "目前主歌詞版本。" : "保留為歌詞版本紀錄。",
      createdAt: version.createdAt,
      source: "歌詞"
    });
  }

  for (const file of song.audioFiles) {
    push(items, {
      id: `file-${file.id}`,
      title: `新增檔案：${file.fileName}`,
      description: `${fileTypeLabel(file.fileType)}${file.versionName ? ` / ${file.versionName}` : ""}`,
      createdAt: file.createdAt,
      source: "檔案"
    });

    for (const analysis of file.analyses) {
      push(items, {
        id: `analysis-${analysis.id}`,
        title: `本機分析：${file.fileName}`,
        description: `Duration ${analysis.durationSeconds ? Math.round(analysis.durationSeconds) : "--"} 秒，RMS ${
          analysis.rms ? analysis.rms.toFixed(3) : "--"
        }。`,
        createdAt: analysis.createdAt,
        source: "音訊分析"
      });
    }

    for (const report of file.qualityReports) {
      push(items, {
        id: `quality-${report.id}`,
        title: `音質檢查：${file.fileName}`,
        description: `${report.verdict} / LUFS ${report.integratedLufs ?? "--"} / clipping ${
          report.clippingRisk ? "有風險" : "未偵測"
        }`,
        createdAt: report.createdAt,
        source: "Audio QA"
      });
    }

    for (const comment of file.comments) {
      push(items, {
        id: `comment-${comment.id}`,
        title: `時間點留言：${Math.floor(comment.timestampSeconds / 60)
          .toString()
          .padStart(2, "0")}:${Math.floor(comment.timestampSeconds % 60)
          .toString()
          .padStart(2, "0")}`,
        description: `${comment.category} / ${comment.status}：${comment.body}`,
        createdAt: comment.createdAt,
        source: "混音工作台"
      });
    }
  }

  for (const session of song.recordingSessions) {
    push(items, {
      id: `recording-session-${session.id}`,
      title: `錄音偵測：${session.targetInstrument}`,
      description: `${session.targetBpm ?? "--"} BPM / ${session.targetKey ?? "調性未設定"} / ${session.detectionMode}`,
      createdAt: session.createdAt,
      source: "錄音偵測"
    });

    for (const take of session.takes) {
      push(items, {
        id: `recording-take-${take.id}`,
        title: `錄音 take：${take.label}`,
        description: `${take.status} / ${take.audioFile?.fileName ?? "音檔待確認"}`,
        createdAt: take.createdAt,
        source: "錄音 take"
      });

      for (const report of take.reports) {
        push(items, {
          id: `performance-report-${report.id}`,
          title: `準確度偵測：${report.overallScore} 分`,
          description: `${report.summary} / 問題點 ${report.issues.length} 個。`,
          createdAt: report.createdAt,
          source: "錄音報告"
        });
      }
    }
  }

  for (const history of song.statusHistory) {
    push(items, {
      id: `status-${history.id}`,
      title: `狀態變更：${history.toStatusLabel}`,
      description: history.note ?? "手動更新作品狀態。",
      createdAt: history.changedAt,
      source: "狀態"
    });
  }

  for (const inspiration of song.inspirations) {
    push(items, {
      id: `inspiration-${inspiration.id}`,
      title: `靈感：${inspiration.title}`,
      description: inspiration.content,
      createdAt: inspiration.createdAt,
      source: "靈感"
    });
  }

  for (const credit of song.credits) {
    for (const confirmation of credit.confirmations) {
      push(items, {
        id: `credit-confirmation-${confirmation.id}`,
        title: `${credit.contributor.name} 分潤確認：${confirmation.status}`,
        description: `${credit.role} / ${credit.splitPercentage ?? 0}%${
          confirmation.confirmedAt ? "，已完成確認。" : "，等待合作人確認。"
        }`,
        createdAt: confirmation.confirmedAt ?? confirmation.createdAt,
        source: "分潤"
      });
    }
  }

  for (const log of song.garageBandLogs) {
    push(items, {
      id: `gb-${log.id}`,
      title: `GarageBand：${log.operation}`,
      description: `${log.command} / ${log.approvalStatus} / ${log.resultStatus}`,
      createdAt: log.createdAt,
      source: "GarageBand"
    });
  }

  for (const asset of song.promoAssets) {
    push(items, {
      id: `promo-${asset.id}`,
      title: `發行素材：${asset.title}`,
      description: asset.status,
      createdAt: asset.createdAt,
      source: "發行素材"
    });
  }

  return items.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}
