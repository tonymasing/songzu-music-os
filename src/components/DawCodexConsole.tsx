"use client";

import { AudioLines, CircleStop, Play, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AiAgentActionDto, AiAgentProviderStatus, AiConversationDto } from "@/lib/ai-agent";
import type { DawProjectDto } from "@/lib/daw";
import { dawAdjustmentRevision, isCurrentDawProposal } from "@/lib/daw-adjustment";
import { dawRecordingEvidence } from "@/lib/daw-recording-evidence";
import styles from "./DawCodexConsole.module.css";

type Track = DawProjectDto["tracks"][number];

type AgentResponse = {
  providerStatus: AiAgentProviderStatus;
  conversation: AiConversationDto | null;
  error?: string;
};

type Props = {
  project: DawProjectDto;
  selectedTrack: Track | null;
  selectedClipId: string;
  playheadSeconds: number;
  providerStatus: AiAgentProviderStatus | null;
  isPlaying: boolean;
  recordingState: string;
  editsPending: boolean;
  onOperationStart: () => boolean;
  onOperationEnd: () => void;
  onReviewIssue: (start: number, end: number, trackId: string) => Promise<boolean>;
  onAudition: (action: AiAgentActionDto, mode: "original" | "proposal") => Promise<boolean>;
  onPlayMix: () => void | Promise<void>;
  onStop: () => void;
  onActionApplied: () => void | Promise<void>;
};

const quickPrompts = [
  "把人聲拉近一點、清楚一點，但不要太乾。",
  "幫我做自然、現代、不會糊掉的殘響範例。",
  "檢查目前音軌的拍子、音準、音量與 Audio QA，告訴我先處理哪裡。",
  "給我一個現在版本和更乾淨版本的 A/B 比較方案。"
];

const settingLabels: Record<string, string> = {
  volume: "音量",
  pan: "聲像",
  inputGain: "輸入修整",
  lowGain: "低頻",
  midGain: "中頻",
  highGain: "高頻",
  compression: "壓縮",
  noiseGate: "Noise Gate",
  echo: "回音",
  reverb: "殘響"
};

function dawActionForTrack(action: AiAgentActionDto, trackId: string) {
  return (
    (action.actionType === "adjust_daw_track" || action.actionType === "apply_daw_polish") &&
    action.payload?.trackId === trackId
  );
}

