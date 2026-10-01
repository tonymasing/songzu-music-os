import { NextResponse } from "next/server";

import { createSystemBackup, listSystemBackups, openSystemBackup } from "@/lib/system-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fileName = new URL(request.url).searchParams.get("file");
  if (!fileName) return NextResponse.json({ backups: await listSystemBackups() });

  const backup = await openSystemBackup(fileName);
  if (!backup) return NextResponse.json({ error: "備份檔案不存在" }, { status: 404 });
  return new Response(backup.stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(backup.size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": "no-store"
    }
  });
}

export async function POST() {
  try {
    return NextResponse.json(await createSystemBackup(), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "建立備份失敗" },
      { status: 500 }
    );
  }
}
