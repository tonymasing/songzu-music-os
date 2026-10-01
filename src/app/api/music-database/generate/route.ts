import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLocalGenerationOutput, getMusicMaterials, getPersonalTheoryRules, toMusicGenerationDraftDto } from "@/lib/music-database";
import { prisma } from "@/lib/prisma";

const GenerateSchema = z.object({
  prompt: z.string().optional().default(""),
  styleTags: z.array(z.string()).optional().default([]),
  songId: z.string().optional().nullable()
});

export async function POST(request: Request) {
  const body = GenerateSchema.parse(await request.json());
  const [materials, rules] = await Promise.all([getMusicMaterials(), getPersonalTheoryRules()]);
  const output = buildLocalGenerationOutput(body.prompt, materials, rules, body.styleTags);
  const draft = await prisma.musicGenerationDraft.create({
    data: {
      title: output.title,
      prompt: body.prompt || "從我的音樂資料庫生成",
      songId: body.songId || null,
      materialIdsJson: JSON.stringify(output.materialIds),
      ruleIdsJson: JSON.stringify(output.ruleIds),
      styleTagsJson: JSON.stringify(body.styleTags),
      outputJson: JSON.stringify(output)
    }
  });

  return NextResponse.json(toMusicGenerationDraftDto(draft), { status: 201 });
}