export function DawCodexConsole({
  project,
  selectedTrack,
  selectedClipId,
  playheadSeconds,
  providerStatus: initialProviderStatus,
  isPlaying,
  recordingState,
  editsPending,
  onOperationStart,
  onOperationEnd,
  onReviewIssue,
  onAudition,
  onPlayMix,
  onStop,
  onActionApplied
}: Props) {
  const [providerStatus, setProviderStatus] = useState(initialProviderStatus);
  const [conversation, setConversation] = useState<AiConversationDto | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [heard, setHeard] = useState<{ key: string; original: boolean; proposal: boolean }>({ key: "", original: false, proposal: false });
  const [auditionMode, setAuditionMode] = useState("");
  const [undoneAction, setUndoneAction] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(false);
  const mountedRef = useRef(true);
  const protectedSession = recordingState !== "idle" || editsPending;
  const viewKey = selectedTrack ? `${selectedTrack.id}:${selectedClipId}:${dawAdjustmentRevision(selectedTrack)}` : "";
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current?.abort(); };
  }, []);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const storageKey = `songzu.daw.codex-conversation.${project.id}`;

  useEffect(() => setProviderStatus(initialProviderStatus), [initialProviderStatus]);

  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    const conversationId = window.localStorage.getItem(storageKey);
    if (!conversationId) return () => {
      cancelled = true;
    };
    fetch(`/api/ai/agent?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as AgentResponse;
        if (!response.ok) throw new Error(data.error || "無法讀取 Codex 對話。");
        if (cancelled) return;
        setProviderStatus(data.providerStatus);
        setConversation(data.conversation);
      })
      .catch(() => {
        if (!cancelled) window.localStorage.removeItem(storageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.messages.length, asking]);

  const proposedAction = useMemo(() => {
    if (!selectedTrack) return null;
    return [...(conversation?.actions ?? [])]
      .reverse()
      .find(
        (action) =>
          dawActionForTrack(action, selectedTrack.id) &&
          (action.status === "PROPOSED" || action.status === "FAILED")
      ) ?? null;
  }, [conversation?.actions, selectedTrack]);
  const staleProposal = Boolean(proposedAction && selectedTrack && !isCurrentDawProposal(selectedTrack, proposedAction.payload));
  const auditionKey = `${proposedAction?.id ?? ""}:${viewKey}`;
  const heardBoth = heard.key === auditionKey && heard.original && heard.proposal;
  const evidence = selectedTrack ? dawRecordingEvidence(selectedTrack, selectedClipId, playheadSeconds) : null;
  const lastApplied = [...(conversation?.actions ?? [])].reverse().find(action =>
    action.status === "DONE" && action.payload?.trackId === selectedTrack?.id &&
    typeof action.result?.historyOperationId === "string" && action.id !== undoneAction
  );
  const busy = asking || Boolean(actionBusy);
  function beginOperation() {
    if (protectedSession || operationRef.current || !onOperationStart()) return false;
    operationRef.current = true;
    return true;
  }
  function endOperation() {
    operationRef.current = false;
    onOperationEnd();
  }
  const actionSettings =
    proposedAction?.payload?.settings &&
    typeof proposedAction.payload.settings === "object" &&
    !Array.isArray(proposedAction.payload.settings)
      ? (proposedAction.payload.settings as Record<string, unknown>)
      : {};

  async function askCodex() {
    const message = question.trim();
    if (!message || !selectedTrack || !beginOperation()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 95_000);
    setAsking(true);
    setError("");
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/codex-chat`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation?.id ?? null, message, trackId: selectedTrack.id,
          selectedClipId: evidence?.clip?.id ?? null, playheadSeconds
        })
      });
      const data = (await response.json()) as AgentResponse;
      if (!response.ok) throw new Error(data.error || "Codex 錄音師沒有完成這次回答。");
      if (!data.providerStatus.realModel || data.providerStatus.provider !== "codex_cli") throw new Error("Codex 尚未連線，沒有改用其他模型。");
      if (!mountedRef.current) return;
      setProviderStatus(data.providerStatus);
      setConversation(data.conversation);
      if (data.conversation?.id) window.localStorage.setItem(storageKey, data.conversation.id);
      setQuestion("");
    } catch (caught) {
      if (mountedRef.current) setError(controller.signal.aborted ? "已取消或逾時；未套用任何調整。" : caught instanceof Error ? caught.message : "Codex 暫時無法使用。");
    } finally {
      window.clearTimeout(timer);
      requestRef.current = null;
      if (mountedRef.current) setAsking(false);
      endOperation();
    }
  }

  async function audition(mode: "original" | "proposal") {
    if (!proposedAction || staleProposal || !beginOperation()) return;
    const key = auditionKey;
    const selectedView = viewKey;
    setActionBusy("audition");
    setError("");
    try {
      const started = await onAudition(proposedAction, mode);
      if (!started) throw new Error("試聽未成功啟動，請檢查音檔或播放錯誤。");
      setAuditionMode(mode);
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      if (mountedRef.current && playingRef.current && viewKeyRef.current === selectedView) {
        setHeard(current => ({
          key, original: (current.key === key && current.original) || mode === "original",
          proposal: (current.key === key && current.proposal) || mode === "proposal"
        }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "試聽失敗。");
    } finally { setActionBusy(""); endOperation(); }
  }

  async function decideAction(decision: "approve" | "reject") {
    if (!proposedAction || (decision === "approve" && (staleProposal || !heardBoth)) || !beginOperation()) return;
    setActionBusy(proposedAction.id);
    setError("");
    onStop();
    try {
      const response = await fetch(`/api/ai/agent/actions/${proposedAction.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision })
      });
      const data = (await response.json()) as { conversation?: AiConversationDto; error?: string };
      if (!response.ok) throw new Error(data.error || "無法處理 Codex 動作。");
      const updated = data.conversation?.actions.find(action => action.id === proposedAction.id);
      setConversation(data.conversation ?? null);
      if (decision === "approve" && updated?.status !== "DONE") throw new Error(updated?.errorMessage || "方案未成功套用。");
      if (decision === "approve") await onActionApplied();
      setHeard({ key: "", original: false, proposal: false });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Codex 動作失敗。"); }
    finally { setActionBusy(""); endOperation(); }
  }

  async function undoLastAdjustment() {
    if (!lastApplied || !beginOperation()) return;
    setActionBusy("undo");
    setError("");
    onStop();
    try {
      const response = await fetch(`/api/daw-projects/${project.id}/history`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", expectedOperationId: lastApplied.result?.historyOperationId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "無法復原。");
      setUndoneAction(lastApplied.id);
      await onActionApplied();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "無法復原。"); }
    finally { setActionBusy(""); endOperation(); }
  }

  async function previewIssue(start: number, end: number) {
    if (!selectedTrack || !beginOperation()) return;
    setActionBusy("issue");
    setError("");
    try { if (!await onReviewIssue(start, end, selectedTrack.id)) throw new Error("疑點回聽未能啟動。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "回聽失敗。"); }
    finally { setActionBusy(""); endOperation(); }
  }

  async function previewMix() {
    if (!beginOperation()) return;
    setActionBusy("mix");
    try { await onPlayMix(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "播放失敗。"); }
    finally { setActionBusy(""); endOperation(); }
  }

  return (
    <section className="daw-codex-console" aria-label="Codex 對話式錄音師">
      <div className="daw-codex-chat">
        <div className="daw-codex-head">
          <span>
            <Sparkles size={16} />
            <strong>Codex 控制室</strong>
          </span>
          <span className={providerStatus?.realModel ? "daw-codex-presence online" : "daw-codex-presence"}>
            {providerStatus?.realModel ? "Codex 登入可用" : "尚未連線"}
          </span>
        </div>

        {protectedSession ? <p className="daw-codex-error" role="status">{recordingState !== "idle" ? "錄音保護中" : "音軌設定尚未儲存"} · 暫停試聽與調整</p> : null}
        <div className="daw-codex-thread" aria-live="polite">
          {!conversation?.messages.length ? (
            <div className="daw-codex-empty">
              <AudioLines size={22} />
              <strong>直接告訴錄音師你想聽到什麼</strong>
              <p>目前片段：{evidence?.clip?.label ?? evidence?.clip?.audioFile.fileName ?? "未選取"}</p>
            </div>
          ) : null}
          {conversation?.messages.slice(-12).map((message) => (
            <div className={`daw-codex-message ${message.role.toLowerCase()}`} key={message.id}>
              <span>{message.role === "USER" ? "你" : message.role === "TOOL" ? "系統" : "Codex"}</span>
              <p>{message.content}</p>
            </div>
          ))}
          {asking ? <div className="daw-codex-thinking">Codex 正在檢查音軌與效果鏈...</div> : null}
          <div ref={threadEndRef} />
        </div>

        <div className="daw-codex-quick" aria-label="常用錄音師問題">
          {quickPrompts.map((prompt) => (
            <button type="button" key={prompt} onClick={() => setQuestion(prompt)} disabled={busy || protectedSession}>
              {prompt}
            </button>
          ))}
        </div>

        <form
          className="daw-codex-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void askCodex();
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={selectedTrack ? `告訴 Codex 要怎麼調整「${selectedTrack.name}」` : "請先選擇音軌"}
            disabled={!selectedTrack || busy || protectedSession}
            rows={3}
          />
          <button type="submit" disabled={!selectedTrack || !question.trim() || busy || protectedSession || !providerStatus?.realModel}>
            <Send size={16} />
            {asking ? "思考中" : "詢問 Codex"}
          </button>
        </form>
        {asking ? <button className="daw-icon-button" type="button" onClick={() => requestRef.current?.abort()} title="取消請求" aria-label="取消請求"><X size={16} /></button> : null}
        {error ? <p className="daw-codex-error">{error}</p> : null}
        <p className="daw-codex-privacy">未傳送原始音檔 · 演奏疑點待製作人確認</p>
      </div>

      <aside className="daw-codex-audition" aria-label="Codex 效果試聽與批准">
        <div className="daw-codex-audition-head">
          <strong>錄音師監聽</strong>
          <span>{selectedTrack?.name ?? "未選音軌"}</span>
        </div>
        <div className="daw-codex-transport">
          <button type="button" onClick={() => void previewMix()} disabled={!selectedTrack || busy || protectedSession}>
            <Play size={15} />播放目前混音
          </button>
          <button type="button" onClick={() => { onStop(); setAuditionMode(""); }} disabled={!isPlaying || protectedSession}>
            <CircleStop size={15} />停止
          </button>
        </div>

        <div className="daw-codex-settings">
          <span><small>Take 分析</small><strong>{evidence?.report ? "已有報告" : "無對應報告"}</strong></span>
          <span><small>演奏判定</small><strong>待回聽確認</strong></span>
        </div>
        {evidence?.issues.slice(0, 6).map(issue => (
          <button className={styles.issue} key={issue.id} type="button" disabled={busy || protectedSession}
            onClick={() => void previewIssue(issue.startSeconds, issue.endSeconds)} title="回聽疑點前後片段">
            <Play size={14} /><span>{issue.timelineSeconds.toFixed(1)}s</span><strong>{issue.title}</strong>
            <small>{issue.detail}</small>
          </button>
        ))}
        {lastApplied ? <button className="button" type="button" disabled={busy || protectedSession} onClick={() => void undoLastAdjustment()}><Undo2 size={15} />復原上次通道調整</button> : null}
        {proposedAction ? (
          <div className="daw-codex-proposal">
            <span className="tag warn">{staleProposal ? "方案已過期，請重新產生" : heardBoth ? "等待你的批准" : "尚未完成 A/B 試聽"}</span>
            <strong>{proposedAction.title}</strong>
            {proposedAction.description ? <p>{proposedAction.description}</p> : null}
            {typeof proposedAction.payload?.rationale === "string" ? <em>{proposedAction.payload.rationale}</em> : null}
            <div className="daw-codex-settings">
              {Object.entries(actionSettings).map(([key, value]) => (
                <span key={key}>
                  <small>{settingLabels[key] ?? key}</small>
                  <strong>{typeof value === "number" ? value.toFixed(2) : String(value)}</strong>
                </span>
              ))}
            </div>
            <div className="daw-codex-ab">
              <button className={isPlaying && auditionMode === "original" ? "active" : ""} type="button" disabled={busy || protectedSession || staleProposal} onClick={() => void audition("original")}>
                <Play size={15} />A 目前聲音
              </button>
              <button className={isPlaying && auditionMode === "proposal" ? "active" : ""} type="button" disabled={busy || protectedSession || staleProposal} onClick={() => void audition("proposal")}>
                <Sparkles size={15} />B Codex 方案
              </button>
            </div>
            <div className="daw-codex-decision">
              <button className="approve" type="button" onClick={() => void decideAction("approve")} disabled={busy || protectedSession || staleProposal || !heardBoth}>
                {actionBusy === proposedAction.id ? "套用中" : "批准並套用"}
              </button>
              <button type="button" onClick={() => void decideAction("reject")} disabled={busy || protectedSession}>
                略過
              </button>
            </div>
          </div>
        ) : (
          <div className="daw-codex-no-proposal">
            <AudioLines size={20} />
            <strong>尚未有待試聽方案</strong>
            <p>詢問建議不會自動改音軌；只有 Codex 提出效果動作後才會出現 A/B 控制。</p>
          </div>
        )}
      </aside>
    </section>
  );
}
