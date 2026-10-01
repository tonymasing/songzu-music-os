import {
  authorizeGuitarAiAdapter,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import {
  buildGuitarAiOwnerPrivateFormalScore,
  normalizeGuitarAiFormalTitle,
  type GuitarAiOwnerPrivateFormalScoreMetadata
} from "@/lib/guitar-ai-formal-export";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "title")) {
    return guitarAiAdapterJson(
      { error: "正式譜查詢參數不在允許清單。", code: "INVALID_QUERY" },
      400
    );
  }
  const title = normalizeGuitarAiFormalTitle(url.searchParams.get("title"));
  if (!title) {
    return guitarAiAdapterJson(
      { error: "請提供有效且完整的歌曲名稱。", code: "INVALID_TITLE" },
      400
    );
  }

  try {
    const songs = await prisma.song.findMany({
      where: { title },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        bpm: true,
        musicalKey: true,
        workingTitle: true,
        dawProjects: {
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: {
            id: true,
            scoreDrafts: {
              where: {
                targetInstrument: "guitar",
                OR: [
                  { status: { in: ["REVIEWED", "APPLIED"] } },
                  { formalReleases: { some: {} } }
                ]
              },
              orderBy: { updatedAt: "desc" },
              take: 20,
              select: {
                id: true,
                projectId: true,
                title: true,
                targetInstrument: true,
                status: true,
                resultJson: true,
                updatedAt: true,
                formalReleases: {
                  orderBy: { revision: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    revision: true,
                    formalContentSha256: true,
                    contentHashVersion: true,
                    resultJson: true,
                    textSha256: true,
                    pdfSha256: true,
                    releasedAt: true
                  }
                }
              }
            }
          }
        }
      }
    });

    const matches: GuitarAiOwnerPrivateFormalScoreMetadata[] = [];
    for (const song of songs) {
      if (song.title.normalize("NFC") !== title) continue;
      const eligible: Array<{
        metadata: GuitarAiOwnerPrivateFormalScoreMetadata;
        updatedAt: Date;
      }> = [];
      for (const project of song.dawProjects) {
        for (const draft of project.scoreDrafts) {
          const release = draft.formalReleases[0] ?? null;
          try {
            const built = await buildGuitarAiOwnerPrivateFormalScore({
              ...draft,
              status: release ? "REVIEWED" : draft.status,
              resultJson: release?.resultJson ?? draft.resultJson,
              formalRelease: release,
              project: {
                id: project.id,
                song: {
                  id: song.id,
                  title: song.title,
                  bpm: song.bpm,
                  musicalKey: song.musicalKey,
                  workingTitle: song.workingTitle
                }
              }
            });
            if (built.ok) eligible.push({ metadata: built.metadata, updatedAt: release?.releasedAt ?? draft.updatedAt });
          } catch {
            // Legacy or malformed drafts must not make a healthy locked release
            // disappear from the exact-title catalogue.
            continue;
          }
        }
      }
      eligible.sort((left, right) =>
        right.metadata.score.revision - left.metadata.score.revision ||
        right.updatedAt.getTime() - left.updatedAt.getTime()
      );
      if (eligible[0]) matches.push(eligible[0].metadata);
    }

    return guitarAiAdapterJson({
      title,
      matchMode: "exact",
      deliveryScope: "owner_private_preview",
      matches
    });
  } catch {
    return guitarAiAdapterJson(
      { error: "無法查詢 owner-private 正式譜。", code: "FORMAL_SCORE_CATALOG_UNAVAILABLE" },
      500
    );
  }
}
