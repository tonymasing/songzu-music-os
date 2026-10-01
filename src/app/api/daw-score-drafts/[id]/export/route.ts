import { NextResponse } from "next/server";

import { autoScoreToMidi, autoScoreToMusicXml } from "@/lib/auto-score";
import { prisma } from "@/lib/prisma";
import {
  buildOfficialScorePdfExport,
  buildOfficialScoreTextExport,
  safeScoreFileName,
  scoreArtist
} from "@/lib/score-export";
import { getScoreDraft, parseScoreResult } from "@/lib/score-drafts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const draft = await getScoreDraft(id);
  if (!draft) return NextResponse.json({ error: "找不到採譜草稿" }, { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "musicxml";
  const draftMode = url.searchParams.get("draft") === "1";
  const forceDownload = url.searchParams.get("download") === "1";
  const result = parseScoreResult(draft.resultJson);
  if (result.targetInstrument === "guitar" && (result.review?.status !== "finalized" || result.review.verificationMethod !== "manual") && !draftMode) {
    return NextResponse.json({ error: "這份吉他譜尚未完成逐拍人工確認；正式匯出前請先確認並鎖定，或使用草稿備份" }, { status: 409 });
  }
  const identity = result.verification?.officialMetadata;
  const baseName = safeScoreFileName(
    result.targetInstrument === "guitar" && identity
      ? `${identity.artist} - ${identity.title} - 完整吉他譜`
      : draft.title
  );
  let body: BodyInit;
  let type: string;
  let extension: string;

  if (format === "midi") {
    body = autoScoreToMidi(result, draft.title);
    type = "audio/midi";
    extension = "mid";
  } else if (format === "pdf") {
    const project = await prisma.dawProject.findUnique({
      where: { id: draft.projectId },
      select: { song: { select: { title: true, workingTitle: true } } }
    });
    body = (await buildOfficialScorePdfExport(result, draft.title, {
      title: project?.song.title,
      artist: project?.song ? scoreArtist(project.song.workingTitle, project.song.title) : undefined
    })).bytes;
    type = "application/pdf";
    extension = "pdf";
  } else if (format === "txt") {
    body = buildOfficialScoreTextExport(result, draft.title).bytes;
    type = "text/plain; charset=utf-8";
    extension = "txt";
  } else if (format === "json") {
    body = JSON.stringify(result, null, 2);
    type = "application/json; charset=utf-8";
    extension = "json";
  } else {
    body = autoScoreToMusicXml(result, draft.title);
    type = "application/vnd.recordare.musicxml+xml; charset=utf-8";
    extension = "musicxml";
  }

  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${format === "pdf" && !forceDownload ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`${baseName}.${extension}`)}`,
      "Cache-Control": "private, no-store"
    }
  });
}
