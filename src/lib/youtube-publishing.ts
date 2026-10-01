import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";

import type { PlatformConnection, PlatformPublishJob } from "@prisma/client";

import { mediaExportPath } from "@/lib/media-export";
import { parseJsonArray, toIso } from "@/lib/music";
import { prisma } from "@/lib/prisma";
import { ensurePublishedSongPreview } from "@/lib/storefront";

const execFileAsync = promisify(execFile);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const KEYCHAIN_SERVICE = "local.songzu.music-os.youtube";
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export const youtubeScopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
] as const;

export const youtubeJobStatuses = [
  "AWAITING_APPROVAL",
  "UPLOADING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED"
] as const;

export type YoutubeConnectionDto = ReturnType<typeof toYoutubeConnectionDto>;
export type YoutubePublishJobDto = ReturnType<typeof toYoutubePublishJobDto>;

type OAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YoutubeChannelResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      thumbnails?: { default?: { url?: string } };
    };
    statistics?: {
      subscriberCount?: string;
      videoCount?: string;
      viewCount?: string;
    };
  }>;
  error?: { message?: string };
};

type YoutubeVideoResponse = {
  id?: string;
  processingDetails?: { processingStatus?: string; processingFailureReason?: string };
  status?: { privacyStatus?: string; uploadStatus?: string; failureReason?: string; rejectionReason?: string };
  error?: { message?: string };
};

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function keychainAccount(connection: Pick<PlatformConnection, "tokenReference" | "id">) {
  return connection.tokenReference || connection.id;
}

function configuredClientId(connection: Pick<PlatformConnection, "clientId"> | null | undefined) {
  return process.env.YOUTUBE_CLIENT_ID?.trim() || connection?.clientId?.trim() || "";
}

async function readResponseError(response: Response) {
  const text = await response.text();
  if (!text) return `YouTube API 回應 ${response.status}`;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      error_description?: string;
    };
    if (typeof parsed.error === "string") return parsed.error_description || parsed.error;
    return parsed.error?.message || parsed.error_description || text;
  } catch {
    return text;
  }
}

async function keychainWrite(account: string, token: string) {
  if (process.platform !== "darwin") {
    throw new Error("目前安全 token 儲存只支援 macOS Keychain。請在 Mac 主機完成 YouTube 連線。");
  }
  await execFileAsync("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
    token
  ]);
}

