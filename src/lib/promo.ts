import type { SongDto } from "@/lib/music";

export type GeneratedPromoAsset = {
  assetType: string;
  title: string;
  content: string;
};

const assetLabels: Record<string, string> = {
  release_copy: "發行文案",
  ig_reels: "IG / Reels 文案",
  youtube_description: "YouTube Description",
  spotify_pitch: "Spotify Pitch",
  email_pitch: "Email Pitch",
  cover_prompt: "封面 Prompt",
  short_script: "30 秒短影音腳本"
};

function primaryLyrics(song: SongDto) {
  return song.lyricsVersions.find((version) => version.isPrimary)?.content ?? song.lyricsVersions[0]?.content ?? "";
}

function lyricExcerpt(song: SongDto) {
  const content = primaryLyrics(song)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" / ");
  return content || "以敬拜、故事與旋律推動的作品。";
}

function tags(song: SongDto) {
  return [song.genre, song.subgenre, ...song.mood, song.bpm ? `${song.bpm} BPM` : null, song.musicalKey]
    .filter(Boolean)
    .join("、");
}

export function promoAssetTypeLabel(assetType: string) {
  return assetLabels[assetType] ?? assetType;
}

export function generateLocalPromoAssets(song: SongDto): GeneratedPromoAsset[] {
  const title = song.title;
  const genre = song.genre ?? "未定曲風";
  const mood = song.mood.length ? song.mood.join("、") : "溫暖、真實";
  const summary = song.summary || `${title} 是一首以 ${genre} 為核心、帶著 ${mood} 情緒的作品。`;
  const musicFacts = tags(song) || "曲風、BPM、調性待補";
  const hook = lyricExcerpt(song);
  const credits = song.credits.length
    ? song.credits.map((credit) => `${credit.contributor.name}（${credit.role}）`).join("、")
    : "製作名單待補";

  return [
    {
      assetType: "release_copy",
      title: `${title} 發行文案`,
      content: `${summary}\n\n這首歌保留創作當下的信念與情緒，適合放在個人發行頁、教會分享、合作提案與影像配樂簡介中。音樂標籤：${musicFacts}。`
    },
    {
      assetType: "ig_reels",
      title: `${title} IG / Reels 文案`,
      content: `新作品《${title}》正在整理中。\n\n${summary}\n\n你會先注意到哪一句？\n「${hook}」\n\n#${genre.replace(/\s+/g, "")} #原創音樂 #敬拜創作 #Songwriting`
    },
    {
      assetType: "youtube_description",
      title: `${title} YouTube Description`,
      content: `《${title}》\n\n${summary}\n\n歌詞片段：\n${hook}\n\nCredits：${credits}\n\n作品資料：${musicFacts}\n\n聯絡 / 合作：請填入你的聯絡資訊。`
    },
    {
      assetType: "spotify_pitch",
      title: `${title} Spotify Pitch`,
      content: `${title} 以 ${genre} 為核心，情緒關鍵字是 ${mood}。${summary} 推薦給喜歡有敘事感、信仰感與旋律焦點的聽眾。可用於敬拜歌單、華語福音流行、安靜反思與新歌探索情境。`
    },
    {
      assetType: "email_pitch",
      title: `${title} Email Pitch`,
      content: `您好，我想分享一首作品《${title}》。\n\n${summary}\n\n目前整理好的資料包含：${musicFacts}。如果您正在尋找適合合作、影像配樂、教會使用或發行評估的原創作品，我很樂意提供完整歌詞、音檔與 credits。`
    },
    {
      assetType: "cover_prompt",
      title: `${title} 封面 Prompt`,
      content: `單曲封面，主題為《${title}》，氛圍：${mood}，曲風：${genre}。畫面要有信念感、留白、可讀性強，適合 Spotify / Apple Music 方形封面。避免過多文字與複雜標誌。`
    },
    {
      assetType: "short_script",
      title: `${title} 30 秒短影音腳本`,
      content: `0-5 秒：用一句歌詞或創作動機開場：「${hook}」。\n5-15 秒：播放副歌或最有辨識度的段落，畫面切到錄音、歌詞手稿或 GarageBand session。\n15-24 秒：補一句故事：「這首歌想留下的是 ${mood}。」\n24-30 秒：顯示歌名《${title}》與發行 / 試聽 CTA。`
    }
  ];
}
