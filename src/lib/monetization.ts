import type { MonetizationProfile, RevenueRecord } from "@prisma/client";

import { toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";

export type MonetizationProfileDto = ReturnType<typeof toMonetizationProfileDto>;
export type RevenueRecordDto = ReturnType<typeof toRevenueRecordDto>;

export async function ensureYoutubeMonetizationProfile() {
  return prisma.monetizationProfile.upsert({
    where: { provider: "youtube" },
    create: { provider: "youtube", regionCode: "TW" },
    update: {}
  });
}

export function buildYppProgress(profile: MonetizationProfile) {
  const fanFundingByWatch = profile.publicWatchHours >= 3000;
  const fanFundingByShorts = profile.shortsViews90Days >= 3_000_000;
  const adsByWatch = profile.publicWatchHours >= 4000;
  const adsByShorts = profile.shortsViews90Days >= 10_000_000;
  return {
    fanFunding: {
      eligible:
        profile.subscriberCount >= 500 &&
        profile.validPublicUploads90Days >= 3 &&
        (fanFundingByWatch || fanFundingByShorts),
      subscriberProgress: Math.min(100, Math.round((profile.subscriberCount / 500) * 100)),
      uploadProgress: Math.min(100, Math.round((profile.validPublicUploads90Days / 3) * 100)),
      watchProgress: Math.min(100, Math.round((profile.publicWatchHours / 3000) * 100)),
      shortsProgress: Math.min(100, Math.round((profile.shortsViews90Days / 3_000_000) * 100))
    },
    ads: {
      eligible: profile.subscriberCount >= 1000 && (adsByWatch || adsByShorts),
      subscriberProgress: Math.min(100, Math.round((profile.subscriberCount / 1000) * 100)),
      watchProgress: Math.min(100, Math.round((profile.publicWatchHours / 4000) * 100)),
      shortsProgress: Math.min(100, Math.round((profile.shortsViews90Days / 10_000_000) * 100))
    }
  };
}

export function toMonetizationProfileDto(profile: MonetizationProfile) {
  return {
    id: profile.id,
    provider: profile.provider,
    regionCode: profile.regionCode,
    yppStatus: profile.yppStatus,
    subscriberCount: profile.subscriberCount,
    publicWatchHours: profile.publicWatchHours,
    shortsViews90Days: profile.shortsViews90Days,
    validPublicUploads90Days: profile.validPublicUploads90Days,
    fanFundingEnabled: profile.fanFundingEnabled,
    adsRevenueEnabled: profile.adsRevenueEnabled,
    contentIdStatus: profile.contentIdStatus,
    distributorName: profile.distributorName,
    publishingAdmin: profile.publishingAdmin,
    notes: profile.notes,
    progress: buildYppProgress(profile),
    updatedAt: toIso(profile.updatedAt)
  };
}

export async function updateYoutubeMonetizationProfile(input: {
  subscriberCount?: number;
  publicWatchHours?: number;
  shortsViews90Days?: number;
  validPublicUploads90Days?: number;
  yppStatus?: string;
  fanFundingEnabled?: boolean;
  adsRevenueEnabled?: boolean;
  contentIdStatus?: string;
  distributorName?: string | null;
  publishingAdmin?: string | null;
  notes?: string | null;
}) {
  const current = await ensureYoutubeMonetizationProfile();
  return prisma.monetizationProfile.update({
    where: { id: current.id },
    data: input
  });
}

export function toRevenueRecordDto(record: RevenueRecord & { song?: { title: string } | null }) {
  return {
    id: record.id,
    songId: record.songId,
    songTitle: record.song?.title || null,
    platform: record.platform,
    revenueType: record.revenueType,
    periodStart: toIso(record.periodStart),
    periodEnd: toIso(record.periodEnd),
    grossAmount: record.grossAmount,
    currency: record.currency,
    source: record.source,
    externalReference: record.externalReference,
    notes: record.notes,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt)
  };
}

export async function listRevenueRecords() {
  const records = await prisma.revenueRecord.findMany({
    include: { song: { select: { title: true } } },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    take: 200
  });
  return records.map(toRevenueRecordDto);
}

export async function createRevenueRecord(input: {
  songId?: string | null;
  platform: string;
  revenueType: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  currency: string;
  source?: string;
  externalReference?: string | null;
  notes?: string | null;
}) {
  if (input.periodEnd < input.periodStart) throw new Error("收入期間結束日不能早於開始日。");
  return prisma.revenueRecord.create({
    data: input,
    include: { song: { select: { title: true } } }
  });
}

export async function deleteRevenueRecord(id: string) {
  return prisma.revenueRecord.delete({ where: { id } });
}

export function revenueSummary(records: RevenueRecordDto[]) {
  const totalsByCurrency = records.reduce<Record<string, number>>((totals, record) => {
    totals[record.currency] = (totals[record.currency] || 0) + record.grossAmount;
    return totals;
  }, {});
  const latestPeriod = records[0]?.periodEnd || null;
  return { count: records.length, totalsByCurrency, latestPeriod };
}
