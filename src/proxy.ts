import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isLoopbackRequest, requestOrigin } from "@/lib/local-request";
import { authenticateMobileRequest, mobileTrustCorsHeaders } from "@/lib/mobile-trust";

const publicPrefixes = [
  "/_next/",
  "/api/credit-confirmations/",
  "/api/integrations/guitar-ai/v1/",
  "/api/listen/",
  "/api/mobile/health",
  "/api/mobile/pairing/claim",
  "/api/mobile/pairing/session",
  "/api/share/",
  "/apple-icon",
  "/confirm-credit/",
  "/downloads/",
  "/icon.svg",
  "/listen",
  "/manifest.webmanifest",
  "/maskable-icon.svg",
  "/mobile-connect",
  "/offline",
  "/share/",
  "/sw.js"
];

function isPublicPath(pathname: string) {
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  if (request.method === "OPTIONS" || isLoopbackRequest(request) || isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const device = await authenticateMobileRequest(request);
  if (device) {
    const response = NextResponse.next();
    response.headers.set("X-Songzu-Trusted-Device", device.id);
    return response;
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const response = NextResponse.json(
      { error: "這台裝置尚未配對。請在 Mac 的「本機 App」產生配對碼。", code: "MOBILE_PAIRING_REQUIRED" },
      { status: 401 }
    );
    for (const [name, value] of Object.entries(mobileTrustCorsHeaders)) response.headers.set(name, value);
    return response;
  }

  const destination = new URL("/mobile-connect", requestOrigin(request));
  destination.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: "/:path*"
};
