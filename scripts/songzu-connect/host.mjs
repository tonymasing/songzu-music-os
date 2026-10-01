import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  decryptConnectEnvelope,
  deriveConnectKey,
  encryptConnectEnvelope,
  normalizeRelayUrl
} from "./core.mjs";

const dataRoot = resolve(process.env.SONGZU_MUSIC_OS_DATA_ROOT || ".");
const configPath = process.env.SONGZU_CONNECT_CONFIG_PATH?.trim() || join(dataRoot, "security", "songzu-connect.json");
const statusPath = process.env.SONGZU_CONNECT_STATUS_PATH?.trim() || join(dataRoot, "security", "songzu-connect-status.json");
const localBaseUrl = new URL(process.env.SONGZU_CONNECT_LOCAL_URL || "http://127.0.0.1:3000").origin;
const localRelayUrl = new URL(process.env.SONGZU_CONNECT_LOCAL_RELAY_URL || "http://127.0.0.1:39321").origin;
const appVersion = process.env.SONGZU_APP_VERSION || "unknown";
const requestBodyLimit = 2 * 1024 * 1024;
const responseBodyLimit = 12 * 1024 * 1024;
const blockedPrefixes = [
  "/api/songzu-connect",
  "/api/local-network",
  "/api/storage",
  "/api/system/backup",
  "/api/youtube/auth",
  "/api/youtube/callback",
  "/api/integrations/openai",
  "/api/integrations/claude",
  "/api/integrations/hermes"
];
let stopping = false;
let lastStatus = "";

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function relayBaseUrl(config) {
  try {
    return new URL(config.relayUrl).hostname.toLowerCase().endsWith(".trycloudflare.com") ? localRelayUrl : config.relayUrl;
  } catch {
    return config.relayUrl;
  }
}

async function readConfig() {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (
      config?.version !== 1 ||
      typeof config.enabled !== "boolean" ||
      !/^sz_[A-Za-z0-9_-]{20,30}$/.test(config.hostId || "") ||
      typeof config.hostSecret !== "string" ||
      !config.privateKeyJwk ||
      !config.publicKeyJwk
    ) return null;
    return { ...config, relayUrl: normalizeRelayUrl(config.relayUrl) };
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path, value) {
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  if (encoded === lastStatus && path === statusPath) return;
  const temporaryPath = `${path}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, encoded, { mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  await rename(temporaryPath, path);
  if (path === statusPath) lastStatus = encoded;
}

async function updateStatus(value) {
  await writeJsonAtomic(statusPath, {
    version: 1,
    pid: process.pid,
    localBaseUrl,
    updatedAt: new Date().toISOString(),
    ...value
  }).catch(() => undefined);
}

function allowedRequest(method, path) {
  const upper = String(method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH"].includes(upper)) return false;
  if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\")) return false;
  if (path === "/api/mobile/pairing" || path.startsWith("/api/mobile/pairing/session")) return false;
  if (/^\/api\/youtube\/jobs\/[^/]+\/upload(?:\?|$)/.test(path)) return false;
  return !blockedPrefixes.some((prefix) => path.startsWith(prefix));
}

function requestHeaders(input, deviceToken, requestId) {
  const source = input && typeof input === "object" ? input : {};
  const allowed = ["accept", "content-type", "range", "x-upload-offset", "x-upload-token"];
  const result = {
    "x-forwarded-host": "songzu-connect.remote",
    "x-forwarded-proto": "https",
    "x-songzu-connect-request": requestId
  };
  for (const name of allowed) {
    const value = source[name] ?? source[name.replace(/(^|-)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)];
    if (typeof value === "string" && value.length <= 512) result[name] = value;
  }
  if (deviceToken) result.authorization = `Bearer ${deviceToken}`;
  return result;
}

function responseHeaders(headers) {
  const names = ["content-type", "content-range", "accept-ranges", "content-disposition", "etag", "last-modified"];
  return Object.fromEntries(names.map((name) => [name, headers.get(name)]).filter(([, value]) => Boolean(value)));
}

async function forwardRequest(envelope) {
  const method = String(envelope.method || "GET").toUpperCase();
  const path = String(envelope.path || "");
  if (!allowedRequest(method, path)) return { status: 403, headers: { "content-type": "application/json" }, body: { error: "此操作只能在 Mac 主機執行。" } };
  if (path !== "/api/mobile/health" && path !== "/api/mobile/pairing/claim" && !envelope.deviceToken) {
    return { status: 401, headers: { "content-type": "application/json" }, body: { error: "手機尚未完成可信裝置配對。", code: "MOBILE_PAIRING_REQUIRED" } };
  }
  const body = envelope.bodyBase64 ? Buffer.from(String(envelope.bodyBase64), "base64") : null;
  if (body && body.length > requestBodyLimit) return { status: 413, headers: { "content-type": "application/json" }, body: { error: "單次遠端封包超過 2 MB，請使用分段同步。" } };
  const response = await fetch(new URL(path, localBaseUrl), {
    method,
    headers: requestHeaders(envelope.headers, envelope.deviceToken, envelope.requestId),
    body: ["GET", "HEAD"].includes(method) ? undefined : body || undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > responseBodyLimit) return { status: 413, headers: { "content-type": "application/json" }, body: { error: "遠端回覆超過 12 MB，請改用分段下載。" } };
  return { status: response.status, headers: responseHeaders(response.headers), bodyBase64: bytes.toString("base64") };
}

async function postEncryptedResponse(config, request, key, value) {
  const encrypted = encryptConnectEnvelope({ key, requestId: request.requestId, direction: "response", value });
  const response = await fetch(`${relayBaseUrl(config)}/v1/hosts/${config.hostId}/responses/${request.requestId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.hostSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify(encrypted),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`中繼站拒絕回覆：HTTP ${response.status}`);
}

