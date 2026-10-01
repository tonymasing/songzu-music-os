import { NextResponse } from "next/server";
import { z } from "zod";

import { runAudioIntelligenceJob } from "@/lib/audio-intelligence";
import { approveAndExecuteAutomation, previewAutomation, rollbackAutomation } from "@/lib/automation-engine";
import {
  addPlatformMetricSnapshot,
  createCatalogBrief,
  exportIndustryMetadata,
  matchCatalogBrief,
  saveSongRightsProfile
} from "@/lib/catalog-business-intelligence";
import { applyAudioJobToDaw, saveDawLatencyProfile } from "@/lib/daw-intelligence";
import { rebuildKnowledgeGraph, searchKnowledgeGraph } from "@/lib/knowledge-graph";
import { getMusicIntelligenceOverview } from "@/lib/music-intelligence";
import { scanLocalPlugins, setPluginQuarantine } from "@/lib/plugin-platform";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rebuild_graph") }),
  z.object({
    action: z.literal("run_audio_job"),
    audioFileId: z.string().min(1),
    jobType: z.enum(["DEEP_ANALYSIS", "TRANSCRIPTION", "STEM_SEPARATION"]),
    target: z.enum(["guitar", "piano", "drums"]).optional(),
    forceReanalysis: z.boolean().optional(),
    comparisonMode: z.boolean().optional()
  }),
  z.object({ action: z.literal("scan_plugins") }),
  z.object({ action: z.literal("set_plugin_quarantine"), pluginId: z.string().min(1), quarantined: z.boolean() }),
  z.object({ action: z.literal("save_effect_chain"), id: z.string().optional(), name: z.string().min(1).max(100), category: z.string().min(1).max(40), description: z.string().max(500).optional(), steps: z.array(z.record(z.string(), z.unknown())).min(1), tags: z.array(z.string()).default([]), favorite: z.boolean().default(false) }),
  z.object({ action: z.literal("preview_workflow"), workflowId: z.string().min(1), songId: z.string().nullable().optional() }),
  z.object({ action: z.literal("approve_workflow"), runId: z.string().min(1) }),
  z.object({ action: z.literal("rollback_workflow"), runId: z.string().min(1) }),
  z.object({
    action: z.literal("create_brief"),
    title: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    useCase: z.string().min(1).max(60),
    query: z.string().min(1).max(1000),
    moods: z.array(z.string()).default([]),
    instruments: z.array(z.string()).default([]),
    genres: z.array(z.string()).default([]),
    bpmMin: z.number().int().min(20).max(300).nullable().optional(),
    bpmMax: z.number().int().min(20).max(300).nullable().optional(),
    requiredRights: z.enum(["one_stop_required", "one_stop_preferred", "any"]).default("one_stop_preferred"),
    allowVocals: z.boolean().default(true)
  }),
  z.object({ action: z.literal("match_brief"), briefId: z.string().min(1) }),
  z.object({
    action: z.literal("save_rights"),
    songId: z.string().min(1),
    alternateTitle: z.string().max(200).nullable().optional(),
    iswc: z.string().max(30).nullable().optional(),
    language: z.string().max(20).default("zh-TW"),
    explicit: z.boolean().default(false),
    territory: z.string().max(100).default("Worldwide"),
    publisher: z.string().max(160).nullable().optional(),
    proAffiliation: z.string().max(120).nullable().optional(),
    masterOwner: z.string().max(160).nullable().optional(),
    publishingOwner: z.string().max(160).nullable().optional(),
    oneStopClearance: z.boolean().default(false),
    masterControlled: z.boolean().default(true),
    publishingControlled: z.boolean().default(true),
    recordingLocation: z.string().max(240).nullable().optional(),
    notes: z.string().max(2000).nullable().optional()
  }),
  z.object({ action: z.literal("export_rights"), songId: z.string().min(1), format: z.enum(["LABEL_COPY_JSON", "DDEX_RIN_DRAFT", "DDEX_ERN_DRAFT", "SPLIT_SHEET_HTML"]) }),
  z.object({
    action: z.literal("add_metric"),
    songId: z.string().nullable().optional(),
    provider: z.string().min(1).max(60),
    externalMediaId: z.string().max(160).nullable().optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    views: z.number().int().min(0).default(0),
    engagedViews: z.number().int().min(0).default(0),
    watchMinutes: z.number().min(0).default(0),
    averageViewDuration: z.number().min(0).default(0),
    likes: z.number().int().min(0).default(0),
    comments: z.number().int().min(0).default(0),
    shares: z.number().int().min(0).default(0),
    subscribersGained: z.number().int().min(0).default(0),
    estimatedRevenue: z.number().min(0).default(0),
    currency: z.string().min(3).max(3).default("TWD")
  }),
  z.object({ action: z.literal("apply_daw_analysis"), jobId: z.string().min(1), projectId: z.string().min(1), applyTempo: z.boolean().default(true), createMarker: z.boolean().default(true) }),
  z.object({
    action: z.literal("save_latency_profile"),
    projectId: z.string().min(1),
    inputDevice: z.string().nullable().optional(),
    outputDevice: z.string().nullable().optional(),
    measuredRoundTripMs: z.number().min(0).max(1000),
    inputCompensationMs: z.number().min(-1000).max(1000),
    monitoringMode: z.enum(["direct", "software", "off"])
  })
]);

