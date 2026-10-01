import { NextResponse } from "next/server";
import { z } from "zod";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

const PatchSuggestionSchema = z.object({
  status: z.enum(["pending", "applied", "dismissed", "archived"])
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = PatchSuggestionSchema.parse(await request.json());
  const suggestion = await prisma.aiSuggestion.update({
    where: { id },
    data: {
      status: body.status,
      appliedAt: body.status === "applied" ? new Date() : null
    }
  });

  return NextResponse.json({
    id: suggestion.id,
    suggestionType: suggestion.suggestionType,
    status: suggestion.status,
    inputSnapshot: suggestion.inputSnapshotJson,
    outputPayload: suggestion.outputPayloadJson,
    createdAt: toIso(suggestion.createdAt),
    appliedAt: toIso(suggestion.appliedAt)
  });
}
