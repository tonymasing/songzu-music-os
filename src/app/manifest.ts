import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "頌祖音樂 OS",
    short_name: "頌祖音樂",
    description: "本機優先的 AI 音樂創作、作品資料庫、音色資料庫與發行工作台。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f4ee",
    theme_color: "#1f7a68",
    orientation: "any",
    lang: "zh-Hant",
    categories: ["music", "productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/maskable-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "作品庫",
        short_name: "作品",
        description: "查看歌曲與版本。",
        url: "/songs",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
      },
      {
        name: "音色資料庫",
        short_name: "音色",
        description: "收集樂器、效果與年代參考。",
        url: "/sounds",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
      },
      {
        name: "發佈 / 輸出",
        short_name: "輸出",
        description: "準備 YouTube / IG / 發佈素材。",
        url: "/publishing",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
      }
    ]
  };
}
