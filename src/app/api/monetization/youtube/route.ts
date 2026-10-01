import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureYoutubeMonetizationProfile,
  toMonetizationProfileDto,
  updateYoutubeMonetizationProfile
} from "@/lib/monetization";

export const runtime = "nodejs";

const ProfileSchema = z.object({
  subscriberCount: z.number().int().min(0).optional(),
  publicWatchHours: z.number().min(0).optional(),
  shortsViews90Days: z.number().int().min(0).optional(),
  validPublicUploads90Days: z.number().int().min(0).optional(),
  yppStatus: z.enum(["NOT_APPLIED", "ELIGIBLE", "APPLIED", "APPROVED", "REJECTED"]).optional(),
  fanFundingEnabled: z.boolean().optional(),
  adsRevenueEnabled: z.boolean().optional(),
  contentIdStatus: z.enum(["NOT_CONFIGURED", "REVIEWING", "ACTIVE", "INELIGIBLE"]).optional(),
  distributorName: z.string().max(160).optional().nullable(),
  publishingAdmin: z.string().max(160).optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
});

export async function GET() {
  return NextResponse.json(toMonetizationProfileDto(await ensureYoutubeMonetizationProfile()));
}

export async function PATCH(request: Request) {
  try {
    const body = ProfileSchema.parse(await request.json());
    return NextResponse.json(toMonetizationProfileDto(await updateYoutubeMonetizationProfile(body)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新營利進度失敗。" }, { status: 400 });
  }
}
