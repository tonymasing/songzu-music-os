"use client";

import {
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileSearch,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Mic2,
  RadioTower,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  Zap
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { AiAgentActionDto, AiAgentProviderStatus, AiConversationDto } from "@/lib/ai-agent";
import { requestJson } from "@/lib/client-request";
import type { SongDto } from "@/lib/music";
import { buildCatalogStrategy } from "@/lib/production-director";

type ConversationSummary = {
  id: string;
  title: string;
  provider: string | null;
  model: string | null;
  messageCount: number;
  actionCount: number;
  updatedAt: string | null;
};

type AgentResponse = {
  providerStatus: AiAgentProviderStatus;
  conversation: AiConversationDto | null;
  conversations: ConversationSummary[];
};

type MessageMetadata = {
  decisionSummary?: string;
  matchingSongIds?: string[];
  suggestedNextSteps?: string[];
  confidence?: number;
  providerNote?: string;
  activity?: string[];
};

const promptGroups = [
  {
    label: "錄音",
    icon: Mic2,
    prompts: ["我們的錄音介面整理好了嗎？還缺哪些關鍵能力？", "請整理下一次錄音最該先處理的三件事。"]
  },
  {
    label: "發行",
    icon: RadioTower,
    prompts: ["哪些歌最接近可以發行？請說明依據。", "哪些歌還不能發行？幫我列出真正的阻塞。"]
  },
  {
    label: "混音與音質",
    icon: ShieldCheck,
    prompts: ["哪些歌曲需要下一輪混音？請整理成工作順序。", "找出 Master 音質或 Audio QA 有風險的歌曲。"]
  },
  {
    label: "資料與事業",
    icon: FileSearch,
    prompts: ["哪些作品缺少製作名單、分潤或發行資料？", "根據整個作品庫，建議我這週怎麼安排音樂事業工作。"]
  }
] as const;

const actionLabels: Record<string, string> = {
  create_song: "建立歌曲",
  create_song_task: "建立任務",
  update_song_status: "更新階段",
  add_timeline_note: "加入時間軸",
  generate_promo_assets: "產生發行素材",
  run_audio_qa: "執行音質檢查",
  prepare_garageband_workflow: "準備 GarageBand 工作流",
  adjust_daw_track: "調整 DAW 音軌效果",
  apply_daw_polish: "套用 Codex 錄音修飾"
};

const statusLabels: Record<string, string> = {
  PROPOSED: "等待批准",
  EXECUTING: "執行中",
  DONE: "已完成",
  FAILED: "執行失敗",
  REJECTED: "已略過"
};

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const hour24 = taipei.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  return `${taipei.getUTCMonth() + 1}/${taipei.getUTCDate()} ${hour24 >= 12 ? "下午" : "上午"}${String(hour12).padStart(2, "0")}:${String(taipei.getUTCMinutes()).padStart(2, "0")}`;
}

function messageMetadata(value: Record<string, unknown> | null): MessageMetadata {
  return value ? (value as MessageMetadata) : {};
}

function actionTone(status: string) {
  if (status === "DONE") return "green";
  if (status === "FAILED") return "danger";
  if (status === "PROPOSED") return "warn";
  return "";
}

