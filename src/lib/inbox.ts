export type InspirationAnalysis = {
  title: string;
  aiCategory: string;
  moods: string[];
  suggestedTitle: string;
};

export function analyzeInspiration(content: string): InspirationAnalysis {
  const text = content.trim();
  const lower = text.toLowerCase();
  const firstLine = text.split(/\r?\n/).find(Boolean) ?? "未命名靈感";
  const title = firstLine.length > 26 ? `${firstLine.slice(0, 26)}...` : firstLine;

  const aiCategory =
    lower.includes("reels") || lower.includes("short") || text.includes("短影音")
      ? "宣傳素材"
      : text.includes("副歌") || text.includes("主歌") || text.includes("歌詞")
        ? "歌詞片段"
        : lower.includes("mix") || text.includes("混音") || text.includes("母帶")
          ? "混音備註"
          : lower.includes("garageband") || text.includes("編曲") || text.includes("和聲")
            ? "編曲想法"
            : "新歌靈感";

  const moods = [
    text.includes("雨") ? "療癒" : null,
    text.includes("光") ? "盼望" : null,
    text.includes("城市") ? "城市" : null,
    text.includes("清晨") ? "清晨" : null,
    text.includes("祢") || text.includes("禱告") ? "敬拜" : null,
    lower.includes("lo-fi") ? "lo-fi" : null
  ].filter((item): item is string => Boolean(item));

  return {
    title,
    aiCategory,
    moods: moods.length ? moods : ["待整理"],
    suggestedTitle: title.replace(/[，。,.].*$/, "")
  };
}
