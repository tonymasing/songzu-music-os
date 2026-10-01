import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataRoot = resolve(process.env.SONGZU_MUSIC_OS_DATA_ROOT || projectRoot);
const localUrl = process.env.SONGZU_CONNECT_LOCAL_URL || "http://127.0.0.1:3000";
const localRelayUrl = process.env.SONGZU_CONNECT_LOCAL_RELAY_URL || "http://127.0.0.1:39321";
const securityRoot = join(dataRoot, "security");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const workers = new Map();
let stopping = false;

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function statusFresh(path, pidKey, freshnessMs = 12_000) {
  const status = await readJson(path);
  const updatedAt = status?.updatedAt ? new Date(status.updatedAt).getTime() : 0;
  return Boolean(Date.now() - updatedAt < freshnessMs && pidAlive(Number(status?.[pidKey])));
}

async function relayHealthy() {
  try {
    const response = await fetch(`${localRelayUrl}/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const body = await response.json().catch(() => null);
    return response.ok && body?.service === "songzu-connect-relay";
  } catch {
    return false;
  }
}

const definitions = {
  relay: {
    entry: join(projectRoot, "scripts", "songzu-connect", "relay.mjs"),
    externalActive: relayHealthy,
    env: {
      SONGZU_CONNECT_RELAY_HOST: "127.0.0.1",
      SONGZU_CONNECT_RELAY_PORT: "39321",
      SONGZU_CONNECT_RELAY_DATA: join(securityRoot, "songzu-connect-relay.json"),
      SONGZU_CONNECT_WEB_ROOT: join(projectRoot, "mobile-shell")
    }
  },
  tunnel: {
    entry: join(projectRoot, "scripts", "songzu-connect", "tunnel.mjs"),
    externalActive: () => statusFresh(join(securityRoot, "songzu-connect-tunnel-status.json"), "managerPid"),
    env: {
      SONGZU_MUSIC_OS_DATA_ROOT: dataRoot,
      SONGZU_CONNECT_LOCAL_RELAY_URL: localRelayUrl
    }
  },
  host: {
    entry: join(projectRoot, "scripts", "songzu-connect", "host.mjs"),
    externalActive: () => statusFresh(join(securityRoot, "songzu-connect-status.json"), "pid", 45_000),
    env: {
      SONGZU_MUSIC_OS_DATA_ROOT: dataRoot,
      SONGZU_CONNECT_LOCAL_URL: localUrl,
      SONGZU_CONNECT_LOCAL_RELAY_URL: localRelayUrl,
      SONGZU_APP_VERSION: packageJson.version
    }
  }
};

function launch(name, definition) {
  if (stopping || workers.has(name)) return;
  const child = spawn(process.execPath, [definition.entry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
      ...definition.env
    },
    stdio: ["ignore", "inherit", "inherit"]
  });
  workers.set(name, child);
  process.stdout.write(`[${new Date().toISOString()}] 頌祖 Connect 啟動 ${name} pid=${child.pid}\n`);
  child.once("exit", (code, signal) => {
    workers.delete(name);
    process.stdout.write(`[${new Date().toISOString()}] 頌祖 Connect ${name} 結束 code=${code ?? ""} signal=${signal ?? ""}\n`);
  });
}

async function maintainWorkers() {
  for (const [name, definition] of Object.entries(definitions)) {
    if (workers.has(name)) continue;
    if (await definition.externalActive()) continue;
    launch(name, definition);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of workers.values()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await sleep(2_000);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown());
process.stdout.write(`[${new Date().toISOString()}] 頌祖 Connect 常駐主管啟動，資料根目錄：${dataRoot}\n`);

while (!stopping) {
  await maintainWorkers();
  await sleep(3_000);
}
