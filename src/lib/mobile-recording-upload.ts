import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { appPath } from "@/lib/paths";

export const mobileRecordingChunkBytes = 1024 * 1024;
export const mobileRecordingMaxBytes = 4 * 1024 * 1024 * 1024;
export const mobileRecordingCorsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Songzu-Device-Token, X-Upload-Offset, X-Upload-Token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, max-age=0"
};

export type MobileRecordingUploadState = {
  version: 1;
  id: string;
  token: string;
  status: "uploading" | "ingesting" | "failed";
  createdAt: string;
  updatedAt: string;
  songId: string;
  dawTrackId: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
  durationSeconds: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  inputDeviceLabel: string;
  targetInstrument: string;
  detectionMode: string;
  targetBpm: number | null;
  targetKey: string;
  timelineStartSeconds: number;
  notes: string;
  error: string | null;
};

function safeId(id: string) {
  if (!/^[a-f0-9-]{20,80}$/i.test(id)) throw new Error("錄音上傳識別碼無效。");
  return id;
}

function uploadRoot() {
  return appPath("uploads", ".incoming-mobile");
}

export function mobileUploadDirectory(id: string) {
  return join(uploadRoot(), safeId(id));
}

export function mobileUploadPartPath(id: string) {
  return join(mobileUploadDirectory(id), "recording.part");
}

function mobileUploadStatePath(id: string) {
  return join(mobileUploadDirectory(id), "state.json");
}

export async function createMobileRecordingUpload(
  input: Omit<MobileRecordingUploadState, "version" | "id" | "token" | "status" | "createdAt" | "updatedAt" | "error">
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const state: MobileRecordingUploadState = {
    version: 1,
    id,
    token: randomBytes(24).toString("base64url"),
    status: "uploading",
    createdAt: now,
    updatedAt: now,
    error: null,
    ...input
  };
  const directory = mobileUploadDirectory(id);
  await mkdir(directory, { recursive: true });
  await writeFile(mobileUploadPartPath(id), Buffer.alloc(0), { flag: "wx" });
  await writeFile(mobileUploadStatePath(id), `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  return state;
}

export async function readMobileRecordingUpload(id: string) {
  const parsed = JSON.parse(await readFile(mobileUploadStatePath(id), "utf8")) as MobileRecordingUploadState;
  if (parsed.version !== 1 || parsed.id !== id) throw new Error("錄音上傳狀態損壞。");
  return parsed;
}

export function assertMobileUploadToken(state: MobileRecordingUploadState, token: string | null) {
  if (!token || token !== state.token) throw new Error("錄音上傳授權已失效。");
}

export async function mobileRecordingReceivedBytes(id: string) {
  return (await stat(mobileUploadPartPath(id))).size;
}

export async function appendMobileRecordingChunk(id: string, offset: number, bytes: Buffer) {
  const state = await readMobileRecordingUpload(id);
  if (state.status !== "uploading") throw new Error("這個錄音上傳工作目前不能接收資料。");
  const received = await mobileRecordingReceivedBytes(id);
  if (offset !== received) throw new Error(`上傳位置不一致；伺服器目前需要從 ${received} bytes 繼續。`);
  if (!bytes.length || bytes.length > mobileRecordingChunkBytes) throw new Error("錄音分段大小無效。");
  if (received + bytes.length > state.fileSizeBytes) throw new Error("上傳內容超過原始錄音大小。");
  await appendFile(mobileUploadPartPath(id), bytes);
  return received + bytes.length;
}

export async function updateMobileRecordingUpload(id: string, patch: Partial<Pick<MobileRecordingUploadState, "status" | "error">>) {
  const state = await readMobileRecordingUpload(id);
  const next: MobileRecordingUploadState = { ...state, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(mobileUploadStatePath(id), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function hashMobileRecordingUpload(id: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(mobileUploadPartPath(id))) hash.update(chunk);
  return hash.digest("hex");
}

export async function clearMobileRecordingUpload(id: string) {
  await rm(mobileUploadDirectory(id), { recursive: true, force: true });
}
