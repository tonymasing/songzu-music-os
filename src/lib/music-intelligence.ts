import { getAudioEngineRegistry, listAudioIntelligenceJobs } from "@/lib/audio-intelligence";
import { getAutomationSummary } from "@/lib/automation-engine";
import { getCatalogBusinessSummary } from "@/lib/catalog-business-intelligence";
import { getDawIntelligenceSummary } from "@/lib/daw-intelligence";
import { getHarmonyControlPlane } from "@/lib/harmony-control-plane";
import { getKnowledgeGraphSummary, rebuildKnowledgeGraph } from "@/lib/knowledge-graph";
import { getPluginPlatformSummary } from "@/lib/plugin-platform";
import { prisma } from "@/lib/prisma";

export async function getMusicIntelligenceOverview() {
  if ((await prisma.knowledgeNode.count()) === 0 && (await prisma.song.count()) > 0) {
    await rebuildKnowledgeGraph();
  }
  const [graph, engines, jobs, plugins, automation, business, daw, songs] = await Promise.all([
    getKnowledgeGraphSummary(),
    getAudioEngineRegistry(),
    listAudioIntelligenceJobs(),
    getPluginPlatformSummary(),
    getAutomationSummary(),
    getCatalogBusinessSummary(),
    getDawIntelligenceSummary(),
    prisma.song.findMany({
      select: {
        id: true,
        title: true,
        status: true,
        bpm: true,
        musicalKey: true,
        genre: true,
        audioFiles: {
          where: { archivedAt: null },
          select: { id: true, fileName: true, fileType: true, qualityStatus: true, filePath: true, durationSeconds: true },
          orderBy: { createdAt: "desc" }
        },
        dawProjects: { select: { id: true, title: true, bpm: true, engineMode: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        rightsProfile: true,
        credits: {
          include: { contributor: { select: { id: true, name: true, ipi: true, isni: true, proAffiliation: true } }, confirmations: { select: { status: true } } },
          orderBy: { createdAt: "asc" }
        },
        releaseTracks: { include: { release: { select: { id: true, title: true, upc: true, status: true } } } }
      },
      orderBy: { updatedAt: "desc" }
    })
  ]);
  const harmonyControl = await getHarmonyControlPlane(engines, jobs);

  return {
    generatedAt: new Date().toISOString(),
    version: "0.26",
    graph,
    engines,
    harmonyControl,
    jobs,
    plugins,
    automation,
    business,
    daw,
    songs,
    principles: [
      "原始音檔只讀分析，不覆蓋、不破壞。",
      "本機引擎優先，選配模型缺少時明確顯示。",
      "自動化先預覽、再核准，可回復衍生紀錄。",
      "DDEX 匯出是審核草稿，不冒充認證交付。"
    ]
  };
}
