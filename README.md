# 頌祖音樂 OS · Songzu Music OS

本機優先的音樂創作工作台。整合作品、錄音、參考音樂、偏好筆記與資料維護，使用金／紫／綠的賽博龐克介面。

分享版 **0.32.17**。首次進入參考資料庫即有兩首隨附 MP3 與 Tony 的分類筆記：City Pop 與 Reggae / Rocksteady 版本的 Call of Silence。其他個人歌曲、錄音、樂譜與私人設定均不包含。

![賽博龐克音樂資料庫與播放器](docs/images/music-library.png)

畫面為隨附 City Pop / Reggae 參考曲；兩首均可直接播放。

## 我只想安裝使用

[下載 Mac M 系列安裝包](https://github.com/tonymasing/songzu-music-os/releases/download/v0.32.17.001/Songzu-Music-OS-0.32.17-arm64.dmg) · [完整下載頁](https://github.com/tonymasing/songzu-music-os/releases/tag/v0.32.17.001)

本專案已公開，朋友不需要 GitHub 帳號或邀請即可查看說明、下載安裝包。

在此專案的 **Releases** 下載 `Songzu-Music-OS-0.32.17-arm64.dmg`，開啟後把 App 拖到「應用程式」。打開「頌祖音樂 OS」即會啟動內建的本機服務，不必啟動開發預覽或安裝 Node.js。

目前安裝包適用 **Apple Silicon Mac（M 系列）**。Intel Mac、Windows 尚無已驗證的安裝包。

- [安裝、首次開啟、更新與疑難排解](docs/INSTALL.md)
- [功能分類與需要的外部工具](docs/FEATURES.md)
- [加入自己的音樂及分類筆記](docs/MUSIC-LIBRARY.md)
- [原始碼開發與自行打包](docs/DEVELOPMENT.md)
- [版本與驗證紀錄](CHANGELOG.md)

## 功能分類

| 工作 | 入口 | 用途 |
| --- | --- | --- |
| 寫歌與作品 | 收件箱、作品庫 | 收集靈感、管理歌曲版本、歌詞與任務 |
| 錄音製作 | DAW 錄音室 | 錄音、音軌編輯、播放、混音與輸出 |
| 參考與學習 | 音樂資料庫、樂理資料 | 音檔播放、風格分類、喜好與創作注意事項 |
| 製作輔助 | 音樂智慧核心 | 製作建議、分析記錄與外部引擎狀態 |
| 系統維護 | 資料維護、裝置與整合、系統說明 | 備份、缺檔檢查、儲存位置與裝置連接 |

播放器提供 A–B 循環、速度與調性調整，播放鍵使用持續漸變發光。部分分析、轉檔與遠端功能需要另外配置，詳見功能說明。

## 專案整理

| 位置 | 內容 |
| --- | --- |
| `src/` | 網頁介面、API 與功能邏輯 |
| `electron/` | 桌面 App 啟動、儲存位置與服務生命週期 |
| `native/songzu-daw-core/` | Rust 原生音訊引擎 |
| `prisma/` | 資料結構、空白初始化與近期升級工具 |
| `public/`、`build/` | 介面、字型與圖示資源 |
| `mobile-shell/` | 手機連接介面原始碼；未附手機安裝包 |
| `scripts/` | 建置、分析與選用的本機工具 |
| `docs/` | 使用與開發文件 |

兩首指定分享曲與筆記放在 `public/bundled-references/`，其他使用者資料不放進原始碼目錄。安裝包放 Releases；個人資料保留在使用者自己的電腦。

## 素材與分享範圍

這是供朋友使用的軟體分享版，僅附 Tony 明確指定分享的兩首 Call of Silence 改編音檔與筆記，不包含其完整個人音樂資料庫。第三方字型及 DSP 元件保留原有授權；[素材說明](THIRD_PARTY_NOTICES.md)列出來源。倉庫提供下載不代表所有程式及視覺素材已採用開源授權。
