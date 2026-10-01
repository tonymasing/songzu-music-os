import { access } from "node:fs/promises";

import { NextResponse } from "next/server";

import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { nativeDawRequest } from "@/lib/native-daw";
import { appPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

type RecoveryList = { ok: boolean; files: Array<{ relativePath: string; fileSizeBytes: number; recoverable: boolean }> };
type RecoveryResult = { ok: boolean; recovered: string[]; skipped: string[] };

export async function GET() {
  try {
    return NextResponse.json(await nativeDawRequest<RecoveryList>("/recordings/recovery", { timeoutMs: 2_500 }));
  } catch (error) {
    return NextResponse.json({ ok: false, files: [], mode: "web_fallback", error: error instanceof Error ? error.message : "無法列出事故錄音。" });
  }
}

export async function POST() {
  try {
    const result = await nativeDawRequest<RecoveryResult>("/recordings/recovery", { method: "POST", body: "{}", timeoutMs: 30_000 });
    const imported: string[] = [];
    for (const relativePath of result.recovered) {
      const match = relativePath.match(/^uploads\/([^/]+)\/recordings\/([^/]+\.wav)$/);
      if (!match) continue;
      const [, songId, fileName] = match;
      const song = await prisma.song.findUnique({ where: { id: songId }, select: { id: true } });
      if (!song) continue;
      const absolutePath = appPath(...relativePath.split("/"));
      await access(absolutePath);
      const existing = await prisma.audioFile.findFirst({ where: { songId, filePath: absolutePath } });
      const audioFile = existing ?? await prisma.audioFile.create({
        data: {
          songId,
          fileName,
          originalFileName: fileName,
          filePath: absolutePath,
          storageProvider: "local_native",
          sourceKind: "native_recovery",
          mimeType: "audio/wav",
          codecName: "pcm_s24le",
          containerFormat: "wav",
          fileType: "demo",
          versionName: `recovered_${new Date().toISOString().replace(/[:.]/g, "-")}`,
          qualityStatus: "pending",
          isProtectedOriginal: true,
          notes: "由 DAW 事故復原層從安全暫存 WAV 救回，請重新確認內容與時間位置。"
        }
      });
      await generateAndStoreAudioQualityReport(audioFile.id).catch(() => null);
      await prisma.timelineEvent.create({
        data: {
          songId,
          eventType: "daw_recording_recovered",
          title: "救回未完成錄音",
          description: `${fileName} 已從安全暫存檔救回並保留原始 PCM 資料。`,
          relatedModel: "AudioFile",
          relatedId: audioFile.id
        }
      });
      imported.push(audioFile.id);
    }
    return NextResponse.json({ ...result, importedAudioFileIds: imported });
  } catch (error) {
    return NextResponse.json({ ok: false, recovered: [], skipped: [], error: error instanceof Error ? error.message : "事故錄音復原失敗。" }, { status: 503 });
  }
}
