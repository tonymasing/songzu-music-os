import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeInspiration } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

const InspirationSchema = z.object({
  title: z.string().optional().nullable(),
  content: z.string().min(1),
  sourceType: z.string().default("text")
});

export async function GET() {
  const items = await prisma.inspiration.findMany({
    include: { linkedSong: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json(
    items.map((item) => ({
      ...item,
      moods: item.moodJson ? JSON.parse(item.moodJson) : []
    }))
  );
}

export async function POST(request: Request) {
  const body = InspirationSchema.parse(await request.json());
  const analysis = analyzeInspiration(body.content);
  const item = await prisma.inspiration.create({
    data: {
      title: body.title?.trim() || analysis.title,
      content: body.content,
      sourceType: body.sourceType,
      aiCategory: analysis.aiCategory,
      moodJson: JSON.stringify(analysis.moods),
      suggestedTitle: analysis.suggestedTitle
    }
  });

  return NextResponse.json({ ...item, moods: analysis.moods }, { status: 201 });
}
