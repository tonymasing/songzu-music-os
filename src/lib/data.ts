import { prisma } from "@/lib/prisma";
import { songInclude, statusLabel, toSongDto } from "@/lib/music";

export async function getSongs() {
  const songs = await prisma.song.findMany({
    include: songInclude,
    orderBy: { updatedAt: "desc" }
  });

  return songs.map(toSongDto);
}

export async function getSong(id: string) {
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  return song ? toSongDto(song) : null;
}

export async function getContributors() {
  return prisma.contributor.findMany({
    orderBy: { name: "asc" }
  });
}

export async function getDashboardData() {
  const songs = await getSongs();
  const totalSongs = songs.length;
  const byStatus = songs.reduce<Record<string, { label: string; count: number }>>((acc, song) => {
    acc[song.status] ??= { label: statusLabel(song.status), count: 0 };
    acc[song.status].count += 1;
    return acc;
  }, {});
  const readySongs = songs.filter((song) => song.releaseReadiness.ready);
  const missingMetadataSongs = songs.filter((song) => song.warnings.length > 0);
  const averageReadiness = totalSongs
    ? Math.round(songs.reduce((sum, song) => sum + song.readiness, 0) / totalSongs)
    : 0;
  const activeTasks = songs.flatMap((song) =>
    song.tasks
      .filter((task) => task.status !== "DONE")
      .map((task) => ({
        ...task,
        songId: song.id,
        songTitle: song.title
      }))
  );

  return {
    totalSongs,
    byStatus: Object.entries(byStatus).map(([status, value]) => ({
      status,
      ...value
    })),
    averageReadiness,
    readySongs,
    missingMetadataSongs,
    recentlyUpdated: songs.slice(0, 5),
    activeTasks: activeTasks.slice(0, 8),
    songs
  };
}
