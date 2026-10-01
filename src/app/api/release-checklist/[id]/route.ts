import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const ChecklistPatchSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional().nullable()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ChecklistPatchSchema.parse(await request.json());
  const item = await prisma.releaseChecklistItem.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    }
  });

  return NextResponse.json(item);
}
