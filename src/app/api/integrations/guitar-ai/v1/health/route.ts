import { appVersion } from "@/lib/app-info";
import {
  authorizeGuitarAiAdapter,
  guitarAiAdapterAuthorizationError,
  guitarAiAdapterJson
} from "@/lib/guitar-ai-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = authorizeGuitarAiAdapter(request);
  if (!authorization.ok) return guitarAiAdapterAuthorizationError(authorization);

  return guitarAiAdapterJson({
    ok: true,
    service: "songzu-music-os-guitar-ai-adapter",
    contractVersion: "v1",
    musicOsVersion: appVersion,
    checkedAt: new Date().toISOString()
  });
}
