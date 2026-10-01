import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { appPath } from "@/lib/paths";

export type SongzuConnectState = "disabled" | "connecting" | "online" | "offline" | "error";

type ConnectConfig = {
  version: 1;
  enabled: boolean;
  relayUrl: string;
  hostId: string;
  hostSecret: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
  updatedAt: string;
};

type ConnectRuntimeStatus = {
  version: 1;
  state: Exclude<SongzuConnectState, "offline">;
  enabled: boolean;
  relayUrl: string | null;
  hostId: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  updatedAt: string;
  pid?: number;
};

type ConnectTunnelControl = {
  version: 1;
  enabled: boolean;
  mode: "quick";
  restoreRelayUrl: string;
  restoreEnabled: boolean;
  requestedAt: string;
  updatedAt: string;
};

type ConnectTunnelRuntimeStatus = {
  version: 1;
  state: "disabled" | "starting" | "online" | "error";
  enabled: boolean;
  mode: "quick";
  publicUrl: string | null;
  localRelayUrl: string;
  cloudflaredPath: string | null;
  cloudflaredPid: number | null;
  managerPid: number;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
};

const defaultRelayUrl = process.env.SONGZU_CONNECT_RELAY_URL?.trim() || "http://127.0.0.1:39321";
let mutationQueue: Promise<unknown> = Promise.resolve();

function configPath() {
  return appPath("security", "songzu-connect.json");
}

function statusPath() {
  return appPath("security", "songzu-connect-status.json");
}

function tunnelControlPath() {
  return appPath("security", "songzu-connect-tunnel.json");
}

function tunnelStatusPath() {
  return appPath("security", "songzu-connect-tunnel-status.json");
}

function cleanPublicKey(value: JsonWebKey) {
  if (value.kty !== "EC" || value.crv !== "P-256" || !value.x || !value.y) throw new Error("公開金鑰格式不正確。");
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, ext: true } satisfies JsonWebKey;
}

function cleanPrivateKey(value: JsonWebKey) {
  const publicKey = cleanPublicKey(value);
  if (!value.d) throw new Error("私密金鑰格式不正確。");
  return { ...publicKey, d: value.d } satisfies JsonWebKey;
}

