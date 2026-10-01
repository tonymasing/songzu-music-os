import { NextResponse } from "next/server";
import { z } from "zod";

import { createRevenueRecord, listRevenueRecords, toRevenueRecordDto } from "@/lib/monetization";

export const runtime = "nodejs";

const RevenueSchema = z.object({
  songId: z.string().min(1).optional().nullable(),
  platform: z.string().trim().min(1).max(80),
  revenueType: z.string().trim().min(1).max(80),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  grossAmount: z.number().finite(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  source: z.string().trim().min(1).max(80).default("manual"),
  externalReference: z.string().max(240).optional().nullable(),
  notes: z.string().max(1000).optional().nullable()
});

export async function GET() {
  return NextResponse.json(await listRevenueRecords());
}

export async function POST(request: Request) {
  try {
    const body = RevenueSchema.parse(await request.json());
    const record = await createRevenueRecord({
      ...body,
      periodStart: new Date(`${body.periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${body.periodEnd}T23:59:59.999Z`)
    });
    return NextResponse.json(toRevenueRecordDto(record), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增收入紀錄失敗。" }, { status: 400 });
  }
}
