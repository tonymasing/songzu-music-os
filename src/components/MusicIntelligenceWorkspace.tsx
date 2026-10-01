"use client";

import {
  Activity,
  AudioWaveform,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleMinus,
  Cpu,
  Database,
  Download,
  GitBranch,
  GitCompareArrows,
  HardDrive,
  History,
  LibraryBig,
  MemoryStick,
  LoaderCircle,
  Network,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  WandSparkles,
  Workflow,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { HarmonyControlPlane } from "@/lib/harmony-control-plane";

type Engine = {
  id: string;
  label: string;
  available: boolean;
  mode: "built_in" | "optional";
  role: "orchestrator" | "core" | "evidence" | "separation" | "experimental" | "feature";
  stage: string;
  connected: boolean;
  path: string | null;
  purpose: string;
  note: string;
};

type SongOption = {
  id: string;
  title: string;
  status: string;
  bpm: number | null;
  musicalKey: string | null;
  genre: string | null;
  audioFiles: Array<{ id: string; fileName: string; fileType: string; qualityStatus: string; filePath: string | null; durationSeconds: number | null }>;
  dawProjects: Array<{ id: string; title: string; bpm: number | null; engineMode: string }>;
  rightsProfile: RightsProfile | null;
  credits: Array<{
    id: string;
    role: string;
    splitPercentage: number | null;
    publishingSplit: number | null;
    masterSplit: number | null;
    contributor: { id: string; name: string; ipi: string | null; isni: string | null; proAffiliation: string | null };
    confirmations: Array<{ status: string }>;
  }>;
  releaseTracks: Array<{ id: string; isrc: string | null; release: { id: string; title: string; upc: string | null; status: string } }>;
};
type RightsProfile = {
  id: string;
  songId: string;
  alternateTitle: string | null;
  iswc: string | null;
  language: string;
  territory: string;
  publisher: string | null;
  proAffiliation: string | null;
  masterOwner: string | null;
  publishingOwner: string | null;
  oneStopClearance: boolean;
  masterControlled: boolean;
  publishingControlled: boolean;
  recordingLocation: string | null;
  notes: string | null;
};
type AudioJob = {
  id: string;
  songId: string | null;
  jobType: string;
  target: string | null;
  engine: string;
  status: string;
  progress: number;
  resultJson: string | null;
  errorMessage: string | null;
  createdAt: string;
  song: { id: string; title: string } | null;
  audioFile: { id: string; fileName: string; fileType: string } | null;
};
type Plugin = { id: string; name: string; format: string; vendor: string | null; status: string; validationStatus: string; quarantined: boolean; filePath: string };
type EffectChain = { id: string; name: string; category: string; description: string | null; stepsJson: string; tagsJson: string | null; favorite: boolean };
type WorkflowItem = { id: string; code: string; name: string; description: string | null; category: string; stepsJson: string; riskLevel: string };
type AutomationRun = { id: string; status: string; createdAt: string; workflow: WorkflowItem; song: { id: string; title: string } | null; previewJson: string | null; resultJson: string | null; errorMessage: string | null };
type CatalogMatch = { id: string; score: number; rightsStatus: string; status: string; reasonsJson: string | null; blockersJson: string | null; song: { id: string; title: string; genre: string | null; bpm: number | null } };
type CatalogBrief = { id: string; title: string; query: string; useCase: string; status: string; matches: CatalogMatch[] };
type SongInsight = { song: { id: string; title: string; genre: string | null; status: string }; views: number; plays: number; claims: number; engagementRate: number; conversionRate: number; revenue: number; recommendations: string[] };
type DawSummary = {
  id: string;
  song: { id: string; title: string };
  title: string;
  bpm: number | null;
  engineMode: string;
  tracks: number;
  clips: number;
  takeLanes: number;
  compRanges: number;
  markers: number;
  scoreDrafts: number;
  tempoMap: unknown[];
  latencyProfile: unknown;
  intelligenceImports: number;
  capabilities: { nonDestructiveEditing: boolean; takeComping: boolean; punchRecording: boolean; latencyCompensation: boolean; tempoMapApplied: boolean };
};
type Overview = {
  generatedAt: string;
  version: string;
  graph: { nodes: number; edges: number; byType: Array<{ type: string; count: number }>; recent: Array<{ id: string; nodeType: string; label: string; songId: string | null }> };
  engines: Engine[];
  harmonyControl: HarmonyControlPlane;
  jobs: AudioJob[];
  plugins: { plugins: Plugin[]; chains: EffectChain[]; counts: { total: number; available: number; untested: number; quarantined: number }; safety: string };
  automation: { workflows: WorkflowItem[]; runs: AutomationRun[]; counts: { proposed: number; completed: number; failed: number; rolledBack: number } };
  business: {
    briefs: CatalogBrief[];
    rights: Array<RightsProfile & { song: { id: string; title: string; credits: Array<{ publishingSplit: number | null; splitPercentage: number | null }> } }>;
    exports: Array<{ id: string; format: string; fileName: string; validationStatus: string; createdAt: string; song: { id: string; title: string } | null }>;
    metrics: Array<{ id: string; provider: string; views: number; likes: number; comments: number; shares: number; estimatedRevenue: number; periodEnd: string; song: { id: string; title: string } | null }>;
    songInsights: SongInsight[];
    totals: { views: number; watchMinutes: number; previewPlays: number; claims: number; revenue: number; rightsReady: number };
  };
  daw: { projects: DawSummary[] };
  songs: SongOption[];
  principles: string[];
};
type SearchResult = { id: string; nodeType: string; label: string; summary: string | null; songId: string | null; score: number; matchedTokens: string[]; connections: Array<{ direction: string; relation: string; weight: number; node: { id: string; nodeType: string; label: string; songId: string | null } }> };
type ActiveTab = "overview" | "graph" | "audio" | "daw" | "plugins" | "automation" | "catalog" | "rights" | "analytics";

const tabs: Array<{ id: ActiveTab; label: string; icon: typeof Network }> = [
  { id: "overview", label: "總覽", icon: Sparkles },
  { id: "graph", label: "知識圖譜", icon: Network },
  { id: "audio", label: "本機聽覺", icon: AudioWaveform },
  { id: "daw", label: "DAW 成熟度", icon: SlidersHorizontal },
  { id: "plugins", label: "插件與效果", icon: PlugZap },
  { id: "automation", label: "視覺自動化", icon: Workflow },
  { id: "catalog", label: "Catalog 配對", icon: LibraryBig },
  { id: "rights", label: "權利與交付", icon: ShieldCheck },
  { id: "analytics", label: "成效回饋", icon: Activity }
];

const jobLabels: Record<string, string> = { DEEP_ANALYSIS: "深度音訊分析", TRANSCRIPTION: "自動採譜", STEM_SEPARATION: "Stem 分軌" };
const statusLabels: Record<string, string> = { COMPLETED: "完成", RUNNING: "執行中", QUEUED: "排隊", FAILED: "失敗", NEEDS_ENGINE: "需要引擎", PROPOSED: "待核准", ROLLED_BACK: "已回復" };

function parseStrings(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function splitInput(value: string) {
  return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function StatusTag({ status }: { status: string }) {
  const good = ["COMPLETED", "DISCOVERED", "REVIEW_READY", "STRONG_MATCH"].includes(status);
  const danger = ["FAILED", "QUARANTINED", "INCOMPLETE"].includes(status);
  return <span className={`tag ${good ? "green" : danger ? "danger" : "warn"}`}>{statusLabels[status] || status}</span>;
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "--" : `${Math.round(value * 100)}%`;
}

function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  if (value < 1_000) return `${Math.round(value)} ms`;
  const seconds = value / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function pipelineTone(status: string) {
  if (["success", "pass", "passed", "active"].includes(status)) return "healthy";
  if (["failed", "fail"].includes(status)) return "failed";
  if (["degraded", "review", "rollback"].includes(status)) return "degraded";
  return "idle";
}

function pipelineStatusLabel(status: string) {
  const labels: Record<string, string> = {
    success: "成功",
    passed: "通過",
    pass: "通過",
    review: "需複核",
    degraded: "降級",
    failed: "失敗",
    running: "執行中",
    pending: "尚未執行",
    skipped: "本次略過",
    idle: "尚無工作",
    active: "目前使用",
    rollback: "回滾點",
    archived: "歷史版本"
  };
  return labels[status] || status;
}

function BooleanState({ value, yes, no, idle = "無本次資料", optional = false }: {
  value: boolean | null;
  yes: string;
  no: string;
  idle?: string;
  optional?: boolean;
}) {
  const tone = value === true ? "healthy" : value === false ? optional ? "degraded" : "failed" : "idle";
  const Icon = value === true ? CheckCircle2 : value === false ? optional ? CircleAlert : XCircle : CircleMinus;
  return <span className={`engine-state ${tone}`}><Icon size={13} /><b>{value === true ? yes : value === false ? no : idle}</b></span>;
}

function PipelineFlow({ control, compact = false }: { control: HarmonyControlPlane; compact?: boolean }) {
  return (
    <ol className={`harmony-pipeline-flow${compact ? " compact" : ""}`} aria-label="採譜主管線流程">
      {control.stages.map((stage, index) => {
        const tone = pipelineTone(stage.status);
        const Icon = tone === "healthy" ? CheckCircle2 : tone === "failed" ? XCircle : tone === "degraded" ? CircleAlert : CircleMinus;
        return <li className={tone} key={stage.id} title={stage.error || stage.detail || stage.label}>
          <span className="pipeline-step-index">{String(index + 1).padStart(2, "0")}</span>
          <span><strong>{stage.label}</strong>{compact ? null : <small>{pipelineStatusLabel(stage.status)}{stage.durationMs !== null ? ` · ${formatDurationMs(stage.durationMs)}` : ""}</small>}</span>
          <Icon size={15} />
        </li>;
      })}
    </ol>
  );
}

function HarmonyControlOverview({ control }: { control: HarmonyControlPlane }) {
  const run = control.latestRun;
  const highConfidence = control.keyResults.highConfidenceBeatCount;
  const beatCount = control.keyResults.beatCount;
  return (
    <div className="harmony-overview-panel">
      <div className="harmony-overview-heading">
        <div><span className="eyebrow">本機採譜</span><h2>高精細採譜主管線 v12</h2></div>
        <span className={`pipeline-health ${pipelineTone(control.health)}`}>{pipelineStatusLabel(control.health)}</span>
      </div>
      <PipelineFlow control={control} compact />
      <div className="harmony-overview-results">
        <span><small>根音證據</small><strong>{formatPercent(control.keyResults.rootConfidence)}</strong></span>
        <span><small>和弦性質</small><strong>{formatPercent(control.keyResults.qualityConfidence)}</strong></span>
        <span><small>衝突拍</small><strong>{control.keyResults.conflictBeatCount ?? "--"}</strong></span>
        <span><small>高可信拍</small><strong>{highConfidence === null || beatCount === null ? "--" : `${highConfidence}/${beatCount}`}</strong></span>
      </div>
      <p>{run ? `${run.songTitle} · ${formatDurationMs(run.durationMs)} · ${formatDate(run.completedAt || run.startedAt)}` : "尚未執行新版主管線；第一次分析後會顯示真實參與與品質資料。"}</p>
    </div>
  );
}

function EngineRegistry({ control }: { control: HarmonyControlPlane }) {
  return (
    <section className="panel pad harmony-engine-registry">
      <div className="section-heading"><div><span className="eyebrow">引擎登錄</span><h2>安裝與本次執行分開判讀</h2></div><Database size={19} /></div>
      <div className="engine-state-head" aria-hidden="true"><span>引擎</span><span>已安裝</span><span>已接入</span><span>本次參與</span><span>品質檢查</span><span /></div>
      {control.engineGroups.map((group) => group.engines.length ? <section className="engine-group" key={group.id}>
        <h3>{group.label}<small>{group.engines.length}</small></h3>
        {group.engines.map((engine) => <details className="engine-control-row" key={engine.id}>
          <summary>
            <span className="engine-identity"><strong>{engine.label}</strong><small>{engine.stage} · {engine.version}</small></span>
            <BooleanState value={engine.states.installed} yes="已安裝" no="未安裝" optional={engine.mode === "optional"} />
            <BooleanState value={engine.states.connected} yes="已接入" no="未接入" optional={engine.role === "experimental" || engine.mode === "optional"} />
            <BooleanState value={engine.states.participated} yes="有參與" no="未參與" idle="尚無工作" optional />
            <BooleanState value={engine.states.qualityPassed} yes="已通過" no="未通過" idle="無結果" optional={!engine.states.participated} />
            <ChevronDown className="engine-row-chevron" size={16} />
          </summary>
          <div className="engine-control-details">
            <div><span>用途</span><p>{engine.purpose}</p></div>
            <div><span>目前說明</span><p>{engine.latest?.detail || engine.note}</p></div>
            <div><span>路徑</span><code>{engine.path || "未安裝"}</code></div>
            <div><span>參數</span><p>{engine.parameters.join(" · ") || "沒有可調參數"}</p></div>
            <div><span>本次耗時 / 快取</span><p>{engine.latest ? `${formatDurationMs(engine.latest.durationMs)} · ${engine.latest.cacheHits} hit / ${engine.latest.cacheMisses} miss` : "尚無本次資料"}</p></div>
            <div><span>最近錯誤</span><p className={engine.lastError ? "danger-text" : ""}>{engine.lastError || "無"}</p></div>
          </div>
        </details>)}
      </section> : null)}
    </section>
  );
}

function HarmonyRunConsole({ control }: { control: HarmonyControlPlane }) {
  const run = control.latestRun;
  const resources = control.resources.current;
  const latestResources = control.resources.latestRun;
  return (
    <section className="panel pad harmony-run-console">
      <div className="harmony-run-header">
        <div><span className="eyebrow">主管線執行</span><h2>{run?.songTitle || "尚無新版執行紀錄"}</h2><p>{run ? `${run.audioFileName} · ${jobLabels[run.jobType] || run.jobType}` : "執行一次採譜後，這裡會留下完整的階段與品質證據。"}</p></div>
        <div className="harmony-run-status"><span className={`pipeline-health ${pipelineTone(run?.status || "idle")}`}>{pipelineStatusLabel(run?.status || "idle")}</span><strong>{formatDurationMs(run?.durationMs)}</strong><small>{run ? formatDate(run.completedAt || run.startedAt) : "--"}</small></div>
      </div>
      {run?.errorReason ? <div className="pipeline-error"><CircleAlert size={15} /><span>{run.errorReason}</span></div> : null}
      <PipelineFlow control={control} />
      <div className="harmony-result-grid">
        <div><span>根音證據</span><strong>{formatPercent(control.keyResults.rootConfidence)}</strong><small>Bass 與跨家族根音共識</small></div>
        <div><span>和弦性質證據</span><strong>{formatPercent(control.keyResults.qualityConfidence)}</strong><small>吉他、鍵盤與音符覆蓋</small></div>
        <div><span>衝突拍數</span><strong>{control.keyResults.conflictBeatCount ?? "--"}</strong><small>需要逐拍複核</small></div>
        <div><span>高可信拍數</span><strong>{control.keyResults.highConfidenceBeatCount === null || control.keyResults.beatCount === null ? "--" : `${control.keyResults.highConfidenceBeatCount}/${control.keyResults.beatCount}`}</strong><small>拍點穩定且至少兩家族同意</small></div>
      </div>
      <div className="harmony-resource-strip">
        <span><Cpu size={16} /><small>CPU</small><strong>{resources.cpuLoadPercent}%</strong></span>
        <span><MemoryStick size={16} /><small>記憶體</small><strong>{resources.processMemoryMb} MB</strong></span>
        <span><HardDrive size={16} /><small>模型裝置</small><strong>{resources.modelDevice}</strong></span>
        <span><Database size={16} /><small>快取命中</small><strong>{latestResources?.cacheHitRate === null || latestResources?.cacheHitRate === undefined ? "--" : formatPercent(latestResources.cacheHitRate)}</strong></span>
        <span><TimerReset size={16} /><small>安全上限</small><strong>{latestResources ? `${Math.round(latestResources.guard.maxRuntimeMs / 60_000)} 分` : "20 分"}</strong></span>
      </div>
    </section>
  );
}

function BenchmarkConsole({ control }: { control: HarmonyControlPlane }) {
  const benchmark = control.benchmark;
  const metrics = [
    ["根音", benchmark.metrics.root],
    ["和弦性質", benchmark.metrics.quality],
    ["轉位", benchmark.metrics.inversion],
    ["N.C.", benchmark.metrics.noChord],
    ["換弦拍點", benchmark.metrics.boundary]
  ] as const;
  return (
    <section className="panel pad harmony-benchmark-console">
      <div className="section-heading"><div><span className="eyebrow">人工確認譜 Benchmark</span><h2>分項準確度，不用模糊總分</h2><p>{benchmark.benchmarkedSongCount} 首可比較 · {benchmark.totalBeats} 拍；另有 {benchmark.awaitingComparableBaselineCount} 首舊正式譜缺少升級前基準。</p></div><GitCompareArrows size={19} /></div>
      <div className="benchmark-metrics">
        {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatPercent(value.accuracy)}</strong><small>{value.correct}/{value.total || 0} 拍</small></div>)}
      </div>
      <div className="reliability-table">
        <div className="reliability-head"><span>引擎</span><span>根音</span><span>性質</span><span>樣本</span><span>自動權重</span></div>
        {benchmark.engines.length ? benchmark.engines.map((engine) => <div key={engine.engineId}>
          <span><strong>{engine.engineId}</strong><small>{engine.bestContext ? `較佳：${engine.bestContext.label}` : "尚無足夠情境樣本"}{engine.riskContext && engine.riskContext.label !== engine.bestContext?.label ? ` · 風險：${engine.riskContext.label}` : ""}</small></span>
          <b>{formatPercent(engine.root.accuracy)}</b><b>{formatPercent(engine.quality.accuracy)}</b><b>{engine.sampleCount}</b><b className={engine.automaticWeight < 0.95 ? "degraded-text" : engine.automaticWeight > 1.05 ? "healthy-text" : ""}>{engine.automaticWeight.toFixed(3)}×</b>
        </div>) : <p className="empty compact">新版基準從下一首人工定稿開始累積；舊譜不會被偽造成可比較樣本。</p>}
      </div>
    </section>
  );
}

function PipelineVersions({ control }: { control: HarmonyControlPlane }) {
  return (
    <section className="panel pad harmony-version-console">
      <div className="section-heading"><div><span className="eyebrow">版本與回滾</span><h2>每次升級都有可比較基準</h2></div><History size={19} /></div>
      <div className="pipeline-version-list">
        {control.versions.map((version) => <details key={version.version} open={version.status === "active"}>
          <summary><span><strong>{version.version}</strong><small>{version.parameterProfile}</small></span><span className={`pipeline-health ${pipelineTone(version.status)}`}>{pipelineStatusLabel(version.status)}</span><ChevronDown size={15} /></summary>
          <div>
            <p>{version.rollbackMode || "目前正式主管線；新工作保存完整參數雜湊與結果。"}</p>
            <dl><div><dt>參數雜湊</dt><dd><code>{version.parameterHash?.slice(0, 16) || "歷史唯讀"}</code></dd></div><div><dt>Benchmark</dt><dd>{version.benchmark ? `${version.benchmark.songCount} 首 · 根音 ${formatPercent(version.benchmark.metrics.root.accuracy)} · 性質 ${formatPercent(version.benchmark.metrics.quality.accuracy)}` : "尚無可比較樣本"}</dd></div></dl>
          </div>
        </details>)}
      </div>
    </section>
  );
}

export function MusicIntelligenceWorkspace() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [busy, setBusy] = useState<string | null>("initial");
  const [notice, setNotice] = useState<{ tone: "good" | "danger"; text: string } | null>(null);
  const [selectedSongId, setSelectedSongId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [audioFileId, setAudioFileId] = useState("");
  const [jobType, setJobType] = useState<"DEEP_ANALYSIS" | "TRANSCRIPTION" | "STEM_SEPARATION">("DEEP_ANALYSIS");
  const [scoreTarget, setScoreTarget] = useState<"guitar" | "piano" | "drums">("piano");
  const [effectForm, setEffectForm] = useState({ name: "", category: "vocal" });
  const [briefForm, setBriefForm] = useState({ title: "", useCase: "影像配樂", query: "", moods: "", instruments: "", genres: "", bpmMin: "", bpmMax: "", allowVocals: true, requiredRights: "one_stop_preferred" });
  const [rightsForm, setRightsForm] = useState({ alternateTitle: "", iswc: "", language: "zh-TW", territory: "Worldwide", publisher: "", proAffiliation: "", masterOwner: "", publishingOwner: "", recordingLocation: "", notes: "", oneStopClearance: false, masterControlled: true, publishingControlled: true });
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const [metricForm, setMetricForm] = useState({ provider: "youtube", periodStart: monthStart, periodEnd: today, views: "0", engagedViews: "0", watchMinutes: "0", likes: "0", comments: "0", shares: "0", subscribersGained: "0", estimatedRevenue: "0" });
  const [latencyForm, setLatencyForm] = useState({ measuredRoundTripMs: "0", inputCompensationMs: "0", monitoringMode: "direct" as "direct" | "software" | "off" });

  async function refresh(showBusy = true) {
    if (showBusy) setBusy("refresh");
    try {
      const response = await fetch("/api/music-intelligence", { cache: "no-store" });
      const data = await response.json() as Overview & { error?: string };
      if (!response.ok) throw new Error(data.error || "讀取失敗");
      setOverview(data);
      setSelectedSongId((current) => current || data.songs[0]?.id || "");
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "音樂智慧核心讀取失敗" });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const selectedSong = useMemo(() => overview?.songs.find((song) => song.id === selectedSongId) ?? null, [overview, selectedSongId]);
  useEffect(() => {
    const profile = selectedSong?.rightsProfile;
    setRightsForm({
      alternateTitle: profile?.alternateTitle || "",
      iswc: profile?.iswc || "",
      language: profile?.language || "zh-TW",
      territory: profile?.territory || "Worldwide",
      publisher: profile?.publisher || "",
      proAffiliation: profile?.proAffiliation || "",
      masterOwner: profile?.masterOwner || "",
      publishingOwner: profile?.publishingOwner || "",
      recordingLocation: profile?.recordingLocation || "",
      notes: profile?.notes || "",
      oneStopClearance: profile?.oneStopClearance || false,
      masterControlled: profile?.masterControlled ?? true,
      publishingControlled: profile?.publishingControlled ?? true
    });
    setAudioFileId(selectedSong?.audioFiles[0]?.id || "");
  }, [selectedSong]);

  async function command(key: string, payload: Record<string, unknown>, success: string, reload = true) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch("/api/music-intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "執行失敗");
      setNotice({ tone: "good", text: success });
      if (reload) await refresh(false);
      return data;
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "執行失敗" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function searchGraph() {
    if (!searchQuery.trim()) return;
    setBusy("search");
    try {
      const response = await fetch(`/api/music-intelligence?q=${encodeURIComponent(searchQuery)}`, { cache: "no-store" });
      const data = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "搜尋失敗");
      setSearchResults(data.results ?? []);
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "搜尋失敗" });
    } finally {
      setBusy(null);
    }
  }

  if (!overview) {
    return <section className="intelligence-loading"><LoaderCircle className="spin" size={28} /><strong>正在整理音樂智慧核心</strong><span>讀取作品、音檔、權利與本機引擎。</span></section>;
  }

  const strongMatches = overview.business.briefs.flatMap((brief) => brief.matches).filter((match) => match.score >= 65).length;
  const harmonyControl = overview.harmonyControl;

  return (
    <div className="intelligence-workspace">
      <header className="intelligence-hero">
        <div>
          <span className="eyebrow">頌祖音樂智慧核心 v{overview.version}</span>
          <h1>把作品、聲音、權利與市場變成同一套決策系統。</h1>
          <p>所有音訊預設留在本機；衍生索引可重建；自動化需核准；原始音檔不被覆蓋。</p>
        </div>
        <div className="intelligence-hero-status">
          <span><Network size={17} /><b>{overview.graph.nodes}</b><small>知識節點</small></span>
          <span><AudioWaveform size={17} /><b>{pipelineStatusLabel(harmonyControl?.health || "idle")}</b><small>採譜主管線</small></span>
          <span><ShieldCheck size={17} /><b>{overview.business.totals.rightsReady}</b><small>權利就緒</small></span>
          <button className="icon-button" type="button" title="重新整理" onClick={() => void refresh()} disabled={Boolean(busy)}><RefreshCw size={17} /></button>
        </div>
      </header>

      {notice ? <div className={`intelligence-notice ${notice.tone}`} role="status">{notice.tone === "good" ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}<span>{notice.text}</span></div> : null}

      <nav className="intelligence-tabs" aria-label="音樂智慧功能">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}><Icon size={16} />{label}</button>)}
      </nav>

      {activeTab === "overview" ? (
        <div className="intelligence-section-stack">
          <section className="intelligence-metrics">
            <button type="button" onClick={() => setActiveTab("graph")}><Network size={19} /><span>知識關聯</span><strong>{overview.graph.edges}</strong><small>{overview.graph.nodes} 個節點</small></button>
            <button type="button" onClick={() => setActiveTab("audio")}><AudioWaveform size={19} /><span>分析工作</span><strong>{overview.jobs.length}</strong><small>{overview.jobs.filter((job) => job.status === "COMPLETED").length} 已完成</small></button>
            <button type="button" onClick={() => setActiveTab("plugins")}><PlugZap size={19} /><span>可用插件</span><strong>{overview.plugins.counts.available}</strong><small>{overview.plugins.chains.length} 組效果鏈</small></button>
            <button type="button" onClick={() => setActiveTab("automation")}><Workflow size={19} /><span>待核准流程</span><strong>{overview.automation.counts.proposed}</strong><small>{overview.automation.counts.completed} 已完成</small></button>
            <button type="button" onClick={() => setActiveTab("catalog")}><ScanSearch size={19} /><span>強配對</span><strong>{strongMatches}</strong><small>{overview.business.briefs.length} 份需求</small></button>
            <button type="button" onClick={() => setActiveTab("analytics")}><Activity size={19} /><span>試聽播放</span><strong>{overview.business.totals.previewPlays}</strong><small>{overview.business.totals.claims} 次認領</small></button>
          </section>
          <section className="intelligence-overview-grid">
            <div className="panel pad intelligence-principles">
              <div className="section-heading"><div><span className="eyebrow">核心邊界</span><h2>不犧牲作品安全換取智能</h2></div><ShieldCheck size={20} /></div>
              {overview.principles.map((principle, index) => <div key={principle}><b>{String(index + 1).padStart(2, "0")}</b><span>{principle}</span></div>)}
            </div>
            <div className="panel pad">{harmonyControl ? <HarmonyControlOverview control={harmonyControl} /> : <div className="empty">主管線資料正在升級，重新整理後會自動接回。</div>}</div>
          </section>
        </div>
      ) : null}

      {activeTab === "graph" ? (
        <section className="intelligence-section-stack">
          <div className="intelligence-toolbar panel pad">
            <div><span className="eyebrow">個人音樂知識圖譜</span><h2>從整個作品庫找關聯，不只找檔名</h2><p>可搜尋歌詞、情緒、曲風、調性、素材、音色、合作人與樂理規則。</p></div>
            <button className="button" type="button" disabled={busy === "graph"} onClick={() => void command("graph", { action: "rebuild_graph" }, "知識圖譜已從原始資料重建。")}>{busy === "graph" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}重建索引</button>
          </div>
          <div className="intelligence-searchbar"><Search size={18} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchGraph(); }} placeholder="例如：溫暖敬拜、雨後、G 大調、木吉他、適合短片" /><button className="button primary" type="button" disabled={busy === "search" || !searchQuery.trim()} onClick={() => void searchGraph()}>搜尋</button></div>
          <div className="intelligence-graph-layout">
            <div className="panel pad">
              <div className="section-heading"><div><span className="eyebrow">搜尋結果</span><h2>{searchResults.length ? `${searchResults.length} 個關聯` : "輸入想找的聲音或用途"}</h2></div></div>
              <div className="knowledge-results">{searchResults.length ? searchResults.map((result) => <article key={result.id}><div><span className="tag">{result.nodeType}</span><strong>{result.label}</strong><b>{result.score}</b></div>{result.summary ? <p>{result.summary}</p> : null}<small>命中：{result.matchedTokens.slice(0, 5).join("、") || "關聯節點"}</small><div className="knowledge-connections">{result.connections.slice(0, 4).map((connection) => <span key={`${connection.relation}-${connection.node.id}`}>{connection.relation} · {connection.node.label}</span>)}</div>{result.songId ? <Link href={`/songs/${result.songId}`}>打開作品 <ChevronRight size={14} /></Link> : null}</article>) : <div className="empty">搜尋結果會把歌曲與相鄰素材一起列出。</div>}</div>
            </div>
            <aside className="panel pad"><div className="section-heading"><div><span className="eyebrow">圖譜組成</span><h2>{overview.graph.nodes} 節點</h2></div></div><div className="graph-types">{overview.graph.byType.map((item) => <div key={item.type}><span>{item.type}</span><strong>{item.count}</strong><i style={{ width: `${Math.max(8, item.count / Math.max(1, overview.graph.nodes) * 100)}%` }} /></div>)}</div></aside>
          </div>
        </section>
      ) : null}

      {activeTab === "audio" ? (
        <section className="intelligence-section-stack">
          <div className="panel pad intelligence-action-console">
            <div><span className="eyebrow">本機聽覺智能</span><h2>讀取音檔、留下分析，不碰原始內容</h2><p>深度分析、採譜可直接使用；Stem 在本機模型可用時才會執行。</p></div>
            <div className="field-row intelligence-form-grid">
              <label className="field"><span>作品</span><select value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)}>{overview.songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>
              <label className="field"><span>音檔</span><select value={audioFileId} onChange={(event) => setAudioFileId(event.target.value)}>{selectedSong?.audioFiles.map((file) => <option key={file.id} value={file.id}>{file.fileName} · {file.fileType}</option>)}</select></label>
              <label className="field"><span>工作</span><select value={jobType} onChange={(event) => setJobType(event.target.value as typeof jobType)}><option value="DEEP_ANALYSIS">深度音訊分析</option><option value="TRANSCRIPTION">自動採譜</option><option value="STEM_SEPARATION">Stem 分軌</option></select></label>
              <label className="field"><span>目標</span><select value={scoreTarget} onChange={(event) => setScoreTarget(event.target.value as typeof scoreTarget)} disabled={jobType === "STEM_SEPARATION"}><option value="piano">鋼琴</option><option value="guitar">吉他</option><option value="drums">鼓手</option></select></label>
            </div>
            <button className="button primary" type="button" disabled={!audioFileId || busy === "audio-job"} onClick={() => void command("audio-job", { action: "run_audio_job", audioFileId, jobType, target: scoreTarget }, jobType === "STEM_SEPARATION" ? "Stem 工作已建立，系統已回報本機引擎狀態。" : "本機分析完成，結果已寫入作品。")}>{busy === "audio-job" ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}執行本機工作</button>
          </div>
          {harmonyControl ? <>
            <HarmonyRunConsole control={harmonyControl} />
            <EngineRegistry control={harmonyControl} />
            <div className="harmony-audit-layout">
              <BenchmarkConsole control={harmonyControl} />
              <PipelineVersions control={harmonyControl} />
            </div>
          </> : <div className="panel pad empty">主管線資料正在升級，重新整理後會自動接回。</div>}
          <section className="panel pad"><div className="section-heading"><div><span className="eyebrow">最近工作</span><h2>分析佇列</h2></div></div><div className="job-list">{overview.jobs.length ? overview.jobs.slice(0, 12).map((job) => <article key={job.id}><span><strong>{jobLabels[job.jobType] || job.jobType}</strong><small>{job.song?.title || "未綁定作品"} · {job.audioFile?.fileName || "音檔已移除"}</small></span><span><StatusTag status={job.status} /><small>{formatDate(job.createdAt)}</small></span>{job.errorMessage ? <p>{job.errorMessage}</p> : null}</article>) : <div className="empty">尚未執行深度分析。</div>}</div></section>
        </section>
      ) : null}

      {activeTab === "daw" ? (
        <section className="intelligence-section-stack">
          <div className="intelligence-toolbar panel pad"><div><span className="eyebrow">成熟錄音與剪輯</span><h2>Comp、定點重錄、延遲補償與 Tempo Map</h2><p>這裡管理 DAW 能力狀態；實際音軌編輯仍在獨立錄音室。</p></div><Link className="button primary" href="/daw"><AudioWaveform size={16} />進入 DAW 錄音室</Link></div>
          <div className="daw-capability-list">{overview.daw.projects.length ? overview.daw.projects.map((project) => {
            const matchingJobs = overview.jobs.filter((job) => job.songId === project.song.id && job.status === "COMPLETED" && job.jobType === "DEEP_ANALYSIS");
            return <article className="panel pad" key={project.id}><div className="section-heading"><div><span className="eyebrow">{project.engineMode}</span><h2>{project.song.title}</h2></div><Link className="icon-button" href={`/songs/${project.song.id}/daw`} aria-label="打開 DAW"><ChevronRight size={18} /></Link></div><div className="daw-stats"><span><b>{project.tracks}</b> 音軌</span><span><b>{project.clips}</b> 片段</span><span><b>{project.takeLanes}</b> Takes</span><span><b>{project.compRanges}</b> Comp 區間</span><span><b>{project.scoreDrafts}</b> 草譜</span></div><div className="capability-checks"><span className="ready">非破壞剪輯</span><span className="ready">Take comping</span><span className="ready">Punch-in</span><span className={project.capabilities.latencyCompensation ? "ready" : "pending"}>延遲設定</span><span className={project.capabilities.tempoMapApplied ? "ready" : "pending"}>Tempo Map</span></div>{matchingJobs[0] ? <button className="button" type="button" disabled={busy === `apply-${project.id}`} onClick={() => void command(`apply-${project.id}`, { action: "apply_daw_analysis", jobId: matchingJobs[0].id, projectId: project.id, applyTempo: true, createMarker: true }, "節奏分析已非破壞性套用到 DAW 專案。")}>套用最近 BPM 分析</button> : <p className="empty compact">先在「本機聽覺」執行深度分析，即可套用 Tempo Map。</p>}</article>;
          }) : <div className="panel pad empty">尚未建立 DAW 專案。</div>}</div>
          {overview.daw.projects[0] ? <div className="panel pad latency-console"><div><span className="eyebrow">延遲校正</span><h2>保存目前設備的錄音補償</h2><p>數值只寫入專案 metadata，不會移動已錄原檔。</p></div><div className="field-row three"><label className="field"><span>Round-trip ms</span><input type="number" min="0" max="1000" step="0.1" value={latencyForm.measuredRoundTripMs} onChange={(event) => setLatencyForm({ ...latencyForm, measuredRoundTripMs: event.target.value })} /></label><label className="field"><span>輸入補償 ms</span><input type="number" min="-1000" max="1000" step="0.1" value={latencyForm.inputCompensationMs} onChange={(event) => setLatencyForm({ ...latencyForm, inputCompensationMs: event.target.value })} /></label><label className="field"><span>監聽</span><select value={latencyForm.monitoringMode} onChange={(event) => setLatencyForm({ ...latencyForm, monitoringMode: event.target.value as typeof latencyForm.monitoringMode })}><option value="direct">介面直接監聽</option><option value="software">軟體監聽</option><option value="off">關閉</option></select></label></div><button className="button primary" type="button" onClick={() => void command("latency", { action: "save_latency_profile", projectId: overview.daw.projects[0].id, measuredRoundTripMs: Number(latencyForm.measuredRoundTripMs), inputCompensationMs: Number(latencyForm.inputCompensationMs), monitoringMode: latencyForm.monitoringMode }, "延遲設定已保存。")}>保存設備設定</button></div> : null}
        </section>
      ) : null}

      {activeTab === "plugins" ? (
        <section className="intelligence-section-stack">
          <div className="intelligence-toolbar panel pad"><div><span className="eyebrow">開放插件與效果平台</span><h2>先安全登記，再由隔離音訊主機載入</h2><p>{overview.plugins.safety}</p></div><button className="button primary" type="button" disabled={busy === "plugins"} onClick={() => void command("plugins", { action: "scan_plugins" }, "AU、VST3 與 CLAP 目錄掃描完成。")}>{busy === "plugins" ? <LoaderCircle className="spin" size={16} /> : <ScanSearch size={16} />}掃描本機插件</button></div>
          <section className="intelligence-metrics compact"><div><span>已登記</span><strong>{overview.plugins.counts.total}</strong></div><div><span>可用候選</span><strong>{overview.plugins.counts.available}</strong></div><div><span>待主機驗證</span><strong>{overview.plugins.counts.untested}</strong></div><div><span>已隔離</span><strong>{overview.plugins.counts.quarantined}</strong></div></section>
          <div className="intelligence-two-column plugin-layout">
            <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">插件登錄</span><h2>不直接載入的安全清單</h2></div></div><div className="plugin-list">{overview.plugins.plugins.length ? overview.plugins.plugins.map((plugin) => <article key={plugin.id}><span><strong>{plugin.name}</strong><small>{plugin.format} · {plugin.validationStatus}</small><code>{plugin.filePath}</code></span><button className={plugin.quarantined ? "button" : "button danger"} type="button" onClick={() => void command(`plugin-${plugin.id}`, { action: "set_plugin_quarantine", pluginId: plugin.id, quarantined: !plugin.quarantined }, plugin.quarantined ? "插件已移出隔離名單。" : "插件已隔離，不會進入可用候選。")}>{plugin.quarantined ? "解除隔離" : "隔離"}</button></article>) : <div className="empty">按「掃描本機插件」建立登錄。</div>}</div></div>
            <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">效果鏈</span><h2>可重用的錄音起點</h2></div></div><div className="effect-chain-list">{overview.plugins.chains.map((chain) => <article key={chain.id}><span className="tag">{chain.category}</span><strong>{chain.name}</strong><p>{chain.description}</p><small>{parseStrings(chain.tagsJson).join(" · ")}</small></article>)}</div><div className="inline-create"><input placeholder="自訂效果鏈名稱" value={effectForm.name} onChange={(event) => setEffectForm({ ...effectForm, name: event.target.value })} /><select value={effectForm.category} onChange={(event) => setEffectForm({ ...effectForm, category: event.target.value })}><option value="vocal">人聲</option><option value="guitar">吉他</option><option value="piano">鋼琴</option><option value="master">Master</option></select><button className="button primary" type="button" disabled={!effectForm.name.trim()} onClick={() => void command("effect", { action: "save_effect_chain", name: effectForm.name, category: effectForm.category, tags: [effectForm.category, "自訂"], favorite: false, steps: [{ type: "high_pass", enabled: true }, { type: "compressor", enabled: true }, { type: "reverb", enabled: false }] }, "自訂效果鏈已建立。")}>建立</button></div></div>
          </div>
        </section>
      ) : null}

      {activeTab === "automation" ? (
        <section className="intelligence-section-stack">
          <div className="intelligence-toolbar panel pad"><div><span className="eyebrow">視覺自動化</span><h2>先看會做什麼，再決定是否執行</h2><p>流程只能執行內建白名單，沒有任意指令入口。</p></div><label className="field compact-field"><span>作用作品</span><select value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)}>{overview.songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label></div>
          <div className="workflow-grid">{overview.automation.workflows.map((workflow) => <article className="panel pad" key={workflow.id}><div><span className="tag">{workflow.category}</span><span className={workflow.riskLevel === "medium" ? "tag warn" : "tag green"}>{workflow.riskLevel === "medium" ? "需仔細核對" : "低風險"}</span></div><h2>{workflow.name}</h2><p>{workflow.description}</p><ol>{parseStrings(workflow.stepsJson).map((step) => <li key={step}>{step}</li>)}</ol><button className="button primary" type="button" onClick={() => void command(`workflow-${workflow.id}`, { action: "preview_workflow", workflowId: workflow.id, songId: workflow.code === "catalog_refresh" ? null : selectedSongId }, "流程預覽已建立，尚未執行任何變更。")}>建立預覽</button></article>)}</div>
          <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">執行紀錄</span><h2>核准與回復</h2></div></div><div className="automation-runs">{overview.automation.runs.length ? overview.automation.runs.map((run) => <article key={run.id}><span><strong>{run.workflow.name}</strong><small>{run.song?.title || "全作品庫"} · {formatDate(run.createdAt)}</small></span><StatusTag status={run.status} /><div>{run.status === "PROPOSED" ? <button className="button primary" type="button" onClick={() => void command(`approve-${run.id}`, { action: "approve_workflow", runId: run.id }, "流程已核准並執行完成。")}>核准執行</button> : null}{run.status === "COMPLETED" ? <button className="button" type="button" onClick={() => void command(`rollback-${run.id}`, { action: "rollback_workflow", runId: run.id }, "衍生紀錄已回復。")}> <RotateCcw size={14} />回復</button> : null}</div>{run.errorMessage ? <p>{run.errorMessage}</p> : null}</article>) : <div className="empty">尚無流程紀錄。</div>}</div></div>
        </section>
      ) : null}

      {activeTab === "catalog" ? (
        <section className="intelligence-section-stack">
          <div className="panel pad catalog-brief-form"><div><span className="eyebrow">Catalog 搜尋與授權候選</span><h2>把對方需求變成可重算的選歌 Brief</h2><p>分數會同時考慮音樂內容、Master 與權利完整度。</p></div><div className="field-row"><label className="field"><span>Brief 名稱</span><input value={briefForm.title} onChange={(event) => setBriefForm({ ...briefForm, title: event.target.value })} placeholder="例如：教會短片片尾" /></label><label className="field"><span>用途</span><select value={briefForm.useCase} onChange={(event) => setBriefForm({ ...briefForm, useCase: event.target.value })}><option>影像配樂</option><option>教會使用</option><option>品牌合作</option><option>歌手選曲</option><option>遊戲音樂</option></select></label></div><label className="field"><span>音樂需求</span><textarea value={briefForm.query} onChange={(event) => setBriefForm({ ...briefForm, query: event.target.value })} placeholder="例如：溫暖但不煽情，木吉他為主，適合 60 秒人物故事" /></label><div className="field-row three"><label className="field"><span>情緒</span><input value={briefForm.moods} onChange={(event) => setBriefForm({ ...briefForm, moods: event.target.value })} placeholder="盼望、平靜" /></label><label className="field"><span>樂器</span><input value={briefForm.instruments} onChange={(event) => setBriefForm({ ...briefForm, instruments: event.target.value })} placeholder="木吉他、鋼琴" /></label><label className="field"><span>曲風</span><input value={briefForm.genres} onChange={(event) => setBriefForm({ ...briefForm, genres: event.target.value })} placeholder="Gospel Pop" /></label></div><div className="catalog-form-actions"><label><input type="checkbox" checked={briefForm.allowVocals} onChange={(event) => setBriefForm({ ...briefForm, allowVocals: event.target.checked })} />接受人聲</label><select value={briefForm.requiredRights} onChange={(event) => setBriefForm({ ...briefForm, requiredRights: event.target.value })}><option value="one_stop_required">必須 One-stop</option><option value="one_stop_preferred">優先 One-stop</option><option value="any">權利不限</option></select><button className="button primary" type="button" disabled={!briefForm.title.trim() || !briefForm.query.trim()} onClick={async () => { const data = await command("brief", { action: "create_brief", title: briefForm.title, useCase: briefForm.useCase, query: briefForm.query, moods: splitInput(briefForm.moods), instruments: splitInput(briefForm.instruments), genres: splitInput(briefForm.genres), bpmMin: briefForm.bpmMin ? Number(briefForm.bpmMin) : null, bpmMax: briefForm.bpmMax ? Number(briefForm.bpmMax) : null, allowVocals: briefForm.allowVocals, requiredRights: briefForm.requiredRights }, "Brief 已建立。", true); const id = (data as { brief?: { id?: string } } | null)?.brief?.id; if (id) await command("match", { action: "match_brief", briefId: id }, "作品庫配對完成。"); }}>建立並配對</button></div></div>
          <div className="brief-list">{overview.business.briefs.length ? overview.business.briefs.map((brief) => <article className="panel pad" key={brief.id}><div className="section-heading"><div><span className="eyebrow">{brief.useCase}</span><h2>{brief.title}</h2><p>{brief.query}</p></div><button className="button" type="button" onClick={() => void command(`match-${brief.id}`, { action: "match_brief", briefId: brief.id }, "配對分數已重新計算。")}>重新配對</button></div><div className="catalog-match-list">{brief.matches.length ? brief.matches.map((match) => <Link href={`/songs/${match.song.id}`} key={match.id}><b>{match.score}</b><span><strong>{match.song.title}</strong><small>{match.song.genre || "未分類"} · {match.song.bpm || "--"} BPM</small><small>{parseStrings(match.reasonsJson).slice(0, 2).join(" · ") || parseStrings(match.blockersJson).slice(0, 1).join(" · ")}</small></span><StatusTag status={match.rightsStatus} /><ChevronRight size={16} /></Link>) : <div className="empty compact">尚未配對。</div>}</div></article>) : <div className="panel pad empty">建立第一份選歌需求，系統會從作品庫評分。</div>}</div>
        </section>
      ) : null}

      {activeTab === "rights" ? (
        <section className="intelligence-section-stack">
          <div className="intelligence-toolbar panel pad"><div><span className="eyebrow">權利、分潤與產業資料</span><h2>先整理正確，再產生交付草稿</h2><p>DDEX RIN / ERN 只標示為 inspired draft，不宣稱官方認證。</p></div><label className="field compact-field"><span>作品</span><select value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)}>{overview.songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label></div>
          <div className="intelligence-two-column rights-layout">
            <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">權利主檔</span><h2>{selectedSong?.title}</h2></div></div><div className="field-row"><label className="field"><span>Master owner</span><input value={rightsForm.masterOwner} onChange={(event) => setRightsForm({ ...rightsForm, masterOwner: event.target.value })} /></label><label className="field"><span>Publishing owner</span><input value={rightsForm.publishingOwner} onChange={(event) => setRightsForm({ ...rightsForm, publishingOwner: event.target.value })} /></label><label className="field"><span>Publisher</span><input value={rightsForm.publisher} onChange={(event) => setRightsForm({ ...rightsForm, publisher: event.target.value })} /></label><label className="field"><span>ISWC</span><input value={rightsForm.iswc} onChange={(event) => setRightsForm({ ...rightsForm, iswc: event.target.value })} /></label><label className="field"><span>地區</span><input value={rightsForm.territory} onChange={(event) => setRightsForm({ ...rightsForm, territory: event.target.value })} /></label><label className="field"><span>PRO</span><input value={rightsForm.proAffiliation} onChange={(event) => setRightsForm({ ...rightsForm, proAffiliation: event.target.value })} /></label></div><div className="rights-toggles"><label><input type="checkbox" checked={rightsForm.masterControlled} onChange={(event) => setRightsForm({ ...rightsForm, masterControlled: event.target.checked })} />Master 可控</label><label><input type="checkbox" checked={rightsForm.publishingControlled} onChange={(event) => setRightsForm({ ...rightsForm, publishingControlled: event.target.checked })} />Publishing 可控</label><label><input type="checkbox" checked={rightsForm.oneStopClearance} onChange={(event) => setRightsForm({ ...rightsForm, oneStopClearance: event.target.checked })} />One-stop 可授權</label></div><button className="button primary" type="button" disabled={!selectedSongId} onClick={() => void command("rights", { action: "save_rights", songId: selectedSongId, ...rightsForm }, "權利主檔已保存。")}> <Save size={16} />保存權利主檔</button></div>
            <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">Split 與識別碼</span><h2>合作人完整度</h2></div></div><div className="split-summary"><span><small>Publishing 合計</small><strong>{selectedSong?.credits.reduce((total, credit) => total + (credit.publishingSplit ?? credit.splitPercentage ?? 0), 0) || 0}%</strong></span><span><small>Master 合計</small><strong>{selectedSong?.credits.reduce((total, credit) => total + (credit.masterSplit ?? 0), 0) || 0}%</strong></span><span><small>已確認</small><strong>{selectedSong?.credits.filter((credit) => credit.confirmations.some((item) => item.status === "CONFIRMED")).length || 0}/{selectedSong?.credits.length || 0}</strong></span></div><div className="rights-credit-list">{selectedSong?.credits.length ? selectedSong.credits.map((credit) => <article key={credit.id}><span><strong>{credit.contributor.name}</strong><small>{credit.role} · IPI {credit.contributor.ipi || "待補"}</small></span><b>{credit.publishingSplit ?? credit.splitPercentage ?? 0}%</b></article>) : <div className="empty compact">尚未建立合作人與分潤。</div>}</div><Link className="button" href="/contributors">前往合作人管理</Link></div>
          </div>
          <div className="panel pad industry-export"><div><span className="eyebrow">產業格式草稿</span><h2>下載前先看警告</h2><p>所有輸出保存在外接硬碟 exports，並建立 SHA-256。</p></div><div>{(["LABEL_COPY_JSON", "DDEX_RIN_DRAFT", "DDEX_ERN_DRAFT", "SPLIT_SHEET_HTML"] as const).map((format) => <button className="button" type="button" key={format} disabled={!selectedSongId} onClick={() => void command(`export-${format}`, { action: "export_rights", songId: selectedSongId, format }, `${format} 草稿已輸出。`)}><Download size={15} />{format.replaceAll("_", " ")}</button>)}</div></div>
          <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">最近輸出</span><h2>交付稽核紀錄</h2></div></div><div className="export-list">{overview.business.exports.length ? overview.business.exports.map((item) => <article key={item.id}><span><strong>{item.fileName}</strong><small>{item.song?.title || "未綁定歌曲"} · {formatDate(item.createdAt)}</small></span><StatusTag status={item.validationStatus} /></article>) : <div className="empty compact">尚未建立產業格式草稿。</div>}</div></div>
        </section>
      ) : null}

      {activeTab === "analytics" ? (
        <section className="intelligence-section-stack">
          <section className="intelligence-metrics"><div><span>平台觀看</span><strong>{overview.business.totals.views.toLocaleString("zh-TW")}</strong><small>{overview.business.totals.watchMinutes} 分鐘</small></div><div><span>試聽播放</span><strong>{overview.business.totals.previewPlays}</strong><small>匿名本機事件</small></div><div><span>認領轉換</span><strong>{overview.business.totals.claims}</strong><small>試聽頁送單</small></div><div><span>已記錄收入</span><strong>{formatMoney(overview.business.totals.revenue)}</strong><small>跨平台帳本</small></div></section>
          <div className="panel pad metric-entry"><div><span className="eyebrow">發行後數據</span><h2>手動匯入平台快照</h2><p>目前不需外部 API；未來可在使用者授權後接 YouTube Analytics。</p></div><div className="field-row three"><label className="field"><span>作品</span><select value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)}>{overview.songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label><label className="field"><span>平台</span><select value={metricForm.provider} onChange={(event) => setMetricForm({ ...metricForm, provider: event.target.value })}><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="spotify">Spotify</option><option value="direct">直接試聽</option></select></label><label className="field"><span>觀看</span><input type="number" min="0" value={metricForm.views} onChange={(event) => setMetricForm({ ...metricForm, views: event.target.value })} /></label><label className="field"><span>觀看分鐘</span><input type="number" min="0" value={metricForm.watchMinutes} onChange={(event) => setMetricForm({ ...metricForm, watchMinutes: event.target.value })} /></label><label className="field"><span>讚</span><input type="number" min="0" value={metricForm.likes} onChange={(event) => setMetricForm({ ...metricForm, likes: event.target.value })} /></label><label className="field"><span>留言</span><input type="number" min="0" value={metricForm.comments} onChange={(event) => setMetricForm({ ...metricForm, comments: event.target.value })} /></label><label className="field"><span>分享</span><input type="number" min="0" value={metricForm.shares} onChange={(event) => setMetricForm({ ...metricForm, shares: event.target.value })} /></label><label className="field"><span>預估收入 TWD</span><input type="number" min="0" value={metricForm.estimatedRevenue} onChange={(event) => setMetricForm({ ...metricForm, estimatedRevenue: event.target.value })} /></label></div><button className="button primary" type="button" onClick={() => void command("metric", { action: "add_metric", songId: selectedSongId, provider: metricForm.provider, periodStart: metricForm.periodStart, periodEnd: metricForm.periodEnd, views: Number(metricForm.views), engagedViews: Number(metricForm.engagedViews), watchMinutes: Number(metricForm.watchMinutes), averageViewDuration: 0, likes: Number(metricForm.likes), comments: Number(metricForm.comments), shares: Number(metricForm.shares), subscribersGained: Number(metricForm.subscribersGained), estimatedRevenue: Number(metricForm.estimatedRevenue), currency: "TWD" }, "平台數據快照已加入。")}>加入數據快照</button></div>
          <div className="panel pad"><div className="section-heading"><div><span className="eyebrow">策略回饋</span><h2>哪些作品值得繼續放大</h2></div><Bot size={20} /></div><div className="insight-table">{overview.business.songInsights.map((item) => <Link href={`/songs/${item.song.id}`} key={item.song.id}><span><strong>{item.song.title}</strong><small>{item.song.genre || "未分類"}</small></span><span><b>{item.views}</b><small>觀看</small></span><span><b>{item.plays}</b><small>試聽</small></span><span><b>{item.conversionRate}%</b><small>轉換</small></span><span><b>{formatMoney(item.revenue)}</b><small>收入</small></span><span><small>{item.recommendations[0] || "持續觀察"}</small></span><ChevronRight size={16} /></Link>)}</div></div>
        </section>
      ) : null}
    </div>
  );
}
