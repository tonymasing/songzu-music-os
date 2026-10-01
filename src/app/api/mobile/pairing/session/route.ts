import { NextResponse } from "next/server";

import {
  authenticateMobileToken,
  mobileDeviceCookieName,
  mobileDeviceTokenMaxAgeSeconds,
  mobileTrustCorsHeaders
} from "@/lib/mobile-trust";
import { requestOrigin } from "@/lib/local-request";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/?mobileApp=1";
  return value;
}

async function createSessionResponse(request: Request, token: string, returnTo: string | null) {
  const url = new URL(request.url);
  const device = await authenticateMobileToken(token);
  if (!device) {
    return NextResponse.json(
      { error: "裝置授權無效或已被撤銷。", code: "MOBILE_PAIRING_REQUIRED" },
      { status: 401, headers: mobileTrustCorsHeaders }
    );
  }

  const response = NextResponse.redirect(new URL(safeReturnTo(returnTo), requestOrigin(request)));
  response.cookies.set(mobileDeviceCookieName, token, {
    httpOnly: true,
    maxAge: mobileDeviceTokenMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:"
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return createSessionResponse(request, url.searchParams.get("token")?.trim() || "", url.searchParams.get("returnTo"));
}

export async function POST(request: Request) {
  const form = await request.formData();
  return createSessionResponse(
    request,
    typeof form.get("token") === "string" ? String(form.get("token")).trim() : "",
    typeof form.get("returnTo") === "string" ? String(form.get("returnTo")) : null
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: mobileTrustCorsHeaders });
}
