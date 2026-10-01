import { access, stat } from "node:fs/promises";
import { basename } from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateAndStoreAudioQualityReport, toAudioQualityReportDto } from "@/lib/audio-quality";
import { inferUploadMetadata } from "@/lib/production";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ImportExportSchema = z.object({
  exportPath: z.string().min(1),
  songId: z.string().optional().nullable(),
  fileType: z.string().optional().nullable(),
  versionName: z.string().optional().nullable(),
  parentAudioFileId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isPrimary: z.boolean().default(false)
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ImportExportSchema.parse(await request.json());
  const log = await prisma.garageBandOperationLog.findUnique({ where: { id } });

  if (!log) {
    return NextResponse.json({ error: "GarageBand log not found" }, { status: 404 });
  }

  const songId = body.songId ?? log.songId;
  if (!songId) {
    return NextResponse.json({ error: "需要指定歌曲才能匯入 GarageBand export" }, { status: 400 });
  }

  try {
    await access(body.exportPath);
  } catch {
    return NextResponse.json({ error: "export path 不存在，請確認 GarageBand 匯出檔案路徑" }, { status: 400 });
  }

  const fileStat = await stat(body.exportPath);
  const fileName = basename(body.exportPath);
  const inferred = inferUploadMetadata(fileName, body.fileType ?? "auto", body.versionName, body.notes);

  const audioFile = await prisma.$transaction(async (tx) => {
    if (body.isPrimary) {
      await tx.audioFile.updateMany({
        where: { songId, fileType: inferred.fileType },
        data: { isPrimary: false }
      });
    }

    const created = await tx.audioFile.create({
      data: {
        songId,
        fileName,
        originalFileName: fileName,
        filePath: body.exportPath,
        storageProvider: "local_upload",
        sourceKind: "garageband_export",
        fileType: inferred.fileType,
        versionName: inferred.versionName || null,
        fileSizeBytes: fileStat.size,
        parentAudioFileId: body.parentAudioFileId || null,
        originGarageBandLogId: id,
        qualityStatus: "pending",
        isProtectedOriginal: true,
        isPrimary: body.isPrimary,
        notes: inferred.notes || null
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId,
        eventType: "garageband_export_imported",
        title: "匯入 GarageBand 新版本",
        description: `${fileName} 已作為新音檔版本加入，不覆蓋原檔。`,
        relatedModel: "AudioFile",
        relatedId: created.id,
        metadataJson: JSON.stringify({ garageBandLogId: id, exportPath: body.exportPath })
      }
    });

    return created;
  });

  const report = await generateAndStoreAudioQualityReport(audioFile.id);

  return NextResponse.json(
    {
      audioFileId: audioFile.id,
      report: toAudioQualityReportDto(report)
    },
    { status: 201 }
  );
}
