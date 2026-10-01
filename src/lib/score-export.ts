import { createHash } from "node:crypto";

import { autoScoreToText, type AutoScoreResult } from "@/lib/auto-score";
import { autoScoreToChordSheetPdf } from "@/lib/chord-sheet-pdf";

type OfficialScorePdfOptions = {
  title?: string;
  artist?: string;
};

export function scoreExportSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isStructurallyValidOfficialScorePdf(bytes: Uint8Array) {
  if (bytes.byteLength < 32) return false;
  const prefix = Buffer.from(bytes.subarray(0, Math.min(8, bytes.byteLength))).toString("ascii");
  const suffix = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).toString("ascii");
  return prefix.startsWith("%PDF-") && /startxref\s+\d+\s+%%EOF\s*$/s.test(suffix);
}

export function safeScoreFileName(value: string) {
  return value.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "songzu-score";
}

export function scoreArtist(workingTitle: string | null, title: string) {
  if (!workingTitle) return undefined;
  const suffix = ` - ${title}`;
  return workingTitle.endsWith(suffix) ? workingTitle.slice(0, -suffix.length).trim() || undefined : undefined;
}

/**
 * Canonical text export shared by the Music OS UI and the owner-private
 * Guitar AI adapter. This preserves 本機創作者's arrangement, sections and
 * confirmed strumming instead of rebuilding a score from raw bars.
 */
export function buildOfficialScoreTextExport(result: AutoScoreResult, fallbackTitle: string) {
  const text = autoScoreToText(result, fallbackTitle);
  const bytes = new TextEncoder().encode(text);
  return {
    text,
    bytes,
    sha256: scoreExportSha256(bytes)
  };
}

/**
 * Canonical PDF export shared by the Music OS UI and the owner-private
 * Guitar AI adapter. The PDF generator consumes the same complete current
 * result as the TXT path, including 本機創作者's arrangement, sections and
 * confirmed strumming; it never reconstructs a score from adapter bars.
 */
export async function buildOfficialScorePdfExport(
  result: AutoScoreResult,
  fallbackTitle: string,
  options: OfficialScorePdfOptions = {}
) {
  const generated = await autoScoreToChordSheetPdf(result, fallbackTitle, options);
  const bytes = new Uint8Array(generated);
  if (!isStructurallyValidOfficialScorePdf(bytes)) {
    throw new Error("Music OS official score PDF pipeline returned invalid content");
  }
  return {
    bytes,
    sha256: scoreExportSha256(bytes)
  };
}
