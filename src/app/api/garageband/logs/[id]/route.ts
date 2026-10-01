import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonValue, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const PatchLogSchema = z.object({
  approvalStatus: z.string().optional(),
  resultStatus: z.string().optional(),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchLogSchema.parse(await request.json());

  const log = await prisma.garageBandOperationLog.update({
    where: { id },
    data: {
      ...(body.approvalStatus !== undefined ? { approvalStatus: body.approvalStatus } : {}),
      ...(body.resultStatus !== undefined ? { resultStatus: body.resultStatus } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    include: { song: { select: { id: true, title: true } } }
  });

  return NextResponse.json({
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
  });
}
