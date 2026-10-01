import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { claimConflictTypes, newOrderCode } from "@/lib/storefront";

type RouteContext = { params: Promise<{ token: string }> };

const ClaimSchema = z.object({
  offerId: z.string().min(1),
  customerName: z.string().trim().min(1).max(80),
  contactChannel: z.enum(["email", "line", "instagram", "phone", "other"]),
  contactValue: z.string().trim().min(3).max(160),
  message: z.string().trim().max(1000).optional().nullable(),
  termsAccepted: z.literal(true),
  website: z.string().max(0).optional()
});

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const body = ClaimSchema.parse(await request.json());
  try {
    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.claimOffer.findFirst({
        where: {
          id: body.offerId,
          status: "ACTIVE",
          preview: { token, status: "PUBLISHED", allowClaims: true }
        },
        include: { preview: true }
      });
      if (!offer) throw new Error("這個認領方案目前不可使用。");
      const now = new Date();
      const conflicts = claimConflictTypes(offer.offerType);
      const occupied = await tx.claimOrder.count({
        where: {
          ...(offer.offerType === "CUSTOM"
            ? { offerId: offer.id }
            : { offer: { previewId: offer.previewId, offerType: { in: conflicts } } }),
          OR: [
            { status: { in: ["PAID", "IN_PROGRESS", "DELIVERED"] } },
            {
              status: { in: ["REQUESTED", "AWAITING_PAYMENT"] },
              OR: [{ reservationExpiresAt: null }, { reservationExpiresAt: { gt: now } }]
            }
          ]
        }
      });
      if (occupied >= offer.maxClaims) throw new Error("這個方案目前已被認領或保留，請選擇其他方案。");
      const order = await tx.claimOrder.create({
        data: {
          offerId: offer.id,
          orderCode: newOrderCode(),
          customerName: body.customerName,
          contactChannel: body.contactChannel,
          contactValue: body.contactValue,
          message: body.message || null,
          amountSnapshot: offer.price,
          currency: offer.currency,
          termsAcceptedAt: now,
          reservationExpiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000)
        }
      });
      await tx.audienceEvent.create({
        data: {
          songId: offer.preview.songId,
          previewId: offer.previewId,
          eventType: "claim_submitted",
          source: "storefront",
          metadataJson: JSON.stringify({ offerType: offer.offerType, amount: offer.price, currency: offer.currency })
        }
      });
      return { order, paymentInstructions: offer.preview.paymentInstructions };
    });
    return NextResponse.json(
      {
        orderCode: result.order.orderCode,
        status: result.order.status,
        amount: result.order.amountSnapshot,
        currency: result.order.currency,
        reservationExpiresAt: result.order.reservationExpiresAt?.toISOString() ?? null,
        paymentInstructions:
          result.paymentInstructions || "認領單已送出，創作者會依你留下的聯絡方式確認付款與授權內容。"
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "認領單送出失敗。" },
      { status: 409 }
    );
  }
}
