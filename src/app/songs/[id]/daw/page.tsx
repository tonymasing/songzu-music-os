import { notFound } from "next/navigation";

import { DawProjectWorkspace } from "@/components/DawProjectWorkspace";
import { getOrCreateDawProject, toDawProjectDto } from "@/lib/daw";
import { getSong } from "@/lib/data";
import { getSoundLibraryItems } from "@/lib/sound-library";

export default async function SongDawPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [song, project, soundLibraryItems] = await Promise.all([getSong(id), getOrCreateDawProject(id), getSoundLibraryItems()]);

  if (!song || !project) {
    notFound();
  }

  return (
    <DawProjectWorkspace
      initialProject={toDawProjectDto(project)}
      availableAudioFiles={song.audioFiles
        .filter((file) => !file.archivedAt)
        .map((file) => ({
          id: file.id,
          fileName: file.fileName,
          fileType: file.fileType,
          versionName: file.versionName,
          durationSeconds: file.durationSeconds,
          qualityStatus: file.qualityStatus,
          storageProvider: file.storageProvider,
          sourceKind: file.sourceKind,
          isProtectedOriginal: file.isProtectedOriginal,
          mimeType: file.mimeType,
          codecName: file.codecName,
          parentAudioFileId: file.parentAudioFileId
        }))}
      soundLibraryItems={soundLibraryItems.slice(0, 24)}
    />
  );
}
