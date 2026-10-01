import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

const CreateOfferSchema = z.object({
  offerType: z.string().trim().min(1).max(40).default("CUSTOM"),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).optional().nullable(),
  price: z.number().int().min(0).max(1_000_000),
  currency: z.string().trim().length(3).default("TWD"),
  rightsSummary: z.string().trim().min(1).max(1000),
  deliveryDays: z.number().int().min(1).max(365).optional().nullable(),
  maxClaims: z.number().int().min(1).max(999).default(1),
  sortOrder: z.number().int().min(0).max(9999).default(100)
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = CreateOfferSchema.parse(await request.json());
  const preview = await prisma.songPreview.findUnique({ where: { id } });
  if (!preview) return NextResponse.json({ error: "找不到試聽頁。" }, { status: 404 });
  const offer = await prisma.claimOffer.create({ data: { previewId: id, ...body } });
  return NextResponse.json(offer, { status: 201 });
}
