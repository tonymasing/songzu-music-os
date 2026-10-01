import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonValue, songInclude, toIso, toSongDto } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const IssueSchema = z.object({
  timestampSeconds: z.number().min(0),
  issueType: z.string().min(1),
  severity: z.string().min(1).default("medium"),
  title: z.string().min(1),
  detail: z.string().min(1),
  suggestion: z.string().optional().nullable(),
  measuredValue: z.number().optional().nullable(),
  expectedValue: z.number().optional().nullable()
});

const ReportSchema = z.object({
  detectionMode: z.string().min(1).default("timing_pitch"),
  overallScore: z.number().int().min(0).max(100),
  timingScore: z.number().int().min(0).max(100).optional().nullable(),
  pitchScore: z.number().int().min(0).max(100).optional().nullable(),
  levelScore: z.number().int().min(0).max(100).optional().nullable(),
  durationSeconds: z.number().positive().optional().nullable(),
  peak: z.number().min(0).optional().nullable(),
  rms: z.number().min(0).optional().nullable(),
  tempoDriftMs: z.number().optional().nullable(),
  pitchDriftCents: z.number().optional().nullable(),
  summary: z.string().min(1),
  recommendations: z.array(z.string()).optional().default([]),
  metrics: z.record(z.string(), z.unknown()).optional().default({}),
  issues: z.array(IssueSchema).optional().default([]),
  createTimestampComments: z.boolean().optional().default(true)
});

function commentCategory(issueType: string) {
  if (issueType === "timing") return "節奏";
  if (issueType === "pitch") return "人聲";
  if (issueType === "level" || issueType === "clipping") return "混音";
  return "其他";
}

function toReportDto(report: {
  id: string;
  recordingTakeId: string;
  songId: string;
  audioFileId: string | null;
  analyzer: string;
  detectionMode: string;
  overallScore: number;
  timingScore: number | null;
  pitchScore: number | null;
  levelScore: number | null;
  durationSeconds: number | null;
  peak: number | null;
  rms: number | null;
  tempoDriftMs: number | null;
  pitchDriftCents: number | null;
  summary: string;
  recommendationsJson: string | null;
  metricsJson: string | null;
  createdAt: Date;
  issues: Array<{
    id: string;
    reportId: string;
    recordingTakeId: string;
    songId: string;
    audioFileId: string | null;
    timestampSeconds: number;
    issueType: string;
    severity: string;
    title: string;
    detail: string;
    suggestion: string | null;
    measuredValue: number | null;
    expectedValue: number | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: report.id,
    recordingTakeId: report.recordingTakeId,
    songId: report.songId,
    audioFileId: report.audioFileId,
    analyzer: report.analyzer,
    detectionMode: report.detectionMode,
    overallScore: report.overallScore,
    timingScore: report.timingScore,
    pitchScore: report.pitchScore,
    levelScore: report.levelScore,
    durationSeconds: report.durationSeconds,
    peak: report.peak,
    rms: report.rms,
    tempoDriftMs: report.tempoDriftMs,
    pitchDriftCents: report.pitchDriftCents,
    summary: report.summary,
    recommendations: parseJsonValue<string[]>(report.recommendationsJson, []),
    metrics: parseJsonValue<Record<string, unknown>>(report.metricsJson, {}),
    createdAt: toIso(report.createdAt),
    issues: report.issues.map((issue) => ({
      ...issue,
      createdAt: toIso(issue.createdAt)
    }))
  };
}

function numericArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ReportSchema.parse(await request.json());
  const take = await prisma.recordingTake.findUnique({
    where: { id },
    include: { audioFile: true, session: true }
  });

  if (!take) {
    return NextResponse.json({ error: "Recording take not found" }, { status: 404 });
  }

  const waveform = numericArray(body.metrics.waveform);
  const energy = numericArray(body.metrics.energy);
  const createdReport = await prisma.$transaction(async (tx) => {
    const report = await tx.performanceAnalysisReport.create({
      data: {
        recordingTakeId: take.id,
        songId: take.songId,
        audioFileId: take.audioFileId,
        analyzer: "browser_web_audio",
        detectionMode: body.detectionMode,
        overallScore: body.overallScore,
        timingScore: body.timingScore ?? null,
        pitchScore: body.pitchScore ?? null,
        levelScore: body.levelScore ?? null,
        durationSeconds: body.durationSeconds ?? null,
        peak: body.peak ?? null,
        rms: body.rms ?? null,
        tempoDriftMs: body.tempoDriftMs ?? null,
        pitchDriftCents: body.pitchDriftCents ?? null,
        summary: body.summary,
        recommendationsJson: JSON.stringify(body.recommendations),
        metricsJson: JSON.stringify(body.metrics)
      }
    });

    if (body.issues.length) {
      await tx.performanceIssue.createMany({
        data: body.issues.map((issue) => ({
          reportId: report.id,
          recordingTakeId: take.id,
          songId: take.songId,
          audioFileId: take.audioFileId,
          timestampSeconds: issue.timestampSeconds,
          issueType: issue.issueType,
          severity: issue.severity,
          title: issue.title,
          detail: issue.detail,
          suggestion: issue.suggestion ?? null,
          measuredValue: issue.measuredValue ?? null,
          expectedValue: issue.expectedValue ?? null
        }))
      });

      if (body.createTimestampComments && take.audioFileId) {
        await tx.audioComment.createMany({
          data: body.issues.slice(0, 12).map((issue) => ({
            audioFileId: take.audioFileId!,
            songId: take.songId,
            timestampSeconds: issue.timestampSeconds,
            category: commentCategory(issue.issueType),
            status: "TODO",
            body: `[錄音偵測] ${issue.title}：${issue.detail}`
          }))
        });
      }
    }

    if (take.audioFileId && (waveform.length || energy.length)) {
      await tx.audioAnalysis.create({
        data: {
          audioFileId: take.audioFileId,
          durationSeconds: body.durationSeconds ?? null,
          peak: body.peak ?? null,
          rms: body.rms ?? null,
          energyJson: JSON.stringify(energy),
          waveformJson: JSON.stringify(waveform),
          suggestedBpm: take.session.targetBpm ?? null,
          suggestedMoodJson: JSON.stringify(body.overallScore >= 80 ? ["錄音穩定"] : ["需要重錄檢查"]),
          suggestedUseCaseJson: JSON.stringify(["錄音偵測", take.session.targetInstrument])
        }
      });

      await tx.audioFile.update({
        where: { id: take.audioFileId },
        data: { durationSeconds: body.durationSeconds ?? take.audioFile?.durationSeconds ?? null }
      });
    }

    await tx.recordingTake.update({
      where: { id: take.id },
      data: { status: "ANALYZED" }
    });

    await tx.timelineEvent.create({
      data: {
        songId: take.songId,
        eventType: "performance_analysis",
        title: "完成錄音準確度偵測",
        description: `${take.label}：${body.summary}`,
        relatedModel: "PerformanceAnalysisReport",
        relatedId: report.id,
        metadataJson: JSON.stringify({
          recordingTakeId: take.id,
          audioFileId: take.audioFileId,
          overallScore: body.overallScore,
          issues: body.issues.length
        })
      }
    });

    return tx.performanceAnalysisReport.findUniqueOrThrow({
      where: { id: report.id },
      include: { issues: { orderBy: { timestampSeconds: "asc" } } }
    });
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id: take.songId }, include: songInclude });
  return NextResponse.json(
    {
      report: toReportDto(createdReport),
      song: toSongDto(song)
    },
    { status: 201 }
  );
}