async function keychainRead(account: string) {
  if (process.env.YOUTUBE_REFRESH_TOKEN?.trim()) return process.env.YOUTUBE_REFRESH_TOKEN.trim();
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      "-w"
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function keychainDelete(account: string) {
  if (process.platform !== "darwin") return;
  try {
    await execFileAsync("/usr/bin/security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]);
  } catch {
    // The token may already be gone; disconnect should still finish locally.
  }
}

export async function ensureYoutubeConnection() {
  const envClientId = process.env.YOUTUBE_CLIENT_ID?.trim() || null;
  return prisma.platformConnection.upsert({
    where: { provider: "youtube" },
    create: {
      provider: "youtube",
      displayName: "YouTube",
      status: envClientId ? "CONFIGURED" : "NOT_CONFIGURED",
      clientId: envClientId,
      scopesJson: JSON.stringify(youtubeScopes),
      tokenStorage: "macos_keychain"
    },
    update: envClientId ? { clientId: envClientId } : {}
  });
}

export async function configureYoutubeConnection(clientId: string) {
  const normalized = clientId.trim();
  if (!normalized) throw new Error("請填入 Google Desktop OAuth Client ID。");
  return prisma.platformConnection.upsert({
    where: { provider: "youtube" },
    create: {
      provider: "youtube",
      displayName: "YouTube",
      status: "CONFIGURED",
      clientId: normalized,
      scopesJson: JSON.stringify(youtubeScopes),
      tokenStorage: "macos_keychain"
    },
    update: {
      clientId: normalized,
      status: "CONFIGURED",
      lastError: null,
      scopesJson: JSON.stringify(youtubeScopes)
    }
  });
}

export function youtubeRedirectUri() {
  return process.env.YOUTUBE_REDIRECT_URI?.trim() || `http://127.0.0.1:${process.env.PORT || "3000"}/api/youtube/oauth/callback`;
}

export function createYoutubeAuthorization(connection: PlatformConnection) {
  const clientId = configuredClientId(connection);
  if (!clientId) throw new Error("尚未設定 YouTube Desktop OAuth Client ID。");

  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", youtubeRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", youtubeScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, verifier };
}

export async function exchangeYoutubeAuthorizationCode(code: string, verifier: string) {
  const connection = await ensureYoutubeConnection();
  const clientId = configuredClientId(connection);
  if (!clientId) throw new Error("YouTube Client ID 不存在。");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: youtubeRedirectUri()
    }),
    cache: "no-store"
  });
  const token = (await response.json()) as OAuthTokenResponse;
  if (!response.ok || !token.access_token) {
    throw new Error(token.error_description || token.error || "Google OAuth 授權碼交換失敗。");
  }

  const channelResponse = await fetch(`${YOUTUBE_API_URL}/channels?part=snippet,statistics&mine=true`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store"
  });
  const channelBody = (await channelResponse.json()) as YoutubeChannelResponse;
  if (!channelResponse.ok) {
    throw new Error(channelBody.error?.message || "讀取 YouTube 頻道失敗。");
  }
  const channel = channelBody.items?.[0];
  if (!channel?.id) throw new Error("這個 Google 帳號目前沒有可用的 YouTube 頻道。");

  const tokenReference = connection.tokenReference || connection.id;
  if (token.refresh_token) {
    await keychainWrite(tokenReference, token.refresh_token);
  } else if (!(await keychainRead(tokenReference))) {
    throw new Error("Google 沒有回傳 refresh token，請移除舊授權後重新連線。");
  }

  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const updated = await prisma.platformConnection.update({
    where: { id: connection.id },
    data: {
      status: "CONNECTED",
      accountId: channel.id,
      accountName: channel.snippet?.title || "YouTube 頻道",
      accountThumbnailUrl: channel.snippet?.thumbnails?.default?.url || null,
      scopesJson: JSON.stringify((token.scope || youtubeScopes.join(" ")).split(" ")),
      tokenReference,
      connectedAt: new Date(),
      tokenExpiresAt: expiresAt,
      lastCheckedAt: new Date(),
      lastError: null
    }
  });

  await prisma.monetizationProfile.upsert({
    where: { provider: "youtube" },
    create: {
      provider: "youtube",
      regionCode: "TW",
      subscriberCount: Number(channel.statistics?.subscriberCount || 0)
    },
    update: {
      subscriberCount: Number(channel.statistics?.subscriberCount || 0)
    }
  });

  return updated;
}

async function refreshYoutubeAccessToken(connection: PlatformConnection) {
  if (process.env.YOUTUBE_ACCESS_TOKEN?.trim()) return process.env.YOUTUBE_ACCESS_TOKEN.trim();
  const clientId = configuredClientId(connection);
  const refreshToken = await keychainRead(keychainAccount(connection));
  if (!clientId || !refreshToken) {
    throw new Error("YouTube 授權已遺失，請在 Mac 主機重新連線。");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  const token = (await response.json()) as OAuthTokenResponse;
  if (!response.ok || !token.access_token) {
    const message = token.error_description || token.error || "YouTube token 更新失敗。";
    await prisma.platformConnection.update({
      where: { id: connection.id },
      data: { status: "RECONNECT_REQUIRED", lastError: message }
    });
    throw new Error(message);
  }
  await prisma.platformConnection.update({
    where: { id: connection.id },
    data: {
      status: "CONNECTED",
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      lastCheckedAt: new Date(),
      lastError: null
    }
  });
  return token.access_token;
}

export async function disconnectYoutube() {
  const connection = await ensureYoutubeConnection();
  const refreshToken = await keychainRead(keychainAccount(connection));
  if (refreshToken) {
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
        cache: "no-store"
      });
    } catch {
      // Local disconnect still proceeds if Google is temporarily unreachable.
    }
  }
  await keychainDelete(keychainAccount(connection));
  return prisma.platformConnection.update({
    where: { id: connection.id },
    data: {
      status: configuredClientId(connection) ? "CONFIGURED" : "NOT_CONFIGURED",
      accountId: null,
      accountName: null,
      accountThumbnailUrl: null,
      tokenReference: null,
      connectedAt: null,
      tokenExpiresAt: null,
      lastCheckedAt: new Date(),
      lastError: null
    }
  });
}

