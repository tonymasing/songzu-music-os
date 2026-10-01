import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { pitchPackInclude, toPitchPackDto } from "@/lib/pitch";
import { prisma } from "@/lib/prisma";

const PitchPackSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  songIds: z.array(z.string()).min(1),
  allowDownload: z.boolean().default(false),
  showLyrics: z.boolean().default(true),
  showCredits: z.boolean().default(true),
  showContact: z.boolean().default(true),
  contactInfo: z.string().optional().nullable()
});

function token() {
  return randomBytes(18).toString("base64url");
}

export async function GET() {
  const packs = await prisma.pitchPack.findMany({
    include: pitchPackInclude,
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json(packs.map(toPitchPackDto));
}

export async function POST(request: Request) {
  const body = PitchPackSchema.parse(await request.json());
  const pack = await prisma.pitchPack.create({
    data: {
      token: token(),
      title: body.title,
      description: body.description || null,
      allowDownload: body.allowDownload,
      showLyrics: body.showLyrics,
      showCredits: body.showCredits,
      showContact: body.showContact,
      contactInfo: body.contactInfo || null,
      songs: {
        create: body.songIds.map((songId, index) => ({
          songId,
          sortOrder: index
        }))
      }
    },
    include: pitchPackInclude
  });

  return NextResponse.json(toPitchPackDto(pack), { status: 201 });
}
