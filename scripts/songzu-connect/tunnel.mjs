import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

const dataRoot = resolve(process.env.SONGZU_MUSIC_OS_DATA_ROOT || ".");
const securityRoot = join(dataRoot, "security");
const controlPath = process.env.SONGZU_CONNECT_TUNNEL_CONTROL_PATH?.trim() || join(securityRoot, "songzu-connect-tunnel.json");
const statusPath = process.env.SONGZU_CONNECT_TUNNEL_STATUS_PATH?.trim() || join(securityRoot, "songzu-connect-tunnel-status.json");
const connectConfigPath = process.env.SONGZU_CONNECT_CONFIG_PATH?.trim() || join(securityRoot, "songzu-connect.json");
const localRelayUrl = new URL(process.env.SONGZU_CONNECT_LOCAL_RELAY_URL || "http://127.0.0.1:39321").origin;
const skipLocalHealth = process.env.SONGZU_CONNECT_TUNNEL_SKIP_LOCAL_HEALTH === "1";
const forceDisabled = process.env.SONGZU_CONNECT_TUNNEL_FORCE_DISABLED === "1";
let cloudflaredProcess = null;
let stopping = false;
let managedPublicUrl = null;
let currentState = {
  state: "disabled",
  enabled: false,
  publicUrl: null,
  lastError: null,
  startedAt: null
};

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  await rename(temporaryPath, path);
}

async function writeStatus(update = {}) {
  currentState = { ...currentState, ...update };
  await writeJsonAtomic(statusPath, {
    version: 1,
    managerPid: process.pid,
    mode: "quick",
    localRelayUrl,
    cloudflaredPath: findCloudflared(),
    updatedAt: new Date().toISOString(),
    ...currentState,
    cloudflaredPid: cloudflaredProcess?.pid || null
  }).catch(() => undefined);
}

function findCloudflared() {
  const explicit = process.env.SONGZU_CLOUDFLARED_BIN?.trim();
  const pathCandidates = (process.env.PATH || "").split(delimiter).filter(Boolean).map((entry) => join(entry, "cloudflared"));
  const candidates = [explicit, "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", ...pathCandidates].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function healthReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.service === "songzu-connect-relay") return true;
    } catch {
      // Relay and tunnel startup are asynchronous.
    }
    await sleep(500);
  }
  return false;
}

function validConnectConfig(config) {
  return Boolean(
    config?.version === 1 &&
    /^sz_[A-Za-z0-9_-]{20,30}$/.test(config.hostId || "") &&
    typeof config.hostSecret === "string" &&
    config.publicKeyJwk &&
    config.privateKeyJwk
  );
}

async function setConnectTarget({ enabled, relayUrl }) {
  const config = await readJson(connectConfigPath);
  if (!validConnectConfig(config)) throw new Error("請先在 App 建立頌祖 Connect 主機身份。");
  const url = new URL(relayUrl);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new Error("外出通路必須使用 HTTPS。");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  await writeJsonAtomic(connectConfigPath, {
    ...config,
    enabled,
    relayUrl: url.toString().replace(/\/$/, ""),
    updatedAt: new Date().toISOString()
  });
}

async function readControl() {
  const control = await readJson(controlPath);
  if (control?.version !== 1 || control?.mode !== "quick") return null;
  return {
    enabled: forceDisabled ? false : Boolean(control.enabled),
    restoreRelayUrl: typeof control.restoreRelayUrl === "string" ? control.restoreRelayUrl : localRelayUrl,
    restoreEnabled: Boolean(control.restoreEnabled)
  };
}

function stopCloudflared() {
  if (cloudflaredProcess && cloudflaredProcess.exitCode === null) cloudflaredProcess.kill("SIGTERM");
  cloudflaredProcess = null;
}

