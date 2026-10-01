import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const ContributorSchema = z.object({
  name: z.string().trim().min(1),
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

export async function GET() {
  return NextResponse.json(await prisma.contributor.findMany({ include, orderBy: { name: "asc" } }));
}

export async function POST(request: Request) {
  const body = ContributorSchema.parse(await request.json());
  const contributor = await prisma.contributor.create({
    data: {
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      ipi: body.ipi || null,
      isni: body.isni || null,
      proAffiliation: body.proAffiliation || null,
      countryCode: body.countryCode?.toUpperCase() || null,
      defaultRoles: body.defaultRoles || null,
      notes: body.notes || null
    },
    include
  });
  return NextResponse.json(contributor, { status: 201 });
}
