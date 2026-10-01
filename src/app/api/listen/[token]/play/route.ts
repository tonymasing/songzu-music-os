import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const preview = await prisma.songPreview.findFirst({ where: { token, status: "PUBLISHED" } });
  if (!preview) return NextResponse.json({ error: "找不到公開試聽頁。" }, { status: 404 });
  const fingerprint = `${request.headers.get("x-forwarded-for") || "local"}|${request.headers.get("user-agent") || "unknown"}|${token}`;
  const sessionHash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.songPreview.update({
      where: { id: preview.id },
      data: { playCount: { increment: 1 } },
      select: { playCount: true }
    });
    await tx.audienceEvent.create({
      data: {
        songId: preview.songId,
        previewId: preview.id,
        eventType: "preview_play",
        source: request.headers.get("referer") ? "referral" : "direct",
        sessionHash,
        metadataJson: JSON.stringify({ userAgentFamily: request.headers.get("sec-ch-ua-mobile") === "?1" ? "mobile" : "desktop_or_unknown" })
      }
    });
    return next;
  });
  return NextResponse.json(updated);
}
