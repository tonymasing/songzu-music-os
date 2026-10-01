import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const ChecklistCreateSchema = z.object({
  title: z.string().min(1),
  category: z.string().default("其他"),
  required: z.boolean().default(true)
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ChecklistCreateSchema.parse(await request.json());
  const count = await prisma.releaseChecklistItem.count({ where: { releaseId: id } });
  const item = await prisma.releaseChecklistItem.create({
    data: {
      releaseId: id,
      title: body.title,
      category: body.category,
      required: body.required,
      sortOrder: count + 1
    }
  });

  return NextResponse.json(item, { status: 201 });
}
