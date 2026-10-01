import {
  authorizeGuitarAiAdapter,
  buildGuitarAiPracticeAudioAsset,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const practiceAudioSelect = {
  id: true,
  songId: true,
  status: true,
  previewFileName: true,
  previewDurationSeconds: true,
  previewSha256: true,
  publishedAt: true,
  sourceAudioFile: {
    select: {
      id: true,
      fileType: true,
      qualityStatus: true,
      isProtectedOriginal: true,
      archivedAt: true
    }
  },
  song: {
    select: {
      id: true,
      title: true,
      bpm: true,
      musicalKey: true,
      rightsProfile: {
        select: {
          oneStopClearance: true,
          masterControlled: true,
          publishingControlled: true
        }
      }
    }
  }
} as const;

export async function GET(request: Request) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const songId = new URL(request.url).searchParams.get("songId")?.trim() ?? "";
  if (songId.length > 120) {
    return guitarAiAdapterJson({ error: "歌曲 ID 不可超過 120 個字元。", code: "INVALID_SONG_ID" }, 400);
  }

  try {
    const previews = await prisma.songPreview.findMany({
      where: {
        status: "PUBLISHED",
        ...(songId ? { songId } : {})
      },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 25,
      select: practiceAudioSelect
    });

    const assets = previews.flatMap((preview) => {
      const result = buildGuitarAiPracticeAudioAsset(preview);
      return result.ok ? [result.payload] : [];
    });
    return guitarAiAdapterJson({
      assets,
      policy: {
        delivery: "authorized_short_preview_only",
        nominalDurationSeconds: 30,
        downloadAllowed: false,
        fullSourceAudioAvailable: false
      }
    });
  } catch {
    return guitarAiAdapterJson(
      { error: "無法讀取受控練習音檔目錄。", code: "AUDIO_CATALOG_UNAVAILABLE" },
      500
    );
  }
}
