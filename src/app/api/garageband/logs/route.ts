import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const GarageBandLogSchema = z.object({
  songId: z.string().optional().nullable(),
  operation: z.string().min(1),
  command: z.string().min(1),
  payload: z.unknown().optional().nullable(),
  payloadJson: z.string().optional().nullable(),
  requiresConfirmation: z.boolean().default(false),
  approvalStatus: z.string().optional(),
  resultStatus: z.string().optional(),
  notes: z.string().optional().nullable()
});

type GarageBandLogWithSong = {
  id: string;
  songId: string | null;
  operation: string;
  command: string;
  payloadJson: string | null;
  requiresConfirmation: boolean;
  approvalStatus: string;
  resultStatus: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  song?: { id: string; title: string } | null;
};

function toLogDto(log: GarageBandLogWithSong) {
  return {
    id: log.id,
    songId: log.songId,
    songTitle: log.song?.title ?? null,
    operation: log.operation,
    command: log.command,
    payload: parseJsonValue<Record<string, unknown> | null>(log.payloadJson, null),
    payloadJson: log.payloadJson,
    requiresConfirmation: log.requiresConfirmation,
    approvalStatus: log.approvalStatus,
    resultStatus: log.resultStatus,
    notes: log.notes,
    createdAt: toIso(log.createdAt),
    updatedAt: toIso(log.updatedAt)
  };
}

export async function GET() {
  const logs = await prisma.garageBandOperationLog.findMany({
    include: { song: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  return NextResponse.json(logs.map(toLogDto));
}

export async function POST(request: Request) {
  const body = GarageBandLogSchema.parse(await request.json());
  const payloadJson = body.payloadJson ?? (body.payload ? JSON.stringify(body.payload, null, 2) : null);

  const log = await prisma.$transaction(async (tx) => {
    const created = await tx.garageBandOperationLog.create({
      data: {
        songId: body.songId || null,
        operation: body.operation,
        command: body.command,
        payloadJson,
        requiresConfirmation: body.requiresConfirmation,
        approvalStatus: body.approvalStatus ?? (body.requiresConfirmation ? "PENDING" : "APPROVED"),
        resultStatus: body.resultStatus ?? "QUEUED",
        notes: body.notes || null
      },
      include: { song: { select: { id: true, title: true } } }
    });

    if (created.songId) {
      await tx.timelineEvent.create({
        data: {
          songId: created.songId,
          eventType: "garageband_operation",
          title: `GarageBand 操作：${created.operation}`,
          description: `${created.command} / ${created.approvalStatus} / ${created.resultStatus}`,
          relatedModel: "GarageBandOperationLog",
          relatedId: created.id
        }
      });
    }

    return created;
  });

  return NextResponse.json(toLogDto(log), { status: 201 });
}
