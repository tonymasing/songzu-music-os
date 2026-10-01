import { NextResponse } from "next/server";

import { pitchPackInclude, toPitchPackDto } from "@/lib/pitch";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const pack = await prisma.pitchPack.findUnique({
    where: { token },
    include: pitchPackInclude
  });

  if (!pack) {
    return NextResponse.json({ error: "Share pack not found" }, { status: 404 });
  }

  return NextResponse.json(toPitchPackDto(pack));
}
