import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { claimOfferStatuses } from "@/lib/storefront";

type RouteContext = { params: Promise<{ id: string }> };

const UpdateOfferSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(600).optional().nullable(),
  price: z.number().int().min(0).max(1_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  rightsSummary: z.string().trim().min(1).max(1000).optional(),
  deliveryDays: z.number().int().min(1).max(365).optional().nullable(),
  maxClaims: z.number().int().min(1).max(999).optional(),
  status: z.enum(claimOfferStatuses).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
});

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateOfferSchema.parse(await request.json());
  const current = await prisma.claimOffer.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到認領方案。" }, { status: 404 });
  if (body.maxClaims !== undefined && body.maxClaims < current.claimedCount) {
    return NextResponse.json({ error: "名額不可少於已確認的認領數。" }, { status: 409 });
  }
  return NextResponse.json(await prisma.claimOffer.update({ where: { id }, data: body }));
}
