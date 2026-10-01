import { NextResponse } from "next/server";
import { z } from "zod";

import { getAudioRepairItem } from "@/lib/audio-repair";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AudioVersionPatchSchema = z.object({
  versionName: z.string().trim().max(120).optional().nullable(),
  fileType: z.string().trim().min(1).max(60).optional(),
  parentAudioFileId: z.string().trim().optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = AudioVersionPatchSchema.parse(await request.json());
    const current = await prisma.audioFile.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ error: "找不到音檔紀錄。" }, { status: 404 });
    if (current.archivedAt) return NextResponse.json({ error: "已封存音檔不能設為主要版本或修改來源。" }, { status: 400 });

    const nextFileType = body.fileType ?? current.fileType;
    const nextParentId = body.parentAudioFileId === undefined ? current.parentAudioFileId : body.parentAudioFileId || null;
    const nextPrimary = body.isPrimary ?? current.isPrimary;

    if (nextParentId === id) {
      return NextResponse.json({ error: "音檔不能把自己設為版本來源。" }, { status: 400 });
    }

    if (nextParentId) {
      const songFiles = await prisma.audioFile.findMany({
        where: { songId: current.songId, archivedAt: null },
        select: { id: true, parentAudioFileId: true }
      });
      const byId = new Map(songFiles.map((file) => [file.id, file.parentAudioFileId]));
      if (!byId.has(nextParentId)) {
        return NextResponse.json({ error: "版本來源必須屬於同一首作品。" }, { status: 400 });
      }
      const visited = new Set<string>();
      let cursor: string | null = nextParentId;
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json({ error: "版本來源會形成循環，請改選更早的版本。" }, { status: 400 });
        }
        if (visited.has(cursor)) return NextResponse.json({ error: "版本來源已有循環，請先修正來源關係。" }, { status: 400 });
        visited.add(cursor);
        cursor = byId.get(cursor) ?? null;
      }
    }

    await prisma.$transaction(async (tx) => {
      if (nextPrimary) {
        await tx.audioFile.updateMany({
          where: { songId: current.songId, fileType: nextFileType, archivedAt: null, id: { not: id } },
          data: { isPrimary: false }
        });
      }

      const saved = await tx.audioFile.updateMany({
        where: { id, updatedAt: current.updatedAt, archivedAt: null },
        data: {
          ...(body.versionName !== undefined ? { versionName: body.versionName || null } : {}),
          ...(body.fileType !== undefined ? { fileType: body.fileType } : {}),
          ...(body.parentAudioFileId !== undefined ? { parentAudioFileId: body.parentAudioFileId || null } : {}),
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {})
        }
      });
      if (saved.count !== 1) throw new Error("音檔已被其他工作更新，請重新整理後再試。");

      await tx.timelineEvent.create({
        data: {
          songId: current.songId,
          eventType: "audio_version_updated",
          title: "更新音檔版本治理",
          description: `${body.versionName || current.versionName || current.fileName} 的版本名稱、來源或主要版本設定已更新。`,
          relatedModel: "AudioFile",
          relatedId: id,
          metadataJson: JSON.stringify({ fileType: nextFileType, parentAudioFileId: nextParentId, isPrimary: nextPrimary })
        }
      });
    });

    return NextResponse.json(await getAudioRepairItem(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "音檔版本設定失敗。" },
      { status: 400 }
    );
  }
}
