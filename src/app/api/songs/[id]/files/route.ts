import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

const FileSchema = z.object({
  fileName: z.string().min(1),
  filePath: z.string().optional().nullable(),
  fileType: z.string().min(1),
  versionName: z.string().optional().nullable(),
  durationSeconds: z.number().optional().nullable(),
  lufs: z.number().optional().nullable(),
  truePeak: z.number().optional().nullable(),
  isPrimary: z.boolean().default(false),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = FileSchema.parse(await request.json());

  await prisma.$transaction(async (tx) => {
    if (body.isPrimary) {
      await tx.audioFile.updateMany({
        where: { songId: id, fileType: body.fileType },
        data: { isPrimary: false }
      });
    }

    const audioFile = await tx.audioFile.create({
      data: {
        songId: id,
        fileName: body.fileName,
        originalFileName: body.fileName,
        filePath: body.filePath || null,
        sourceKind: "external_path",
        qualityStatus: "pending",
        isProtectedOriginal: true,
        fileType: body.fileType,
        versionName: body.versionName || null,
        durationSeconds: body.durationSeconds ?? null,
        lufs: body.lufs ?? null,
        truePeak: body.truePeak ?? null,
        isPrimary: body.isPrimary,
        notes: body.notes || null
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId: id,
        eventType: "audio_file_recorded",
        title: "新增檔案紀錄",
        description: `${body.fileName} 已加入作品檔案清單。`,
        relatedModel: "AudioFile",
        relatedId: audioFile.id
      }
    });
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
