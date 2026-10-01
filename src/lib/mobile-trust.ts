import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isLoopbackRequest } from "@/lib/local-request";
import { appPath } from "@/lib/paths";

export const mobileDeviceCookieName = "songzu_mobile_device";
export const mobilePairingCodeLifetimeMs = 5 * 60 * 1000;
export const mobileDeviceTokenMaxAgeSeconds = 90 * 24 * 60 * 60;

export const mobileTrustCorsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Songzu-Device-Token, X-Upload-Offset, X-Upload-Token",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, OPTIONS, POST, PUT",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, max-age=0"
};

type PairingCodeState = {
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attemptsRemaining: number;
};

export type TrustedMobileDevice = {
  id: string;
  deviceKey: string;
  name: string;
  platform: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

type MobileTrustState = {
  version: 1;
  pairingCode: PairingCodeState | null;
  devices: TrustedMobileDevice[];
};

export class MobileTrustError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "MobileTrustError";
    this.status = status;
  }
}

const initialState = (): MobileTrustState => ({ version: 1, pairingCode: null, devices: [] });
let mutationQueue: Promise<unknown> = Promise.resolve();

function statePath() {
  return appPath("security", "mobile-trust.json");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function cleanLabel(value: string, fallback: string, maxLength = 80) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) || fallback;
}

function validState(value: unknown): value is MobileTrustState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileTrustState>;
  return candidate.version === 1 && Array.isArray(candidate.devices);
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as unknown;
    return validState(parsed) ? parsed : initialState();
  } catch {
    return initialState();
  }
}

async function writeState(state: MobileTrustState) {
  const path = statePath();
  const temporaryPath = `${path}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  await rename(temporaryPath, path);
}

function serializeMutation<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function publicDevice(device: TrustedMobileDevice) {
  return {
    id: device.id,
    deviceKey: device.deviceKey,
    name: device.name,
    platform: device.platform,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt
  };
}

export async function getMobileTrustStatus() {
  const state = await readState();
  const now = Date.now();
  const pairingCodeActive = Boolean(state.pairingCode && new Date(state.pairingCode.expiresAt).getTime() > now);
  return {
    pairingRequired: true,
    pairingCodeActive,
    pairingCodeExpiresAt: pairingCodeActive ? state.pairingCode?.expiresAt ?? null : null,
    activeDevices: state.devices.filter((device) => !device.revokedAt).map(publicDevice),
    revokedDevices: state.devices.filter((device) => device.revokedAt).map(publicDevice)
  };
}

export async function createMobilePairingCode() {
  return serializeMutation(async () => {
    const state = await readState();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + mobilePairingCodeLifetimeMs);
    state.pairingCode = {
      codeHash: sha256(`songzu-pair:${code}`),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      attemptsRemaining: 8
    };
    await writeState(state);
    return { code, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), attemptsRemaining: 8 };
  });
}

export async function claimMobilePairingCode(input: {
  code: string;
  deviceKey: string;
  name: string;
  platform: string;
}) {
  return serializeMutation(async () => {
    const state = await readState();
    const now = new Date();
    const pairing = state.pairingCode;
    let error: MobileTrustError | null = null;

    if (!/^\d{6}$/.test(input.code)) {
      error = new MobileTrustError("配對碼格式不正確。", 400);
    } else if (!pairing || new Date(pairing.expiresAt).getTime() <= now.getTime()) {
      state.pairingCode = null;
      error = new MobileTrustError("配對碼已過期，請回到 Mac 重新產生。", 410);
    } else if (pairing.attemptsRemaining <= 0) {
      state.pairingCode = null;
      error = new MobileTrustError("配對嘗試次數已用完，請回到 Mac 重新產生。", 429);
    } else if (!hashesMatch(pairing.codeHash, sha256(`songzu-pair:${input.code}`))) {
      pairing.attemptsRemaining -= 1;
      if (pairing.attemptsRemaining <= 0) state.pairingCode = null;
      error = new MobileTrustError("配對碼不正確。", 401);
    }

    if (error) {
      await writeState(state);
      throw error;
    }

    const deviceKey = cleanLabel(input.deviceKey, "unknown-device", 120);
    const name = cleanLabel(input.name, "行動裝置");
    const platform = cleanLabel(input.platform, "mobile", 32).toLowerCase();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const existing = state.devices.find((device) => device.deviceKey === deviceKey);
    const device: TrustedMobileDevice = existing
      ? {
          ...existing,
          name,
          platform,
          tokenHash,
          lastSeenAt: now.toISOString(),
          revokedAt: null
        }
      : {
          id: randomUUID(),
          deviceKey,
          name,
          platform,
          tokenHash,
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          revokedAt: null
        };

    state.devices = [device, ...state.devices.filter((item) => item.id !== device.id)].slice(0, 40);
    state.pairingCode = null;
    await writeState(state);
    return { token, device: publicDevice(device), maxAgeSeconds: mobileDeviceTokenMaxAgeSeconds };
  });
}

export function mobileTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim();
  const explicit = request.headers.get("x-songzu-device-token")?.trim();
  if (explicit) return explicit;
  const cookieHeader = request.headers.get("cookie") || "";
  for (const pair of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (rawName === mobileDeviceCookieName) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export async function authenticateMobileToken(token: string | null) {
  if (!token || token.length < 32 || token.length > 180) return null;
  const tokenHash = sha256(token);
  const state = await readState();
  const device = state.devices.find((item) => !item.revokedAt && hashesMatch(item.tokenHash, tokenHash));
  return device ? publicDevice(device) : null;
}

export async function authenticateMobileRequest(request: Request) {
  return authenticateMobileToken(mobileTokenFromRequest(request));
}

export async function requireTrustedMobileRequest(request: Request, allowLoopback = true) {
  if (allowLoopback && isLoopbackRequest(request)) return { mode: "loopback" as const, device: null };
  const device = await authenticateMobileRequest(request);
  if (!device) throw new MobileTrustError("這台裝置尚未與頌祖音樂 OS 配對，或授權已被撤銷。", 401);
  return { mode: "trusted_device" as const, device };
}

export async function revokeTrustedMobileDevice(id: string) {
  return serializeMutation(async () => {
    const state = await readState();
    const device = state.devices.find((item) => item.id === id);
    if (!device) throw new MobileTrustError("找不到這台可信裝置。", 404);
    device.revokedAt = new Date().toISOString();
    await writeState(state);
    return publicDevice(device);
  });
}
