import {
  authorizeGuitarAiAdapter,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import {
  buildGuitarAiOwnerPrivateFormalScore,
  guitarAiOwnerPrivatePdfMaxBytes,
  guitarAiOwnerPrivateDeliveryScope
} from "@/lib/guitar-ai-formal-export";
import { prisma } from "@/lib/prisma";
import { safeScoreFileName, scoreExportSha256 } from "@/lib/score-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (
    [...url.searchParams.keys()].some((key) => key !== "format" && key !== "revision") ||
    (format !== "txt" && format !== "pdf")
  ) {
    return guitarAiAdapterJson(
      { error: "owner-private 正式譜只允許 txt 或 pdf 匯出。", code: "UNSUPPORTED_EXPORT_FORMAT" },
      400
    );
  }
  const revisionValue = url.searchParams.get("revision");
  const requestedRevision = revisionValue === null ? null : Number(revisionValue);
  if (requestedRevision !== null && (!Number.isInteger(requestedRevision) || requestedRevision <= 0)) {
    return guitarAiAdapterJson(
      { error: "正式譜 revision 必須是正整數。", code: "INVALID_REVISION" },
      400
    );
  }

  const { id } = await context.params;
  try {
    const draft = await prisma.dawScoreDraft.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        title: true,
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
                musicalKey: true,
                workingTitle: true
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
    const formal = await buildGuitarAiOwnerPrivateFormalScore({
      ...draft,
      status: release ? "REVIEWED" : draft.status,
      resultJson: release?.resultJson ?? draft.resultJson,
      formalRelease: release
    });
    if (!formal.ok) {
      return guitarAiAdapterJson(
        {
          error: "這份採譜尚未符合 owner-private 正式匯出條件。",
          code: "FORMAL_SCORE_REQUIRED",
          reason: formal.reason
        },
        409
      );
    }

    const isPdf = format === "pdf";
    const bytes = isPdf ? formal.pdfBytes : formal.bytes;
    const delivery = isPdf ? formal.metadata.delivery.pdf : formal.metadata.delivery.txt;
    if (
      scoreExportSha256(bytes) !== delivery.sha256 ||
      (isPdf && bytes.byteLength > guitarAiOwnerPrivatePdfMaxBytes)
    ) {
      return guitarAiAdapterJson(
        { error: "owner-private 正式譜完整性驗證失敗。", code: "FORMAL_SCORE_EXPORT_INTEGRITY_FAILED" },
        500
      );
    }
    const extension = isPdf ? "pdf" : "txt";
    const fileName = `${safeScoreFileName(`${formal.metadata.song.title} - 正式吉他譜`)}.${extension}`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `${isPdf ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": delivery.contentType,
        "X-Content-Type-Options": "nosniff",
        "X-Songzu-Delivery-Scope": guitarAiOwnerPrivateDeliveryScope,
        "X-Songzu-Export-Sha256": delivery.sha256,
        "X-Songzu-Score-Hash": formal.metadata.score.hash,
        "X-Songzu-Score-Id": formal.metadata.score.id,
        "X-Songzu-Score-Revision": String(formal.metadata.score.revision),
        "X-Songzu-Certification-Status": formal.metadata.score.certification.status,
        ...(formal.metadata.score.releaseId ? { "X-Songzu-Release-Id": formal.metadata.score.releaseId } : {})
      }
    });
  } catch {
    return guitarAiAdapterJson(
      { error: "owner-private 正式譜匯出目前不可用。", code: "FORMAL_SCORE_EXPORT_UNAVAILABLE" },
      500
    );
  }
}
