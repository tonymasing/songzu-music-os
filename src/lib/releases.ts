import type { Prisma } from "@prisma/client";

import { releaseStatusLabel, releaseTypeLabel, songInclude, toSongDto } from "@/lib/music";

export const releaseInclude = {
  tracks: {
    include: { song: { include: songInclude } },
    orderBy: { trackNumber: "asc" }
  },
  checklistItems: { orderBy: { sortOrder: "asc" } }
} satisfies Prisma.ReleaseInclude;

export type ReleaseRecord = Prisma.ReleaseGetPayload<{ include: typeof releaseInclude }>;

export function toReleaseDto(release: ReleaseRecord) {
  const tracks = release.tracks.map((track) => {
    const song = toSongDto(track.song);
    return {
      id: track.id,
      songId: track.songId,
      trackNumber: track.trackNumber,
      displayTitle: track.displayTitle,
      isrc: track.isrc,
      song: {
        title: song.title,
        readiness: song.releaseReadiness.score,
        releaseReadiness: song.releaseReadiness,
        warnings: song.warnings,
        masterQualityStatus: song.releaseReadiness.masterQualityPassed
          ? "pass"
          : song.audioFiles.find((file) => file.fileType === "master")?.qualityStatus ?? "missing"
      }
    };
  });
  const requiredItems = release.checklistItems.filter((item) => item.required);
  const completedRequiredItems = requiredItems.filter((item) => item.status === "DONE");
  const trackReadiness = tracks.length
    ? Math.round(tracks.reduce((total, track) => total + track.song.releaseReadiness.score, 0) / tracks.length)
    : 0;
  const checklistReadiness = requiredItems.length
    ? Math.round((completedRequiredItems.length / requiredItems.length) * 100)
    : 100;
  const score = tracks.length ? Math.round(trackReadiness * 0.8 + checklistReadiness * 0.2) : 0;
  const blockers = tracks.flatMap((track) =>
    track.song.releaseReadiness.blockers.map((blocker) => `${track.displayTitle ?? track.song.title}：${blocker}`)
  );
  if (!release.releaseDate) blockers.push("發行專案：尚未設定發行日。");
  if (!release.upc) blockers.push("發行專案：尚未填寫 UPC。");
  if (completedRequiredItems.length !== requiredItems.length) {
    blockers.push(`發行 Checklist：尚有 ${requiredItems.length - completedRequiredItems.length} 項必修未完成。`);
  }

  return {
    id: release.id,
    title: release.title,
    releaseType: release.releaseType,
    releaseTypeLabel: releaseTypeLabel(release.releaseType),
    status: release.status,
    statusLabel: releaseStatusLabel(release.status),
    releaseDate: release.releaseDate?.toISOString() ?? null,
    upc: release.upc,
    copyrightLine: release.copyrightLine,
    publishingLine: release.publishingLine,
    readiness: {
      score,
      ready: tracks.length > 0 && blockers.length === 0,
      trackReadiness,
      checklistReadiness,
      blockers
    },
    tracks,
    checklistItems: release.checklistItems.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      status: item.status,
      required: item.required,
      sortOrder: item.sortOrder,
      notes: item.notes
    }))
  };
}

export type ReleaseDto = ReturnType<typeof toReleaseDto>;
