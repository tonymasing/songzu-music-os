import { NextResponse } from "next/server";
import { z } from "zod";

import { getDawProjectById, toDawProjectDto } from "@/lib/daw";
import { recordDawEditOperation } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const UpdateTakeLaneSchema = z.object({
  compStatus: z.string().min(1).optional(),
  selectedRange: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().nullable().optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateTakeLaneSchema.parse(await request.json());
  const current = await prisma.dawTakeLane.findUnique({
    where: { id },
    include: { track: true }
  });

  if (!current) {
    return NextResponse.json({ error: "DAW take lane not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.dawTakeLane.update({
      where: { id },
      data: {
      ...(body.compStatus !== undefined ? { compStatus: body.compStatus } : {}),
      ...(body.selectedRange !== undefined ? { selectedRangeJson: body.selectedRange ? JSON.stringify(body.selectedRange) : null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
      }
    });
    await recordDawEditOperation(tx, {
      projectId: current.track.projectId,
      operationType: "update",
      entityType: "take_lane",
      entityId: id,
      label: "調整 Take 狀態",
      before: current,
      after: updated
    });
  });

  const project = await getDawProjectById(current.track.projectId);
  return NextResponse.json({ project: project ? toDawProjectDto(project) : null });
}