const RecoveryQuerySchema = z.object({
  audioFileId: z.string().min(1),
  jobType: z.enum(["DEEP_ANALYSIS", "TRANSCRIPTION", "STEM_SEPARATION"]),
  target: z.enum(["guitar", "piano", "drums"]).optional(),
  since: z.coerce.date()
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "輸入資料不完整", details: error.issues }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "音樂智慧核心執行失敗" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("recoverJob") === "1") {
      const query = RecoveryQuerySchema.parse({
        audioFileId: url.searchParams.get("audioFileId"),
        jobType: url.searchParams.get("jobType"),
        target: url.searchParams.get("target") || undefined,
        since: url.searchParams.get("since")
      });
      const job = await prisma.audioIntelligenceJob.findFirst({
        where: {
          audioFileId: query.audioFileId,
          jobType: query.jobType,
          target: query.target,
          createdAt: { gte: query.since }
        },
        include: {
          audioFile: { select: { id: true, fileName: true, fileType: true } },
          song: { select: { id: true, title: true } }
        },
        orderBy: { createdAt: "desc" }
      });
      return NextResponse.json({ job });
    }
    const query = url.searchParams.get("q")?.trim();
    if (query) return NextResponse.json({ query, results: await searchKnowledgeGraph(query) });
    return NextResponse.json(await getMusicIntelligenceOverview());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = CommandSchema.parse(await request.json());
    switch (body.action) {
      case "rebuild_graph":
        return NextResponse.json({ result: await rebuildKnowledgeGraph() });
      case "run_audio_job":
        return NextResponse.json({ job: await runAudioIntelligenceJob(body) }, { status: 201 });
      case "scan_plugins":
        return NextResponse.json({ result: await scanLocalPlugins() });
      case "set_plugin_quarantine":
        return NextResponse.json({ plugin: await setPluginQuarantine(body.pluginId, body.quarantined) });
      case "save_effect_chain": {
        const data = { name: body.name, category: body.category, description: body.description ?? null, stepsJson: JSON.stringify(body.steps), tagsJson: JSON.stringify(body.tags), favorite: body.favorite, status: "ACTIVE" };
        const chain = body.id ? await prisma.effectChain.update({ where: { id: body.id }, data }) : await prisma.effectChain.create({ data });
        return NextResponse.json({ chain }, { status: body.id ? 200 : 201 });
      }
      case "preview_workflow":
        return NextResponse.json({ run: await previewAutomation(body.workflowId, body.songId) }, { status: 201 });
      case "approve_workflow":
        return NextResponse.json({ run: await approveAndExecuteAutomation(body.runId) });
      case "rollback_workflow":
        return NextResponse.json({ run: await rollbackAutomation(body.runId) });
      case "create_brief":
        return NextResponse.json({ brief: await createCatalogBrief(body) }, { status: 201 });
      case "match_brief":
        return NextResponse.json({ brief: await matchCatalogBrief(body.briefId) });
      case "save_rights":
        return NextResponse.json({ rights: await saveSongRightsProfile(body) });
      case "export_rights":
        return NextResponse.json(await exportIndustryMetadata(body.songId, body.format), { status: 201 });
      case "add_metric":
        return NextResponse.json({ metric: await addPlatformMetricSnapshot({ ...body, source: "manual" }) }, { status: 201 });
      case "apply_daw_analysis":
        return NextResponse.json(await applyAudioJobToDaw(body));
      case "save_latency_profile":
        return NextResponse.json(await saveDawLatencyProfile(body));
    }
  } catch (error) {
    return errorResponse(error);
  }
}
