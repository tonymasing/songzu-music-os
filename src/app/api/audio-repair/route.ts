import { NextResponse } from "next/server";
import { z } from "zod";

import { archiveAudioFile, getAudioRepairItems, reanalyzeAudioFile } from "@/lib/audio-repair";

export const runtime = "nodejs";

const BulkRepairSchema = z.object({
  action: z.enum(["reanalyze_selected", "archive_missing_selected"]),
  ids: z.array(z.string().min(1)).min(1).max(50),
  reason: z.string().max(1000).optional().nullable()
});

export async function GET() {
  return NextResponse.json(await getAudioRepairItems());
}

export async function POST(request: Request) {
  try {
    const body = BulkRepairSchema.parse(await request.json());
    const ids = Array.from(new Set(body.ids));
    const current = new Map((await getAudioRepairItems()).map(item => [item.id, item]));
    const updated = [];
    const failed: Array<{ id: string; error: string }> = [];
    let skipped = 0, processed = 0;
    const deadline = Date.now() + 60_000;
    for (const id of ids) {
      const item = current.get(id);
      if (!item) { failed.push({ id, error: "找不到音檔紀錄。" }); continue; }
      if (item.archivedAt || (body.action === "archive_missing_selected" ? item.exists : !item.exists)) {
        skipped++;
        continue;
      }
      if (Date.now() >= deadline) { failed.push({ id, error: "本批處理已達時間上限，這個音檔尚未執行。" }); continue; }
      try {
        const result = body.action === "archive_missing_selected"
          ? await archiveAudioFile(id, body.reason || "封存未使用的缺檔紀錄")
          : await reanalyzeAudioFile(id);
        updated.push(result);
        if (body.action === "reanalyze_selected" && result.latestReport?.errorMessage) {
          failed.push({ id, error: result.latestReport.errorMessage });
        } else processed++;
      } catch (error) {
        failed.push({ id, error: error instanceof Error ? error.message : "處理失敗" });
      }
    }
    return NextResponse.json({ items: updated, summary: { action: body.action, requested: ids.length, processed, skipped, failed } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法處理音檔。" }, { status: 400 });
  }
}