function actionPreview(action: AiAgentActionDto) {
  if (!action.payload) return [];
  return Object.entries(action.payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
}

export function AssistantWorkspace({ songs }: { songs: SongDto[] }) {
  const strategy = useMemo(() => buildCatalogStrategy(songs), [songs]);
  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const [question, setQuestion] = useState("");
  const [providerStatus, setProviderStatus] = useState<AiAgentProviderStatus | null>(null);
  const [conversation, setConversation] = useState<AiConversationDto | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [contextReadAt, setContextReadAt] = useState<Date | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const catalogUpdatedAt = useMemo(() => {
    const latest = Math.max(
      ...songs.map((song) => song.updatedAt ? new Date(song.updatedAt).getTime() : 0).filter(Number.isFinite),
      0
    );
    return latest ? new Date(latest) : null;
  }, [songs]);
  const audioFileCount = useMemo(() => songs.reduce((total, song) => total + song.audioFiles.length, 0), [songs]);

  useEffect(() => {
    let cancelled = false;
    requestJson<AgentResponse>("/api/ai/agent")
      .then((response) => {
        if (cancelled) return;
        setProviderStatus(response.providerStatus);
        setConversation(response.conversation);
        setConversations(response.conversations);
        setContextReadAt(new Date());
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "AI 代理人載入失敗");
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: asking ? "smooth" : "auto", block: "end" });
  }, [conversation?.messages.length, asking]);

  const proposedActions = conversation?.actions.filter((action) => action.status === "PROPOSED" || action.status === "FAILED") ?? [];
  const recentActions = conversation?.actions.filter((action) => action.status !== "PROPOSED" && action.status !== "FAILED").slice(-4).reverse() ?? [];

  async function loadConversation(id: string) {
    setInitialLoading(true);
    setError("");
    try {
      const response = await requestJson<AgentResponse>(`/api/ai/agent?conversationId=${encodeURIComponent(id)}`);
      setProviderStatus(response.providerStatus);
      setConversation(response.conversation);
      setConversations(response.conversations);
      setContextReadAt(new Date());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法讀取對話");
    } finally {
      setInitialLoading(false);
    }
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const message = question.trim();
    if (!message || asking) return;
    setAsking(true);
    setError("");
    setQuestion("");
    const optimisticId = `pending-${Date.now()}`;
    setConversation((current) => current
      ? { ...current, messages: [...current.messages, { id: optimisticId, role: "USER", content: message, provider: null, model: null, metadata: null, createdAt: new Date().toISOString() }] }
      : current);
    try {
      const response = await requestJson<AgentResponse>("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation?.id ?? null, message })
      });
      setProviderStatus(response.providerStatus);
      setConversation(response.conversation);
      setConversations(response.conversations);
      setContextReadAt(new Date());
    } catch (requestError) {
      setConversation((current) => current ? { ...current, messages: current.messages.filter((item) => item.id !== optimisticId) } : current);
      setQuestion(message);
      setError(requestError instanceof Error ? requestError.message : "AI 無法處理這個問題");
    } finally {
      setAsking(false);
    }
  }

  async function decideAction(action: AiAgentActionDto, decision: "approve" | "reject") {
    if (actionBusy) return;
    setActionBusy(action.id);
    setError("");
    try {
      const response = await requestJson<{ conversation: AiConversationDto }>(`/api/ai/agent/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      setConversation(response.conversation);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "無法處理這個動作");
    } finally {
      setActionBusy(null);
    }
  }

  function beginNewConversation() {
    setConversation(null);
    setQuestion("");
    setError("");
  }

  return (
    <div className="assistant-agent-page">
      <header className="assistant-agent-header">
        <div className="stack">
          <span className="eyebrow">AI 製作代理人</span>
          <h1>問清楚，決定下一步，再交給它執行。</h1>
          <div className="assistant-provider-line">
            <span className={`agent-presence ${providerStatus?.realModel ? "online" : "fallback"}`} aria-hidden="true" />
            <strong>{providerStatus?.displayName ?? "正在確認模型"}</strong>
            {providerStatus?.model ? <span className="tag">{providerStatus.model}</span> : null}
            {providerStatus?.credentialKind ? <span className="muted">{providerStatus.credentialKind}</span> : null}
          </div>
        </div>
        <div className="assistant-header-actions">
          <label className="assistant-history-select">
            <History size={15} />
            <select
              className="select"
              aria-label="切換 AI 對話"
              value={conversation?.id ?? ""}
              onChange={(event) => event.target.value && loadConversation(event.target.value)}
            >
              <option value="">最近對話</option>
              {conversations.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
            </select>
          </label>
          <button className="button" type="button" onClick={beginNewConversation}>
            <MessageSquarePlus size={16} />
            新對話
          </button>
        </div>
      </header>

      {providerStatus && !providerStatus.realModel ? (
        <div className="agent-fallback-banner" role="status">
          <ShieldCheck size={17} />
          <div><strong>目前是本機規則備援</strong><span>{providerStatus.message}</span></div>
        </div>
      ) : null}

      <section className="agent-context-strip" aria-label="AI 本次讀取範圍">
        <div><FileSearch size={16} /><span><strong>{songs.length} 首作品</strong><small>作品資料與任務</small></span></div>
        <div><ShieldCheck size={16} /><span><strong>{audioFileCount} 個音檔</strong><small>Audio QA 與版本</small></span></div>
        <div><Clock3 size={16} /><span><strong>{catalogUpdatedAt ? formatTime(catalogUpdatedAt.toISOString()) : "尚無更新"}</strong><small>資料最新異動</small></span></div>
        <div><BrainCircuit size={16} /><span><strong>{contextReadAt ? formatTime(contextReadAt.toISOString()) : "正在讀取"}</strong><small>本次讀取時間</small></span></div>
      </section>

      <main className="assistant-agent-layout">
        <section className="assistant-conversation" aria-label="AI 對話">
          <div className="assistant-conversation-head">
            <div>
              <span className="muted">目前對話</span>
              <h2>{conversation?.title ?? "新的製作決策"}</h2>
            </div>
            <span className="tag green"><BrainCircuit size={13} /> 作品庫已連接</span>
          </div>

          <div className="assistant-message-stream" aria-live="polite">
            {initialLoading ? (
              <div className="agent-empty-state"><LoaderCircle className="spin" size={24} /><strong>正在讀取 AI 對話</strong></div>
            ) : !conversation?.messages.length ? (
              <div className="agent-empty-state">
                <div className="agent-empty-icon"><Sparkles size={24} /></div>
                <strong>今天要推進哪一件事？</strong>
                <span>AI 會讀取作品、音檔品質、錄音狀態、任務與發行缺口後回答。</span>
              </div>
            ) : (
              conversation.messages.map((message) => {
                const metadata = messageMetadata(message.metadata);
                const relatedSongs = (metadata.matchingSongIds ?? []).map((id) => songMap.get(id)).filter((song): song is SongDto => Boolean(song));
                const messageActions = conversation.actions.filter((action) => action.sourceMessageId === message.id);
                const pendingMessageActions = messageActions.filter((item) => item.status === "PROPOSED" || item.status === "FAILED");
                if (message.role === "TOOL") {
                  return (
                    <div className="agent-tool-message" key={message.id}>
                      <CheckCircle2 size={15} />
                      <span>{message.content}</span>
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                  );
                }
                if (message.role === "USER") {
                  return (
                    <div className="agent-message user" key={message.id}>
                      <div className="agent-message-label"><span>你</span><time>{formatTime(message.createdAt)}</time></div>
                      <p>{message.content}</p>
                    </div>
                  );
                }
                return (
                  <article className="agent-message assistant" key={message.id}>
                    <div className="agent-message-label">
                      <span><Bot size={15} /> AI 製作代理人</span>
                      <span className="agent-model-label">{message.model ?? "本機規則"}</span>
                    </div>
                    <span className="agent-section-label">分析結果</span>
                    <div className="agent-answer-copy">{message.content}</div>
                    {metadata.decisionSummary ? (
                      <div className="agent-decision-summary"><Zap size={15} /><span>{metadata.decisionSummary}</span></div>
                    ) : null}
                    {relatedSongs.length ? (
                      <div className="agent-related-songs">
                        <span className="agent-section-label">相關作品</span>
                        <div className="agent-link-row">
                          {relatedSongs.map((song) => (
                            <Link href={`/songs/${song.id}`} key={song.id}>
                              <span>{song.title}</span><small>{song.readiness}%</small><ChevronRight size={14} />
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {metadata.suggestedNextSteps?.length ? (
                      <div className="agent-next-steps">
                        <span className="agent-section-label">建議順序</span>
                        {metadata.suggestedNextSteps.map((step, index) => (
                          <div key={`${step}-${index}`}><strong>{index + 1}</strong><span>{step}</span></div>
                        ))}
                      </div>
                    ) : null}
                    {messageActions.length ? (
                      <div className="agent-message-action-note">
                        <CircleDashed size={15} />
                        <span>{pendingMessageActions.length ? `${pendingMessageActions.length} 個動作等待批准` : `${messageActions.length} 個動作已處理`}</span>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}

            {asking ? (
              <div className="agent-thinking" role="status">
                <div className="agent-thinking-title"><LoaderCircle className="spin" size={17} /><strong>AI 正在處理</strong></div>
                <div className="agent-thinking-steps">
                  <span><Check size={14} /> 理解目標</span>
                  <span><LoaderCircle className="spin" size={14} /> 讀取作品庫</span>
                  <span><CircleDashed size={14} /> 整理動作</span>
                </div>
              </div>
            ) : null}
            <div ref={messageEndRef} />
          </div>

          <form className="assistant-composer" onSubmit={ask}>
            <textarea
              className="textarea"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="問作品進度、錄音、混音、音質、發行，或請 AI 提出可執行的下一步…"
              aria-label="詢問 AI 製作代理人"
              disabled={asking}
            />
            <div className="assistant-composer-footer">
              <span><ShieldCheck size={14} /> 修改資料前會先等你批准</span>
              <button className="button primary" type="submit" disabled={asking || !question.trim()} aria-label="送出問題">
                {asking ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                <span>送出</span>
              </button>
            </div>
          </form>
          {error ? <p className="action-message error assistant-error" role="alert">{error}</p> : null}
        </section>

        <aside className="assistant-agent-rail">
          <section className="agent-rail-section action-queue">
            <div className="agent-rail-heading">
              <div><span className="muted">動作佇列</span><h2>等待你決定</h2></div>
              <span className="agent-count">{proposedActions.length}</span>
            </div>
            {!proposedActions.length ? (
              <div className="agent-rail-empty"><CheckCircle2 size={18} /><span>目前沒有待批准動作</span></div>
            ) : proposedActions.map((action) => (
              <div className="agent-action-item" key={action.id}>
                <div className="agent-action-top">
                  <span className={`tag ${actionTone(action.status)}`}>{statusLabels[action.status] ?? action.status}</span>
                  <span className="muted">{actionLabels[action.actionType] ?? action.actionType}</span>
                </div>
                <strong>{action.title}</strong>
                {action.songTitle ? <Link href={`/songs/${action.songId}`}>{action.songTitle}<ChevronRight size={13} /></Link> : null}
                {action.description ? <p>{action.description}</p> : null}
                {actionPreview(action).length ? (
                  <div className="agent-action-preview" aria-label="預計變更內容">
                    <span>變更預覽</span>
                    {actionPreview(action).map((item) => <small key={item}>{item}</small>)}
                  </div>
                ) : null}
                {action.errorMessage ? <span className="agent-action-error">{action.errorMessage}</span> : null}
                <div className="agent-action-buttons">
                  <button className="button primary" type="button" onClick={() => decideAction(action, "approve")} disabled={Boolean(actionBusy)}>
                    {actionBusy === action.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                    {action.status === "FAILED" ? "重試" : "批准"}
                  </button>
                  <button className="button" type="button" onClick={() => decideAction(action, "reject")} disabled={Boolean(actionBusy)}>
                    <X size={15} /> 略過
                  </button>
                </div>
              </div>
            ))}
            {recentActions.length ? (
              <div className="agent-recent-actions">
                <span className="agent-section-label">最近處理</span>
                {recentActions.map((action) => (
                  <div key={action.id}>
                    {action.status === "DONE" ? <CheckCircle2 size={14} /> : action.status === "REJECTED" ? <XCircle size={14} /> : <Clock3 size={14} />}
                    <span>{action.title}</span><small>{statusLabels[action.status] ?? action.status}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="agent-rail-section">
            <div className="agent-rail-heading">
              <div><span className="muted">快速提問</span><h2>工作方向</h2></div>
              <Sparkles size={17} />
            </div>
            <div className="agent-prompt-list">
              {promptGroups.map((group) => {
                const Icon = group.icon;
                return (
                  <div key={group.label}>
                    <span><Icon size={14} />{group.label}</span>
                    {group.prompts.map((prompt) => (
                      <button type="button" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}<ChevronRight size={14} /></button>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="agent-rail-section catalog-signal-section">
            <div className="agent-rail-heading">
              <div><span className="muted">作品庫策略</span><h2>{songs.length} 首作品</h2></div>
              <BrainCircuit size={17} />
            </div>
            <div className="catalog-signal-grid">
              <Link href="/releases"><strong>{strategy.priorityRelease.length}</strong><span>優先發行</span></Link>
              <Link href="/daw"><strong>{strategy.needsRerecord.length}</strong><span>需要重錄</span></Link>
              <Link href="/pitch"><strong>{strategy.pitchPackCandidates.length}</strong><span>分享候選</span></Link>
              <Link href="/metadata"><strong>{strategy.needsMetadata.length}</strong><span>補齊資料</span></Link>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
