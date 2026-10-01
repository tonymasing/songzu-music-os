import { NextResponse } from "next/server";

import { generateAndStoreAudioQualityReport, toAudioQualityReportDto } from "@/lib/audio-quality";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const reports = await prisma.audioQualityReport.findMany({
    where: { audioFileId: id },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return NextResponse.json(reports.map(toAudioQualityReportDto));
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const report = await generateAndStoreAudioQualityReport(id);
  return NextResponse.json(toAudioQualityReportDto(report), { status: 201 });
}
