const CACHE_PREFIX = "songzu-music-os-";
const CACHE_NAME = `${CACHE_PREFIX}v6-rsc-safe`;
const DEVELOPMENT = new URL(self.location.href).searchParams.get("runtime") === "development";
const APP_SHELL = ["/", "/daw", "/offline", "/local-app", "/music-db", "/theory", "/intelligence", "/icon.svg", "/maskable-icon.svg"];

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.headers.get("content-type")?.includes("text/x-component")) return response;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Cache failures must not interrupt a successful network response.
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (DEVELOPMENT ? Promise.resolve() : caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && (DEVELOPMENT || key !== CACHE_NAME))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // A pass-through dev worker also replaces an older cache-serving worker in open tabs.
  // Never replay Flight streams: they belong to a specific router tree and build.
  const isFlight = url.searchParams.has("_rsc") || request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree") || request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") || request.headers.get("accept")?.includes("text/x-component");
  if (DEVELOPMENT || isFlight) return;

  if (request.headers.has("range") || url.pathname.startsWith("/sound-assets/") ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/exports/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/offline")))
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => caches.match(request))
    );
    return;
  }

  // Only ordinary assets can use stale-while-revalidate; dynamic data stays on the network.
  if (!["style", "script", "image", "font"].includes(request.destination) || url.pathname.startsWith("/_next/")) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
