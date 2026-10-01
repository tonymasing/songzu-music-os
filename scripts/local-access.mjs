import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const port = process.env.PORT || "3000";
const certPath = join(root, ".local-ssl", "songzu-local-cert.pem");
const keyPath = join(root, ".local-ssl", "songzu-local-key.pem");

function localIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function probe(protocol) {
  const client = protocol === "https" ? https : http;
  return new Promise((resolveProbe) => {
    const request = client.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/local-app",
        method: "HEAD",
        rejectUnauthorized: false,
        timeout: 900
      },
      (response) => {
        response.resume();
        resolveProbe(Boolean(response.statusCode && response.statusCode < 500));
      }
    );

    request.on("error", () => resolveProbe(false));
    request.on("timeout", () => {
      request.destroy();
      resolveProbe(false);
    });
    request.end();
  });
}

const ips = localIps();
const httpsReady = existsSync(certPath) && existsSync(keyPath);
const [httpResponding, httpsResponding] = await Promise.all([probe("http"), probe("https")]);

console.log("頌祖音樂 OS 本機連線資訊\n");

console.log("目前服務：");
console.log(`  HTTP：${httpResponding ? "有回應" : "未回應"}`);
console.log(`  HTTPS：${httpsResponding ? "有回應" : httpsReady ? "憑證已建立，但目前未回應" : "尚未建立憑證"}`);

console.log("\n電腦：");
if (httpResponding) console.log(`  http://127.0.0.1:${port}`);
if (httpsResponding) {
  console.log(`  https://localhost:${port}`);
  console.log(`  https://127.0.0.1:${port}`);
}
if (!httpResponding && !httpsResponding) {
  console.log("  尚未偵測到正在回應的本機服務");
}

console.log("\n手機 / 平板同 Wi-Fi：");
if (ips.length && (httpResponding || httpsResponding)) {
  for (const ip of ips) {
    if (httpResponding) console.log(`  http://${ip}:${port}`);
    if (httpsResponding) console.log(`  https://${ip}:${port}`);
  }
} else if (!ips.length) {
  console.log("  尚未偵測到區網 IP");
} else {
  console.log("  請先執行 npm run dev 或 npm run dev:https");
}
console.log(`\nHTTPS 憑證：${httpsReady ? "已建立" : "尚未建立，請執行 npm run dev:https"}`);
