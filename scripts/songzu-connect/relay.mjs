import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bearerToken,
  cleanPublicKeyJwk,
  connectCipher,
  connectProtocolVersion,
  normalizeRelayUrl,
  safeHashMatch,
  sha256
} from "./core.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env.SONGZU_CONNECT_RELAY_HOST || "127.0.0.1";
const port = Number(process.env.SONGZU_CONNECT_RELAY_PORT || 39321);
const dataPath = process.env.SONGZU_CONNECT_RELAY_DATA?.trim() || join(root, ".cache", "songzu-connect-relay.json");
const webRoot = process.env.SONGZU_CONNECT_WEB_ROOT?.trim() || join(root, "mobile-shell");
const requestMaxBytes = 3 * 1024 * 1024;
const responseTtlMs = 4 * 60 * 1000;
const onlineWindowMs = 45 * 1000;
const hosts = new Map();
const pendingByHost = new Map();
const rateBuckets = new Map();
let persistenceQueue = Promise.resolve();

function json(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Songzu-Reply-Token",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
    ...extraHeaders
  });
  response.end(body);
}

function relayState() {
  return {
    version: 1,
    hosts: [...hosts.values()].map(({ lastSeenAt, ...item }) => item)
  };
}

async function persistHosts() {
  persistenceQueue = persistenceQueue.then(async () => {
    const temporaryPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(dataPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(relayState(), null, 2)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, dataPath);
  });
  return persistenceQueue;
}

function loadHosts() {
  try {
    const state = JSON.parse(readFileSync(dataPath, "utf8"));
    if (state?.version !== 1 || !Array.isArray(state.hosts)) return;
    for (const item of state.hosts) {
      if (!/^sz_[A-Za-z0-9_-]{20,30}$/.test(item.hostId || "") || !/^[a-f0-9]{64}$/i.test(item.secretHash || "")) continue;
      hosts.set(item.hostId, { ...item, publicKeyJwk: cleanPublicKeyJwk(item.publicKeyJwk), lastSeenAt: null });
    }
  } catch {
    // A missing relay state is a clean first launch.
  }
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function rateAllowed(request) {
  const key = clientIp(request);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt > 5 * 60 * 1000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 600;
}

async function readJsonBody(request, maxBytes = requestMaxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("封包超過中繼站限制。"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON 格式不正確。"), { status: 400 });
  }
}

function validHostAuth(request, hostRecord) {
  const token = bearerToken(request.headers);
  return Boolean(token && hostRecord && safeHashMatch(hostRecord.secretHash, sha256(token)));
}

function hostQueue(hostId) {
  if (!pendingByHost.has(hostId)) pendingByHost.set(hostId, []);
  return pendingByHost.get(hostId);
}

function cleanExpired() {
  const cutoff = Date.now() - responseTtlMs;
  for (const [hostId, queue] of pendingByHost) {
    const next = queue.filter((item) => item.createdAt > cutoff && !item.consumedAt);
    if (next.length) pendingByHost.set(hostId, next);
    else pendingByHost.delete(hostId);
  }
  const bucketCutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of rateBuckets) if (bucket.startedAt < bucketCutoff) rateBuckets.delete(key);
}

async function waitFor(readValue, waitMs) {
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 25_000);
  while (true) {
    const value = readValue();
    if (value || Date.now() >= deadline) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
}

function validateEncryptedPacket(body, maxCiphertextChars = Math.ceil(requestMaxBytes * 1.4)) {
  if (
    !body ||
    !/^[A-Za-z0-9_-]{20,80}$/.test(body.requestId || "") ||
    !/^[A-Za-z0-9_-]{16}$/.test(body.nonce || "") ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length < 24 ||
    body.ciphertext.length > maxCiphertextChars
  ) {
    throw Object.assign(new Error("加密封包格式不正確。"), { status: 400 });
  }
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8"
};

