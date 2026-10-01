import { NextResponse } from "next/server";

import { deleteRevenueRecord } from "@/lib/monetization";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteRevenueRecord(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "刪除收入紀錄失敗。" }, { status: 400 });
  }
}
