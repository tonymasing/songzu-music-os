import { SystemWorkspace } from "@/components/SystemWorkspace";
import {
  AudioLines,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Database,
  Disc3,
  FileWarning,
  GitBranch,
  HardDrive,
  Library,
  LockKeyhole,
  Music2,
  PlugZap,
  RadioTower,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Workflow
} from "lucide-react";
import Link from "next/link";
import styles from "./SystemConsole.module.css";

const systemRoles = [
  {
    href: "/inbox",
    icon: Music2,
    layer: "創作入口",
    title: "靈感收件箱",
    owns: "靈感、片段、未成形想法",
    ai: "整理成可發展的歌曲草稿",
    data: "InboxItem / MusicMaterial"
  },
  {
    href: "/songs",
    icon: Library,
    layer: "作品核心",
    title: "作品庫",
    owns: "歌曲、歌詞、版本、任務、credits",
    ai: "判斷階段與下一步",
    data: "Song / AudioFile / TimelineEvent"
  },
  {
    href: "/daw",
    icon: AudioLines,
    layer: "製作核心",
    title: "DAW Core",
    owns: "錄音設定、音軌、clip、take、mixer、非破壞性編輯",
    ai: "錄音問題、混音指令、版本比較",
    data: "DawProject / DawTrack / DawClip"
  },
  {
    href: "/sounds",
    icon: SlidersHorizontal,
    layer: "聲音材料",
    title: "音色資料庫",
    owns: "樂器、效果、年代聲音、preset、效果鏈",
    ai: "推薦音色與錄音鏈",
    data: "SoundLibraryItem / SongSoundUse"
  },
  {
    href: "/music-db",
    icon: Database,
    layer: "材料生成",
    title: "音樂資料庫",
    owns: "歌詞、和弦、情緒、用途、生成草稿",
    ai: "組合材料並落地成作品",
    data: "MusicMaterial / MusicGenerationDraft"
  },
  {
    href: "/publishing",
    icon: RadioTower,
    layer: "輸出發佈",
    title: "發佈 / 輸出",
    owns: "YouTube / IG / WAV / stems / 發佈包",
    ai: "判斷輸出缺口與文案需求",
    data: "MediaExport / PromoAsset"
  },
  {
    href: "/assistant",
    icon: Bot,
    layer: "智能總控",
    title: "AI 助理",
    owns: "跨作品策略、問答、製作總監摘要",
    ai: "統整全系統狀態",
    data: "AiSuggestion / LocalRuleEngine"
  }
];

const intelligenceLayers = [
  ["本機規則引擎", "不依賴外部 API，先用資料完整度、Audio QA、timestamp 留言與任務狀態判斷。"],
  ["製作總監", "每首歌判斷目前階段、缺口、下一步、能不能進入發行。"],
  ["錄音教練", "錄音時聚焦拍子、音準、音量、噪音、重錄區間與 take 選擇。"],
  ["聲音推薦", "從音色資料庫、樂理邏輯與歌曲用途推薦可用音色與效果鏈。"],
  ["事業策略", "從 catalog 角度挑出優先發行、需要重錄、適合分享包與需要補資料的歌。"],
  ["安全守門", "原始音檔保護、hash、Audio QA、GarageBand 匯入不覆蓋原檔。"]
];

const openCoreRows = [
  {
    title: "可以開源",
    icon: GitBranch,
    points: ["DAW Core 引擎與專案格式", ".songzu-project JSON schema", "本機規則引擎框架", "SDK / CLI / 文件", "非個人化 UI 元件"]
  },
  {
    title: "保持私有",
    icon: LockKeyhole,
    points: ["你的歌曲與音檔", "SQLite 資料庫", "uploads / exports", "個人 AI 規則與樂理偏好", "未授權音色素材與合作人資料"]
  },
  {
    title: "開源前檢查",
    icon: ShieldCheck,
    points: ["移除真實路徑與 token", "不包含受版權保護素材", "sample project 使用假資料", "文件寫清楚本機優先與非破壞性原則", "license 另行決定"]
  }
];

const operatingRules = [
  ["每個工作台只負責一種工作", "錄音回 DAW，作品資料回作品庫，素材回音色資料庫，發行回 Publishing。"],
  ["AI 只提出建議，不偷改資料", "AI 建議要能被套用、忽略、封存，重要操作要留下 timeline。"],
  ["原始音檔永遠保護", "上傳、匯入、GarageBand export 都建立新版本，不覆蓋原始檔。"],
  ["驗收與部署分開", "完成驗收不代表已部署。正式更新須協調服務、保留可回復版本，再驗證 App 與教室連線。"]
];

