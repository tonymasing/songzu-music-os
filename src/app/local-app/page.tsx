import { SystemWorkspace } from "@/components/SystemWorkspace";
import {
  AppWindow,
  AlertTriangle,
  Cable,
  CheckCircle2,
  HardDrive,
  Laptop,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
  Terminal
} from "lucide-react";
import { existsSync, readFileSync, statSync } from "node:fs";

import { InstallAppPanel } from "@/components/InstallAppPanel";
import { LocalNetworkPanel } from "@/components/LocalNetworkPanel";
import { DeviceReadinessPanel } from "@/components/DeviceReadinessPanel";
import { MobilePairingPanel } from "@/components/MobilePairingPanel";
import { SongzuConnectPanel } from "@/components/SongzuConnectPanel";
import { appVersion } from "@/lib/app-info";
import { appAssetPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

type AppUpdateInfo = {
  appName: string;
  version: string;
  stageName: string;
  completedAt: string;
  checks: string[];
  dmgPath: string;
  dmgSizeBytes: number | null;
  dmgUpdatedAt: string | null;
};

function formatBytes(value: number | null | undefined) {
  if (!value) return "待確認";
  const mb = value / 1024 / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "待確認";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getAppUpdateInfo(): AppUpdateInfo {
  const updatePath = appAssetPath("public", "app-update.json");
  if (existsSync(updatePath)) {
    return JSON.parse(readFileSync(updatePath, "utf8")) as AppUpdateInfo;
  }

  const fallbackDmgPath = appAssetPath("dist-electron", `頌祖音樂 OS-${appVersion}-arm64.dmg`);
  const dmgStat = existsSync(fallbackDmgPath) ? statSync(fallbackDmgPath) : null;
  return {
    appName: "頌祖音樂 OS",
    version: appVersion,
    stageName: "手動建置",
    completedAt: dmgStat?.mtime.toISOString() ?? new Date().toISOString(),
    checks: ["electron:dmg"],
    dmgPath: fallbackDmgPath,
    dmgSizeBytes: dmgStat?.size ?? null,
    dmgUpdatedAt: dmgStat?.mtime.toISOString() ?? null
  };
}

const deviceRows = [
  {
    icon: Laptop,
    title: "電腦主機",
    status: "核心資料中心",
    details: "保存 SQLite 資料庫、uploads、exports、音質分析、GarageBand 交接與本機檔案。"
  },
  {
    icon: Smartphone,
    title: "手機",
    status: "外出工作入口",
    details: "同 Wi-Fi 時直接連線；外出時透過頌祖 Connect 的端對端加密通道回到 Mac 主機。"
  },
  {
    icon: TabletSmartphone,
    title: "平板",
    status: "製作工作台",
    details: "適合看歌曲頁、混音留言、音色資料庫、錄音準備清單與發行工作台。"
  }
];

const capabilityRows = [
  ["作品資料庫", "手機 / 平板 / 電腦", "可用"],
  ["音檔上傳與播放", "同 Wi-Fi 直連；外出錄音以分段加密同步", "可用"],
  ["GarageBand 操作交接", "Mac 主機", "主機限定"],
  ["ffmpeg 音質分析", "Mac 主機", "主機限定"],
  ["iPhone / iPad", "Safari 網頁 / PWA，不需要 Apple App 簽章", "可用"],
  ["Android", "Chrome 網頁 / PWA，不需要額外 APK", "可用"],
  ["首次啟動資料位置", "可選擇資料資料夾，App 會記住", "可用"],
  ["Electron DMG 安裝包", `dist-electron/頌祖音樂 OS-${appVersion}-arm64.dmg，資料不打包進 DMG`, "可用"],
  ["頌祖 Connect", "一鍵臨時 HTTPS、密文中繼、公開金鑰固定", "v2"],
  ["可信裝置配對", "短效配對碼、90 天裝置 token 與主機撤銷", "可用"]
];

export default function LocalAppPage() {
  const appUpdateInfo = getAppUpdateInfo();

  return (
    <SystemWorkspace area="devices" current="/local-app">
      <header className="dashboard-hero local-app-hero">
        <div className="stack">
          <span className="eyebrow">DEVICES / ACCESS</span>
          <h1>裝置連線與安裝</h1>
          <p className="subtle">
            先連回保存資料的主機，再依需要安裝 App。區網、外出連線與裝置配對集中在這裡；檔案備份請到資料維護。
          </p>
          <div className="dashboard-actions">
            <a className="button primary" href="#connections"><Cable size={16} />設定連線</a>
            <a className="button" href="#install-app"><MonitorSmartphone size={16} />安裝 App</a>
            <a className="button" href="/settings#backup-plan"><HardDrive size={16} />資料備份</a>
          </div>
        </div>
      </header>

      <section className="section" id="connections">
        <div className="system-subsection"><h2>裝置連線</h2><p>同 Wi-Fi → 配對裝置 → 需要時開啟外出連線。</p></div>
        <div className="system-connections"><LocalNetworkPanel /><MobilePairingPanel /><SongzuConnectPanel /></div>
        <details className="system-details"><summary>連線步驟與裝置相容性</summary>
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>使用方式</h2>
              <p className="muted">Mac 使用桌面 App；手機與平板直接用瀏覽器或加入主畫面，不再依賴 Apple 簽章。</p>
            </div>
            <HardDrive size={18} color="var(--accent)" />
          </div>
          <div className="local-step-list">
            <div>
              <strong>1</strong>
              <span>Mac / 電腦啟動頌祖音樂 OS，保留資料庫與音檔原檔。</span>
            </div>
            <div>
              <strong>2</strong>
              <span>同一個 Wi-Fi 時使用區網網址；第一次輸入 Mac 顯示的 6 位數配對碼。</span>
            </div>
            <div>
              <strong>3</strong>
              <span>外出時改用頌祖 Connect 網址，手機不需要和 Mac 在同一個 Wi-Fi。</span>
            </div>
            <div>
              <strong>4</strong>
              <span>手機錄音先保存原始 WAV，再以 1 MB 分段同步；音質分析與平台發布仍由 Mac 執行。</span>
            </div>
          </div>
        </div>
        <DeviceReadinessPanel />
        </details>
      </section>
      <section className="section local-app-grid" id="install-app">

        <InstallAppPanel />

        <details className="system-details"><summary>版本資訊與進階安裝</summary>
        <div className="install-app-panel">
          <div className="toolbar">
            <div>
              <h2>階段更新狀態</h2>
              <p className="muted">每完成一個開發階段，就同步更新本機 App、重包 DMG、做 smoke test。</p>
            </div>
            <span className="tag green">已納入流程</span>
          </div>

          <div className="install-status-grid">
            <span>
              <CheckCircle2 size={18} />
              <strong>{appUpdateInfo.stageName}</strong>
              最近階段
            </span>
            <span>
              <AppWindow size={18} />
              <strong>{appUpdateInfo.version}</strong>
              App 版本
            </span>
            <span>
              <HardDrive size={18} />
              <strong>{formatBytes(appUpdateInfo.dmgSizeBytes)}</strong>
              DMG 大小
            </span>
            <span>
              <CheckCircle2 size={18} />
              <strong>{formatDateTime(appUpdateInfo.completedAt)}</strong>
              更新時間
            </span>
          </div>

          <div className="local-command-grid">
            <div className="local-command">
              <Terminal size={17} />
              <span>
                <strong>npm run stage:update -- --stage="階段名稱"</strong>
                <small>完成階段時跑完整 App 更新流程。</small>
              </span>
            </div>
            <div className="local-command">
              <Terminal size={17} />
              <span>
                <strong>docs/stage-update-policy.md</strong>
                <small>階段更新規則與交付標準。</small>
              </span>
            </div>
            <div className="local-command">
              <ShieldCheck size={17} />
              <span>
                <strong>{appUpdateInfo.checks.includes("package:verify") ? "package:verify 已啟用" : "package:verify 待啟用"}</strong>
                <small>確認 DMG 不誤包正式資料庫、uploads、exports 或舊安裝包。</small>
              </span>
            </div>
          </div>
        </div>

        <div className="install-app-panel">
          <div className="toolbar">
            <div>
              <h2>Electron DMG 安裝包</h2>
              <p className="muted">產生真正 macOS 安裝映像檔，可拖到 Applications，開啟後自動連到這套本機音樂 OS。</p>
            </div>
            <span className="tag green">已可輸出</span>
          </div>

          <div className="install-status-grid">
            <span>
              <AppWindow size={18} />
              <strong>dist-electron/頌祖音樂 OS-{appVersion}-arm64.dmg</strong>
              DMG 安裝包
            </span>
            <span>
              <HardDrive size={18} />
              <strong>資料資料夾獨立</strong>
              首次啟動會使用或記住資料位置
            </span>
            <span>
              <Server size={18} />
              <strong>自動啟動本機服務</strong>
              App 會檢查 127.0.0.1:3000，未啟動就代為啟動
            </span>
          </div>

          <div className="local-command-grid">
            <div className="local-command">
              <Terminal size={17} />
              <span>
                <strong>npm run electron:dmg</strong>
                <small>建置 Next.js 並輸出 macOS DMG。</small>
              </span>
            </div>
            <div className="local-command">
              <Terminal size={17} />
              <span>
                <strong>npm run electron:dev</strong>
                <small>開發時用 Electron 視窗測試。</small>
              </span>
            </div>
            <div className="local-command">
              <Terminal size={17} />
              <span>
                <strong>npm run package:verify</strong>
                <small>檢查安裝包邊界與空白 baseline DB。</small>
              </span>
            </div>
          </div>
        </div>
        </details>
      </section>

      {/* Native fragment navigation can open this disclosure before React hydrates. */}
      <details className="system-details" suppressHydrationWarning><summary>安裝注意事項</summary>
        <div className="panel pad stack" id="install-safety">
          <div className="toolbar">
            <div>
              <h2>正式安裝注意事項</h2>
              <p className="muted">目前是本機開發版安裝包，先以可靠使用、資料不混包為優先。</p>
            </div>
            <AlertTriangle size={18} color="var(--warn)" />
          </div>
          <div className="local-step-list">
            <div>
              <strong>1</strong>
              <span>第一次開啟 DMG 版時，選擇或確認資料資料夾；這是你的歌曲、音檔與輸出保存位置。</span>
            </div>
            <div>
              <strong>2</strong>
              <span>如果 macOS 提醒 App 未經驗證，代表目前尚未做 Apple 簽章；可用右鍵開啟或到系統設定允許。</span>
            </div>
            <div>
              <strong>3</strong>
              <span>更新 DMG 不會自動刪除你的資料；資料資料夾與 App 安裝包是分開的。</span>
            </div>
            <div>
              <strong>4</strong>
              <span>更新 App 前可先查看設定頁的備份規劃；未來正式發佈版再補 Apple Developer ID 簽章、公證與自動更新流程。</span>
            </div>
          </div>
        </div>
      </details>

      {/* Native fragment navigation can open this disclosure before React hydrates. */}
      <details className="system-details" suppressHydrationWarning><summary>裝置分工與支援能力</summary>
      <section id="device-plan">
        <div className="toolbar">
          <div>
            <h2>裝置分工</h2>
            <p className="muted">先把邏輯分清楚，後面才不會把音檔、GarageBand、手機操作混在一起。</p>
          </div>
          <Cable size={18} color="var(--accent)" />
        </div>
        <div className="device-plan-grid">
          {deviceRows.map((item) => {
            const Icon = item.icon;
            return (
              <article className="device-plan-card" key={item.title}>
                <Icon size={22} color="var(--accent)" />
                <span className="tag green">{item.status}</span>
                <h2>{item.title}</h2>
                <p className="muted">{item.details}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>能力矩陣</h2>
              <p className="muted">哪些功能跨裝置可用，哪些要留在主機端。</p>
            </div>
            <CheckCircle2 size={18} color="var(--accent)" />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>功能</th>
                  <th>裝置範圍</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {capabilityRows.map(([feature, scope, status]) => (
                  <tr key={feature}>
                    <td>
                      <strong>{feature}</strong>
                    </td>
                    <td>{scope}</td>
                    <td>
                      <span className={status === "可用" ? "tag green" : status === "主機限定" ? "tag warn" : "tag"}>{status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      </details>
    </SystemWorkspace>
  );
}
