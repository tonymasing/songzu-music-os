"use client";

import { Bot, ClipboardList, Copy, ExternalLink, FolderSearch, PlugZap, RadioTower, Save, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { fileTypeLabel, type SongDto } from "@/lib/music";

type IntegrationDto = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  connectionKind: string;
  endpoint: string | null;
  apiKeyEnv: string | null;
  threadUrl: string | null;
  threadId: string | null;
  projectPath: string | null;
  commandPath: string | null;
  notes: string | null;
};

type HandoffDto = {
  codexThreadUrl?: string | null;
  codexThreadId?: string | null;
  operatorRoot: string;
  commandPath: string;
  operatorExists: boolean;
  commandCount: number;
  implementedCommands: Array<{
    name: string;
    implemented: boolean;
    requires_confirmation?: boolean;
    profile_required?: boolean;
    category?: string;
  }>;
  safeCommands: Array<{
    name: string;
    implemented: boolean;
    requires_confirmation?: boolean;
    profile_required?: boolean;
    category?: string;
  }>;
  handoffPrompt: string;
};

type WorkflowDto = HandoffDto & {
  steps: Array<{
    order: number;
    title: string;
    command: string;
    intent: string;
    requiresConfirmation: boolean;
    implemented: boolean;
    category: string;
    shellCommand: string;
    payload: {
      command: string;
      confirmed?: boolean;
      source: string;
    };
  }>;
};

