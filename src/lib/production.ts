import type { SongDto } from "@/lib/music";
import { fileTypeLabel } from "@/lib/music";

export type SongHealthReport = {
  score: number;
  level: "READY" | "FOCUS" | "BLOCKED";
  levelLabel: string;
  summary: string;
  blockers: string[];
  nextActions: string[];
  strengths: string[];
};

export type SongAiTab = {
  id: string;
  label: string;
  summary: string;
  bullets: string[];
  action: string;
};

function hasFile(song: SongDto, fileType: string) {
  return song.audioFiles.some((file) => file.fileType === fileType);
}

function primaryLyrics(song: SongDto) {
  return song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0] ?? null;
}

export function analyzeSongHealth(song: SongDto): SongHealthReport {
  const blockers = [...song.warnings];
  const nextActions: string[] = [];
  const strengths: string[] = [];
  const hasMaster = hasFile(song, "master");
  const hasMasterQualityFail = song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "fail");
  const hasMasterQualityPass = song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pass");

  if (primaryLyrics(song)) strengths.push("已有主歌詞，可進行歌詞架構與段落分析。");
  else nextActions.push("先補主歌詞，AI 才能穩定分析段落、主題與副歌力量。");

  if (hasFile(song, "demo")) strengths.push("已有 Demo，可開始比較編曲方向。");
  else nextActions.push("上傳 Demo 或語音備忘錄，讓作品先有聲音版本。");

  if (hasFile(song, "mix")) strengths.push("已有混音版本，可進入混音檢查。");
  else nextActions.push("建立混音版本或把 GarageBand 專案整理成下一輪混音任務。");

  if (hasMasterQualityPass) strengths.push("已有音質通過的母帶，具備發行資產基礎。");
  else if (hasMasterQualityFail) nextActions.push("Master 音質未通過，先重新輸出或檢查 clipping / 格式。");
  else if (hasMaster) nextActions.push("母帶已存在，但需要完成 Audio QA 才能安全進入發行。");
  else nextActions.push("完成母帶，並標記主版本。");

  if (hasFile(song, "cover")) strengths.push("已有封面素材。");
  else nextActions.push("補封面或先產生封面概念。");

  if (song.splitTotal === 100) strengths.push("分潤比例已達 100%。");
  else nextActions.push(`修正分潤比例，目前是 ${song.splitTotal}%。`);

  if (!song.targetReleaseDate && song.status === "READY_FOR_RELEASE") {
    nextActions.push("已準備發行的作品需要設定目標發行日。");
  }

  const score = Math.max(0, Math.min(100, song.readiness - Math.max(0, blockers.length - 2) * 4));
  const level = score >= 76 ? "READY" : blockers.length >= 4 ? "BLOCKED" : "FOCUS";
  const levelLabel = level === "READY" ? "可推進" : level === "BLOCKED" ? "卡關" : "需聚焦";

  return {
    score,
    level,
    levelLabel,
    summary:
      level === "READY"
        ? `${song.title} 已接近可發行，重點是確認素材與發行節奏。`
        : `${song.title} 目前最需要處理 ${blockers[0] ?? "核心資料"}，完成後就能進入下一階段。`,
    blockers: blockers.slice(0, 6),
    nextActions: nextActions.slice(0, 6),
    strengths: strengths.slice(0, 5)
  };
}

