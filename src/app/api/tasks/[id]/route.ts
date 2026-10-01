import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const TaskPatchSchema = z.object({
  status: z.string().optional(),
  title: z.string().min(1).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = TaskPatchSchema.parse(await request.json());
  const status = body.status;

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(status ? { status, completedAt: status === "DONE" ? new Date() : null } : {})
    }
  });

  return NextResponse.json(task);
}
