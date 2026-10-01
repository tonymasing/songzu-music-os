import { NextResponse } from "next/server";
import { z } from "zod";

import { nativeDawRequest } from "@/lib/native-daw";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type NativeHealth = {
  ok: boolean;
  mode: string;
  recording?: {
    status?: string;
    recordingId?: string | null;
    peak?: number;
    rms?: number;
    clipping?: boolean;
    xrunCount?: number;
    inputOverflowCount?: number;
    outputUnderflowCount?: number;
    diskWriteErrorCount?: number;
    callbackLoad?: number;
    freeDiskBytes?: number;
    error?: string | null;
  };
  recoverableRecordings?: Array<{ relativePath: string; fileSizeBytes: number; recoverable: boolean }>;
};

async function health() {
  return nativeDawRequest<NativeHealth>("/health", { timeoutMs: 1_500 });
}

export async function GET() {
  try {
    return NextResponse.json(await health());
  } catch (error) {
    return NextResponse.json({ ok: false, mode: "web_fallback", error: error instanceof Error ? error.message : "原生引擎健康檢查失敗。" });
  }
}

export async function POST(request: Request) {
  const body = z.object({ projectId: z.string().min(1) }).parse(await request.json());
  try {
    const result = await health();
    const recording = result.recording ?? {};
    const status = recording.error || (recording.xrunCount ?? 0) > 0 || (recording.diskWriteErrorCount ?? 0) > 0
      ? "warning"
      : recording.clipping
        ? "clipping"
        : "healthy";
    const snapshot = await prisma.dawEngineHealthSnapshot.create({
      data: {
        projectId: body.projectId,
        recordingId: recording.recordingId ?? null,
        status,
        peak: recording.peak ?? 0,
        rms: recording.rms ?? 0,
        truePeak: recording.peak ?? null,
        clipping: Boolean(recording.clipping),
        xrunCount: recording.xrunCount ?? 0,
        inputOverflowCount: recording.inputOverflowCount ?? 0,
        outputUnderflowCount: recording.outputUnderflowCount ?? 0,
        diskWriteErrorCount: recording.diskWriteErrorCount ?? 0,
        callbackLoad: recording.callbackLoad ?? 0,
        freeDiskBytes: recording.freeDiskBytes == null ? null : BigInt(Math.max(0, Math.round(recording.freeDiskBytes))),
        detailsJson: JSON.stringify({ mode: result.mode, error: recording.error ?? null, recoverableRecordings: result.recoverableRecordings ?? [] })
      }
    });
    return NextResponse.json({ health: result, snapshot: { ...snapshot, freeDiskBytes: snapshot.freeDiskBytes?.toString() ?? null } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "無法保存健康快照。" }, { status: 503 });
  }
}
