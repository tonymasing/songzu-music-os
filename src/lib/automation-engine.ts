import { getSong } from "@/lib/data";
import { rebuildKnowledgeGraph } from "@/lib/knowledge-graph";
import { prisma } from "@/lib/prisma";
import { buildProductionDirectorBrief } from "@/lib/production-director";

const workflowDefinitions = [
  {
    code: "song_health_check",
    name: "單曲製作健康檢查",
    description: "檢查下一步、混音留言、Master 音質、Metadata 與分潤，不自動修改作品。",
    category: "production",
    riskLevel: "low",
    steps: ["讀取作品與音檔狀態", "執行製作總監規則", "建立可審核建議", "寫入時間軸"]
  },
  {
    code: "release_preflight",
    name: "發行前完整預檢",
    description: "在發布前核對 Master、封面、歌詞、ISRC、UPC、分潤、文案與授權資料。",
    category: "release",
    riskLevel: "medium",
    steps: ["檢查發行阻塞", "檢查權利與分潤", "檢查 Master 音質", "建立預檢報告"]
  },
  {
    code: "catalog_refresh",
    name: "Catalog 智慧索引更新",
    description: "重新整理可重建的知識節點與關聯，不移動、不改名、不刪除原始資料。",
    category: "catalog",
    riskLevel: "low",
    steps: ["讀取歌曲與素材", "重建衍生索引", "重算關聯權重", "回報節點與關係數量"]
  }
] as const;

export async function ensureAutomationWorkflows() {
  const orderBy = [{ category: "asc" as const }, { name: "asc" as const }];
  const current = await prisma.automationWorkflow.findMany({ orderBy });
  if (workflowDefinitions.every(definition => current.some(item => item.code === definition.code))) return current;
  return prisma.$transaction(async tx => {
    for (const definition of workflowDefinitions) {
      if (await tx.automationWorkflow.findUnique({ where: { code: definition.code } })) continue;
      await tx.automationWorkflow.create({ data: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        stepsJson: JSON.stringify(definition.steps),
        riskLevel: definition.riskLevel,
        requiresApproval: true,
        status: "ACTIVE",
        version: 1
      } });
    }
    return tx.automationWorkflow.findMany({ orderBy });
  });
}

export async function previewAutomation(workflowId: string, songId?: string | null) {
  const workflow = await prisma.automationWorkflow.findUnique({ where: { id: workflowId } });
  if (!workflow || workflow.status !== "ACTIVE") throw new Error("找不到可執行的自動化流程");
  if (workflow.code !== "catalog_refresh" && !songId) throw new Error("這個流程需要選擇歌曲");
  const song = songId ? await getSong(songId) : null;
  if (songId && !song) throw new Error("找不到歌曲");
  const preview = {
    workflow: workflow.code,
    song: song ? { id: song.id, title: song.title } : null,
    steps: JSON.parse(workflow.stepsJson) as string[],
    effects: workflow.code === "catalog_refresh"
      ? ["刪除並重建 source=derived 的索引", "原始歌曲、音檔、素材與權利資料不變"]
      : ["建立一筆 AI 建議", "建立一筆歌曲時間軸事件", "不自動改狀態、不改檔案"],
    requiresApproval: true,
    generatedAt: new Date().toISOString()
  };
  return prisma.automationRun.create({
    data: { workflowId, songId: songId ?? null, status: "PROPOSED", previewJson: JSON.stringify(preview) },
    include: { workflow: true, song: { select: { id: true, title: true } } }
  });
}

