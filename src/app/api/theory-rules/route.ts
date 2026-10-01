import { NextResponse } from "next/server";
import { z } from "zod";

import { getPersonalTheoryRules, toPersonalTheoryRuleDto } from "@/lib/music-database";
import { prisma } from "@/lib/prisma";

const TheoryRuleSchema = z.object({
  title: z.string().min(1),
  ruleType: z.string().min(1).default("identity"),
  scope: z.string().optional().nullable(),
  statement: z.string().min(1),
  examples: z.array(z.string()).optional().default([]),
  avoid: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  priority: z.number().int().min(1).max(5).default(3),
  isActive: z.boolean().optional().default(true)
});

export async function GET() {
  return NextResponse.json(await getPersonalTheoryRules());
}

export async function POST(request: Request) {
  const body = TheoryRuleSchema.parse(await request.json());
  const item = await prisma.personalTheoryRule.create({
    data: {
      title: body.title,
      ruleType: body.ruleType,
      scope: body.scope || null,
      statement: body.statement,
      examplesJson: JSON.stringify(body.examples),
      avoidJson: JSON.stringify(body.avoid),
      tagsJson: JSON.stringify(body.tags),
      priority: body.priority,
      isActive: body.isActive
    }
  });

  return NextResponse.json(toPersonalTheoryRuleDto(item), { status: 201 });
}
