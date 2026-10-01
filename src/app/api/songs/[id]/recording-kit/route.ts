import { NextResponse } from "next/server";

import { exportRecordingKit, listRecordingKits, readRecordingKitZip } from "@/lib/recording-kit";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const fileName = url.searchParams.get("file");

  if (!fileName) {
    return NextResponse.json(await listRecordingKits(id));
  }

  try {
    const file = await readRecordingKitZip(id, fileName);
    return new Response(file.bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`
      }
    });
  } catch {
    return NextResponse.json({ error: "錄音素材包不存在" }, { status: 404 });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    return NextResponse.json(await exportRecordingKit(id), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "錄音素材包匯出失敗" },
      { status: 400 }
    );
  }
}
