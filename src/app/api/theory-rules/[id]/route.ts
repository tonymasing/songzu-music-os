import { NextResponse } from "next/server";
import { z } from "zod";

import { toPersonalTheoryRuleDto } from "@/lib/music-database";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateTheoryRuleSchema = z.object({
  title: z.string().min(1).optional(),
  ruleType: z.string().min(1).optional(),
  scope: z.string().optional().nullable(),
  statement: z.string().min(1).optional(),
  examples: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateTheoryRuleSchema.parse(await request.json());
  const item = await prisma.personalTheoryRule.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.ruleType !== undefined ? { ruleType: body.ruleType } : {}),
      ...(body.scope !== undefined ? { scope: body.scope || null } : {}),
      ...(body.statement !== undefined ? { statement: body.statement } : {}),
      ...(body.examples !== undefined ? { examplesJson: JSON.stringify(body.examples) } : {}),
      ...(body.avoid !== undefined ? { avoidJson: JSON.stringify(body.avoid) } : {}),
      ...(body.tags !== undefined ? { tagsJson: JSON.stringify(body.tags) } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
    }
  });

  return NextResponse.json(toPersonalTheoryRuleDto(item));
}