export async function verifyYoutubeConnection() {
  const connection = await ensureYoutubeConnection();
  if (connection.status !== "CONNECTED") throw new Error("YouTube 尚未連線。");
  const accessToken = await refreshYoutubeAccessToken(connection);
  const response = await fetch(`${YOUTUBE_API_URL}/channels?part=snippet,statistics&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const body = (await response.json()) as YoutubeChannelResponse;
  if (!response.ok || !body.items?.[0]?.id) {
    const message = body.error?.message || "YouTube 頻道驗證失敗。";
    await prisma.platformConnection.update({ where: { id: connection.id }, data: { lastError: message } });
    throw new Error(message);
  }
  const channel = body.items[0];
  const updated = await prisma.platformConnection.update({
    where: { id: connection.id },
    data: {
      status: "CONNECTED",
      accountId: channel.id,
      accountName: channel.snippet?.title || connection.accountName,
      accountThumbnailUrl: channel.snippet?.thumbnails?.default?.url || connection.accountThumbnailUrl,
      lastCheckedAt: new Date(),
      lastError: null
    }
  });
  await prisma.monetizationProfile.upsert({
    where: { provider: "youtube" },
    create: { provider: "youtube", subscriberCount: Number(channel.statistics?.subscriberCount || 0) },
    update: { subscriberCount: Number(channel.statistics?.subscriberCount || 0) }
  });
  return updated;
}

export function toYoutubeConnectionDto(connection: PlatformConnection) {
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    status: connection.status,
    clientId: configuredClientId(connection),
    configured: Boolean(configuredClientId(connection)),
    connected: connection.status === "CONNECTED" && Boolean(connection.tokenReference || process.env.YOUTUBE_REFRESH_TOKEN),
    accountId: connection.accountId,
    accountName: connection.accountName,
    accountThumbnailUrl: connection.accountThumbnailUrl,
    scopes: parseJsonArray(connection.scopesJson),
    tokenStorage: connection.tokenStorage,
    connectedAt: toIso(connection.connectedAt),
    tokenExpiresAt: toIso(connection.tokenExpiresAt),
    lastCheckedAt: toIso(connection.lastCheckedAt),
    lastError: connection.lastError,
    redirectUri: youtubeRedirectUri()
  };
}

export function toYoutubePublishJobDto(job: PlatformPublishJob & { song: { id: string; title: string } }) {
  return {
    id: job.id,
    songId: job.songId,
    songTitle: job.song.title,
    platform: job.platform,
    exportFileName: job.exportFileName,
    title: job.title,
    description: job.description,
    tags: parseJsonArray(job.tagsJson),
    categoryId: job.categoryId,
    privacyStatus: job.privacyStatus,
    scheduledAt: toIso(job.scheduledAt),
    madeForKids: job.madeForKids,
    status: job.status,
    requiresApproval: job.requiresApproval,
    approvedAt: toIso(job.approvedAt),
    attempts: job.attempts,
    progress: job.progress,
    uploadedBytes: job.uploadedBytes,
    fileSizeBytes: job.fileSizeBytes,
    platformMediaId: job.platformMediaId,
    platformUrl: job.platformUrl,
    lastError: job.lastError,
    startedAt: toIso(job.startedAt),
    completedAt: toIso(job.completedAt),
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt)
  };
}

export async function listYoutubePublishJobs() {
  const jobs = await prisma.platformPublishJob.findMany({
    where: { platform: "youtube" },
    include: { song: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return jobs.map(toYoutubePublishJobDto);
}

export async function createYoutubePublishJob(input: {
  songId: string;
  exportFileName: string;
  title: string;
  description?: string | null;
  tags?: string[];
  privacyStatus: "private" | "unlisted" | "public";
  scheduledAt?: Date | null;
  madeForKids?: boolean;
}) {
  const connection = await ensureYoutubeConnection();
  const filePath = mediaExportPath(input.songId, input.exportFileName);
  const file = await stat(filePath);
  if (!input.exportFileName.includes("youtube_video") || !/\.mp4$/i.test(input.exportFileName)) {
    throw new Error("YouTube 發布工作只能使用已驗證的 YouTube MP4 輸出檔。");
  }
  if (input.scheduledAt && input.privacyStatus !== "private") {
    throw new Error("排程發布必須先使用私人影片狀態。");
  }
  const job = await prisma.platformPublishJob.create({
    data: {
      songId: input.songId,
      connectionId: connection.id,
      platform: "youtube",
      exportFileName: input.exportFileName,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      tagsJson: JSON.stringify(input.tags || []),
      privacyStatus: input.privacyStatus,
      scheduledAt: input.scheduledAt || null,
      madeForKids: Boolean(input.madeForKids),
      status: "AWAITING_APPROVAL",
      requiresApproval: true,
      fileSizeBytes: file.size
    },
    include: { song: { select: { id: true, title: true } } }
  });
  return toYoutubePublishJobDto(job);
}

export async function updateYoutubePublishJob(
  jobId: string,
  input: {
    title?: string;
    description?: string | null;
    tags?: string[];
    privacyStatus?: "private" | "unlisted" | "public";
    scheduledAt?: Date | null;
    madeForKids?: boolean;
  }
) {
  const current = await prisma.platformPublishJob.findUnique({ where: { id: jobId } });
  if (!current) throw new Error("找不到 YouTube 發布工作。");
  if (["UPLOADING", "PROCESSING", "PUBLISHED", "CANCELLED"].includes(current.status)) {
    throw new Error("這個發布工作已鎖定，不能再修改發布內容。");
  }
  const privacyStatus = input.privacyStatus ?? current.privacyStatus;
  const scheduledAt = input.scheduledAt === undefined ? current.scheduledAt : input.scheduledAt;
  if (scheduledAt && privacyStatus !== "private") throw new Error("排程發布必須使用私人影片狀態。");
  const updated = await prisma.platformPublishJob.update({
    where: { id: current.id },
    data: {
      title: input.title?.trim() || undefined,
      description: input.description === undefined ? undefined : input.description?.trim() || null,
      tagsJson: input.tags === undefined ? undefined : JSON.stringify(input.tags),
      privacyStatus: input.privacyStatus,
      scheduledAt: input.scheduledAt,
      madeForKids: input.madeForKids,
      status: "AWAITING_APPROVAL",
      approvedAt: null,
      uploadSessionUrl: null,
      uploadedBytes: 0,
      progress: 0,
      lastError: null
    },
    include: { song: { select: { id: true, title: true } } }
  });
  return toYoutubePublishJobDto(updated);
}

async function startUploadSession(job: PlatformPublishJob, accessToken: string, fileSize: number) {
  const status: Record<string, unknown> = {
    privacyStatus: job.scheduledAt ? "private" : job.privacyStatus,
    selfDeclaredMadeForKids: job.madeForKids
  };
  if (job.scheduledAt) status.publishAt = job.scheduledAt.toISOString();
  const response = await fetch(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(fileSize),
      "X-Upload-Content-Type": "video/mp4"
    },
    body: JSON.stringify({
      snippet: {
        title: job.title,
        description: job.description || "",
        tags: parseJsonArray(job.tagsJson),
        categoryId: job.categoryId
      },
      status
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await readResponseError(response));
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("YouTube 沒有回傳 resumable upload session。");
  await prisma.platformPublishJob.update({
    where: { id: job.id },
    data: { uploadSessionUrl: sessionUrl, uploadedBytes: 0, progress: 1 }
  });
  return sessionUrl;
}

function uploadedOffset(rangeHeader: string | null) {
  if (!rangeHeader) return 0;
  const match = rangeHeader.match(/bytes=0-(\d+)/i);
  return match ? Number(match[1]) + 1 : 0;
}

async function queryUploadOffset(sessionUrl: string, accessToken: string, totalBytes: number) {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${totalBytes}`
    },
    redirect: "manual",
    cache: "no-store"
  });
  if (response.status === 308) return { offset: uploadedOffset(response.headers.get("range")), completed: null };
  if (response.ok) return { offset: totalBytes, completed: (await response.json()) as YoutubeVideoResponse };
  if (response.status === 404 || response.status === 410) return { offset: 0, completed: null, expired: true };
  throw new Error(await readResponseError(response));
}

