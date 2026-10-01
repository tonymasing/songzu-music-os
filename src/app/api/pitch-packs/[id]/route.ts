import { NextResponse } from "next/server";
import { z } from "zod";

import { pitchPackInclude, toPitchPackDto } from "@/lib/pitch";
import { prisma } from "@/lib/prisma";

const PatchPitchPackSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  songIds: z.array(z.string()).min(1).optional(),
  allowDownload: z.boolean().optional(),
  showLyrics: z.boolean().optional(),
  showCredits: z.boolean().optional(),
  showContact: z.boolean().optional(),
  contactInfo: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchPitchPackSchema.parse(await request.json());

  await prisma.$transaction(async (tx) => {
    await tx.pitchPack.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.allowDownload !== undefined ? { allowDownload: body.allowDownload } : {}),
        ...(body.showLyrics !== undefined ? { showLyrics: body.showLyrics } : {}),
        ...(body.showCredits !== undefined ? { showCredits: body.showCredits } : {}),
        ...(body.showContact !== undefined ? { showContact: body.showContact } : {}),
        ...(body.contactInfo !== undefined ? { contactInfo: body.contactInfo || null } : {})
      }
    });

    if (body.songIds) {
      await tx.pitchPackSong.deleteMany({ where: { pitchPackId: id } });
      await tx.pitchPackSong.createMany({
        data: body.songIds.map((songId, index) => ({
          pitchPackId: id,
          songId,
          sortOrder: index
        }))
      });
    }
  });

  const pack = await prisma.pitchPack.findUniqueOrThrow({
    where: { id },
    include: pitchPackInclude
  });

  return NextResponse.json(toPitchPackDto(pack));
}
