import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { claimConflictTypes, claimOrderStatuses } from "@/lib/storefront";

type RouteContext = { params: Promise<{ id: string }> };

const UpdateOrderSchema = z.object({
  status: z.enum(claimOrderStatuses).optional(),
  adminNotes: z.string().trim().max(1000).optional().nullable()
});

const paidStatuses = ["PAID", "IN_PROGRESS", "DELIVERED"];

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = UpdateOrderSchema.parse(await request.json());
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.claimOrder.findUnique({
        where: { id },
        include: { offer: { include: { preview: true } } }
      });
      if (!current) throw new Error("找不到認領單。");
      if (current.revenueRecordId && body.status === "CANCELLED") {
        throw new Error("已付款認領單不可直接取消，請先另建退款紀錄。");
      }
      if (current.status === "CANCELLED" && body.status && body.status !== "CANCELLED") {
        throw new Error("已取消的認領單不可重新啟用，請讓認領人重新送單。");
      }
      if (paidStatuses.includes(current.status) && body.status && ["REQUESTED", "AWAITING_PAYMENT"].includes(body.status)) {
        throw new Error("已付款認領單不可退回未付款階段。");
      }
      if (body.status === "DELIVERED" && !paidStatuses.includes(current.status)) {
        throw new Error("尚未確認付款，不能直接標記已交付。");
      }

      let revenueRecordId = current.revenueRecordId;
      const becomesPaid = body.status === "PAID" && !paidStatuses.includes(current.status);
      if (becomesPaid) {
        const now = new Date();
        const revenue = await tx.revenueRecord.create({
          data: {
            songId: current.offer.preview.songId,
            platform: "direct_claim",
            revenueType: "claim",
            periodStart: now,
            periodEnd: now,
            grossAmount: current.amountSnapshot,
            currency: current.currency,
            source: "claim_order",
            externalReference: current.orderCode,
            notes: `${current.offer.title} · ${current.customerName}`
          }
        });
        revenueRecordId = revenue.id;
        const nextClaimedCount = current.offer.claimedCount + 1;
        await tx.claimOffer.update({
          where: { id: current.offerId },
          data: {
            claimedCount: { increment: 1 },
            ...(nextClaimedCount >= current.offer.maxClaims ? { status: "SOLD_OUT" } : {})
          }
        });
        if (current.offer.offerType !== "CUSTOM") {
          await tx.claimOffer.updateMany({
            where: {
              previewId: current.offer.previewId,
              offerType: { in: claimConflictTypes(current.offer.offerType) },
              id: { not: current.offerId }
            },
            data: { status: "SOLD_OUT" }
          });
        }
      }

      return tx.claimOrder.update({
        where: { id },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.adminNotes !== undefined ? { adminNotes: body.adminNotes || null } : {}),
          ...(becomesPaid ? { paidAt: new Date(), reservationExpiresAt: null, revenueRecordId } : {}),
          ...(body.status === "DELIVERED" ? { completedAt: new Date() } : {})
        }
      });
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "認領單更新失敗。" },
      { status: 409 }
    );
  }
}