async function uploadChunks(job: PlatformPublishJob, filePath: string, sessionUrl: string, accessToken: string, startOffset: number, totalBytes: number) {
  const handle = await open(filePath, "r");
  let offset = startOffset;
  try {
    while (offset < totalBytes) {
      const chunkLength = Math.min(UPLOAD_CHUNK_BYTES, totalBytes - offset);
      const chunk = Buffer.allocUnsafe(chunkLength);
      const { bytesRead } = await handle.read(chunk, 0, chunkLength, offset);
      if (!bytesRead) throw new Error("讀取 YouTube 輸出檔時意外結束。");
      const end = offset + bytesRead - 1;
      const response = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "video/mp4",
          "Content-Length": String(bytesRead),
          "Content-Range": `bytes ${offset}-${end}/${totalBytes}`
        },
        body: bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead),
        redirect: "manual",
        cache: "no-store"
      });
      if (response.status === 308) {
        offset = uploadedOffset(response.headers.get("range")) || end + 1;
        await prisma.platformPublishJob.update({
          where: { id: job.id },
          data: { uploadedBytes: offset, progress: Math.max(1, Math.min(99, Math.round((offset / totalBytes) * 100))) }
        });
        continue;
      }
      if (!response.ok) throw new Error(await readResponseError(response));
      return (await response.json()) as YoutubeVideoResponse;
    }
  } finally {
    await handle.close();
  }
  throw new Error("YouTube 上傳完成但沒有收到影片資料。");
}

