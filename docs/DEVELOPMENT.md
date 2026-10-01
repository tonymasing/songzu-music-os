# 開發與打包

## 需求

Node.js 22.13 以上（需要 `node:sqlite`）、npm。桌面原生引擎另需 Rust / Cargo 及 Xcode Command Line Tools。以 `package-lock.json` 鎖定套件；本次建置使用 Node.js 26.8.1。

## 新的開發環境

```sh
npm ci
cp .env.example .env
npm run db:generate
npm run db:init
npm run dev
```

`db:init` 只用於不存在的新資料庫，已有資料時會拒絕覆蓋。近期結構升級工具接受 `SONGZU_UPGRADE_DB_PATH`；先備份再執行，不要用重新初始化取代升級。

正式網頁模式：

```sh
npm run build
npm start -- --hostname 127.0.0.1 --port 3000
```

一般使用者請直接使用桌面安裝包。上述命令只給開發者；網頁模式不等於桌面內建原生引擎已啟動。

## 桌面 DMG

```sh
npm run electron:dmg
```

輸出在 `dist-electron/`。打包 hook 會檢查本機 ad-hoc 簽章，失敗會停止；這不是 Apple 公證。封裝會從 schema 建立全新空白 baseline，不能把開發資料庫當成分享資料。`electron/project-root.cjs` 以相對位置解析，不依賴作者電腦路徑。

目前設定產出 macOS arm64；其他平台需要各自打包和驗證，不能直接把檔名改成另一種平台。

## 驗證

```sh
npm run typecheck
npm run lint
npm run build
node scripts/verify-share.mjs
```

封裝後另需檢查空白資料庫、全新使用者設定、獨立本機服務、資源與播放，並計算下載檔 SHA-256。自動 smoke 需用空資料目錄和未占用的 port，不能連到開發者現有正式服務當成通過。

## 選用工具

FFmpeg / ffprobe 供轉檔與分析。進階模型依 `scripts/setup-harmony-engine.mjs` 配置，會下載外部依賴及模型，請先閱讀其來源。`sounds:import`、`sounds:drums` 可匯入各自來源的取樣與標註；自行確認授權。

Connect、macOS service 工具屬進階配置。桌面使用者不需要執行 `service:install`；該命令會安裝登入啟動服務。不要在另一個 Music OS 正在使用相同 port 時啟動第二套服務。

## 定稿者

`SONGZU_CREATOR_NAME` 可設定正式樂譜人工定稿紀錄的名字；未設定時記為「本機創作者」。這是本機操作標記，不是實名驗證。第二人複核必須填不同的名字，仍須完成全曲逐拍確認。
