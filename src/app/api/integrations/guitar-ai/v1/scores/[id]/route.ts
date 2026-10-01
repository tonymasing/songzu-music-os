import {
  authorizeGuitarAiAdapter,
  buildFormalGuitarAiScore,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const { id } = await context.params;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "revision")) {
    return guitarAiAdapterJson({ error: "正式譜查詢參數不在允許清單。", code: "INVALID_QUERY" }, 400);
  }
  const revisionValue = url.searchParams.get("revision");
  const requestedRevision = revisionValue === null ? null : Number(revisionValue);
  if (requestedRevision !== null && (!Number.isInteger(requestedRevision) || requestedRevision <= 0)) {
    return guitarAiAdapterJson({ error: "正式譜 revision 必須是正整數。", code: "INVALID_REVISION" }, 400);
  }
  try {
    const draft = await prisma.dawScoreDraft.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        targetInstrument: true,
        status: true,
        resultJson: true,
        formalReleases: {
          ...(requestedRevision ? { where: { revision: requestedRevision } } : {}),
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
        },
        project: {
          select: {
            id: true,
            song: {
              select: {
                id: true,
                title: true,
                bpm: true,
                musicalKey: true
              }
            }
          }
        }
      }
    });
    if (!draft) {
      return guitarAiAdapterJson(
        { error: "找不到指定的正式譜。", code: "SCORE_NOT_FOUND" },
        404
      );
    }

    const release = draft.formalReleases[0] ?? null;
    if (requestedRevision && !release) {
      return guitarAiAdapterJson(
        { error: "找不到指定的正式譜版本。", code: "SCORE_RELEASE_NOT_FOUND" },
        404
      );
    }
    const formalScore = buildFormalGuitarAiScore({
      ...draft,
      status: release ? "REVIEWED" : draft.status,
      resultJson: release?.resultJson ?? draft.resultJson,
      formalRelease: release
    });
    if (!formalScore.ok) {
      return guitarAiAdapterJson(
        {
          error: "這份採譜尚未符合正式教材來源條件。",
          code: "FORMAL_SCORE_REQUIRED",
          reason: formalScore.reason
        },
        409
      );
    }

    return guitarAiAdapterJson(formalScore.payload);
  } catch {
    return guitarAiAdapterJson(
      { error: "無法讀取正式譜。", code: "SCORE_UNAVAILABLE" },
      500
    );
  }
}
