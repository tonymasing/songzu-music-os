import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function token() {
  return randomBytes(18).toString("base64url");
}

function toConfirmationDto(confirmation: {
  id: string;
  creditId: string;
  token: string;
  status: string;
  confirmedAt: Date | null;
  displayName: string | null;
  emailSnapshot: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...confirmation,
    confirmedAt: toIso(confirmation.confirmedAt),
    createdAt: toIso(confirmation.createdAt),
    updatedAt: toIso(confirmation.updatedAt)
  };
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const credit = await prisma.credit.findUnique({
    where: { id },
    include: { contributor: true }
  });

  if (!credit) {
    return NextResponse.json({ error: "Credit not found" }, { status: 404 });
  }

  const existing = await prisma.creditConfirmation.findFirst({
    where: { creditId: id, status: "PENDING" },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    return NextResponse.json(toConfirmationDto(existing));
  }

  const confirmation = await prisma.creditConfirmation.create({
    data: {
      creditId: id,
      token: token(),
      status: "PENDING",
      displayName: credit.contributor.name,
      emailSnapshot: credit.contributor.email
    }
  });

  return NextResponse.json(toConfirmationDto(confirmation), { status: 201 });
}
