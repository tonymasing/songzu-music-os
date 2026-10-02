import { readFile, realpath, stat, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { appPath, appAssetPath } from "@/lib/paths";

import { prisma } from "@/lib/prisma";
import bundled from "../../public/bundled-references/manifest.json";

const manifestSchema = z.object({
  version: z.literal(1),
  materialId: z.string(),
  fileName: z.string().regex(/^[a-f0-9]{64}\.mp4$/),
  durationSeconds: z.number().finite().positive(),
  sizeBytes: z.number().int().positive()
});

/** Sidecars keep private MV associations separate from imported song notes. */
export async function getReferenceVideo(materialId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(materialId)) return null;
  let personalManifestExists = true;
  try { await lstat(appPath("uploads", "reference-videos", `${materialId}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") personalManifestExists = false; else return null; }
  try {
    const root = await realpath(appPath("uploads", "reference-videos"));
    const manifestPath = await realpath(join(root, `${materialId}.json`));
    if (dirname(manifestPath) !== root) return null;
    const info = await stat(manifestPath);
    if (!info.isFile() || info.size > 8192) return null;
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (manifest.materialId !== materialId) return null;
    const path = await realpath(join(root, manifest.fileName));
    if (dirname(path) !== root) return null;
    const file = await stat(path);
    if (!file.isFile() || file.size !== manifest.sizeBytes) return null;
    return { ...manifest, path };
  } catch {
    if (personalManifestExists) return null;
    // A personal sidecar takes priority; portable bundled assets are a fallback.
    const item = await prisma.musicMaterial.findUnique({ where: { id: materialId }, select: { externalSourceKey: true } });
    const entry = bundled.find((entry) => entry.key === item?.externalSourceKey);
    if (!entry?.video) return null;
    try {
      const root = await realpath(appAssetPath("public", "bundled-references"));
      const path = await realpath(join(root, entry.video.file));
      if (dirname(path) !== root) return null;
      const file = await stat(path);
      if (!file.isFile() || file.size !== entry.video.sizeBytes) return null;
      return { version: 1, materialId, fileName: `${entry.video.sha256}.mp4`, durationSeconds: entry.video.durationSeconds, sizeBytes: file.size, path };
    } catch { return null; }
  }
}
