// AcreMap Service Worker — cache + tiles + notifications
const CACHE = "acremap-v2";
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
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/").then((r) => r || Response.error()))
    );
  }
});

// Push notifications (serveur push à brancher plus tard).
self.addEventListener("push", (event) => {
  let payload = { title: "AcreMap", body: "Nouvelle notification", tag: "acremap", data: {} };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 500],
      data: payload.data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) { c.navigate(targetUrl); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Permet de déclencher une notification depuis la page (postMessage).
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "show-notification") {
    self.registration.showNotification(data.title || "AcreMap", {
      body: data.body || "",
      tag: data.tag,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 500],
      data: data.data || {},
    });
  }
});