function normalizeRelayUrl(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error("中繼網址不能包含帳密、查詢或片段。");
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("外出中繼站必須使用 HTTPS；HTTP 只允許本機測試。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function validConfig(value: unknown): value is ConnectConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConnectConfig>;
  return (
    candidate.version === 1 &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.relayUrl === "string" &&
    /^sz_[A-Za-z0-9_-]{20,30}$/.test(candidate.hostId || "") &&
    typeof candidate.hostSecret === "string" &&
    Boolean(candidate.publicKeyJwk) &&
    Boolean(candidate.privateKeyJwk)
  );
}

async function readJson<T>(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readConfig() {
  const config = await readJson<unknown>(configPath());
  if (!validConfig(config)) return null;
  try {
    return {
      ...config,
      relayUrl: normalizeRelayUrl(config.relayUrl),
      publicKeyJwk: cleanPublicKey(config.publicKeyJwk),
      privateKeyJwk: cleanPrivateKey(config.privateKeyJwk)
    };
  } catch {
    return null;
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  await rename(temporaryPath, path);
}

function createIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    hostId: `sz_${randomBytes(16).toString("base64url")}`,
    hostSecret: randomBytes(32).toString("base64url"),
    publicKeyJwk: cleanPublicKey(publicKey.export({ format: "jwk" })),
    privateKeyJwk: cleanPrivateKey(privateKey.export({ format: "jwk" }))
  };
}

function fingerprint(key: JsonWebKey) {
  const digest = createHash("sha256").update(`${key.crv}:${key.x}:${key.y}`).digest("hex").slice(0, 16).toUpperCase();
  return digest.match(/.{1,4}/g)?.join("-") || digest;
}

function connectionUrl(config: ConnectConfig) {
  const encodedKey = Buffer.from(JSON.stringify(cleanPublicKey(config.publicKeyJwk))).toString("base64url");
  return `${config.relayUrl}/?host=${encodeURIComponent(config.hostId)}#key=${encodedKey}`;
}

function isLocalRelay(relayUrl: string) {
  try {
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(relayUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isQuickRelay(relayUrl: string) {
  try {
    return new URL(relayUrl).hostname.toLowerCase().endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

function installedCloudflaredPath() {
  const candidates = [process.env.SONGZU_CLOUDFLARED_BIN?.trim(), "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function serializeMutation<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function updateSongzuConnect(input: { enabled: boolean; relayUrl?: string }) {
  return serializeMutation(async () => {
    const existing = await readConfig();
    const now = new Date().toISOString();
    const identity = existing || createIdentity();
    const config: ConnectConfig = {
      version: 1,
      enabled: input.enabled,
      relayUrl: normalizeRelayUrl(input.relayUrl || existing?.relayUrl || defaultRelayUrl),
      hostId: identity.hostId,
      hostSecret: identity.hostSecret,
      publicKeyJwk: identity.publicKeyJwk,
      privateKeyJwk: identity.privateKeyJwk,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await writeJsonAtomic(configPath(), config);
    return getSongzuConnectOverview();
  });
}

export async function updateSongzuQuickTunnel(enabled: boolean) {
  return serializeMutation(async () => {
    const now = new Date().toISOString();
    let config = await readConfig();
    if (!config) {
      const identity = createIdentity();
      config = {
        version: 1,
        enabled: false,
        relayUrl: defaultRelayUrl,
        ...identity,
        createdAt: now,
        updatedAt: now
      };
      await writeJsonAtomic(configPath(), config);
    }

    const previousControl = await readJson<ConnectTunnelControl>(tunnelControlPath());
    const preserveRestoreTarget = previousControl?.version === 1 && (previousControl.enabled || isQuickRelay(config.relayUrl));
    const control: ConnectTunnelControl = {
      version: 1,
      enabled,
      mode: "quick",
      restoreRelayUrl: preserveRestoreTarget ? previousControl.restoreRelayUrl : config.relayUrl,
      restoreEnabled: preserveRestoreTarget ? previousControl.restoreEnabled : config.enabled,
      requestedAt: now,
      updatedAt: now
    };
    await writeJsonAtomic(tunnelControlPath(), control);
    return getSongzuConnectOverview();
  });
}

export async function getSongzuQuickTunnelOverview() {
  const [control, runtime] = await Promise.all([
    readJson<ConnectTunnelControl>(tunnelControlPath()),
    readJson<ConnectTunnelRuntimeStatus>(tunnelStatusPath())
  ]);
  const updatedAt = runtime?.updatedAt ? new Date(runtime.updatedAt).getTime() : 0;
  const managerFresh = Boolean(runtime?.managerPid && Date.now() - updatedAt < 12_000);
  const cloudflaredPath = runtime?.cloudflaredPath || installedCloudflaredPath();
  const requested = Boolean(control?.version === 1 && control.enabled);
  const state = !requested
    ? "disabled"
    : !managerFresh
      ? "unavailable"
      : runtime?.state || "starting";
  return {
    available: managerFresh && Boolean(cloudflaredPath),
    installed: Boolean(cloudflaredPath),
    requested,
    state,
    publicUrl: state === "online" ? runtime?.publicUrl || null : null,
    startedAt: runtime?.startedAt || null,
    lastError: state === "error" ? runtime?.lastError || "外出通路啟動失敗。" : null,
    temporary: true,
    changesOnRestart: true,
    provider: "Cloudflare Quick Tunnel"
  };
}

export async function getSongzuConnectOverview() {
  const config = await readConfig();
  const runtime = await readJson<ConnectRuntimeStatus>(statusPath());
  const quickTunnel = await getSongzuQuickTunnelOverview();
  const heartbeatAt = runtime?.lastHeartbeatAt ? new Date(runtime.lastHeartbeatAt).getTime() : 0;
  const runtimeMatches = Boolean(config && runtime?.hostId === config.hostId && runtime?.relayUrl === config.relayUrl);
  const heartbeatFresh = heartbeatAt > 0 && Date.now() - heartbeatAt < 50_000;
  const state: SongzuConnectState = !config?.enabled
    ? "disabled"
    : runtimeMatches && runtime?.state === "online" && heartbeatFresh
      ? "online"
      : runtimeMatches && runtime?.state === "error"
        ? "error"
        : runtimeMatches && runtime?.state === "connecting"
          ? "connecting"
          : "offline";

  return {
    configured: Boolean(config),
    enabled: Boolean(config?.enabled),
    state,
    relayUrl: config?.relayUrl || defaultRelayUrl,
    localRelay: isLocalRelay(config?.relayUrl || defaultRelayUrl),
    hostId: config?.hostId || null,
    fingerprint: config ? fingerprint(config.publicKeyJwk) : null,
    connectionUrl: config ? connectionUrl(config) : null,
    lastHeartbeatAt: runtimeMatches ? runtime?.lastHeartbeatAt || null : null,
    lastError: runtimeMatches ? runtime?.lastError || null : null,
    updatedAt: config?.updatedAt || null,
    quickTunnel,
    security: {
      cipher: "ECDH P-256 + HKDF SHA-256 + AES-256-GCM",
      relayCanReadContent: false,
      originalFilesProtected: true
    }
  };
}
