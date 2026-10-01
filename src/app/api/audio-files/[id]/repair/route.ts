import { NextResponse } from "next/server";
import { z } from "zod";

import { archiveAudioFile, importAudioFileFromExternalPath, reanalyzeAudioFile } from "@/lib/audio-repair";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const RepairActionSchema = z.object({
  action: z.enum(["archive", "import_path", "reanalyze"]),
  sourcePath: z.string().optional().nullable(),
  reason: z.string().optional().nullable()
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = RepairActionSchema.parse(await request.json());
    if (body.action === "archive") {
      return NextResponse.json(await archiveAudioFile(id, body.reason));
    }
    if (body.action === "import_path") {
      return NextResponse.json(await importAudioFileFromExternalPath(id, body.sourcePath ?? ""));
    }
    return NextResponse.json(await reanalyzeAudioFile(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "音檔修復失敗。" },
      { status: 400 }
    );
  }
}