const nextFeatureRoadmap = [
  {
    priority: "P0",
    status: "下一階段",
    title: "Groove-aware 音訊伸縮與變調",
    detail: "伸縮、變調或套用速度時，可選擇保留 clip 的 Groove 與律動偏移。",
    acceptance: "切換保留 Groove 前後可即時預聽，Undo 後回到完全相同的原始狀態。",
    target: "DAW 錄音室",
    href: "/daw"
  },
  {
    priority: "P0",
    status: "下一階段",
    title: "節拍器強拍與量化邊界保護",
    detail: "確保循環、拍號切換及關閉量化時，小節第一拍仍準確且可清楚強調。",
    acceptance: "4/4、6/8、循環接點與量化開關皆通過第一拍不遺失的自動測試。",
    target: "DAW 錄音室",
    href: "/daw"
  },
  {
    priority: "P1",
    status: "已列入",
    title: "MIDI 控制器辨識與 Mapping Profile",
    detail: "辨識控制器型號、套用預設參數配置，並允許使用者覆寫與另存設定檔。",
    acceptance: "裝置重新連線後可恢復 mapping，未知裝置也能完成手動 Learn。",
    target: "軟體與 AI 通路",
    href: "/integrations"
  },
  {
    priority: "P1",
    status: "已列入",
    title: "版本化專案備份（含素材）",
    detail: "將工程 metadata、引用音訊與版本資訊保存為可還原的完整專案快照。",
    acceptance: "每份快照顯示建立時間、素材完整度、容量與可驗證的還原結果。",
    target: "資料維護",
    href: "/settings"
  },
  {
    priority: "P1",
    status: "已列入",
    title: "離線佇列、上傳進度與衝突提示",
    detail: "行動裝置或網路中斷時先排隊，恢復連線後續傳並清楚處理版本衝突。",
    acceptance: "中斷後可續傳，不建立重複檔案；衝突時保留兩版並交由使用者決定。",
    target: "裝置連線與安裝",
    href: "/local-app"
  },
  {
    priority: "P2",
    status: "待設計",
    title: "Plug-in 視窗集中控制",
    detail: "從工作區、快捷鍵或控制器，一鍵開關目前音軌的效果器編輯視窗。",
    acceptance: "視窗狀態與所選音軌同步，且不影響第三方 plug-in 的音訊處理。",
    target: "DAW 錄音室",
    href: "/daw"
  }
] as const;

