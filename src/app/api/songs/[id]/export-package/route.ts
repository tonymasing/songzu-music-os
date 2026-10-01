import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { NextResponse } from "next/server";

import { songInclude, toSongDto } from "@/lib/music";
import { buildPublishingPlan, exportTextAssets } from "@/lib/platform-publishing";
import { prisma } from "@/lib/prisma";
import { createStoredZip } from "@/lib/zip";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "song";
}

function textFileName(value: string) {
  return slugify(value).replaceAll("-", "_");
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "zip";
  const song = await prisma.song.findUnique({
    where: { id },
    include: songInclude
  });

  if (!song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const dto = toSongDto(song);
  const publishingPlan = buildPublishingPlan(dto);
  const textAssets = exportTextAssets(dto);
  const manifest = {
    exportedAt: new Date().toISOString(),
    song: {
      id: dto.id,
      title: dto.title,
      status: dto.statusLabel,
      bpm: dto.bpm,
      musicalKey: dto.musicalKey,
      genre: dto.genre,
      summary: dto.summary,
      targetReleaseDate: dto.targetReleaseDate,
      readiness: dto.readiness,
      splitTotal: dto.splitTotal,
      warnings: dto.warnings
    },
    audioFiles: dto.audioFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      fileType: file.fileType,
      versionName: file.versionName,
      storageProvider: file.storageProvider,
      sourceKind: file.sourceKind,
      includedInZip: Boolean(file.filePath && file.storageProvider === "local_upload"),
      qualityStatus: file.qualityStatus,
      sha256: file.sha256,
      fileSizeBytes: file.fileSizeBytes
    })),
    credits: dto.credits.map((credit) => ({
      name: credit.contributor.name,
      role: credit.role,
      splitPercentage: credit.splitPercentage,
      ownershipType: credit.ownershipType
    })),
    releaseTracks: dto.releaseTracks,
    publishingPlan
  };

  if (format === "json") {
    return NextResponse.json(manifest);
  }

  const entries: Array<{ path: string; data: Buffer | string }> = [
    { path: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { path: "metadata/song.json", data: JSON.stringify(manifest.song, null, 2) },
    { path: "metadata/credits.json", data: JSON.stringify(manifest.credits, null, 2) },
    { path: "metadata/publishing-plan.json", data: JSON.stringify(publishingPlan, null, 2) }
  ];

  for (const version of dto.lyricsVersions) {
    entries.push({
      path: `lyrics/${textFileName(version.versionName)}.txt`,
      data: version.content
    });
  }

  for (const asset of textAssets) {
    entries.push({
      path: `promo/${asset.fileName}`,
      data: `${asset.title}\n\n${asset.content}`
    });
  }

  for (const file of dto.audioFiles) {
    if (file.filePath && file.storageProvider === "local_upload") {
      entries.push({
        path: `files/${file.fileType}/${basename(file.fileName)}`,
        data: await readFile(file.filePath)
      });
    }
  }

  const zip = createStoredZip(entries);
  const fileName = `${slugify(dto.title)}-export-package.zip`;
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`
    }
  });
}
