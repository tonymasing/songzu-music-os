import { NextResponse } from "next/server";
import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { saveTrackDsp } from "@/lib/daw-dsp-persistence";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    if (typeof body.baseRevision !== "string") return NextResponse.json({ error: "缺少 DSP 版本。" }, { status: 400 });
    const saved = await saveTrackDsp(id, body.baseRevision, body.patch);
    const project = await getDawProjectById(saved.projectId);
    return NextResponse.json({ project: project ? toDawProjectDto(project) : null, operationId: saved.operationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DSP 儲存失敗。";
    if (message.includes("別處修改")) {
      const track = await prisma.dawTrack.findUnique({ where: { id } });
      const project = track ? await getDawProjectById(track.projectId) : null;
      return NextResponse.json({ error: message, project: project ? toDawProjectDto(project) : null }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