async function executeSongWorkflow(run: { id: string; songId: string | null; workflow: { code: string; name: string } }) {
  if (!run.songId) throw new Error("自動化缺少歌曲");
  const song = await getSong(run.songId);
  if (!song) throw new Error("找不到歌曲");
  const brief = buildProductionDirectorBrief(song);
  const releaseMode = run.workflow.code === "release_preflight";
  const payload = releaseMode
    ? {
        title: `${song.title} 發行前預檢`,
        summary: brief.releaseBlockers.length ? `有 ${brief.releaseBlockers.length} 個發行阻塞。` : "目前沒有必要阻塞。",
        blockers: brief.releaseBlockers,
        masterSpec: brief.masterReleaseSpec,
        nextActions: brief.nextActions
      }
    : {
        title: `${song.title} 製作健康檢查`,
        summary: `目前階段：${brief.stage.label}。`,
        stage: brief.stage,
        nextActions: brief.nextActions,
        mixingCommands: brief.mixingCommands,
        qualityGate: brief.qualityGate
      };
  const suggestion = await prisma.aiSuggestion.create({
    data: {
      songId: song.id,
      suggestionType: releaseMode ? "automation_release_preflight" : "automation_song_health",
      inputSnapshotJson: JSON.stringify({ workflow: run.workflow.code, songId: song.id }),
      outputPayloadJson: JSON.stringify(payload),
      status: "pending"
    }
  });
  const timeline = await prisma.timelineEvent.create({
    data: {
      songId: song.id,
      eventType: releaseMode ? "release_preflight" : "automation_health_check",
      title: run.workflow.name,
      description: payload.summary,
      relatedModel: "AutomationRun",
      relatedId: run.id,
      metadataJson: JSON.stringify({ suggestionId: suggestion.id })
    }
  });
  return {
    result: payload,
    rollback: { aiSuggestionIds: [suggestion.id], timelineEventIds: [timeline.id] }
  };
}

export async function approveAndExecuteAutomation(runId: string) {
  const run = await prisma.automationRun.findUnique({ where: { id: runId }, include: { workflow: true } });
  if (!run) throw new Error("找不到自動化執行紀錄");
  if (run.status !== "PROPOSED") throw new Error("只有待核准流程可以執行");
  const approvedAt = new Date();
  await prisma.automationRun.update({ where: { id: run.id }, data: { status: "RUNNING", approvedAt } });
  try {
    const execution = run.workflow.code === "catalog_refresh"
      ? { result: await rebuildKnowledgeGraph(), rollback: { rebuiltDerivedGraph: true } }
      : await executeSongWorkflow(run);
    return prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        resultJson: JSON.stringify(execution.result),
        rollbackJson: JSON.stringify(execution.rollback),
        executedAt: new Date()
      },
      include: { workflow: true, song: { select: { id: true, title: true } } }
    });
  } catch (error) {
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: error instanceof Error ? error.message : "執行失敗", executedAt: new Date() }
    });
    throw error;
  }
}

export async function rollbackAutomation(runId: string) {
  const run = await prisma.automationRun.findUnique({ where: { id: runId }, include: { workflow: true } });
  if (!run || run.status !== "COMPLETED") throw new Error("只有已完成流程可以回復");
  let rollback: { aiSuggestionIds?: string[]; timelineEventIds?: string[]; rebuiltDerivedGraph?: boolean } = {};
  try {
    rollback = run.rollbackJson ? JSON.parse(run.rollbackJson) : {};
  } catch {
    rollback = {};
  }
  await prisma.$transaction(async (tx) => {
    if (rollback.aiSuggestionIds?.length) await tx.aiSuggestion.deleteMany({ where: { id: { in: rollback.aiSuggestionIds } } });
    if (rollback.timelineEventIds?.length) await tx.timelineEvent.deleteMany({ where: { id: { in: rollback.timelineEventIds } } });
    await tx.automationRun.update({ where: { id: run.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
  });
  if (rollback.rebuiltDerivedGraph) await rebuildKnowledgeGraph();
  return prisma.automationRun.findUnique({ where: { id: run.id }, include: { workflow: true, song: { select: { id: true, title: true } } } });
}

export async function getAutomationSummary() {
  const workflows = await ensureAutomationWorkflows();
  const runs = await prisma.automationRun.findMany({
    include: { workflow: true, song: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 30
  });
  return {
    workflows,
    runs,
    counts: {
      proposed: runs.filter((run) => run.status === "PROPOSED").length,
      completed: runs.filter((run) => run.status === "COMPLETED").length,
      failed: runs.filter((run) => run.status === "FAILED").length,
      rolledBack: runs.filter((run) => run.status === "ROLLED_BACK").length
    }
  };
}
