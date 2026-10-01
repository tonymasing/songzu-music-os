import { createServer } from "node:http";

// Existing preview bookmarks remain useful after moving to the formal runtime.
// This listener belongs to that runtime; it never starts another app or database.
export function startLegacyMusicEntry({ port = 3012, targetPort = 3000, onError = console.warn } = {}) {
  const origin = `http://127.0.0.1:${targetPort}`;
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    // Concatenation keeps even a //path on our fixed origin, without trusting Host.
    const path = request.url?.startsWith("/") ? request.url : "/";
    response.writeHead(308, {
      Location: origin + path,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("音樂 OS 已整合至正式入口，正在開啟。\n");
  });
  server.on("error", error => {
    // An occupied preview port must never interrupt the formal application.
    onError(`[Music OS] 舊網址轉接未啟用：${error.code || "UNKNOWN"}`);
  });
  server.listen(port, "127.0.0.1");
  return server;
}
