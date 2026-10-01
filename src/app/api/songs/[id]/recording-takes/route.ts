import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { appPath } from "@/lib/paths";
import { ingestStoredRecording } from "@/lib/recording-ingest";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function cleanFileName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim();
}

function asInt(value: FormDataEntryValue | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function asNumber(value: FormDataEntryValue | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "沒有收到錄音檔" }, { status: 400 });
  }

  const targetInstrument = String(formData.get("targetInstrument") || "vocal");
  const detectionMode = String(formData.get("detectionMode") || "timing_pitch");
  const targetBpm = asInt(formData.get("targetBpm"));
  const targetKey = String(formData.get("targetKey") || "").trim();
  const metronomeEnabled = String(formData.get("metronomeEnabled") || "true") === "true";
  const notes = String(formData.get("notes") || "").trim();
  const sessionId = String(formData.get("sessionId") || "").trim();
  const dawTrackId = String(formData.get("dawTrackId") || "").trim();
  const inputDeviceLabel = String(formData.get("inputDeviceLabel") || "系統預設輸入").trim();
  const channelMode = String(formData.get("channelMode") || "mono") === "stereo" ? "stereo" : "mono";
  const countInBars = asInt(formData.get("countInBars")) ?? 0;
  const recordMode = String(formData.get("recordMode") || "full") === "punch" ? "punch" : "full";
  const punchInSeconds = asNumber(formData.get("punchInSeconds"));
  const punchOutSeconds = asNumber(formData.get("punchOutSeconds"));
  const timelineStartSeconds = Math.max(0, asNumber(formData.get("timelineStartSeconds")) ?? punchInSeconds ?? 0);
  const requestedSampleRate = asInt(formData.get("requestedSampleRate"));
  const captureLeadSeconds = Math.min(5, Math.max(0, asNumber(formData.get("captureLeadSeconds")) ?? 0));
  const overdubCueEnabled = String(formData.get("overdubCueEnabled") || "false") === "true";
  const cleanName = cleanFileName(file.name || `recording-${Date.now()}.webm`);
  const folder = appPath("uploads", id, "recordings");
  const diskName = `${Date.now()}-${cleanName}`;
  const diskPath = join(folder, diskName);

  await mkdir(folder, { recursive: true });
  await writeFile(diskPath, Buffer.from(await file.arrayBuffer()));

  const result = await ingestStoredRecording({
    songId: id,
    diskPath,
    fileName: cleanName,
    originalFileName: file.name || cleanName,
    mimeType: file.type || "audio/webm",
    fileSizeBytes: file.size,
    targetInstrument,
    detectionMode,
    targetBpm,
    targetKey,
    metronomeEnabled,
    notes,
    sessionId: sessionId || undefined,
    dawTrackId: dawTrackId || undefined,
    inputDeviceLabel,
    channelMode,
    countInBars,
    recordMode,
    punchInSeconds,
    punchOutSeconds,
    timelineStartSeconds,
    requestedSampleRate,
    captureLeadSeconds,
    overdubCueEnabled
  });

  return NextResponse.json(result, { status: 201 });
}
