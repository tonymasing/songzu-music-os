import {
  authorizeGuitarAiAdapter,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
  if (query.length > 120) {
    return guitarAiAdapterJson(
      { error: "歌曲查詢不可超過 120 個字元。", code: "INVALID_QUERY" },
      400
    );
  }

  try {
    const songs = await prisma.song.findMany({
      where: query ? { title: { contains: query } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        bpm: true,
        musicalKey: true,
        dawProjects: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true }
        }
      }
    });

    return guitarAiAdapterJson({
      songs: songs.map(({ dawProjects, ...song }) => ({
        ...song,
        projectId: dawProjects[0]?.id ?? null
      }))
    });
  } catch {
    return guitarAiAdapterJson(
      { error: "無法讀取受控歌曲目錄。", code: "CATALOG_UNAVAILABLE" },
      500
    );
  }
}