export default function SystemPage() {
  return (
    <SystemWorkspace area="reference" current="/system"><div className={styles.workspace}>
      <header className="system-hero">
        <div className="system-hero-copy">
          <span className="eyebrow">SYSTEM / ARCHITECTURE</span>
          <h1>系統架構</h1>
          <p className="subtle">
            工作台各司其職，創作流程一目了然。本機優先，AI 建議由你決定；核心可開源，音樂與資料保持私有。
          </p>
          <div className="dashboard-actions">
            <a className="button primary" href="#roles">
              <Workflow size={16} />
              工作台分工
            </a>
            <a className="button" href="#next-features">
              <SlidersHorizontal size={16} />
              功能規劃
            </a>
            <a className="button" href="#open-core">
              <GitBranch size={16} />
              開源邊界
            </a>
          </div>
        </div>
        <div className="system-hero-board" aria-label="系統核心原則">
          <span>
            <strong>{systemRoles.length.toString().padStart(2, "0")}</strong>
            工作責任區
          </span>
          <span>
            <strong>{intelligenceLayers.length.toString().padStart(2, "0")}</strong>
            智能層
          </span>
          <span>
            <strong>開放核心</strong>
            核心可開源
          </span>
          <span>
            <strong>私人資料庫</strong>
            資料私有
          </span>
        </div>
      </header>

      <section className="section system-flow" aria-label="系統流向">
        <div>
          <span>靈感</span>
          <strong>收件箱</strong>
        </div>
        <div>
          <span>作品</span>
          <strong>作品庫</strong>
        </div>
        <div>
          <span>錄音</span>
          <strong>DAW 錄音室</strong>
        </div>
        <div>
          <span>素材</span>
          <strong>音色庫</strong>
        </div>
        <div>
          <span>智能</span>
          <strong>AI 製作總監</strong>
        </div>
        <div>
          <span>輸出</span>
          <strong>發佈輸出</strong>
        </div>
      </section>

      <section className="section" id="roles">
        <div className="section-heading">
          <div>
            <span className="eyebrow">清楚分工</span>
            <h2>系統分工地圖</h2>
          </div>
          <p className="muted">每個入口只處理自己的責任，避免作品管理、錄音、素材、發行混在一起。</p>
        </div>
        <div className="system-role-grid">
          {systemRoles.map((role, index) => {
            const Icon = role.icon;
            return (
              <Link className="system-role-row" href={role.href} key={role.href}>
                <span className="system-role-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <small>{String(index + 1).padStart(2, "0")} / {role.layer}</small>
                  <strong>{role.title}</strong>
                </span>
                <span><small>負責範圍</small>{role.owns}</span>
                <span><small>AI 協作</small>{role.ai}</span>
                <em>{role.data}</em>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section system-intelligence-layout">
        <div className="system-intel-main">
          <div className="section-heading">
            <div>
              <span className="eyebrow">智能系統</span>
              <h2>AI 智能層</h2>
            </div>
            <BrainCircuit size={22} color="var(--accent)" />
          </div>
          <div className="system-intel-grid">
            {intelligenceLayers.map(([title, detail]) => (
              <div className="system-intel-item" key={title}>
                <CheckCircle2 size={17} />
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
        <aside className="system-governance">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">運作規則</span>
              <h2>治理規則</h2>
            </div>
          </div>
          {operatingRules.map(([title, detail]) => (
            <div className="system-rule" key={title}>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          ))}
        </aside>
      </section>

      <section className="section system-roadmap" id="next-features">
        <div className="section-heading">
          <div>
            <span className="eyebrow">產品路線圖 · 2026-07</span>
            <h2>下一步功能清單</h2>
          </div>
          <p className="muted">依錄音穩定性、創作價值與跨裝置可靠度排序；每項先通過驗收條件，再進入 App 更新。</p>
        </div>
        <div className="system-roadmap-list" aria-label="建議加入 App 的功能清單">
          {nextFeatureRoadmap.map((feature, index) => (
            <Link className="system-roadmap-row" href={feature.href} key={feature.title}>
              <span className="system-roadmap-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="system-roadmap-copy">
                <span className="system-roadmap-labels">
                  <strong>{feature.title}</strong>
                  <small data-priority={feature.priority}>{feature.priority}</small>
                </span>
                <span>{feature.detail}</span>
                <em>驗收：{feature.acceptance}</em>
              </span>
              <span className="system-roadmap-target">
                <small>功能落點</small>
                <strong>{feature.target}</strong>
              </span>
              <span className="system-roadmap-status">{feature.status}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" id="open-core">
        <div className="section-heading">
          <div>
            <span className="eyebrow">開源邊界</span>
            <h2>開源邊界</h2>
          </div>
          <Link className="button" href="/local-app#install-app">
            <HardDrive size={16} />
            查看 App 更新
          </Link>
        </div>
        <div className="open-core-lanes">
          {openCoreRows.map((row) => {
            const Icon = row.icon;
            return (
              <div className="open-core-lane" key={row.title}>
                <div className="open-core-lane-head">
                  <Icon size={18} />
                  <strong>{row.title}</strong>
                </div>
                <ul>
                  {row.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section system-action-strip">
        <Link href="/daw">
          <AudioLines size={18} />
          <strong>錄音與 DAW</strong>
          <span>回到真正製作介面</span>
        </Link>
        <Link href="/assistant">
          <Bot size={18} />
          <strong>AI 指揮中心</strong>
          <span>看全作品策略</span>
        </Link>
        <Link href="/settings">
          <FileWarning size={18} />
          <strong>資料維護</strong>
          <span>檢查檔案與備份</span>
        </Link>
        <Link href="/publishing">
          <Disc3 size={18} />
          <strong>發行輸出</strong>
          <span>製作發佈素材</span>
        </Link>
        <Link href="/integrations">
          <PlugZap size={18} />
          <strong>軟體與 AI 通路</strong>
          <span>管理外部交接</span>
        </Link>
        <Link href="/pitch">
          <Send size={18} />
          <strong>分享包</strong>
          <span>對外 pitch</span>
        </Link>
      </section>
    </div></SystemWorkspace>
  );
}
