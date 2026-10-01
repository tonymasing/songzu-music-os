import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const electronDir = join(root, "electron");
const electronPackageRoot = join(root, ".electron-package");
const electronBaselineDbPath = join(root, "electron-baseline", "prisma", "dev.db");
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const requestedMode = modeArg?.split("=")[1];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const hasBuild = await exists(join(root, ".next"));
const serverScript = requestedMode === "dev" ? "dev" : requestedMode === "start" ? "start" : hasBuild ? "start" : "dev";

async function copyIfExists(from, to) {
  if (!(await exists(from))) return false;
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  return true;
}

async function removeIfExists(path) {
  await rm(path, { recursive: true, force: true });
}

async function removeMacPackagingMetadata(directory) {
  if (!(await exists(directory))) return [];

  const removed = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) {
      await rm(path, { recursive: true, force: true });
      removed.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      removed.push(...(await removeMacPackagingMetadata(path)));
    }
  }
  return removed;
}

async function copyPrismaNativeRuntime(standaloneRoot) {
  const copiedClient = await copyIfExists(
    join(root, "node_modules", "@prisma", "client"),
    join(standaloneRoot, "node_modules", "@prisma", "client")
  );
  const copiedGeneratedClient = await copyIfExists(
    join(root, "node_modules", ".prisma", "client"),
    join(standaloneRoot, "node_modules", ".prisma", "client")
  );
  if (!copiedClient || !copiedGeneratedClient) {
    throw new Error("找不到 Prisma macOS 原生 runtime，無法建立可獨立執行的桌面 App。");
  }
}

async function writePrismaExternalAliases(standaloneRoot) {
  const sourceAliasRoot = join(root, ".next", "node_modules", "@prisma");
  if (!(await exists(sourceAliasRoot))) return [];
  const aliases = (await readdir(sourceAliasRoot)).filter((entry) => entry.startsWith("client-"));
  for (const alias of aliases) {
    const aliasRoot = join(standaloneRoot, "node_modules", "@prisma", alias);
    await mkdir(aliasRoot, { recursive: true });
    await writeFile(
      join(aliasRoot, "package.json"),
      `${JSON.stringify({ name: `@prisma/${alias}`, private: true, main: "index.js" }, null, 2)}\n`
    );
    await writeFile(join(aliasRoot, "index.js"), 'module.exports = require("../client");\n');
  }
  return aliases;
}

async function pruneUnusedPrismaRuntimes(standaloneRoot) {
  const runtimeDir = join(standaloneRoot, "node_modules", "@prisma", "client", "runtime");
  if (!(await exists(runtimeDir))) return { count: 0, bytes: 0 };

  const unusedRuntimePattern = /^(query_engine_bg|query_compiler_bg)\.|\.map$/i;
  const entries = (await readdir(runtimeDir)).filter((entry) => unusedRuntimePattern.test(entry));
  const generatedClientDir = join(standaloneRoot, "node_modules", ".prisma", "client");
  const generatedWasmFiles = [
    "default.d.ts",
    "edge.d.ts",
    "index.d.ts",
    "query_engine_bg.js",
    "query_engine_bg.wasm",
    "wasm-edge-light-loader.mjs",
    "wasm-worker-loader.mjs",
    "wasm.d.ts",
    "wasm.js"
  ];
  const developmentDirectories = [
    join(standaloneRoot, "node_modules", "@prisma", "client", "generator-build"),
    join(standaloneRoot, "node_modules", "@prisma", "client", "scripts")
  ];
  let bytes = 0;
  let count = 0;

  for (const entry of entries) {
    const path = join(runtimeDir, entry);
    bytes += (await stat(path)).size;
    await rm(path, { force: true });
    count += 1;
  }

  for (const entry of generatedWasmFiles) {
    const path = join(generatedClientDir, entry);
    if (!(await exists(path))) continue;
    bytes += (await stat(path)).size;
    await rm(path, { force: true });
    count += 1;
  }

  for (const path of developmentDirectories) {
    if (!(await exists(path))) continue;
    await rm(path, { recursive: true, force: true });
    count += 1;
  }

  return { count, bytes };
}

