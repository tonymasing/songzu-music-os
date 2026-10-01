import { notFound } from "next/navigation";

import { PublicClaimWorkspace } from "@/components/PublicClaimWorkspace";
import { publicSongPreview } from "@/lib/storefront";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ token: string }> };

export default async function PublicSongPreviewPage({ params }: PageProps) {
  const { token } = await params;
  const preview = await publicSongPreview(token);
  if (!preview) notFound();
  return <PublicClaimWorkspace preview={preview} />;
}
