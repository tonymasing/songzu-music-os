import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { toSoundLibraryItemDto } from "@/lib/sound-library";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateSoundItemSchema = z.object({
  name: z.string().min(1).optional(),
  itemType: z.string().min(1).optional(),
  family: z.string().optional().nullable(),
  era: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  character: z.array(z.string()).optional(),
  useCases: z.array(z.string()).optional(),
  chain: z.array(z.string()).optional(),
  garageBandHint: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assetPath: z.string().optional().nullable(),
  previewPath: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  licenseName: z.string().optional().nullable(),
  licenseUrl: z.string().optional().nullable(),
  fileSizeBytes: z.number().int().optional().nullable(),
  sha256: z.string().optional().nullable(),
  status: z.string().min(1).optional(),
  favorite: z.boolean().optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateSoundItemSchema.parse(await request.json());
  const item = await prisma.soundLibraryItem.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.itemType !== undefined ? { itemType: body.itemType } : {}),
      ...(body.family !== undefined ? { family: body.family || null } : {}),
      ...(body.era !== undefined ? { era: body.era || null } : {}),
      ...(body.source !== undefined ? { source: body.source || null } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.tags !== undefined ? { tagsJson: JSON.stringify(body.tags) } : {}),
      ...(body.character !== undefined ? { characterJson: JSON.stringify(body.character) } : {}),
      ...(body.useCases !== undefined ? { useCasesJson: JSON.stringify(body.useCases) } : {}),
      ...(body.chain !== undefined ? { chainJson: JSON.stringify(body.chain) } : {}),
      ...(body.garageBandHint !== undefined ? { garageBandHint: body.garageBandHint || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.assetPath !== undefined ? { assetPath: body.assetPath || null } : {}),
      ...(body.previewPath !== undefined ? { previewPath: body.previewPath || null } : {}),
      ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl || null } : {}),
      ...(body.licenseName !== undefined ? { licenseName: body.licenseName || null } : {}),
      ...(body.licenseUrl !== undefined ? { licenseUrl: body.licenseUrl || null } : {}),
      ...(body.fileSizeBytes !== undefined ? { fileSizeBytes: body.fileSizeBytes ?? null } : {}),
      ...(body.sha256 !== undefined ? { sha256: body.sha256 || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.favorite !== undefined ? { favorite: body.favorite } : {})
    }
  });

  return NextResponse.json(toSoundLibraryItemDto(item));
}
