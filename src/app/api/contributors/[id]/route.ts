import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

const ContributorPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  ipi: z.string().trim().max(80).optional().nullable(),
  isni: z.string().trim().max(80).optional().nullable(),
  proAffiliation: z.string().trim().max(120).optional().nullable(),
  countryCode: z.string().trim().max(8).optional().nullable(),
  defaultRoles: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable()
});

const include = {
  credits: {
    include: {
      song: { select: { id: true, title: true } },
      confirmations: { select: { status: true } }
    },
    orderBy: { createdAt: "desc" as const }
  }
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ContributorPatchSchema.parse(await request.json());
  const current = await prisma.contributor.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "找不到合作人" }, { status: 404 });

  const contributor = await prisma.contributor.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.ipi !== undefined ? { ipi: body.ipi || null } : {}),
      ...(body.isni !== undefined ? { isni: body.isni || null } : {}),
      ...(body.proAffiliation !== undefined ? { proAffiliation: body.proAffiliation || null } : {}),
      ...(body.countryCode !== undefined ? { countryCode: body.countryCode?.toUpperCase() || null } : {}),
      ...(body.defaultRoles !== undefined ? { defaultRoles: body.defaultRoles || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    include
  });
  return NextResponse.json(contributor);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const contributor = await prisma.contributor.findUnique({
    where: { id },
    include: { _count: { select: { credits: true } } }
  });
  if (!contributor) return NextResponse.json({ error: "找不到合作人" }, { status: 404 });
  if (contributor._count.credits > 0) {
    return NextResponse.json({ error: "這位合作人已有作品名單紀錄，請保留權利資料或先調整歌曲名單。" }, { status: 409 });
  }
  await prisma.contributor.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
