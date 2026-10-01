import { SystemRecordsWorkspace, type SystemRecord } from "@/components/SystemRecordsWorkspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const [jobs, plugins, chains, workflows, runs, nodes, edges, health] = await Promise.all([
    prisma.audioIntelligenceJob.findMany({ select: { id: true, jobType: true, engine: true, status: true, createdAt: true, song: { select: { title: true } }, audioFile: { select: { fileName: true } } } }),
    prisma.pluginDescriptor.findMany({ select: { id: true, name: true, vendor: true, format: true, status: true, validationStatus: true, quarantined: true, updatedAt: true } }),
    prisma.effectChain.findMany({ select: { id: true, name: true, category: true, description: true, status: true, updatedAt: true } }),
    prisma.automationWorkflow.findMany({ select: { id: true, name: true, description: true, category: true, status: true, requiresApproval: true, updatedAt: true } }),
    prisma.automationRun.findMany({ select: { id: true, status: true, createdAt: true, workflow: { select: { name: true } }, song: { select: { title: true } } } }),
    prisma.knowledgeNode.findMany({ select: { id: true, nodeType: true, label: true, summary: true, source: true, updatedAt: true } }),
    prisma.knowledgeEdge.findMany({ select: { id: true, relationType: true, createdAt: true, sourceNode: { select: { label: true } }, targetNode: { select: { label: true } } } }),
    prisma.dawEngineHealthSnapshot.findMany({ select: { id: true, status: true, clipping: true, xrunCount: true, diskWriteErrorCount: true, createdAt: true, project: { select: { title: true } } } })
  ]);
  const jobLabels: Record<string, string> = { STEM_SEPARATION: "分軌", TRANSCRIPTION: "採譜", AUDIO_REPAIR: "音檔修復", AUDIO_QA: "音質檢查" };
  const nodeLabels: Record<string, string> = { material: "素材", theory_rule: "樂理規則", sound: "音色", contributor: "合作人", genre: "曲風", subgenre: "子曲風", key: "調性", mood: "情緒" };
  const records: SystemRecord[] = [
    ...jobs.map((job): SystemRecord => ({ id: job.id, group: "analysis", title: job.song?.title ?? job.audioFile?.fileName ?? "音訊作業", subtitle: `${jobLabels[job.jobType] ?? job.jobType} · ${job.engine}`, status: job.status, date: job.createdAt.toISOString(), fields: [["工作類型", jobLabels[job.jobType] ?? job.jobType], ["使用引擎", job.engine], ["音檔", job.audioFile?.fileName ?? "未關聯"]] })),
    ...plugins.map((plugin): SystemRecord => ({ id: plugin.id, group: "plugins", title: plugin.name, subtitle: `${plugin.vendor || "未記錄廠商"} · ${plugin.format}`, status: plugin.quarantined ? "QUARANTINED" : plugin.validationStatus, date: plugin.updatedAt.toISOString(), fields: [["格式", plugin.format], ["登錄狀態", plugin.status]] })),
    ...chains.map((chain): SystemRecord => ({ id: chain.id, group: "effects", title: chain.name, subtitle: chain.category, status: "SAVED", date: chain.updatedAt.toISOString(), fields: [["類別", chain.category], ["內容", chain.description || "未記錄描述"]] })),
    ...workflows.map((workflow): SystemRecord => ({ id: workflow.id, group: "automation", title: workflow.name, subtitle: "流程定義", status: "SAVED", date: workflow.updatedAt.toISOString(), fields: [["內容", workflow.description || "未記錄描述"], ["執行核准", workflow.requiresApproval ? "需要核准" : "依既有授權"]] })),
    ...runs.map((run): SystemRecord => ({ id: run.id, group: "automation", title: run.workflow.name, subtitle: `執行紀錄 · ${run.song?.title ?? "未指定作品"}`, status: run.status, date: run.createdAt.toISOString(), fields: [["關聯作品", run.song?.title ?? "未指定作品"]] })),
    ...nodes.map((node): SystemRecord => ({ id: node.id, group: "knowledge", title: node.label, subtitle: nodeLabels[node.nodeType] ?? node.nodeType, status: "SAVED", date: node.updatedAt.toISOString(), fields: [["類型", nodeLabels[node.nodeType] ?? node.nodeType], ["摘要", node.summary || "未記錄摘要"], ["來源", node.source]] })),
    ...edges.map((edge): SystemRecord => ({ id: edge.id, group: "knowledge", title: `${edge.sourceNode.label} → ${edge.targetNode.label}`, subtitle: "資料關聯", status: "SAVED", date: edge.createdAt.toISOString(), fields: [["來源", edge.sourceNode.label], ["目標", edge.targetNode.label], ["關聯類型", edge.relationType]] })),
    ...health.map((entry): SystemRecord => ({ id: entry.id, group: "health", title: entry.project.title, subtitle: "錄音健康快照", status: entry.clipping ? "CLIPPING" : entry.status, date: entry.createdAt.toISOString(), fields: [["掉音次數", String(entry.xrunCount)], ["磁碟寫入錯誤", String(entry.diskWriteErrorCount)], ["剪波", entry.clipping ? "有" : "無"]] }))
  ];
  records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return <SystemRecordsWorkspace records={records} />;
}
