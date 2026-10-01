import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const inspiration = await prisma.inspiration.findUniqueOrThrow({ where: { id } });
  const moods = inspiration.moodJson ? (JSON.parse(inspiration.moodJson) as string[]) : [];
  const song = await prisma.song.create({
    data: {
      title: inspiration.suggestedTitle || inspiration.title,
      workingTitle: inspiration.title,
      status: "IDEA",
      language: "zh-TW",
      moodJson: JSON.stringify(moods.filter((item) => item !== "待整理")),
      summary: inspiration.content,
      notes: `由靈感收件箱轉成作品：${inspiration.aiCategory ?? "未分類"}`,
      statusHistory: {
        create: {
          toStatus: "IDEA",
          note: "由靈感收件箱建立"
        }
      }
    },
    include: songInclude
  });

  await prisma.inspiration.update({
    where: { id },
    data: {
      status: "PROMOTED",
      linkedSongId: song.id
    }
  });

  return NextResponse.json(toSongDto(song), { status: 201 });
}
