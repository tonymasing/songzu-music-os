import { NextResponse } from "next/server";

import { createYoutubeAuthorization, ensureYoutubeConnection } from "@/lib/youtube-publishing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  if (!["127.0.0.1", "localhost", "::1"].includes(requestUrl.hostname)) {
    const target = new URL("/publishing", requestUrl.origin);
    target.searchParams.set("youtube", "host-required");
    return NextResponse.redirect(target);
  }

  try {
    const authorization = createYoutubeAuthorization(await ensureYoutubeConnection());
    const response = NextResponse.redirect(authorization.url);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      maxAge: 10 * 60,
      path: "/api/youtube/oauth"
    };
    response.cookies.set("songzu_youtube_oauth_state", authorization.state, cookieOptions);
    response.cookies.set("songzu_youtube_oauth_verifier", authorization.verifier, cookieOptions);
    return response;
  } catch (error) {
    const target = new URL("/publishing", requestUrl.origin);
    target.searchParams.set("youtube", "error");
    target.searchParams.set("message", error instanceof Error ? error.message : "無法開始 YouTube 授權。");
    return NextResponse.redirect(target);
  }
}
