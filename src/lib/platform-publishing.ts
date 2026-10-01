import type { SongDto } from "@/lib/music";
import { generateLocalPromoAssets, promoAssetTypeLabel } from "@/lib/promo";

export type PlatformReadiness = {
  platform: "youtube" | "instagram";
  label: string;
  status: "ready_manual" | "missing_assets" | "setup_required";
  summary: string;
  required: Array<{ label: string; ok: boolean; details: string }>;
  recommended: string[];
  manualSteps: string[];
  apiRequirements: string[];
};

export type PublishingPlan = {
  songId: string;
  title: string;
  generatedAt: string;
  exportPackage: {
    availableLocalFiles: number;
    missingExternalFiles: number;
    textAssets: number;
  };
  platforms: PlatformReadiness[];
};

function primaryLyrics(song: SongDto) {
  return song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0] ?? null;
}

function localFiles(song: SongDto) {
  return song.audioFiles.filter((file) => !file.archivedAt && file.storageProvider === "local_upload" && file.filePath);
}

function existingOrGeneratedPromo(song: SongDto, assetType: string) {
  const existing = song.promoAssets.find((asset) => asset.assetType === assetType);
  if (existing) return existing.content;
  return generateLocalPromoAssets(song).find((asset) => asset.assetType === assetType)?.content ?? "";
}

function hasLocalVideo(song: SongDto, fileTypes: string[]) {
  return localFiles(song).find((file) => fileTypes.includes(file.fileType) || /\.(mp4|mov|m4v)$/i.test(file.fileName));
}

function check(label: string, ok: boolean, details: string) {
  return { label, ok, details };
}

function statusFor(required: Array<{ ok: boolean }>, setupRequired: boolean): PlatformReadiness["status"] {
  if (!required.every((item) => item.ok)) return "missing_assets";
  return setupRequired ? "setup_required" : "ready_manual";
}

export function buildPublishingPlan(song: SongDto): PublishingPlan {
  const generatedPromo = generateLocalPromoAssets(song);
  const textAssets = song.promoAssets.length || generatedPromo.length;
  const local = localFiles(song);
  const missingExternalFiles = song.audioFiles.filter((file) => !file.archivedAt && file.filePath && file.storageProvider !== "local_upload").length;
  const youtubeVideo = hasLocalVideo(song, ["music_video", "short_video"]);
  const instagramVideo = hasLocalVideo(song, ["short_video"]);
  const youtubeDescription = existingOrGeneratedPromo(song, "youtube_description");
  const igCaption = existingOrGeneratedPromo(song, "ig_reels");
  const lyrics = primaryLyrics(song);
  const cover = song.audioFiles.find((file) => !file.archivedAt && file.fileType === "cover");

  const youtubeRequired = [
    check("影片檔", Boolean(youtubeVideo), youtubeVideo ? youtubeVideo.fileName : "YouTube 需要影片，不接受單純 WAV/MP3 當影片上傳。"),
    check("標題", Boolean(song.title), song.title || "缺歌名。"),
    check("Description", Boolean(youtubeDescription), youtubeDescription ? "可用發行素材產生。" : "請先產生 YouTube Description。")
  ];
  const instagramRequired = [
    check("短影音檔", Boolean(instagramVideo), instagramVideo ? instagramVideo.fileName : "IG Reels 需要直式短影音 MP4/MOV。"),
    check("Caption", Boolean(igCaption), igCaption ? "可用 IG / Reels 文案。" : "請先產生 IG / Reels 文案。")
  ];

  const youtubeStatus = statusFor(youtubeRequired, true);
  const instagramStatus = statusFor(instagramRequired, true);

  return {
    songId: song.id,
    title: song.title,
    generatedAt: new Date().toISOString(),
    exportPackage: {
      availableLocalFiles: local.length,
      missingExternalFiles,
      textAssets
    },
    platforms: [
      {
        platform: "youtube",
        label: "YouTube",
        status: youtubeStatus,
        summary:
          youtubeStatus === "missing_assets"
            ? "目前還不能上傳 YouTube，因為缺影片檔或發佈文案。"
            : "手動發佈包已可準備；一鍵 API 上傳需要 Google OAuth 與 YouTube Data API。",
        required: youtubeRequired,
        recommended: [
          cover ? `封面：${cover.fileName}` : "補 16:9 或 1:1 封面縮圖。",
          lyrics ? "歌詞可放入 description 或字幕工作流。" : "補歌詞，方便製作字幕與 description。",
          "準備 privacyStatus：private / unlisted / public。"
        ],
        manualSteps: [
          "從匯出包下載影片、description、credits 與封面。",
          "到 YouTube Studio 上傳影片。",
          "貼上 title / description / tags，確認縮圖與 visibility。",
          "發佈後回 App 記錄連結與發行狀態。"
        ],
        apiRequirements: [
          "Google Cloud project 啟用 YouTube Data API v3。",
          "OAuth 2.0 client 與 youtube.upload scope。",
          "若 API project 未完成審核，上傳影片通常會被限制為 private。",
          "需要儲存 OAuth token、重試狀態、YouTube videoId 與錯誤紀錄。"
        ]
      },
      {
        platform: "instagram",
        label: "Instagram Reels",
        status: instagramStatus,
        summary:
          instagramStatus === "missing_assets"
            ? "目前還不能發 IG Reels，因為缺直式短影音或 caption。"
            : "手動發佈包已可準備；一鍵 API 發佈需要 Meta Graph API、專業帳號與公開影片 URL。",
        required: instagramRequired,
        recommended: [
          "建議 9:16 直式 MP4/MOV，音樂已嵌入影片檔。",
          cover ? `可用封面素材：${cover.fileName}` : "補直式封面或影片第一秒視覺。",
          "準備 hashtag 與短 CTA。"
        ],
        manualSteps: [
          "從匯出包下載短影音、caption 與封面提示。",
          "用 Instagram App 或 Meta Business Suite 發佈 Reels。",
          "確認音質、畫面裁切與字幕位置。",
          "發佈後回 App 記錄連結與成效。"
        ],
        apiRequirements: [
          "Instagram Business / Creator 帳號與 Meta App。",
          "Content Publishing 權限與 access token。",
          "API 發佈需要可被 Meta 抓取的公開 video_url，本機 localhost 檔案不能直接用。",
          "需要 container 建立、狀態輪詢、media_publish 與錯誤重試紀錄。"
        ]
      }
    ]
  };
}

export function publishingStatusLabel(status: PlatformReadiness["status"]) {
  if (status === "ready_manual") return "可手動發佈";
  if (status === "setup_required") return "需平台設定";
  return "缺素材";
}

export function exportTextAssets(song: SongDto) {
  const generated = generateLocalPromoAssets(song);
  const assets = song.promoAssets.length
    ? song.promoAssets.map((asset) => ({
        fileName: `${asset.assetType}.txt`,
        title: asset.title,
        content: asset.content
      }))
    : generated.map((asset) => ({
        fileName: `${asset.assetType}.txt`,
        title: asset.title,
        content: asset.content
      }));
  return assets.map((asset) => ({
    ...asset,
    label: promoAssetTypeLabel(asset.fileName.replace(/\\.txt$/, ""))
  }));
}
