import type { SongDto } from "@/lib/music";

export type MetadataCellStatus = "complete" | "missing" | "suggested";

export type MetadataField = {
  key: string;
  label: string;
};

export type MetadataCell = {
  key: string;
  label: string;
  status: MetadataCellStatus;
  note: string;
};

export type MetadataMatrixRow = {
  song: Pick<SongDto, "id" | "title" | "statusLabel" | "readiness"> & {
    readinessLabel: string;
    ready: boolean;
  };
  cells: MetadataCell[];
  missingCount: number;
  suggestedCount: number;
  completeCount: number;
};

export const metadataFields: MetadataField[] = [
  { key: "lyrics", label: "歌詞" },
  { key: "demo", label: "Demo" },
  { key: "mix", label: "Mix" },
  { key: "master", label: "Master" },
  { key: "masterQuality", label: "Master 音質" },
  { key: "cover", label: "封面" },
  { key: "bpm", label: "BPM" },
  { key: "key", label: "調性" },
  { key: "genre", label: "曲風" },
  { key: "credits", label: "製作名單" },
  { key: "split", label: "分潤 100%" },
  { key: "isrc", label: "ISRC" },
  { key: "upc", label: "UPC / 發行專案" },
  { key: "releaseCopy", label: "發行文案" },
  { key: "shortVideo", label: "短影音素材" }
];

function cell(key: string, label: string, status: MetadataCellStatus, note: string): MetadataCell {
  return { key, label, status, note };
}

function hasFile(song: SongDto, fileType: string) {
  return song.audioFiles.some((file) => file.fileType === fileType);
}

function readinessCell(song: SongDto, gateId: string, key: string, label: string) {
  const gate = song.releaseReadiness.gates.find((item) => item.id === gateId);
  if (!gate) return cell(key, label, "missing", "尚未建立管理狀態");
  const status: MetadataCellStatus = gate.status === "pass" ? "complete" : gate.status === "warning" ? "suggested" : "missing";
  return cell(key, label, status, gate.detail);
}

function promoHas(song: SongDto, assetType: string) {
  return song.promoAssets.some((asset) => asset.assetType === assetType && asset.content.trim().length > 0);
}

export function buildMetadataMatrix(songs: SongDto[]): MetadataMatrixRow[] {
  return songs.map((song) => {
    const hasReleaseProject = song.releaseTracks.length > 0;
    const hasUpc = song.releaseTracks.some((track) => Boolean(track.release.upc));
    const hasIsrc = song.releaseTracks.some((track) => Boolean(track.isrc));
    const hasReleaseCopy = promoHas(song, "release_copy") || Boolean(song.summary);
    const hasShortVideo = promoHas(song, "short_script");
    const cells = [
      readinessCell(song, "lyrics", "lyrics", "歌詞"),
      cell("demo", "Demo", hasFile(song, "demo") ? "complete" : "missing", hasFile(song, "demo") ? "已有 Demo" : "缺 Demo"),
      cell("mix", "Mix", hasFile(song, "mix") ? "complete" : "missing", hasFile(song, "mix") ? "已有 Mix" : "缺混音版"),
      cell("master", "Master", hasFile(song, "master") ? "complete" : "missing", hasFile(song, "master") ? "已有母帶" : "缺母帶"),
      readinessCell(song, "masterQuality", "masterQuality", "Master 音質"),
      readinessCell(song, "cover", "cover", "封面"),
      readinessCell(song, "bpm", "bpm", "BPM"),
      readinessCell(song, "key", "key", "調性"),
      readinessCell(song, "genre", "genre", "曲風"),
      readinessCell(song, "credits", "credits", "製作名單"),
      readinessCell(song, "split", "split", "分潤 100%"),
      cell("isrc", "ISRC", hasIsrc ? "complete" : "missing", hasIsrc ? "已有 ISRC" : "缺 ISRC"),
      cell(
        "upc",
        "UPC / 發行專案",
        hasUpc ? "complete" : hasReleaseProject ? "suggested" : "missing",
        hasUpc ? "已有 UPC" : hasReleaseProject ? "有發行專案，待補 UPC" : "未加入發行專案"
      ),
      cell(
        "releaseCopy",
        "發行文案",
        hasReleaseCopy ? "complete" : "missing",
        hasReleaseCopy ? "已有文案初稿" : "缺發行文案"
      ),
      cell(
        "shortVideo",
        "短影音素材",
        hasShortVideo ? "complete" : "suggested",
        hasShortVideo ? "已有短影音腳本" : "建議產生短影音腳本"
      )
    ];

    return {
      song: {
        id: song.id,
        title: song.title,
        statusLabel: song.statusLabel,
        readiness: song.releaseReadiness.score,
        readinessLabel: song.releaseReadiness.label,
        ready: song.releaseReadiness.ready
      },
      cells,
      missingCount: cells.filter((item) => item.status === "missing").length,
      suggestedCount: cells.filter((item) => item.status === "suggested").length,
      completeCount: cells.filter((item) => item.status === "complete").length
    };
  });
}
