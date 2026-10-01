import { NextResponse } from "next/server";
import { z } from "zod";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const PatchCommentSchema = z.object({
  body: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  status: z.string().min(1).optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchCommentSchema.parse(await request.json());
  const comment = await prisma.audioComment.update({
    where: { id },
    data: body
  });

  return NextResponse.json({
    ...comment,
    createdAt: toIso(comment.createdAt),
    updatedAt: toIso(comment.updatedAt)
  });
}
