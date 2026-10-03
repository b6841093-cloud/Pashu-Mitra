/* =================================================================
   PashuMitra Service Worker — Offline Support
   ================================================================= */

const CACHE_NAME = "pashu-mitra-v5";  // bumped: prototype farmer Demo Account box (DEMO_MODE)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/maharashtra_locations.json",
  "/maharashtra_state.geojson",
];

const API_CACHE = [
  "/api/diseases",
  "/api/ivr/info",
];

/* Install — pre-cache static assets */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

/* Activate — clean old caches */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

/* Fetch — stale-while-revalidate for API GET; cache-first for static */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET
  if (event.request.method !== "GET") return;

  // Skip non-same-origin requests (CDN, external resources)
  if (url.origin !== self.location.origin) return;

  // API GET: stale-while-revalidate for safe endpoints
  if (url.pathname.startsWith("/api/")) {
    const isCacheable = API_CACHE.some((p) => url.pathname.startsWith(p));
    if (!isCacheable) return;

    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Static assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});