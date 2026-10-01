import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { toIso } from "@/lib/music";

const CommentSchema = z.object({
  timestampSeconds: z.number().min(0),
  body: z.string().min(1),
  category: z.string().min(1).default("其他"),
  status: z.string().min(1).default("TODO")
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function toCommentDto(comment: {
  id: string;
  audioFileId: string;
  songId: string;
  timestampSeconds: number;
  body: string;
  category: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...comment,
    createdAt: toIso(comment.createdAt),
    updatedAt: toIso(comment.updatedAt)
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const comments = await prisma.audioComment.findMany({
    where: { audioFileId: id },
    orderBy: { createdAt: "asc" }
  });

  return NextResponse.json(comments.map(toCommentDto));
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CommentSchema.parse(await request.json());
  const audioFile = await prisma.audioFile.findUnique({ where: { id } });

  if (!audioFile) {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.audioComment.create({
      data: {
        audioFileId: id,
        songId: audioFile.songId,
        timestampSeconds: body.timestampSeconds,
        body: body.body,
        category: body.category,
        status: body.status
      }
    });

    await tx.timelineEvent.create({
      data: {
        songId: audioFile.songId,
        eventType: "audio_comment",
        title: "新增時間點留言",
        description: `${audioFile.fileName} @ ${Math.round(body.timestampSeconds)} 秒：${body.body}`,
        relatedModel: "AudioComment",
        relatedId: created.id
      }
    });

    return created;
  });

  return NextResponse.json(toCommentDto(comment), { status: 201 });
}