function prepareBaselineDatabase() {
  const target = resolve(electronBaselineDbPath);
  if (target !== resolve(root, "electron-baseline/prisma/dev.db")) throw new Error("Baseline 目的地不符合打包範圍。");
  const inspect = (path) => {
    try { return lstatSync(path); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const verifyTarget = () => {
    for (let cursor = target; ; cursor = dirname(cursor)) {
      const info = inspect(cursor);
      if (info?.isSymbolicLink()) throw new Error("Baseline 路徑不可包含符號連結。");
      if (info && cursor !== target && !info.isDirectory()) throw new Error("Baseline 父路徑不是資料夾。");
      if (cursor === dirname(cursor)) break;
    }
    if (["-wal", "-shm", "-journal"].some(suffix => inspect(target + suffix))) throw new Error("Baseline 有使用中或待復原的 SQLite 檔案。");
    const info = inspect(target), live = inspect(join(root, "prisma/dev.db"));
    if (info && (!info.isFile() || info.nlink !== 1 || (live && info.dev === live.dev && info.ino === live.ino))) throw new Error("Baseline 不是獨立的打包資料庫。");
    if (info) {
      const opened = spawnSync("/usr/sbin/lsof", ["-t", "--", target], { encoding: "utf8", timeout: 5000 });
      if (opened.error || opened.status !== 1) throw new Error("Baseline 可能正在使用，停止更新。");
    }
    return info;
  };
  verifyTarget();
  mkdirSync(dirname(target), { recursive: true });
  const lock = target + ".prepare-lock";
  mkdirSync(lock);
  let staging;
  try {
    const before = verifyTarget();
    staging = mkdtempSync(join(realpathSync(dirname(target)), ".baseline-"));
    const temporary = join(staging, "dev.db");
    const result = spawnSync(process.execPath, [join(root, "prisma", "init-db.mjs")], {
      cwd: root, stdio: "inherit", env: { ...process.env, SONGZU_INIT_DB_PATH: temporary }
    });
    if (result.error || result.status !== 0) throw new Error("空白 Baseline 建立失敗，保留原版本。");
    const db = new DatabaseSync(temporary, { readOnly: true });
    try {
      const integrity = db.prepare("PRAGMA integrity_check").get();
      if (integrity.integrity_check !== "ok" || db.prepare("SELECT COUNT(*) AS n FROM Song").get().n !== 0
        || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Baseline 驗證失敗。");
    } finally { db.close(); }
    if (["-wal", "-shm", "-journal"].some(suffix => inspect(temporary + suffix))) throw new Error("新 Baseline 尚未關閉。");
    const after = verifyTarget();
    if (Boolean(before) !== Boolean(after) || (before && after && (before.ino !== after.ino || before.dev !== after.dev
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs))) throw new Error("Baseline 已被其他工作更新。");
    renameSync(temporary, target);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    rmdirSync(lock);
  }
}

if (serverScript === "start" && (await exists(join(root, ".next", "standalone")))) {
  const standaloneRoot = join(root, ".next", "standalone");
  await copyIfExists(join(root, "public"), join(root, ".next", "standalone", "public"));
  await mkdir(join(root, ".next", "standalone", ".next"), { recursive: true });
  await copyIfExists(join(root, ".next", "static"), join(root, ".next", "standalone", ".next", "static"));
  await mkdir(join(root, ".next", "standalone", "scripts"), { recursive: true });
  await copyIfExists(
    join(root, "scripts", "analyze-harmony.py"),
    join(root, ".next", "standalone", "scripts", "analyze-harmony.py")
  );
  await copyIfExists(
    join(root, "scripts", "analyze-harmony-neural.py"),
    join(root, ".next", "standalone", "scripts", "analyze-harmony-neural.py")
  );
  await copyIfExists(
    join(root, "scripts", "analyze-rhythm-neural.py"),
    join(root, ".next", "standalone", "scripts", "analyze-rhythm-neural.py")
  );
  for (const name of ["analyze-notes-basic-pitch.py", "analyze-harmony-btc.py", "analyze-player-beats.py", "analyze-player-beats-v2.py"]) {
    await copyIfExists(join(root, "scripts", name), join(standaloneRoot, "scripts", name));
  }
  // A distribution must never inherit build-machine configuration or user data.
  for (const entry of await readdir(standaloneRoot)) {
    if (entry.startsWith(".env")) await removeIfExists(join(standaloneRoot, entry));
  }
  await Promise.all([
    removeIfExists(join(standaloneRoot, "security")),
    removeIfExists(join(standaloneRoot, "backups")),
    removeIfExists(join(standaloneRoot, "dist-electron")),
    removeIfExists(join(standaloneRoot, "dist-mobile")),
    removeIfExists(join(standaloneRoot, "android")),
    removeIfExists(join(standaloneRoot, "ios")),
    removeIfExists(join(standaloneRoot, "mobile-shell")),
    removeIfExists(join(standaloneRoot, "native")),
    removeIfExists(join(standaloneRoot, "output")),
    removeIfExists(join(standaloneRoot, "src")),
    removeIfExists(join(standaloneRoot, "uploads")),
    removeIfExists(join(standaloneRoot, "exports")),
    // Analysis derivatives are reproducible local cache files. Shipping them
    // would leak a user's source material and can add hundreds of MB.
    removeIfExists(join(standaloneRoot, ".cache")),
    removeIfExists(join(standaloneRoot, "analysis-cache")),
    removeIfExists(join(standaloneRoot, ".desktop-app")),
    removeIfExists(join(standaloneRoot, ".electron-app")),
    removeIfExists(join(standaloneRoot, "docs")),
    removeIfExists(join(standaloneRoot, "prisma", "dev.db")),
    removeIfExists(join(standaloneRoot, "prisma", "dev.db-journal"))
  ]);
  await copyPrismaNativeRuntime(standaloneRoot);
  const prismaAliases = await writePrismaExternalAliases(standaloneRoot);
  const prunedPrisma = await pruneUnusedPrismaRuntimes(standaloneRoot);
  prepareBaselineDatabase();
  console.log("Electron standalone 靜態資源已整理。");
  console.log("Electron 已加入 Prisma macOS arm64 原生查詢引擎。");
  console.log(`Electron 已建立 ${prismaAliases.length} 個 Turbopack Prisma runtime alias。`);
  console.log(
    `Electron 已移除 ${prunedPrisma.count} 個未使用的 Edge、WASM 與雲端資料庫 runtime（${(
      prunedPrisma.bytes /
      1024 /
      1024
    ).toFixed(1)} MB），保留 SQLite 與 macOS 原生引擎。`
  );
  console.log("Electron baseline DB 已建立：不打包目前作品資料庫。");
  console.log("Electron 已加入本機和聲分析腳本。");
}

await mkdir(electronDir, { recursive: true });
await writeFile(
  join(electronDir, "project-root.cjs"),
  [
    'const path = require("node:path");',
    "module.exports = {",
    '  projectRoot: process.env.SONGZU_PROJECT_ROOT || path.resolve(__dirname, ".."),',
    '  defaultPort: "3000",',
    `  serverScript: ${JSON.stringify(serverScript)}`,
    "};",
    ""
  ].join("\n")
);

const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const removedMacMetadata = await removeMacPackagingMetadata(join(root, "mobile-shell"));
await rm(electronPackageRoot, { recursive: true, force: true });
await mkdir(electronPackageRoot, { recursive: true });
await cp(electronDir, join(electronPackageRoot, "electron"), { recursive: true });
await writeFile(
  join(electronPackageRoot, "package.json"),
  `${JSON.stringify(
    {
      name: `${rootPackage.name}-desktop-runtime`,
      version: rootPackage.version,
      private: true,
      description: rootPackage.description,
      author: rootPackage.author,
      main: "electron/main.cjs"
    },
    null,
    2
  )}\n`
);
await writeFile(
  join(electronPackageRoot, "package-lock.json"),
  `${JSON.stringify(
    {
      name: `${rootPackage.name}-desktop-runtime`,
      version: rootPackage.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: `${rootPackage.name}-desktop-runtime`,
          version: rootPackage.version
        }
      }
    },
    null,
    2
  )}\n`
);
await cp(join(root, "electron-builder.yml"), join(electronPackageRoot, "electron-builder.yml"));
await cp(join(root, "scripts", "sign-macos-share.cjs"), join(electronPackageRoot, "sign-macos-share.cjs"));

console.log(`Electron 專案根目錄已寫入：${root}`);
console.log(`Electron 啟動模式：npm run ${serverScript}`);
console.log(`Electron 輕量封裝目錄已建立：${electronPackageRoot}`);
console.log(`Electron 已排除 ${removedMacMetadata.length} 個 macOS 隱藏 metadata 檔案。`);