type OperationLogDto = {
  id: string;
  songId: string | null;
  songTitle: string | null;
  operation: string;
  command: string;
  payload: Record<string, unknown> | null;
  payloadJson: string | null;
  requiresConfirmation: boolean;
  approvalStatus: string;
  resultStatus: string;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ScannedExportFile = {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  modifiedAt: string | null;
  inferredFileType: string;
  inferredVersionName: string;
  alreadyImported: boolean;
  importedSongId: string | null;
  importedSongTitle: string | null;
  importedAudioFileId: string | null;
};

type ExportScanResult = {
  folderPath: string;
  scannedAt: string;
  files: ScannedExportFile[];
};

const providerLabels: Record<string, string> = {
  CODEX: "Codex",
  CLAUDE: "Claude",
  HERMES: "Hermes",
  GARAGEBAND_OPERATOR: "GarageBand AI Operator"
};

const statusLabels: Record<string, string> = {
  CONNECTED: "已連接",
  CONFIGURED: "已設定",
  READY_TO_CONFIGURE: "待設定",
  DISABLED: "停用"
};

const connectionKindLabels: Record<string, string> = {
  codex_thread: "Codex 對話串",
  api_or_app: "API 或桌面交接",
  local_or_http_agent: "本機或 HTTP Agent",
  local_cli_bridge: "本機 CLI 橋接"
};

const approvalLabels: Record<string, string> = {
  PENDING: "待批准",
  APPROVED: "已批准",
  CANCELLED: "已取消"
};

const resultLabels: Record<string, string> = {
  QUEUED: "已排入",
  DONE: "已完成",
  CANCELLED: "已取消"
};

function formatBytes(value: number) {
  if (value > 1024 * 1024 * 1024) return `${Math.round((value / 1024 / 1024 / 1024) * 10) / 10} GB`;
  if (value > 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
  if (value > 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${value} B`;
}

export function IntegrationsWorkspace({
  initialIntegrations,
  songs,
  initialHandoff,
  initialWorkflow,
  initialOperationLogs
}: {
  initialIntegrations: IntegrationDto[];
  songs: SongDto[];
  initialHandoff: HandoffDto;
  initialWorkflow: WorkflowDto;
  initialOperationLogs: OperationLogDto[];
}) {
  const initialGarageBand = initialIntegrations.find((integration) => integration.provider === "GARAGEBAND_OPERATOR");
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [handoff, setHandoff] = useState(initialHandoff);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [operationLogs, setOperationLogs] = useState(initialOperationLogs);
  const [exportPathByLog, setExportPathByLog] = useState<Record<string, string>>({});
  const [importStatusByLog, setImportStatusByLog] = useState<Record<string, string>>({});
  const [importStatusByPath, setImportStatusByPath] = useState<Record<string, string>>({});
  const [exportFolderPath, setExportFolderPath] = useState(initialGarageBand?.endpoint ?? "");
  const [scanResult, setScanResult] = useState<ExportScanResult | null>(null);
  const [scanStatus, setScanStatus] = useState("");
  const [selectedSongId, setSelectedSongId] = useState(songs[0]?.id ?? "");
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  const garageBand = integrations.find((integration) => integration.provider === "GARAGEBAND_OPERATOR");
  const implementedByCategory = useMemo(() => {
    return handoff.implementedCommands.reduce<Record<string, string[]>>((acc, command) => {
      const category = command.category ?? "其他";
      acc[category] ??= [];
      acc[category].push(command.name);
      return acc;
    }, {});
  }, [handoff.implementedCommands]);

  function updateProvider(provider: string, patch: Partial<IntegrationDto>) {
    setIntegrations((current) =>
      current.map((integration) => (integration.provider === provider ? { ...integration, ...patch } : integration))
    );
  }

  async function saveIntegration(integration: IntegrationDto) {
    setSavingProvider(integration.provider);
    const response = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integration)
    });
    const saved = (await response.json()) as IntegrationDto;
    updateProvider(saved.provider, saved);
    setSavingProvider(null);
  }

  async function generateHandoff() {
    const [handoffResponse, workflowResponse] = await Promise.all([
      fetch("/api/integrations/garageband-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: selectedSongId || null })
      }),
      fetch("/api/integrations/garageband-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: selectedSongId || null })
      })
    ]);
    setHandoff((await handoffResponse.json()) as HandoffDto);
    setWorkflow((await workflowResponse.json()) as WorkflowDto);
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(handoff.handoffPrompt);
  }

  async function createOperationLog(step: WorkflowDto["steps"][number], copiedKind: "命令" | "JSON") {
    const response = await fetch("/api/garageband/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songId: selectedSongId || null,
        operation: `${step.title}（複製${copiedKind}）`,
        command: step.shellCommand,
        payload: step.payload,
        requiresConfirmation: step.requiresConfirmation,
        resultStatus: "QUEUED",
        notes: step.intent
      })
    });
    const created = (await response.json()) as OperationLogDto;
    setOperationLogs((current) => [created, ...current]);
  }

  async function updateOperationLog(id: string, patch: Partial<OperationLogDto>) {
    const response = await fetch(`/api/garageband/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const updated = (await response.json()) as OperationLogDto;
    setOperationLogs((current) => current.map((log) => (log.id === id ? updated : log)));
  }

  async function copyWorkflowStep(step: WorkflowDto["steps"][number]) {
    await navigator.clipboard.writeText(step.shellCommand);
    await createOperationLog(step, "命令");
  }

  async function copyWorkflowPayload(step: WorkflowDto["steps"][number]) {
    await navigator.clipboard.writeText(JSON.stringify(step.payload, null, 2));
    await createOperationLog(step, "JSON");
  }

  async function saveExportFolderPath() {
    if (!garageBand) return;
    const next = { ...garageBand, endpoint: exportFolderPath.trim() || null };
    updateProvider(garageBand.provider, next);
    await saveIntegration(next);
  }

  async function scanGarageBandExports() {
    const folderPath = exportFolderPath.trim() || garageBand?.endpoint?.trim();
    if (!folderPath) {
      setScanStatus("請先填入 GarageBand export 資料夾路徑。");
      return;
    }
    setScanStatus("掃描中");
    const response = await fetch("/api/garageband/exports/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath, limit: 60 })
    });
    if (!response.ok) {
      setScanStatus("掃描失敗，請確認資料夾路徑。");
      return;
    }
    const result = (await response.json()) as ExportScanResult;
    setExportFolderPath(result.folderPath);
    setScanResult(result);
    setScanStatus(`找到 ${result.files.length} 個音檔`);
  }

  async function importScannedExport(file: ScannedExportFile) {
    if (!selectedSongId) {
      setImportStatusByPath((current) => ({ ...current, [file.filePath]: "請先選擇歌曲" }));
      return;
    }
    setImportStatusByPath((current) => ({ ...current, [file.filePath]: "建立匯入紀錄中" }));
    const logResponse = await fetch("/api/garageband/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songId: selectedSongId,
        operation: `匯入 GarageBand export：${file.fileName}`,
        command: "garageband_import_export",
        payload: {
          exportPath: file.filePath,
          source: "garageband_export_folder",
          inferredFileType: file.inferredFileType,
          inferredVersionName: file.inferredVersionName
        },
        requiresConfirmation: false,
        approvalStatus: "APPROVED",
        resultStatus: "DONE",
        notes: "從 GarageBand export folder 監看清單匯入。"
      })
    });
    if (!logResponse.ok) {
      setImportStatusByPath((current) => ({ ...current, [file.filePath]: "建立操作紀錄失敗" }));
      return;
    }
    const log = (await logResponse.json()) as OperationLogDto;
    setOperationLogs((current) => [log, ...current]);

    const importResponse = await fetch(`/api/garageband/logs/${log.id}/import-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exportPath: file.filePath,
        songId: selectedSongId,
        fileType: "auto",
        versionName: file.inferredVersionName,
        isPrimary: false,
        notes: "GarageBand export folder 匯入新版本"
      })
    });
    if (!importResponse.ok) {
      setImportStatusByPath((current) => ({ ...current, [file.filePath]: "匯入失敗，請確認檔案路徑" }));
      return;
    }
    setImportStatusByPath((current) => ({ ...current, [file.filePath]: "已匯入並完成音質報告" }));
    setScanResult((current) =>
      current
        ? {
            ...current,
            files: current.files.map((item) =>
              item.filePath === file.filePath
                ? {
                    ...item,
                    alreadyImported: true,
                    importedSongId: selectedSongId,
                    importedSongTitle: songs.find((song) => song.id === selectedSongId)?.title ?? null
                  }
                : item
            )
          }
        : current
    );
  }

  async function importGarageBandExport(log: OperationLogDto) {
    const exportPath = exportPathByLog[log.id]?.trim();
    if (!exportPath) return;
    setImportStatusByLog((current) => ({ ...current, [log.id]: "匯入中" }));
    const response = await fetch(`/api/garageband/logs/${log.id}/import-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exportPath,
        songId: (log.songId ?? selectedSongId) || null,
        fileType: "auto",
        isPrimary: false,
        notes: "GarageBand export 匯入新版本"
      })
    });
    if (!response.ok) {
      setImportStatusByLog((current) => ({ ...current, [log.id]: "匯入失敗，請確認路徑" }));
      return;
    }
    setImportStatusByLog((current) => ({ ...current, [log.id]: "已匯入新版本並建立音質報告" }));
    setExportPathByLog((current) => ({ ...current, [log.id]: "" }));
  }

  return (
    <>
      <header className="page-header">
        <div className="stack">
          <span className="eyebrow">SOFTWARE / INTEGRATIONS</span>
          <h1>軟體與 AI 通路</h1>
          <p className="subtle">
            設定 AI 工具、GarageBand 交接與匯出回收。手機配對、區網與外出連線請使用「裝置連線與安裝」。
          </p>
        </div>
      </header>

      <section className="grid-4 section">
        {integrations.map((integration) => (
          <div className="panel metric" key={integration.provider}>
            <span>{providerLabels[integration.provider] ?? integration.displayName}</span>
            <strong style={{ fontSize: 24 }}>{statusLabels[integration.status] ?? integration.status}</strong>
            <p className="muted">{connectionKindLabels[integration.connectionKind] ?? integration.connectionKind}</p>
          </div>
        ))}
      </section>

      <section className="split-layout section">
        <div className="stack">
          {integrations.map((integration) => (
            <div className="panel pad stack" key={integration.provider}>
              <div className="toolbar">
                <div>
                  <h2>{providerLabels[integration.provider] ?? integration.displayName}</h2>
                  <p className="muted">{integration.notes ?? "尚未填寫備註。"}</p>
                </div>
                <span className={integration.status === "CONNECTED" ? "tag green" : "tag warn"}>
                  {statusLabels[integration.status] ?? integration.status}
                </span>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>連接類型</label>
                  <input
                    className="input"
                    value={connectionKindLabels[integration.connectionKind] ?? integration.connectionKind}
                    onChange={(event) => updateProvider(integration.provider, { connectionKind: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label>狀態</label>
                  <select
                    className="select"
                    value={integration.status}
                    onChange={(event) => updateProvider(integration.provider, { status: event.target.value })}
                  >
                    <option value="CONNECTED">已連接</option>
                    <option value="CONFIGURED">已設定</option>
                    <option value="READY_TO_CONFIGURE">待設定</option>
                    <option value="DISABLED">停用</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>端點 / 深層連結</label>
                <input
                  className="input"
                  value={integration.endpoint ?? ""}
                  onChange={(event) => updateProvider(integration.provider, { endpoint: event.target.value })}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label>API Key 環境變數</label>
                  <input
                    className="input"
                    value={integration.apiKeyEnv ?? ""}
                    onChange={(event) => updateProvider(integration.provider, { apiKeyEnv: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label>對話 ID</label>
                  <input
                    className="input"
                    value={integration.threadId ?? ""}
                    onChange={(event) => updateProvider(integration.provider, { threadId: event.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label>專案路徑</label>
                <input
                  className="input"
                  value={integration.projectPath ?? ""}
                  onChange={(event) => updateProvider(integration.provider, { projectPath: event.target.value })}
                />
              </div>

              <div className="field">
                <label>命令路徑</label>
                <input
                  className="input"
                  value={integration.commandPath ?? ""}
                  onChange={(event) => updateProvider(integration.provider, { commandPath: event.target.value })}
                />
              </div>

              <div className="field">
                <label>備註</label>
                <textarea
                  className="textarea"
                  value={integration.notes ?? ""}
                  onChange={(event) => updateProvider(integration.provider, { notes: event.target.value })}
                />
              </div>

              <div className="toolbar">
                {integration.threadUrl && (
                  <a className="button" href={integration.threadUrl}>
                    <ExternalLink size={16} />
                    開啟對話
                  </a>
                )}
                <button className="button primary" onClick={() => saveIntegration(integration)} disabled={savingProvider === integration.provider}>
                  <Save size={16} />
                  {savingProvider === integration.provider ? "儲存中" : "儲存設定"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <aside className="stack">
          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>GarageBand 通路</h2>
                <p className="muted">讀取操作器白名單，產生交接給 Codex / Claude / Hermes 的提示。</p>
              </div>
              <PlugZap size={18} color="var(--accent)" />
            </div>

            <div className="tag-row">
              <span className={handoff.operatorExists ? "tag green" : "tag danger"}>
                {handoff.operatorExists ? "操作器已找到" : "操作器路徑不存在"}
              </span>
              <span className="tag">{handoff.commandCount} 個命令</span>
              <span className="tag green">{handoff.safeCommands.length} 個免確認命令</span>
            </div>

            <div className="field">
              <label>指定歌曲</label>
              <select className="select" value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)}>
                {songs.map((song) => (
                  <option key={song.id} value={song.id}>
                    {song.title}
                  </option>
                ))}
              </select>
            </div>

            <button className="button primary" onClick={generateHandoff}>
              <RadioTower size={16} />
              產生交接包
            </button>

            <div className="stack">
              <h3>Operator 路徑</h3>
              <p className="muted">{garageBand?.projectPath ?? handoff.operatorRoot}</p>
              <p className="muted">{garageBand?.commandPath ?? handoff.commandPath}</p>
            </div>

            <div className="stack">
              <h3>安全規則</h3>
              <p className="muted">
                需要確認的命令不會自動執行。錄音、儲存、匯出、音量、聲像與 profile 類操作要先得到你的明確同意。
              </p>
            </div>

            <button className="button" onClick={copyPrompt}>
              <Copy size={16} />
              複製交接提示
            </button>
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>匯出資料夾監看</h2>
                <p className="muted">掃描 GarageBand export folder，挑選新音檔匯入為版本並自動跑 Audio QA。</p>
              </div>
              <FolderSearch size={18} color="var(--accent)" />
            </div>

            <div className="field">
              <label>Export 資料夾路徑</label>
              <input
                className="input"
                placeholder="/Volumes/.../GarageBand Exports"
                value={exportFolderPath}
                onChange={(event) => setExportFolderPath(event.target.value)}
              />
            </div>
            <div className="toolbar compact-toolbar">
              <button className="button primary" onClick={scanGarageBandExports}>
                <FolderSearch size={16} />
                掃描資料夾
              </button>
              <button className="button" onClick={saveExportFolderPath} disabled={!garageBand || !exportFolderPath.trim()}>
                <Save size={16} />
                儲存路徑
              </button>
              {scanStatus && <span className="muted">{scanStatus}</span>}
            </div>

            {scanResult?.files.length ? (
              <div className="small-list">
                {scanResult.files.slice(0, 8).map((file) => (
                  <div className="list-row export-row" key={file.filePath}>
                    <span>
                      <strong>{file.fileName}</strong>
                      <br />
                      <span className="muted">
                        {fileTypeLabel(file.inferredFileType)} · {file.inferredVersionName} · {formatBytes(file.fileSizeBytes)}
                      </span>
                      <br />
                      <span className="muted">{file.filePath}</span>
                      {file.alreadyImported && (
                        <>
                          <br />
                          <span className="muted">已匯入：{file.importedSongTitle ?? "未知歌曲"}</span>
                        </>
                      )}
                    </span>
                    <span className="tag-row">
                      <span className={file.alreadyImported ? "tag green" : "tag warn"}>
                        {file.alreadyImported ? "已匯入" : "新檔案"}
                      </span>
                      <button className="button" onClick={() => importScannedExport(file)} disabled={file.alreadyImported}>
                        匯入
                      </button>
                    </span>
                    {importStatusByPath[file.filePath] && <p className="muted">{importStatusByPath[file.filePath]}</p>}
                  </div>
                ))}
              </div>
            ) : scanResult ? (
              <div className="empty compact">這個資料夾沒有找到 WAV / AIFF / MP3 / M4A / FLAC。</div>
            ) : null}
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>GarageBand 任務流程</h2>
                <p className="muted">每一步都可複製 CLI 命令或 JSON payload 給 AI agent。</p>
              </div>
              <ClipboardList size={18} color="var(--accent)" />
            </div>
            <div className="small-list">
              {workflow.steps.map((step) => (
                <div className="list-row" key={step.command}>
                  <span>
                    <strong>
                      {step.order}. {step.title}
                    </strong>
                    <br />
                    <span className="muted">{step.intent}</span>
                    <br />
                    <span className="muted">{step.shellCommand}</span>
                  </span>
                  <span className="tag-row">
                    <span className={step.requiresConfirmation ? "tag warn" : "tag green"}>
                      {step.requiresConfirmation ? "需確認" : "可交接"}
                    </span>
                    <button className="button" onClick={() => copyWorkflowStep(step)}>
                      命令
                    </button>
                    <button className="button" onClick={() => copyWorkflowPayload(step)}>
                      JSON
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>操作紀錄</h2>
                <p className="muted">複製命令、批准與完成狀態都會留在這裡，未來可回溯 AI 做過什麼建議。</p>
              </div>
              <ClipboardList size={18} color="var(--accent)" />
            </div>
            <div className="small-list">
              {operationLogs.length ? (
                operationLogs.map((log) => (
                  <div className="list-row" key={log.id}>
                    <span>
                      <strong>{log.operation}</strong>
                      <br />
                      <span className="muted">
                        {log.songTitle ?? "未指定歌曲"} · {log.command}
                      </span>
                    </span>
                    <span className="tag-row">
                      <span className={log.approvalStatus === "APPROVED" ? "tag green" : log.approvalStatus === "CANCELLED" ? "tag danger" : "tag warn"}>
                        {approvalLabels[log.approvalStatus] ?? log.approvalStatus}
                      </span>
                      <span className={log.resultStatus === "DONE" ? "tag green" : log.resultStatus === "CANCELLED" ? "tag danger" : "tag"}>
                        {resultLabels[log.resultStatus] ?? log.resultStatus}
                      </span>
                      <button className="button" onClick={() => updateOperationLog(log.id, { approvalStatus: "APPROVED" })}>
                        批准
                      </button>
                      <button className="button" onClick={() => updateOperationLog(log.id, { resultStatus: "DONE" })}>
                        完成
                      </button>
                      <button
                        className="button"
                        onClick={() => updateOperationLog(log.id, { approvalStatus: "CANCELLED", resultStatus: "CANCELLED" })}
                      >
                        取消
                      </button>
                    </span>
                    <div className="field-row" style={{ width: "100%" }}>
                      <input
                        className="input"
                        placeholder="GarageBand export 檔案路徑，匯入後會成為新音檔版本"
                        value={exportPathByLog[log.id] ?? ""}
                        onChange={(event) => setExportPathByLog((current) => ({ ...current, [log.id]: event.target.value }))}
                      />
                      <button className="button" onClick={() => importGarageBandExport(log)}>
                        匯入新版本
                      </button>
                    </div>
                    {importStatusByLog[log.id] && <p className="muted">{importStatusByLog[log.id]}</p>}
                  </div>
                ))
              ) : (
                <div className="empty">還沒有 GarageBand 操作紀錄。</div>
              )}
            </div>
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>可用命令</h2>
                <p className="muted">來自 GarageBand 操作器的 commands.json 白名單。</p>
              </div>
              <ShieldCheck size={18} color="var(--accent)" />
            </div>
            {Object.entries(implementedByCategory).map(([category, commands]) => (
              <div className="stack" key={category}>
                <h3>{category}</h3>
                <div className="tag-row">
                  {commands.map((command) => (
                    <span className="tag" key={command}>
                      {command}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="panel pad stack">
            <div className="toolbar">
              <div>
                <h2>交接提示</h2>
                <p className="muted">可貼給 Codex / Claude / Hermes 接手 GarageBand 操作器。</p>
              </div>
              <Bot size={18} color="var(--accent)" />
            </div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{handoff.handoffPrompt}</pre>
          </div>
        </aside>
      </section>
    </>
  );
}
