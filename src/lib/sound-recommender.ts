import type { SongDto } from "@/lib/music";
import type { SoundLibraryItemDto } from "@/lib/sound-library";

export type SoundRecommendation = {
  item: SoundLibraryItemDto;
  score: number;
  reason: string;
  suggestedRole: string;
  suggestedSection: string;
};

function includesAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function itemHaystack(item: SoundLibraryItemDto) {
  return [
    item.name,
    item.itemType,
    item.itemTypeLabel,
    item.family,
    item.era,
    item.source,
    item.description,
    item.tags.join(" "),
    item.character.join(" "),
    item.useCases.join(" "),
    item.chain.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function songHaystack(song: SongDto) {
  const primaryLyrics = song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0];
  return [
    song.title,
    song.workingTitle,
    song.genre,
    song.subgenre,
    song.summary,
    song.notes,
    song.mood.join(" "),
    primaryLyrics?.content
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function roleFor(item: SoundLibraryItemDto, song: SongDto) {
  const haystack = itemHaystack(item);
  if (includesAny(haystack, ["vocal", "人聲", "plate", "de-esser"])) {
    return { role: "人聲空間 / 修飾", section: "Chorus" };
  }
  if (includesAny(haystack, ["piano", "鋼琴", "keyboard", "鍵盤"])) {
    return { role: "和聲鋪底", section: "Verse" };
  }
  if (includesAny(haystack, ["pad", "synth", "合成器", "shimmer", "ambient"])) {
    return { role: "氛圍與段落擴張", section: song.status === "IDEA" ? "Intro" : "Bridge" };
  }
  if (includesAny(haystack, ["lofi", "cassette", "texture", "質地"])) {
    return { role: "質地與短影音版本", section: "Intro" };
  }
  if (includesAny(haystack, ["organ", "gospel", "soul"])) {
    return { role: "副歌支撐 / 現場感", section: "Chorus" };
  }
  return { role: item.itemTypeLabel, section: "全曲" };
}

export function buildSoundRecommendations(song: SongDto, library: SoundLibraryItemDto[], limit = 5): SoundRecommendation[] {
  const usedIds = new Set(song.soundUsages.map((usage) => usage.soundLibraryItemId));
  const songText = songHaystack(song);
  const moodText = song.mood.join(" ").toLowerCase();
  const bpm = song.bpm ?? 0;

  return library
    .filter((item) => !usedIds.has(item.id) && item.status !== "ARCHIVED")
    .map((item) => {
      const text = itemHaystack(item);
      let score = item.favorite ? 12 : 0;
      const reasons: string[] = [];

      if (item.status === "ACTIVE") score += 18;
      if (item.status === "TESTING") score += 5;

      if (includesAny(songText, ["worship", "敬拜", "gospel", "禱告"]) && includesAny(text, ["worship", "gospel", "shimmer", "piano", "plate", "organ", "敬拜"])) {
        score += 35;
        reasons.push("作品帶敬拜/福音語境，適合補穩定和聲與空間感。");
      }

      if (includesAny(songText, ["lo-fi", "lofi", "清晨", "城市", "voice memo"]) && includesAny(text, ["lofi", "cassette", "texture", "noise"])) {
        score += 34;
        reasons.push("作品有 lo-fi / 生活感方向，可先做質地版本。");
      }

      if (includesAny(songText, ["synth", "宣告", "速度感", "pop"]) && includesAny(text, ["synth", "pad", "80s", "wide"])) {
        score += 30;
        reasons.push("作品偏 pop / synth，可以用 pad 做段落擴張。");
      }

      if (includesAny(songText, ["vocal", "人聲", "和聲", "副歌"]) && includesAny(text, ["vocal", "人聲", "plate", "reverb"])) {
        score += 24;
        reasons.push("目前可先建立人聲空間參考，方便之後混音對照。");
      }

      if (bpm && bpm < 88 && includesAny(text, ["piano", "pad", "shimmer", "ambient", "room"])) {
        score += 14;
        reasons.push("慢速作品適合先用長尾空間或鋼琴支撐情緒。");
      }

      if (bpm >= 110 && includesAny(text, ["synth", "pad", "chorus", "delay"])) {
        score += 14;
        reasons.push("較快 BPM 可用合成器或 delay 增加推進感。");
      }

      if (moodText && item.character.some((tag) => moodText.includes(tag.toLowerCase()))) {
        score += 12;
        reasons.push("音色特性與情緒標籤吻合。");
      }

      if (!reasons.length) {
        reasons.push("可作為候選素材，先放入藍圖觀察。");
      }

      const suggested = roleFor(item, song);
      return {
        item,
        score,
        reason: reasons[0],
        suggestedRole: suggested.role,
        suggestedSection: suggested.section
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
