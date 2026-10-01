import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { appRoot } from "@/lib/paths";

function isNetworkInterfaceInfo(item: NetworkInterfaceInfo | undefined): item is NetworkInterfaceInfo {
  return Boolean(item);
}

function localIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(isNetworkInterfaceInfo)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address)
    .filter((value, index, list) => list.indexOf(value) === index);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const port = url.port || process.env.PORT || "3000";
  const root = process.env.SONGZU_STORAGE_USER_DATA_ROOT?.trim() || appRoot();
  const certPath = join(root, ".local-ssl", "songzu-local-cert.pem");
  const keyPath = join(root, ".local-ssl", "songzu-local-key.pem");
  const caPath = join(root, ".local-ssl", "songzu-local-ca.pem");
  const ips = localIps();
  const httpsReady = existsSync(certPath) && existsSync(keyPath);

  return NextResponse.json({
    currentOrigin: url.origin,
    currentProtocol: url.protocol.replace(":", ""),
    port,
    secureContextExpected: url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1",
    httpsReady,
    hasLocalCa: existsSync(caPath),
    certPath: httpsReady ? certPath : null,
    caPath: existsSync(caPath) ? caPath : null,
    lanIps: ips,
    httpUrls: ips.map((ip) => `http://${ip}:${port}`),
    httpsUrls: ips.map((ip) => `https://${ip}:${port}`),
    localhostUrls: [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `https://localhost:${port}`, `https://127.0.0.1:${port}`]
  });
}