export async function uploadYoutubePublishJob(jobId: string, confirmed: boolean) {
  const job = await prisma.platformPublishJob.findUnique({ where: { id: jobId } });
  if (!job || job.platform !== "youtube") throw new Error("找不到 YouTube 發布工作。");
  if (!confirmed) throw new Error("請先確認發布內容與隱私狀態。");
  if (["PUBLISHED", "PROCESSING", "CANCELLED"].includes(job.status)) {
    throw new Error("這個發布工作目前不能再次上傳。");
  }
  const connection = await ensureYoutubeConnection();
  if (connection.status !== "CONNECTED") throw new Error("YouTube 尚未連線，請先完成 Google OAuth 授權。");

  const filePath = mediaExportPath(job.songId, job.exportFileName);
  const file = await stat(filePath);
  await prisma.platformPublishJob.update({
    where: { id: job.id },
    data: {
      connectionId: connection.id,
      status: "UPLOADING",
      approvedAt: job.approvedAt || new Date(),
      attempts: { increment: 1 },
      progress: Math.max(job.progress, 1),
      fileSizeBytes: file.size,
      startedAt: job.startedAt || new Date(),
      lastError: null
    }
  });

  try {
    const accessToken = await refreshYoutubeAccessToken(connection);
    let sessionUrl = job.uploadSessionUrl;
    let offset = job.uploadedBytes || 0;
    if (sessionUrl) {
      const remote = await queryUploadOffset(sessionUrl, accessToken, file.size);
      if (remote.completed?.id) return completeYoutubeJob(job.id, remote.completed);
      if (remote.expired) {
        sessionUrl = null;
        offset = 0;
      } else {
        offset = remote.offset;
      }
    }
    if (!sessionUrl) sessionUrl = await startUploadSession(job, accessToken, file.size);
    const video = await uploadChunks(job, filePath, sessionUrl, accessToken, offset, file.size);
    return completeYoutubeJob(job.id, video);
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube 上傳失敗。";
    await prisma.platformPublishJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message }
    });
    throw new Error(message);
  }
}