function serveWeb(pathname, response) {
  const relative = pathname === "/" || pathname === "/connect" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  const path = join(webRoot, relative);
  if (!existsSync(path)) return false;
  const stat = readFileSync(path);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
    "Content-Length": stat.length,
    "Cache-Control": relative === "index.html" ? "no-store" : "public, max-age=300",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src http: https:; media-src 'self' blob: http: https:",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(stat);
  return true;
}

loadHosts();
setInterval(cleanExpired, 30_000).unref();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Songzu-Reply-Token",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
        "Access-Control-Max-Age": "600"
      });
      response.end();
      return;
    }
    if (!rateAllowed(request)) return json(response, 429, { error: "請求過於頻繁，請稍後再試。" });
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return json(response, 200, {
        ok: true,
        service: "songzu-connect-relay",
        protocolVersion: connectProtocolVersion,
        cipher: connectCipher,
        registeredHosts: hosts.size,
        checkedAt: new Date().toISOString()
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/hosts/register") {
      const body = await readJsonBody(request, 32 * 1024);
      if (!/^sz_[A-Za-z0-9_-]{20,30}$/.test(body.hostId || "")) return json(response, 400, { error: "主機識別碼不正確。" });
      const hostSecret = bearerToken(request.headers);
      if (hostSecret.length < 40 || hostSecret.length > 100) return json(response, 401, { error: "主機密鑰不正確。" });
      const publicKeyJwk = cleanPublicKeyJwk(body.publicKeyJwk);
      const existing = hosts.get(body.hostId);
      if (existing && !validHostAuth(request, existing)) return json(response, 401, { error: "主機驗證失敗。" });
      if (existing && JSON.stringify(existing.publicKeyJwk) !== JSON.stringify(publicKeyJwk)) {
        return json(response, 409, { error: "主機公開金鑰不同；請先建立新的主機識別碼。" });
      }
      const now = new Date().toISOString();
      hosts.set(body.hostId, {
        hostId: body.hostId,
        secretHash: existing?.secretHash || sha256(hostSecret),
        publicKeyJwk,
        appVersion: String(body.appVersion || "unknown").slice(0, 32),
        createdAt: existing?.createdAt || now,
        lastSeenAt: now
      });
      await persistHosts();
      return json(response, existing ? 200 : 201, { ok: true, hostId: body.hostId, registeredAt: now });
    }

    const hostMatch = url.pathname.match(/^\/v1\/hosts\/(sz_[A-Za-z0-9_-]{20,30})$/);
    if (request.method === "GET" && hostMatch) {
      const record = hosts.get(hostMatch[1]);
      if (!record) return json(response, 404, { error: "找不到這台頌祖音樂主機。" });
      const lastSeen = record.lastSeenAt ? new Date(record.lastSeenAt).getTime() : 0;
      return json(response, 200, {
        ok: true,
        hostId: record.hostId,
        online: Date.now() - lastSeen <= onlineWindowMs,
        publicKeyJwk: record.publicKeyJwk,
        appVersion: record.appVersion,
        lastSeenAt: record.lastSeenAt
      });
    }

    const pollMatch = url.pathname.match(/^\/v1\/hosts\/(sz_[A-Za-z0-9_-]{20,30})\/requests$/);
    if (request.method === "GET" && pollMatch) {
      const record = hosts.get(pollMatch[1]);
      if (!validHostAuth(request, record)) return json(response, 401, { error: "主機驗證失敗。" });
      record.lastSeenAt = new Date().toISOString();
      const waitMs = Number(url.searchParams.get("wait") || 0);
      const ready = await waitFor(() => {
        const now = Date.now();
        const queue = hostQueue(record.hostId);
        const requests = queue.filter((item) => !item.response && (!item.deliveredAt || now - item.deliveredAt > 12_000)).slice(0, 4);
        if (!requests.length) return null;
        for (const item of requests) {
          item.deliveredAt = now;
          item.deliveryAttempts += 1;
        }
        return requests.map(({ replyTokenHash, response: ignoredResponse, ...item }) => item);
      }, waitMs);
      return json(response, 200, { requests: ready || [], checkedAt: new Date().toISOString() });
    }

    if (request.method === "POST" && pollMatch) {
      const record = hosts.get(pollMatch[1]);
      if (!record) return json(response, 404, { error: "找不到這台頌祖音樂主機。" });
      const body = await readJsonBody(request);
      validateEncryptedPacket(body);
      const replyToken = String(request.headers["x-songzu-reply-token"] || "");
      if (replyToken.length < 32 || replyToken.length > 100) return json(response, 401, { error: "回覆權杖不正確。" });
      const clientPublicKeyJwk = cleanPublicKeyJwk(body.clientPublicKeyJwk);
      const queue = hostQueue(record.hostId);
      if (queue.length >= 100) return json(response, 503, { error: "主機佇列已滿，請稍後重試。" });
      if (queue.some((item) => item.requestId === body.requestId)) return json(response, 409, { error: "請求識別碼已存在。" });
      queue.push({
        requestId: body.requestId,
        clientPublicKeyJwk,
        nonce: body.nonce,
        ciphertext: body.ciphertext,
        replyTokenHash: sha256(replyToken),
        createdAt: Date.now(),
        deliveredAt: null,
        deliveryAttempts: 0,
        response: null,
        consumedAt: null
      });
      return json(response, 202, { ok: true, requestId: body.requestId, expiresInSeconds: Math.floor(responseTtlMs / 1000) });
    }

    const responseMatch = url.pathname.match(/^\/v1\/hosts\/(sz_[A-Za-z0-9_-]{20,30})\/responses\/([A-Za-z0-9_-]{20,80})$/);
    if (request.method === "POST" && responseMatch) {
      const record = hosts.get(responseMatch[1]);
      if (!validHostAuth(request, record)) return json(response, 401, { error: "主機驗證失敗。" });
      const item = hostQueue(record.hostId).find((candidate) => candidate.requestId === responseMatch[2]);
      if (!item) return json(response, 404, { error: "找不到待回覆請求。" });
      const body = await readJsonBody(request, 16 * 1024 * 1024);
      validateEncryptedPacket({ ...body, requestId: item.requestId }, 24 * 1024 * 1024);
      item.response = { nonce: body.nonce, ciphertext: body.ciphertext, createdAt: Date.now() };
      return json(response, 201, { ok: true, requestId: item.requestId });
    }

    if (request.method === "GET" && responseMatch) {
      const record = hosts.get(responseMatch[1]);
      if (!record) return json(response, 404, { error: "找不到這台頌祖音樂主機。" });
      const item = hostQueue(record.hostId).find((candidate) => candidate.requestId === responseMatch[2]);
      const replyToken = bearerToken(request.headers);
      if (!item || !replyToken || !safeHashMatch(item.replyTokenHash, sha256(replyToken))) {
        return json(response, 404, { error: "找不到回覆。" });
      }
      const waitMs = Number(url.searchParams.get("wait") || 0);
      const encryptedResponse = await waitFor(() => item.response, waitMs);
      if (!encryptedResponse) return json(response, 202, { ready: false, requestId: item.requestId });
      item.consumedAt = Date.now();
      return json(response, 200, { ready: true, requestId: item.requestId, ...encryptedResponse });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (serveWeb(url.pathname, response)) return;
    }
    json(response, 404, { error: "找不到頌祖 Connect 路由。" });
  } catch (error) {
    json(response, Number(error?.status || 500), { error: error instanceof Error ? error.message : "中繼站處理失敗。" });
  }
});

server.listen(port, host, () => {
  const localUrl = normalizeRelayUrl(`http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
  console.log(JSON.stringify({ ok: true, service: "songzu-connect-relay", url: localUrl, protocolVersion: connectProtocolVersion }));
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
