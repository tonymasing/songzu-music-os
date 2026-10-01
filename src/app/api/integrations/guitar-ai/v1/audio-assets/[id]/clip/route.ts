import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  authorizeGuitarAiAdapter,
  buildGuitarAiPracticeAudioAsset,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";
import { prisma } from "@/lib/prisma";
import { songPreviewPath } from "@/lib/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PRACTICE_CLIP_BYTES = 8 * 1024 * 1024;
type RouteContext = { params: Promise<{ id: string }> };

function parseRange(header: string | null, size: number) {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  const { id } = await context.params;
  try {
    const preview = await prisma.songPreview.findUnique({
      where: { id },
      select: {
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
      }
    });
    if (!preview) return guitarAiAdapterJson({ error: "找不到練習音檔。", code: "AUDIO_ASSET_NOT_FOUND" }, 404);

    const allowed = buildGuitarAiPracticeAudioAsset(preview);
    if (!allowed.ok || !preview.previewFileName) {
      return guitarAiAdapterJson(
        { error: "這份音檔沒有學生練習播放授權。", code: "AUDIO_ASSET_NOT_AUTHORIZED" },
        409
      );
    }

    const path = songPreviewPath(preview.songId, preview.previewFileName);
    const file = await stat(path);
    if (!file.isFile() || file.size <= 0 || file.size > MAX_PRACTICE_CLIP_BYTES) {
      return guitarAiAdapterJson({ error: "練習音檔無法安全提供。", code: "AUDIO_ASSET_UNAVAILABLE" }, 409);
    }
    const bytes = await readFile(path);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== allowed.payload.asset.sha256) {
      return guitarAiAdapterJson({ error: "練習音檔完整性驗證失敗。", code: "AUDIO_ASSET_INTEGRITY_FAILED" }, 409);
    }

    const range = parseRange(request.headers.get("range"), bytes.length);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "private, no-store" }
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? bytes.length - 1;
    const body = bytes.subarray(start, end + 1);
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": 'inline; filename="songzu-practice-clip-30s.m4a"',
        "Content-Length": String(body.length),
        "Content-Type": "audio/mp4",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {})
      }
    });
  } catch {
    return guitarAiAdapterJson({ error: "練習音檔目前不可用。", code: "AUDIO_ASSET_UNAVAILABLE" }, 404);
  }
}
