import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { songInclude, type SongRecord } from "@/lib/music";
import { appAssetPath, storagePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);

type CopiedSoundFile = {
  kind: "original" | "preview";
  sourcePath: string;
  fileName: string;
  relativePath: string;
  fileSizeBytes: number;
};

export type RecordingKitExport = {
  songId: string;
  kitName: string;
  folderName: string;
  folderPath: string;
  zipFileName: string | null;
  zipPath: string | null;
  downloadUrl: string | null;
  fileSizeBytes: number | null;
  soundCount: number;
  copiedAudioCount: number;
  missingAudioCount: number;
  generatedAt: string;
};

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKD")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._ -]+/g, "_")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "sound"
  );
}

function kitsRoot(songId: string) {
  return storagePath("exports", songId, "recording-kits");
}

function resolveAssetDiskPath(value: string | null | undefined) {
  if (!value) return null;
  const relativePath = value
    .replace(/^\/api\/sound-assets\//, "")
    .replace(/^\/sound-assets\//, "");
  if (relativePath !== value) {
    return join(storagePath("sounds"), relativePath);
  }
  return null;
}

async function resolveSoundAsset(value: string | null | undefined) {
  const preferred = resolveAssetDiskPath(value);
  if (preferred && (await exists(preferred))) return preferred;
  if (!value) return null;
  const relativePath = value
    .replace(/^\/api\/sound-assets\//, "")
    .replace(/^\/sound-assets\//, "");
  if (relativePath === value) return null;
  const bundled = appAssetPath("public", "sound-assets", relativePath);
  return (await exists(bundled)) ? bundled : null;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function copySoundFile({
  sourceUrl,
  folder,
  soundName,
  soundId,
  kind
}: {
  sourceUrl: string | null | undefined;
  folder: string;
  soundName: string;
  soundId: string;
  kind: "original" | "preview";
}): Promise<CopiedSoundFile | null> {
  const sourcePath = await resolveSoundAsset(sourceUrl);
  if (!sourcePath) return null;

  const fileStat = await stat(sourcePath);
  const ext = extname(sourcePath) || ".audio";
  const fileName = `${safeFileName(soundName)}-${soundId.slice(-8)}-${kind}${ext}`;
  const relativePath = `audio/${kind}s/${fileName}`;
  const targetPath = join(folder, relativePath);

  await mkdir(join(folder, "audio", `${kind}s`), { recursive: true });
  await copyFile(sourcePath, targetPath);

  return {
    kind,
    sourcePath,
    fileName,
    relativePath,
    fileSizeBytes: fileStat.size
  };
}

function buildReadme(song: SongRecord, copiedCount: number, missingCount: number) {
  const lines = [
    `# ${song.title} - Recording Kit`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Song",
    `- BPM: ${song.bpm ?? "待設定"}`,
    `- Key: ${song.musicalKey ?? "待設定"}`,
    `- Genre: ${song.genre ?? "待設定"}`,
    `- Status: ${song.status}`,
    "",
    "## Audio Assets",
    `- Copied audio files: ${copiedCount}`,
    `- Items without local audio: ${missingCount}`,
    "",
    "## GarageBand Prep",
    "- Import originals when you need source quality.",
    "- Use previews for quick listening and arrangement decisions.",
    "- Check every effect chain manually before recording.",
    "- Keep recorded takes as new audio versions; do not overwrite originals.",
    "",
    "## Sound Blueprint"
  ];

  for (const usage of song.soundUsages) {
    const item = usage.soundLibraryItem;
    lines.push(
      "",
      `### ${item.name}`,
      `- Role: ${usage.role ?? "未設定"}`,
      `- Section: ${usage.section ?? "全曲"}`,
      `- Status: ${usage.status}`,
      `- Family: ${item.family ?? "未分類"}`,
      `- Era: ${item.era ?? "未設定"}`,
      `- Chain: ${parseJsonArray(item.chainJson).join(" -> ") || "未建立"}`,
      `- GarageBand: ${item.garageBandHint ?? "待補"}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildManifest(song: SongRecord, copiedFilesByUsageId: Record<string, CopiedSoundFile[]>) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    song: {
      id: song.id,
      title: song.title,
      workingTitle: song.workingTitle,
      bpm: song.bpm,
      musicalKey: song.musicalKey,
      genre: song.genre,
      subgenre: song.subgenre,
      status: song.status
    },
    sounds: song.soundUsages.map((usage) => ({
      id: usage.soundLibraryItem.id,
      usageId: usage.id,
      name: usage.soundLibraryItem.name,
      itemType: usage.soundLibraryItem.itemType,
      family: usage.soundLibraryItem.family,
      era: usage.soundLibraryItem.era,
      role: usage.role,
      section: usage.section,
      status: usage.status,
      notes: usage.notes,
      source: usage.soundLibraryItem.source,
      sourceUrl: usage.soundLibraryItem.sourceUrl,
      licenseName: usage.soundLibraryItem.licenseName,
      licenseUrl: usage.soundLibraryItem.licenseUrl,
      tags: parseJsonArray(usage.soundLibraryItem.tagsJson),
      character: parseJsonArray(usage.soundLibraryItem.characterJson),
      useCases: parseJsonArray(usage.soundLibraryItem.useCasesJson),
      chain: parseJsonArray(usage.soundLibraryItem.chainJson),
      garageBandHint: usage.soundLibraryItem.garageBandHint,
      sha256: usage.soundLibraryItem.sha256,
      copiedFiles: copiedFilesByUsageId[usage.id] ?? []
    }))
  };
}

function buildGarageBandBlueprint(song: SongRecord, copiedFilesByUsageId: Record<string, CopiedSoundFile[]>) {
  return {
    operation: "recording-kit-blueprint",
    songId: song.id,
    songTitle: song.title,
    tempo: song.bpm,
    key: song.musicalKey,
    createdAt: new Date().toISOString(),
    tracks: song.soundUsages.map((usage) => ({
      trackName: usage.role ? `${usage.role} - ${usage.soundLibraryItem.name}` : usage.soundLibraryItem.name,
      section: usage.section ?? "全曲",
      status: usage.status,
      family: usage.soundLibraryItem.family,
      itemType: usage.soundLibraryItem.itemType,
      importFiles: (copiedFilesByUsageId[usage.id] ?? []).map((file) => file.relativePath),
      effectChain: parseJsonArray(usage.soundLibraryItem.chainJson),
      garageBandHint: usage.soundLibraryItem.garageBandHint,
      notes: usage.notes ?? usage.soundLibraryItem.notes
    })),
    checklist: [
      "Set project tempo and key before importing assets.",
      "Import preview files first for arrangement tests.",
      "Import originals only when committing to a recording sound.",
      "Create a new take or version for every export."
    ]
  };
}

export async function exportRecordingKit(songId: string): Promise<RecordingKitExport> {
  const song = await prisma.song.findUniqueOrThrow({
    where: { id: songId },
    include: songInclude
  });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const folderName = `${slugify(song.title) || `song-${song.id.slice(0, 8)}`}-recording-kit-${stamp}`;
  const root = kitsRoot(song.id);
  const folderPath = join(root, folderName);
  await mkdir(folderPath, { recursive: true });

  const copiedFilesByUsageId: Record<string, CopiedSoundFile[]> = {};

  for (const usage of song.soundUsages) {
    const copied = (
      await Promise.all([
        copySoundFile({
          sourceUrl: usage.soundLibraryItem.assetPath,
          folder: folderPath,
          soundName: usage.soundLibraryItem.name,
          soundId: usage.soundLibraryItem.id,
          kind: "original"
        }),
        copySoundFile({
          sourceUrl: usage.soundLibraryItem.previewPath,
          folder: folderPath,
          soundName: usage.soundLibraryItem.name,
          soundId: usage.soundLibraryItem.id,
          kind: "preview"
        })
      ])
    ).filter((item): item is CopiedSoundFile => Boolean(item));
    copiedFilesByUsageId[usage.id] = copied;
  }

  const copiedAudioCount = Object.values(copiedFilesByUsageId).reduce((total, files) => total + files.length, 0);
  const missingAudioCount = song.soundUsages.filter((usage) => !copiedFilesByUsageId[usage.id]?.length).length;

  await Promise.all([
    writeFile(join(folderPath, "README.md"), buildReadme(song, copiedAudioCount, missingAudioCount)),
    writeFile(join(folderPath, "manifest.json"), JSON.stringify(buildManifest(song, copiedFilesByUsageId), null, 2)),
    writeFile(join(folderPath, "garageband-blueprint.json"), JSON.stringify(buildGarageBandBlueprint(song, copiedFilesByUsageId), null, 2))
  ]);

  const zipFileName = `${folderName}.zip`;
  const zipPath = join(root, zipFileName);
  let finalZipPath: string | null = null;
  let fileSizeBytes: number | null = null;

  try {
    await execFileAsync("/usr/bin/zip", ["-qr", zipPath, folderName], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000
    });
    const zipStat = await stat(zipPath);
    finalZipPath = zipPath;
    fileSizeBytes = zipStat.size;
  } catch {
    finalZipPath = null;
    fileSizeBytes = null;
  }

  await prisma.timelineEvent.create({
    data: {
      songId: song.id,
      eventType: "recording_kit_exported",
      title: "匯出錄音素材包",
      description: `${folderName} 已建立，包含 ${copiedAudioCount} 個音訊檔與 ${song.soundUsages.length} 個音色設定。`,
      relatedModel: "RecordingKit",
      relatedId: zipFileName,
      metadataJson: JSON.stringify({ folderName, zipFileName, copiedAudioCount, missingAudioCount })
    }
  });

  return {
    songId: song.id,
    kitName: `${song.title} Recording Kit`,
    folderName,
    folderPath,
    zipFileName: finalZipPath ? zipFileName : null,
    zipPath: finalZipPath,
    downloadUrl: finalZipPath ? `/api/songs/${song.id}/recording-kit?file=${encodeURIComponent(zipFileName)}` : null,
    fileSizeBytes,
    soundCount: song.soundUsages.length,
    copiedAudioCount,
    missingAudioCount,
    generatedAt: new Date().toISOString()
  };
}

export async function listRecordingKits(songId: string) {
  const root = kitsRoot(songId);
  try {
    await stat(root);
  } catch {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const kits = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
      .map(async (entry) => {
        const filePath = join(root, entry.name);
        const fileStat = await stat(filePath);
        return {
          fileName: entry.name,
          fileSizeBytes: fileStat.size,
          createdAt: fileStat.birthtime.toISOString(),
          downloadUrl: `/api/songs/${songId}/recording-kit?file=${encodeURIComponent(entry.name)}`
        };
      })
  );

  return kits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readRecordingKitZip(songId: string, fileName: string) {
  const safeName = basename(fileName);
  const filePath = join(kitsRoot(songId), safeName);
  return {
    fileName: safeName,
    bytes: await readFile(filePath)
  };
}

export async function clearRecordingKitFolder(songId: string, folderName: string) {
  const safeName = basename(folderName);
  await rm(join(kitsRoot(songId), safeName), { recursive: true, force: true });
}
