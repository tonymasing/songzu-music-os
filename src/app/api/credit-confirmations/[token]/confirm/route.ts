import { NextResponse } from "next/server";
import { z } from "zod";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const ConfirmSchema = z.object({
  displayName: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const body = ConfirmSchema.parse(await request.json());
  const current = await prisma.creditConfirmation.findUnique({
    where: { token },
    include: { credit: true }
  });

  if (!current) {
    return NextResponse.json({ error: "Confirmation not found" }, { status: 404 });
  }

  const confirmation = await prisma.$transaction(async (tx) => {
    const updated = await tx.creditConfirmation.update({
      where: { token },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        displayName: body.displayName || current.displayName,
        notes: body.notes || current.notes
      },
      include: { credit: { include: { song: true, contributor: true } } }
    });

    await tx.timelineEvent.create({
      data: {
        songId: current.credit.songId,
        eventType: "credit_confirmed",
        title: "合作人完成分潤確認",
        description: `${updated.credit.contributor.name} 已確認 ${updated.credit.role} / ${updated.credit.splitPercentage ?? 0}%。`,
        relatedModel: "CreditConfirmation",
        relatedId: updated.id
      }
    });

    return updated;
  });

  return NextResponse.json({
    id: confirmation.id,
    token: confirmation.token,
    status: confirmation.status,
    confirmedAt: toIso(confirmation.confirmedAt),
    displayName: confirmation.displayName,
    notes: confirmation.notes,
    songTitle: confirmation.credit.song.title,
    contributorName: confirmation.credit.contributor.name
  });
}
