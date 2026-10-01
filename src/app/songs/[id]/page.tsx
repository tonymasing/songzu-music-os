import { notFound } from "next/navigation";

import { SongDetailWorkspace } from "@/components/SongDetailWorkspace";
import { getContributors, getSong } from "@/lib/data";
import { getSoundLibraryItems } from "@/lib/sound-library";

export default async function SongDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [song, contributors, soundLibraryItems] = await Promise.all([getSong(id), getContributors(), getSoundLibraryItems()]);

  if (!song) {
    notFound();
  }

  return (
    <SongDetailWorkspace
      initialSong={song}
      initialSoundLibraryItems={soundLibraryItems}
      contributors={contributors.map((contributor) => ({
        id: contributor.id,
        name: contributor.name,
        email: contributor.email,
        defaultRoles: contributor.defaultRoles
      }))}
    />
  );
}
