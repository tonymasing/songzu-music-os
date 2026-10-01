import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";
import { inferUploadMetadata } from "@/lib/production";
import { generateAndStoreAudioQualityReport } from "@/lib/audio-quality";
import { appPath } from "@/lib/paths";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function cleanFileName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "沒有收到檔案" }, { status: 400 });
  }

  const requestedFileType = String(formData.get("fileType") || "auto");
  const versionName = String(formData.get("versionName") || "");
  const notes = String(formData.get("notes") || "");
  const isPrimary = String(formData.get("isPrimary") || "true") === "true";
  const cleanName = cleanFileName(file.name || "upload.bin");
  const inferred = inferUploadMetadata(cleanName, requestedFileType, versionName, notes);
  const folder = appPath("uploads", id);
  const diskName = `${Date.now()}-${cleanName}`;
  const diskPath = join(folder, diskName);

  await mkdir(folder, { recursive: true });
  await writeFile(diskPath, Buffer.from(await file.arrayBuffer()));

  const audioFile = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.audioFile.updateMany({
        where: { songId: id, fileType: inferred.fileType },
        data: { isPrimary: false }
      });
    }

    const created = await tx.audioFile.create({
      data: {
        songId: id,
        fileName: cleanName,
        originalFileName: file.name || cleanName,
        filePath: diskPath,
        storageProvider: "local_upload",
        sourceKind: "upload",
        mimeType: file.type || null,
        fileType: inferred.fileType,
        versionName: inferred.versionName || null,
        fileSizeBytes: file.size,
        qualityStatus: "pending",
        isProtectedOriginal: true,
        isPrimary,
        notes: inferred.notes || null
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId: id,
        eventType: "audio_uploaded",
        title: "上傳新檔案",
        description: `${cleanName} 已存入本機作品庫。`,
        relatedModel: "AudioFile",
        relatedId: created.id
      }
    });

    return created;
  });

  await generateAndStoreAudioQualityReport(audioFile.id);

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
