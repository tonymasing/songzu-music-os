import { NextResponse } from "next/server";
import { z } from "zod";

import { getCatalogAnswer } from "@/lib/ai";
import { getSongs } from "@/lib/data";
import { prisma } from "@/lib/prisma";

const CatalogQuerySchema = z.object({
  question: z.string().min(1)
});

export async function POST(request: Request) {
  const body = CatalogQuerySchema.parse(await request.json());
  const songs = await getSongs();
  const answer = await getCatalogAnswer(body.question, songs);

  await prisma.aiSuggestion.create({
    data: {
      suggestionType: "catalog_answer",
      status: "generated",
      inputSnapshotJson: JSON.stringify({ question: body.question }),
      outputPayloadJson: JSON.stringify(answer)
    }
  });

  return NextResponse.json(answer);
}
