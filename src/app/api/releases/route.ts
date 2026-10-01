import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { releaseInclude, toReleaseDto } from "@/lib/releases";

const CreateReleaseSchema = z.object({
  title: z.string().trim().min(1),
  releaseType: z.enum(["SINGLE", "EP", "ALBUM", "COLLECTION"]).default("SINGLE"),
  releaseDate: z.string().optional().nullable(),
  songIds: z.array(z.string()).min(1),
  upc: z.string().optional().nullable(),
  copyrightLine: z.string().optional().nullable(),
  publishingLine: z.string().optional().nullable()
});

const defaultChecklist = [
  ["確認曲名、版本與發行順序", "metadata"],
  ["確認詞曲、製作名單與分潤", "rights"],
  ["確認母帶音質、封面與平台尺寸", "asset"],
  ["完成發行文案與平台描述", "copy"],
  ["完成短影音與宣傳素材", "marketing"]
] as const;

export async function GET() {
  const releases = await prisma.release.findMany({ include: releaseInclude, orderBy: [{ releaseDate: "asc" }, { createdAt: "desc" }] });
  return NextResponse.json(releases.map(toReleaseDto));
}

export async function POST(request: Request) {
  const body = CreateReleaseSchema.parse(await request.json());
  const uniqueSongIds = [...new Set(body.songIds)];
  const songs = await prisma.song.findMany({ where: { id: { in: uniqueSongIds } }, select: { id: true } });
  if (songs.length !== uniqueSongIds.length) return NextResponse.json({ error: "部分歌曲不存在，請重新選擇曲目。" }, { status: 400 });

  const release = await prisma.release.create({
    data: {
      title: body.title,
      releaseType: body.releaseType,
      status: "PLANNING",
      releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
      upc: body.upc || null,
      copyrightLine: body.copyrightLine || null,
      publishingLine: body.publishingLine || null,
      tracks: {
        create: uniqueSongIds.map((songId, index) => ({ songId, trackNumber: index + 1 }))
      },
      checklistItems: {
        create: defaultChecklist.map(([title, category], index) => ({ title, category, required: true, sortOrder: index + 1 }))
      }
    },
    include: releaseInclude
  });
  return NextResponse.json(toReleaseDto(release), { status: 201 });
}
