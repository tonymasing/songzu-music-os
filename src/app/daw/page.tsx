import { DawOverviewWorkspace } from "@/components/DawOverviewWorkspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DawPage() {
  const songs = await prisma.song.findMany({
    include: {
      audioFiles: { select: { id: true, storageProvider: true } },
      recordingTakes: { select: { id: true } },
      performanceIssues: { select: { id: true } },
      dawProjects: {
        include: {
          tracks: {
            include: {
              clips: { select: { id: true } }
            }
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 1
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const rows = songs.map((song) => {
    const project = song.dawProjects[0] ?? null;
    return {
      songId: song.id,
      title: song.title,
      status: song.status,
      bpm: song.bpm,
      musicalKey: song.musicalKey,
      genre: song.genre,
      audioFileCount: song.audioFiles.length,
      localAudioCount: song.audioFiles.filter((file) => file.storageProvider === "local_upload").length,
      recordingTakeCount: song.recordingTakes.length,
      issueCount: song.performanceIssues.length,
      project: project
        ? {
            id: project.id,
            title: project.title,
            status: project.status,
            engineMode: project.engineMode,
            trackCount: project.tracks.length,
            clipCount: project.tracks.reduce((total, track) => total + track.clips.length, 0),
            updatedAt: project.updatedAt.toISOString()
          }
        : null
    };
  });

  return <DawOverviewWorkspace initialRows={rows} />;
}