export function buildSongAiTabs(song: SongDto): SongAiTab[] {
  const lyrics = primaryLyrics(song);
  const health = analyzeSongHealth(song);
  const hasMix = hasFile(song, "mix");
  const hasMaster = hasFile(song, "master");
  const hasMasterQualityFail = song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "fail");
  const hasMasterQualityPass = song.audioFiles.some((file) => file.fileType === "master" && file.qualityStatus === "pass");
  const mood = song.mood.length ? song.mood.join("、") : "尚未標記";
  const genre = [song.genre, song.subgenre].filter(Boolean).join(" / ") || "未分類";

  return [
    {
      id: "health",
      label: "健檢",
      summary: health.summary,
      bullets: [
        `完整度 ${health.score}%：${health.levelLabel}`,
        ...(health.blockers.length ? health.blockers : ["目前沒有明顯阻塞。"]),
        ...health.nextActions.slice(0, 3)
      ],
      action: "先處理第一個缺漏，讓作品往下一階段移動。"
    },
    {
      id: "lyrics",
      label: "歌詞",
      summary: lyrics ? "已可做段落、hook、主題一致性整理。" : "尚未有主歌詞，歌詞分析會偏弱。",
      bullets: lyrics
        ? [
            `主版本：${lyrics.versionName}`,
            `內容長度：約 ${lyrics.content.length} 字`,
            "建議確認主歌是否鋪陳清楚，副歌是否有一句可被記住的核心句。"
          ]
        : ["新增主歌詞版本。", "先標記 Verse / Chorus / Bridge。", "補一句最能代表歌曲的核心句。"],
      action: "把主版本歌詞補到可直接給 AI 分段。"
    },
    {
      id: "arrangement",
      label: "編曲",
      summary: `${genre}，情緒是 ${mood}。編曲應服務主題，不先堆滿。`,
      bullets: [
        song.bpm ? `BPM：${song.bpm}` : "尚未設定 BPM。",
        song.musicalKey ? `調性：${song.musicalKey}` : "尚未設定調性。",
        song.genre?.toLowerCase().includes("gospel")
          ? "副歌可加群唱或和聲堆疊，讓敬拜感更立體。"
          : "先找一個主音色作為辨識點，再決定鼓與低頻。"
      ],
      action: "建立 2 個編曲方向版本：克制版與打開版。"
    },
    {
      id: "mixing",
      label: "混音",
      summary: hasMix ? "已有混音版本，可以進入聽感比較。" : "尚未看到混音版本，先建立第一個 Mix。版本。",
      bullets: [
        hasMix ? "比對人聲位置、低頻、鼓、空間感。" : "先匯出 rough mix，建立第一個可討論版本。",
        hasMaster ? "母帶已存在，注意混音與母帶版本是否一致。" : "母帶還沒完成，混音確認後再送母帶。",
        hasMasterQualityFail ? "目前 master 音質未通過，不要直接拿去發行。" : "每次新 master 都要重新跑 Audio QA。",
        "每次混音回合只改 3 個重點，避免方向漂移。"
      ],
      action: "把下一次混音要改的 3 件事寫成任務。"
    },
    {
      id: "release",
      label: "發行",
      summary: song.status === "READY_FOR_RELEASE" ? "已進入發行準備。" : "目前還未完全進入發行狀態。",
      bullets: [
        song.targetReleaseDate ? `目標發行日：${song.targetReleaseDate.slice(0, 10)}` : "尚未設定目標發行日。",
        hasMasterQualityPass ? "母帶音質已通過。" : hasMaster ? "母帶需完成音質檢查。" : "缺母帶。",
        hasFile(song, "cover") ? "封面已具備。" : "缺封面。"
      ],
      action: "在發行管理頁補完 checklist。"
    },
    {
      id: "content",
      label: "短影音",
      summary: "每首歌至少準備 3 種短影音角度：故事、金句、製作過程。",
      bullets: [
        `故事角度：${song.summary ?? "補一句這首歌為什麼存在。"}`,
        "金句角度：從副歌挑一句能獨立存在的句子。",
        "製作角度：錄一段 GarageBand 編曲或人聲 before/after。"
      ],
      action: "先建立 3 則短影音任務。"
    },
    {
      id: "cover",
      label: "封面",
      summary: hasFile(song, "cover") ? "已有封面，可進入尺寸與平台檢查。" : "尚未有封面，先定視覺方向。",
      bullets: [
        `主情緒：${mood}`,
        "封面要能在手機小尺寸辨識，不要文字太細。",
        "準備 1:1 主封面與短影音垂直版視覺。"
      ],
      action: "把封面概念寫成一句可交給設計或 AI 生圖的 prompt。"
    },
    {
      id: "positioning",
      label: "定位",
      summary: "定位不是把歌講大，而是講清楚誰會被它打中。",
      bullets: [
        `曲風定位：${genre}`,
        `情緒定位：${mood}`,
        "發行文案先寫給一個具體聽眾，不要寫給所有人。"
      ],
      action: "整理一句聽眾定位：這首歌給正在____的人。"
    }
  ];
}

export function inferUploadMetadata(fileName: string, explicitFileType?: string | null, explicitVersionName?: string | null, notes?: string | null) {
  const lower = fileName.toLowerCase();
  const inferredType =
    explicitFileType && explicitFileType !== "auto"
      ? explicitFileType
      : lower.includes("master")
        ? "master"
        : lower.includes("mix")
          ? "mix"
          : lower.includes("short") || lower.includes("reel") || lower.includes("vertical") || lower.includes("直式")
            ? "short_video"
            : lower.match(/\.(mp4|mov|m4v)$/)
              ? "music_video"
              : lower.includes("stem") || lower.includes("vocal")
                ? "vocal_stem"
                : lower.includes("cover") || lower.match(/\.(png|jpe?g|webp)$/)
                  ? "cover"
                  : lower.match(/\.(pdf|docx?|txt)$/)
                    ? "document"
                    : lower.includes("garageband") || lower.endsWith(".band")
                      ? "project"
                      : "demo";

  const versionMatch = lower.match(/(?:^|[-_\s])v(\d+)(?:\b|[-_\s.])/i);
  const inferredVersion = explicitVersionName?.trim() || (versionMatch ? `v${versionMatch[1]}` : fileTypeLabel(inferredType));
  const aiNote = `AI 自動整理：判斷為「${fileTypeLabel(inferredType)}」，版本「${inferredVersion}」。`;

  return {
    fileType: inferredType,
    versionName: inferredVersion,
    notes: [notes?.trim(), aiNote].filter(Boolean).join("\n")
  };
}
