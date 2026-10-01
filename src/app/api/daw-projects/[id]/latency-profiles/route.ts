import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const ProfileSchema = z.object({
  inputDeviceName: z.string().min(1),
  outputDeviceName: z.string().min(1),
  sampleRate: z.number().int().min(8_000).max(192_000),
  bufferFrames: z.number().int().min(32).max(4_096),
  measuredRoundTripMs: z.number().min(0).max(2_000),
  inputLatencyMs: z.number().min(0).max(1_000).nullable().optional(),
  outputLatencyMs: z.number().min(0).max(1_000).nullable().optional(),
  compensationMs: z.number().min(0).max(1_000),
  method: z.enum(["physical_loopback", "acoustic_loopback", "manual_verified"]),
  confidence: z.number().min(0).max(1),
  measurement: z.record(z.string(), z.unknown()).default({})
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const profiles = await prisma.dawLatencyProfile.findMany({ where: { projectId: id }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ profiles });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = ProfileSchema.parse(await request.json());
  const profile = await prisma.$transaction(async (tx) => {
    await tx.dawLatencyProfile.updateMany({
      where: { projectId: id, inputDeviceName: body.inputDeviceName, outputDeviceName: body.outputDeviceName, sampleRate: body.sampleRate, bufferFrames: body.bufferFrames },
      data: { isActive: false }
    });
    return tx.dawLatencyProfile.create({
      data: {
        projectId: id,
        inputDeviceName: body.inputDeviceName,
        outputDeviceName: body.outputDeviceName,
        sampleRate: body.sampleRate,
        bufferFrames: body.bufferFrames,
        measuredRoundTripMs: body.measuredRoundTripMs,
        inputLatencyMs: body.inputLatencyMs ?? null,
        outputLatencyMs: body.outputLatencyMs ?? null,
        compensationMs: body.compensationMs,
        method: body.method,
        confidence: body.confidence,
        measurementJson: JSON.stringify(body.measurement)
      }
    });
  });
  return NextResponse.json({ profile }, { status: 201 });
}