async function handleRequest(config, request) {
  const key = deriveConnectKey({ hostId: config.hostId, privateKeyJwk: config.privateKeyJwk, publicKeyJwk: request.clientPublicKeyJwk });
  try {
    const envelope = decryptConnectEnvelope({
      key,
      requestId: request.requestId,
      direction: "request",
      nonce: request.nonce,
      ciphertext: request.ciphertext
    });
    if (envelope.version !== 1 || envelope.requestId !== request.requestId) throw new Error("遠端請求版本不相容。");
    if (Math.abs(Date.now() - Number(envelope.issuedAt || 0)) > 5 * 60 * 1000) throw new Error("遠端請求已過期。");
    const result = await forwardRequest(envelope);
    const bodyBase64 = result.bodyBase64 || Buffer.from(JSON.stringify(result.body || {})).toString("base64");
    await postEncryptedResponse(config, request, key, { version: 1, requestId: request.requestId, status: result.status, headers: result.headers, bodyBase64 });
  } catch (error) {
    await postEncryptedResponse(config, request, key, {
      version: 1,
      requestId: request.requestId,
      status: 400,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : "Mac 主機無法處理遠端請求。" })).toString("base64")
    }).catch(() => undefined);
  }
}

async function register(config) {
  const response = await fetch(`${relayBaseUrl(config)}/v1/hosts/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.hostSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hostId: config.hostId, publicKeyJwk: config.publicKeyJwk, appVersion }),
    signal: AbortSignal.timeout(12_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `註冊失敗：HTTP ${response.status}`);
}

async function poll(config) {
  const response = await fetch(`${relayBaseUrl(config)}/v1/hosts/${config.hostId}/requests?wait=20000`, {
    headers: { Authorization: `Bearer ${config.hostSecret}` },
    signal: AbortSignal.timeout(26_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.requests)) throw new Error(body.error || `輪詢失敗：HTTP ${response.status}`);
  await updateStatus({ state: "online", enabled: true, relayUrl: config.relayUrl, hostId: config.hostId, lastHeartbeatAt: new Date().toISOString(), lastError: null });
  for (const request of body.requests) await handleRequest(config, request);
}

async function run() {
  let registeredKey = "";
  let retryMs = 1000;
  while (!stopping) {
    const config = await readConfig();
    if (!config?.enabled) {
      registeredKey = "";
      retryMs = 1000;
      await updateStatus({ state: "disabled", enabled: false, relayUrl: config?.relayUrl || null, hostId: config?.hostId || null, lastHeartbeatAt: null, lastError: null });
      await sleep(1500);
      continue;
    }
    try {
      const key = `${config.relayUrl}:${config.hostId}`;
      if (registeredKey !== key) {
        await updateStatus({ state: "connecting", enabled: true, relayUrl: config.relayUrl, hostId: config.hostId, lastHeartbeatAt: null, lastError: null });
        await register(config);
        registeredKey = key;
      }
      await poll(config);
      retryMs = 1000;
    } catch (error) {
      registeredKey = "";
      await updateStatus({
        state: "error",
        enabled: true,
        relayUrl: config.relayUrl,
        hostId: config.hostId,
        lastHeartbeatAt: null,
        lastError: error instanceof Error ? error.message : "頌祖 Connect 連線失敗。"
      });
      await sleep(retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
await run();
