import { NextResponse } from "next/server";
import { z } from "zod";

import { isLoopbackRequest } from "@/lib/local-request";
import {
  buildStorageMigrationPlan,
  executeStorageMigration,
  getStorageStatus,
  recommendedStorageTargets
} from "@/lib/storage-layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TargetsSchema = z.object({
  databasePath: z.string().trim().min(1),
  mediaRoot: z.string().trim().min(1),
  cacheRoot: z.string().trim().min(1),
  configPath: z.string().trim().min(1)
});

const ActionSchema = z.object({
  action: z.enum(["plan", "migrate"]),
  targets: TargetsSchema
});

function localOnly() {
  return NextResponse.json(
    { error: "儲存搬移只能在執行頌祖音樂 OS 的 Mac 或桌面 App 上操作。" },
    { status: 403 }
  );
}

export async function GET() {
  const status = await getStorageStatus();
  return NextResponse.json({ status, recommended: recommendedStorageTargets(status.layout) });
}

export async function POST(request: Request) {
  if (!isLoopbackRequest(request)) return localOnly();
  try {
    const body = ActionSchema.parse(await request.json());
    if (body.action === "plan") return NextResponse.json(await buildStorageMigrationPlan(body.targets));
    return NextResponse.json(await executeStorageMigration(body.targets), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "儲存路徑格式不完整。", details: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "儲存搬移失敗。" },
      { status: 500 }
    );
  }
}
