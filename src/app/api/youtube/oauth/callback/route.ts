import { NextResponse } from "next/server";

import { exchangeYoutubeAuthorizationCode } from "@/lib/youtube-publishing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL("/publishing", url.origin);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const storedState = request.headers.get("cookie")?.match(/(?:^|; )songzu_youtube_oauth_state=([^;]+)/)?.[1];
  const verifier = request.headers.get("cookie")?.match(/(?:^|; )songzu_youtube_oauth_verifier=([^;]+)/)?.[1];

  try {
    if (oauthError) throw new Error(`Google OAuth：${oauthError}`);
    if (!state || !storedState || decodeURIComponent(storedState) !== state) throw new Error("OAuth state 驗證失敗，請重新連線。");
    if (!code || !verifier) throw new Error("OAuth callback 缺少授權碼或 PKCE verifier。");
    await exchangeYoutubeAuthorizationCode(code, decodeURIComponent(verifier));
    target.searchParams.set("youtube", "connected");
  } catch (error) {
    target.searchParams.set("youtube", "error");
    target.searchParams.set("message", error instanceof Error ? error.message : "YouTube 授權失敗。");
  }

  const response = NextResponse.redirect(target);
  response.cookies.set("songzu_youtube_oauth_state", "", { maxAge: 0, path: "/api/youtube/oauth" });
  response.cookies.set("songzu_youtube_oauth_verifier", "", { maxAge: 0, path: "/api/youtube/oauth" });
  return response;
}