async function restoreConnect(control) {
  if (!managedPublicUrl) return;
  const current = await readJson(connectConfigPath);
  if (validConnectConfig(current) && current.relayUrl === managedPublicUrl) {
    await setConnectTarget({ enabled: control?.restoreEnabled || false, relayUrl: control?.restoreRelayUrl || localRelayUrl });
  }
  managedPublicUrl = null;
}

function waitForPublicUrl(processHandle) {
  return new Promise((resolveUrl, rejectUrl) => {
    let settled = false;
    let transcript = "";
    let publicUrl = null;
    let edgeRegistered = false;
    const timeout = setTimeout(() => finish(new Error("Cloudflare 沒有在 35 秒內建立外出網址。")), 35_000);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (value instanceof Error) rejectUrl(value);
      else resolveUrl(value);
    };
    const consume = (chunk) => {
      process.stderr.write(chunk);
      transcript = `${transcript}${chunk.toString("utf8")}`.slice(-16_000);
      const match = transcript.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) publicUrl = match[0].toLowerCase();
      if (/Registered tunnel connection/i.test(transcript)) edgeRegistered = true;
      if (publicUrl && edgeRegistered) finish(publicUrl);
    };
    processHandle.stdout?.on("data", consume);
    processHandle.stderr?.on("data", consume);
    processHandle.once("error", (error) => finish(error));
    processHandle.once("exit", (code) => finish(new Error(`Cloudflare 通路提早結束（${code ?? "unknown"}）。`)));
  });
}

async function startQuickTunnel() {
  const cloudflared = findCloudflared();
  if (!cloudflared) throw new Error("找不到 cloudflared。請先在 Mac 安裝 Cloudflare Tunnel。");
  if (!skipLocalHealth && !(await healthReady(localRelayUrl, 20_000))) throw new Error("本機加密 relay 尚未就緒。");

  await mkdir(securityRoot, { recursive: true });
  await writeStatus({ state: "starting", enabled: true, publicUrl: null, lastError: null, startedAt: new Date().toISOString() });

  cloudflaredProcess = spawn(cloudflared, [
    "tunnel",
    "--url", localRelayUrl,
    "--protocol", "http2",
    "--no-autoupdate",
    "--metrics", "127.0.0.1:0",
    "--loglevel", "info"
  ], {
    cwd: dataRoot,
    env: { ...process.env, NO_AUTOUPDATE: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const heartbeat = setInterval(() => void writeStatus(), 2_000);
  try {
    const publicUrl = await waitForPublicUrl(cloudflaredProcess);
    managedPublicUrl = publicUrl;
    await writeStatus({ state: "starting", enabled: true, publicUrl, lastError: null });
    await setConnectTarget({ enabled: true, relayUrl: publicUrl });
    await writeStatus({ state: "online", enabled: true, publicUrl, lastError: null });
  } finally {
    clearInterval(heartbeat);
  }
}

async function run() {
  let retryAt = 0;
  while (!stopping) {
    const control = await readControl();
    if (!control?.enabled) {
      stopCloudflared();
      await restoreConnect(control);
      await writeStatus({ state: "disabled", enabled: false, publicUrl: null, lastError: null, startedAt: null });
      await sleep(1_500);
      continue;
    }

    if (!cloudflaredProcess || cloudflaredProcess.exitCode !== null) {
      if (Date.now() < retryAt) {
        await writeStatus();
        await sleep(1_000);
        continue;
      }
      try {
        stopCloudflared();
        await startQuickTunnel();
      } catch (error) {
        stopCloudflared();
        await restoreConnect(control);
        retryAt = Date.now() + 8_000;
        await writeStatus({
          state: "error",
          enabled: true,
          publicUrl: null,
          lastError: error instanceof Error ? error.message : "無法建立外出通路。"
        });
      }
    } else {
      await writeStatus();
    }
    await sleep(2_000);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const control = await readControl();
  stopCloudflared();
  await restoreConnect(control).catch(() => undefined);
  await writeStatus({ state: "disabled", enabled: false, publicUrl: null, lastError: null, startedAt: null });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown());
await writeStatus();
await run();
