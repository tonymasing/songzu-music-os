import { NextResponse } from "next/server";
import { z } from "zod";

import { appendDawRecoveryEntry } from "@/lib/daw-history";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const RecoverySchema = z.object({
  sessionId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: z.string().min(1).optional()
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const entries = await prisma.dawRecoveryEntry.findMany({
    where: { projectId: id, status: { in: ["PENDING", "RECOVERABLE"] } },
    orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
    take: 100
  });
  return NextResponse.json({ entries });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = RecoverySchema.parse(await request.json());
  const entry = await appendDawRecoveryEntry({ projectId: id, ...body });
  return NextResponse.json({ entry }, { status: 201 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = z.object({ sessionId: z.string().min(1), status: z.enum(["RESOLVED", "DISCARDED"]) }).parse(await request.json());
  const result = await prisma.dawRecoveryEntry.updateMany({
    where: { projectId: id, sessionId: body.sessionId, status: { in: ["PENDING", "RECOVERABLE"] } },
    data: { status: body.status, resolvedAt: new Date() }
  });
  return NextResponse.json({ resolved: result.count });
}
