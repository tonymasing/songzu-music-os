import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startLegacyMusicEntry } from "./legacy-music-entry.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);

function readArg(names, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) return args[index + 1] ?? fallback;
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return fallback;
}

const port = readArg(["--port", "-p"], process.env.PORT || "3000");
const hostname = readArg(["--hostname", "-H"], process.env.HOSTNAME || "0.0.0.0");
const standaloneEntry = join(root, ".next", "standalone", "server.js");
const standaloneRoot = join(root, ".next", "standalone");

if (!existsSync(standaloneEntry)) {
  console.error("找不到 .next/standalone/server.js。請先執行 npm run build。");
  process.exit(1);
}

process.env.HOSTNAME = hostname;
process.env.PORT = port;
process.env.SONGZU_MUSIC_OS_DATA_ROOT ||= root;
process.env.SONGZU_MUSIC_OS_APP_ASSETS_ROOT ||= root;
process.env.DATABASE_URL ||= `file:${join(root, "prisma", "dev.db")}`;
process.env.SONGZU_STORAGE_MIGRATION_WORKER ||= join(root, "scripts", "storage-migration-worker.mjs");

async function syncIfExists(from, to) {
  if (!existsSync(from)) return;
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

await syncIfExists(join(root, "public"), join(standaloneRoot, "public"));
await mkdir(join(standaloneRoot, ".next"), { recursive: true });
await syncIfExists(join(root, ".next", "static"), join(standaloneRoot, ".next", "static"));

await import(pathToFileURL(standaloneEntry).href);

if (Number(port) === 3000) startLegacyMusicEntry();
