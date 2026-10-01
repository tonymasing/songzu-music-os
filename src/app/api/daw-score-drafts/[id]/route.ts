import { NextResponse } from "next/server";
import { z } from "zod";

import { createAutoScoreBenchmarkBaseline } from "@/lib/auto-score";
import { getScoreDraft, parseScoreResult, toScoreDraftDto } from "@/lib/score-drafts";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateScoreDraftSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  status: z.enum(["DRAFT", "REVIEWED", "APPLIED", "ARCHIVED"]).optional(),
  confidence: z.number().min(0).max(100).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  musicalKey: z.string().min(1).max(24).optional(),
  timeSignature: z.string().regex(/^\d{1,2}\/\d{1,2}$/).optional(),
  durationSeconds: z.number().positive().max(60 * 60 * 24).optional(),
  result: z.record(z.string(), z.unknown()).optional()
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  return NextResponse.json({ draft: toScoreDraftDto(draft) });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateScoreDraftSchema.parse(await request.json());
  if (body.result && body.result.format !== "songzu-auto-score") {
    return NextResponse.json({ error: "採譜資料格式不正確" }, { status: 400 });
  }
  const existing = await getScoreDraft(id);
  if (!existing) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const existingResult = parseScoreResult(existing.resultJson);
  const incomingResult = body.result ? parseScoreResult(JSON.stringify(body.result)) : undefined;
  const protectedIncomingResult = incomingResult ? {
    ...incomingResult,
    benchmarkBaseline: existingResult.benchmarkBaseline ?? createAutoScoreBenchmarkBaseline(existingResult),
    humanBenchmark: existingResult.humanBenchmark
  } : undefined;
  if (existingResult.review?.status === "finalized" && body.result) {
    return NextResponse.json({ error: "正式譜已鎖定，請先建立修訂版再修改" }, { status: 409 });
  }
  if (body.status === "REVIEWED") {
    const nextResult = protectedIncomingResult;
    if ((nextResult ?? existingResult).targetInstrument === "guitar" && (
      (nextResult ?? existingResult).review?.status !== "finalized" ||
      (nextResult ?? existingResult).review?.verificationMethod !== "manual"
    )) {
      return NextResponse.json({ error: "吉他譜必須先完成全部逐拍人工確認並鎖定，不能直接標記為已審核" }, { status: 409 });
    }
  }
  await prisma.dawScoreDraft.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
      ...(body.bpm !== undefined ? { bpm: body.bpm } : {}),
      ...(body.musicalKey !== undefined ? { musicalKey: body.musicalKey } : {}),
      ...(body.timeSignature !== undefined ? { timeSignature: body.timeSignature } : {}),
      ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
      ...(protectedIncomingResult !== undefined ? { resultJson: JSON.stringify(protectedIncomingResult) } : {})
    }
  });
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  return NextResponse.json({ draft: toScoreDraftDto(draft) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.dawScoreDraft.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