async function completeYoutubeJob(jobId: string, video: YoutubeVideoResponse) {
  if (!video.id) throw new Error("YouTube 上傳成功，但沒有回傳 videoId。");
  const updated = await prisma.platformPublishJob.update({
    where: { id: jobId },
    data: {
      status: "PROCESSING",
      progress: 100,
      platformMediaId: video.id,
      platformUrl: `https://youtu.be/${video.id}`,
      completedAt: new Date(),
      lastError: null
    },
    include: { song: { select: { id: true, title: true } } }
  });
  return toYoutubePublishJobDto(updated);
}

export async function syncYoutubePublishJob(jobId: string) {
  const job = await prisma.platformPublishJob.findUnique({ where: { id: jobId } });
  if (!job?.platformMediaId) throw new Error("這個工作還沒有 YouTube videoId。");
  const connection = await ensureYoutubeConnection();
  const accessToken = await refreshYoutubeAccessToken(connection);
  const response = await fetch(
    `${YOUTUBE_API_URL}/videos?part=status,processingDetails&id=${encodeURIComponent(job.platformMediaId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  const body = (await response.json()) as { items?: YoutubeVideoResponse[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "讀取 YouTube 處理狀態失敗。");
  const video = body.items?.[0];
  if (!video) throw new Error("YouTube 找不到這支影片，可能已被刪除。");
  const processing = video.processingDetails?.processingStatus;
  const failed = processing === "failed" || video.status?.uploadStatus === "failed" || video.status?.uploadStatus === "rejected";
  const status = failed ? "FAILED" : processing === "succeeded" || video.status?.uploadStatus === "processed" ? "PUBLISHED" : "PROCESSING";
  const lastError = failed
    ? video.processingDetails?.processingFailureReason || video.status?.failureReason || video.status?.rejectionReason || "YouTube 處理失敗。"
    : null;
  const updated = await prisma.platformPublishJob.update({
    where: { id: job.id },
    data: {
      status,
      privacyStatus: video.status?.privacyStatus || job.privacyStatus,
      lastError,
      completedAt: status === "PUBLISHED" ? new Date() : job.completedAt
    },
    include: { song: { select: { id: true, title: true } } }
  });
  if (status === "PUBLISHED" && job.status !== "PUBLISHED") {
    await prisma.timelineEvent.create({
      data: {
        songId: job.songId,
        eventType: "platform_publish",
        title: "YouTube 影片處理完成",
        description: job.platformUrl || `https://youtu.be/${job.platformMediaId}`,
        relatedModel: "PlatformPublishJob",
        relatedId: job.id,
        metadataJson: JSON.stringify({ platform: "youtube", videoId: job.platformMediaId })
      }
    });
    await ensurePublishedSongPreview(job.songId, { releaseUrl: job.platformUrl || `https://youtu.be/${job.platformMediaId}` });
  }
  return toYoutubePublishJobDto(updated);
}

export async function cancelYoutubePublishJob(jobId: string) {
  const job = await prisma.platformPublishJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("找不到發布工作。");
  if (["UPLOADING", "PROCESSING", "PUBLISHED"].includes(job.status)) {
    throw new Error("已開始上傳的工作不能只在本機取消；請到 YouTube Studio 管理影片。");
  }
  const updated = await prisma.platformPublishJob.update({
    where: { id: job.id },
    data: { status: "CANCELLED", lastError: null },
    include: { song: { select: { id: true, title: true } } }
  });
  return toYoutubePublishJobDto(updated);
}
