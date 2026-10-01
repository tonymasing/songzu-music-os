import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { appAssetPath, resolveStoredFilePath, storagePath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { assertReferenceAudioPath } from "@/lib/reference-library";
import { parseBeatGrid, type BeatGrid } from "@/lib/player-beat";

const execute = promisify(execFile);
const globals = globalThis as unknown as { playerBeatJobsV1?: { jobs: Map<string, Promise<BeatGrid>>; tail: Promise<unknown> } };
const queue = globals.playerBeatJobsV1 ??= { jobs: new Map(), tail: Promise.resolve() };

export class PlayerBeatQueueFull extends Error {
  constructor() { super("拍點分析排程已滿，播放器會自動重試。"); }
}

async function firstAvailable(paths: string[]) {
  for (const path of paths.filter(Boolean)) { try { await access(path); return path; } catch { /* Try the next installed path. */ } }
  throw new Error("拍點分析引擎目前無法使用，可先手動跟拍。");
}

/** Only resolve media already exposed by the application's media endpoints. */
export async function resolvePlayerAudio(src: string, origin: string) {
  const url = new URL(src, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error("這個來源目前只能手動跟拍。");
  let path: string | null = null;
  const reference = /^\/api\/music-materials\/([a-zA-Z0-9_-]{1,128})\/audio$/.exec(url.pathname);
  const file = /^\/api\/files\/([a-zA-Z0-9_-]{1,128})$/.exec(url.pathname);
  if (reference) {
    const item = await prisma.musicMaterial.findFirst({ where: { id: reference[1], materialType: "style_reference" }, select: { externalAudioPath: true } });
    if (item) path = assertReferenceAudioPath(item.externalAudioPath);
  } else if (file) {
    const item = await prisma.audioFile.findUnique({ where: { id: file[1] }, select: { filePath: true } });
    if (item?.filePath) path = resolveStoredFilePath(item.filePath);
  } else if (url.pathname.startsWith("/sound-assets/") && !url.search) {
    const item = await prisma.soundLibraryItem.findFirst({ where: { OR: [{ previewPath: url.pathname }, { assetPath: url.pathname }] }, select: { id: true } });
    if (item) {
      const root = await realpath(appAssetPath("public", "sound-assets"));
      const candidate = await realpath(resolve(root, decodeURIComponent(url.pathname.slice("/sound-assets/".length))));
      if (candidate.startsWith(root + "/")) path = candidate;
    }
  }
  if (!path) throw new Error("這個音檔目前無法自動分析，可先手動跟拍。");
  const resolved = await realpath(path), info = await stat(resolved);
  if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024 * 1024) throw new Error("音檔大小不適合自動拍點分析，可先手動跟拍。");
  return { path: resolved, key: createHash("sha256").update(JSON.stringify(["player-beats-v2", resolved, info.size, info.mtimeMs, info.ctimeMs])).digest("hex") };
}

export async function playerBeatGrid(source: Awaited<ReturnType<typeof resolvePlayerAudio>>) {
  const directory = storagePath("cache", "player-beats-v2");
  const cached = join(directory, source.key + ".json");
  try { const grid = parseBeatGrid(JSON.parse(await readFile(cached, "utf8"))); if (grid) return grid; } catch { /* A missing/bad derived cache can be regenerated. */ }
  const running = queue.jobs.get(source.key);
  if (running) return running;
  if (queue.jobs.size >= 6) throw new PlayerBeatQueueFull();
  const job = queue.tail.catch(() => {}).then(async () => {
    const python = await firstAvailable([
      process.env.SONGZU_HARMONY_NEURAL_PYTHON?.trim() || "",
      join(homedir(), "Library", "Application Support", "頌祖音樂 OS", "harmony-engine", "venv", "bin", "python"),
      storagePath("cache", "harmony-engine", "venv", "bin", "python"),
    ]);
    const script = await firstAvailable([resolve("scripts", "analyze-player-beats-v2.py"), appAssetPath("scripts", "analyze-player-beats-v2.py")]);
    const ffprobe = await firstAvailable(["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"]);
    const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", VECLIB_MAXIMUM_THREADS: "1" };
    const probe = await execute(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source.path], { timeout: 10000, maxBuffer: 8192, env });
    const duration = Number(probe.stdout.trim());
    if (!Number.isFinite(duration) || duration < 3 || duration > 900) throw new Error("這段音檔不適合自動拍點分析，可使用手動跟拍。");
    const { stdout } = await execute(python, [script, "--input", source.path], { timeout: 120000, maxBuffer: 1024 * 1024, env });
    const grid = parseBeatGrid(JSON.parse(stdout));
    if (!grid || grid.beats.at(-1)! > duration + 0.1) throw new Error("沒有找到可靠拍點，請使用手動跟拍。");
    // Derived cache only. Source audio, song metadata and confirmed score grids stay untouched.
    await mkdir(directory, { recursive: true });
    const temporary = cached + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(grid)); await rename(temporary, cached);
    return grid;
  });
  queue.jobs.set(source.key, job); queue.tail = job;
  try { return await job; } finally { queue.jobs.delete(source.key); }
}
