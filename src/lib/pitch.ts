import type { Prisma } from "@prisma/client";

import { songInclude, toIso, toSongDto } from "@/lib/music";

export const pitchPackInclude = {
  songs: {
    include: { song: { include: songInclude } },
    orderBy: { sortOrder: "asc" }
  }
} satisfies Prisma.PitchPackInclude;

export type PitchPackRecord = Prisma.PitchPackGetPayload<{ include: typeof pitchPackInclude }>;

export type PitchPackDto = ReturnType<typeof toPitchPackDto>;

export function toPitchPackDto(pack: PitchPackRecord) {
  return {
    id: pack.id,
    token: pack.token,
    title: pack.title,
    description: pack.description,
    allowDownload: pack.allowDownload,
    showLyrics: pack.showLyrics,
    showCredits: pack.showCredits,
    showContact: pack.showContact,
    contactInfo: pack.contactInfo,
    createdAt: toIso(pack.createdAt),
    updatedAt: toIso(pack.updatedAt),
    songIds: pack.songs.map((entry) => entry.songId),
    songs: pack.songs.map((entry) => toSongDto(entry.song))
  };
}
