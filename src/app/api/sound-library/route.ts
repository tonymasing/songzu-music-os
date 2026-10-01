import { NextResponse } from "next/server";
import { z } from "zod";

import { getSoundLibraryItems, toSoundLibraryItemDto } from "@/lib/sound-library";
import { prisma } from "@/lib/prisma";

const SoundItemSchema = z.object({
  name: z.string().min(1),
  itemType: z.string().min(1).default("instrument"),
  family: z.string().optional().nullable(),
  era: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  character: z.array(z.string()).optional().default([]),
  useCases: z.array(z.string()).optional().default([]),
  chain: z.array(z.string()).optional().default([]),
  garageBandHint: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assetPath: z.string().optional().nullable(),
  previewPath: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  licenseName: z.string().optional().nullable(),
  licenseUrl: z.string().optional().nullable(),
  fileSizeBytes: z.number().int().optional().nullable(),
  sha256: z.string().optional().nullable(),
  status: z.string().min(1).default("COLLECTED"),
  favorite: z.boolean().optional().default(false)
});

export async function GET() {
  return NextResponse.json(await getSoundLibraryItems());
}

export async function POST(request: Request) {
  const body = SoundItemSchema.parse(await request.json());
  const item = await prisma.soundLibraryItem.create({
    data: {
      name: body.name,
      itemType: body.itemType,
      family: body.family || null,
      era: body.era || null,
      source: body.source || null,
      description: body.description || null,
      tagsJson: JSON.stringify(body.tags),
      characterJson: JSON.stringify(body.character),
      useCasesJson: JSON.stringify(body.useCases),
      chainJson: JSON.stringify(body.chain),
      garageBandHint: body.garageBandHint || null,
      notes: body.notes || null,
      assetPath: body.assetPath || null,
      previewPath: body.previewPath || null,
      sourceUrl: body.sourceUrl || null,
      licenseName: body.licenseName || null,
      licenseUrl: body.licenseUrl || null,
      fileSizeBytes: body.fileSizeBytes ?? null,
      sha256: body.sha256 || null,
      status: body.status,
      favorite: body.favorite
    }
  });

  return NextResponse.json(toSoundLibraryItemDto(item), { status: 201 });
}
