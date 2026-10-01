import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { songInclude, toSongDto } from "@/lib/music";

const CreditSchema = z.object({
  contributorId: z.string().min(1),
  role: z.string().min(1),
  splitPercentage: z.number().min(0).max(100).optional().nullable(),
  ownershipType: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreditSchema.parse(await request.json());

  await prisma.$transaction(async (tx) => {
    const credit = await tx.credit.create({
      data: {
        songId: id,
        contributorId: body.contributorId,
        role: body.role,
        splitPercentage: body.splitPercentage ?? null,
        ownershipType: body.ownershipType || null,
        notes: body.notes || null
      },
      include: { contributor: true }
    });

    await tx.timelineEvent.create({
      data: {
        songId: id,
        eventType: "credit_created",
        title: "新增製作名單",
        description: `${credit.contributor.name} / ${credit.role} / ${credit.splitPercentage ?? 0}%`,
        relatedModel: "Credit",
        relatedId: credit.id
      }
    });
  });

  const song = await prisma.song.findUniqueOrThrow({ where: { id }, include: songInclude });
  return NextResponse.json(toSongDto(song), { status: 201 });
}
