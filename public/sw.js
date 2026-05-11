// AcreMap Service Worker — cache shell + map tiles for offline use
const CACHE = "acremap-v1";
const TILE_CACHE = "acremap-tiles-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Cache map tiles aggressively for offline
  if (/tile\.openstreetmap|arcgisonline|tile\.thunderforest|stamen|esri/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }
  // Network-first for navigations, fallback to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/").then((r) => r || Response.error()))
    );
  }
});
