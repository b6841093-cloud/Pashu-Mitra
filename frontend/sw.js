/* =================================================================
   Pashu-Mitra Service Worker — Offline Support + Incoming Call Push
   =================================================================
   Cache versioning: bump CACHE_NAME whenever a pre-cached asset changes.
   v7 adds the web-calling client (call.js, vendor/socket.io.min.js) and the
   push/notificationclick handlers for incoming web calls. The fetch strategy
   below is unchanged from v6; call API endpoints are never cached.

   v8 (GIGW/GuDApps/UX compliance) adds the global shell: org-config.js,
   shell.js and info-pages.js. The fetch strategy is unchanged; no
   authenticated data is added to the offline cache.

   v9 (a11y + security hardening) adds a11y.js for focus trap, dialogs,
   keyboard operable cards, form error handling, live regions, etc.
   ================================================================= */

const CACHE_NAME = "pashu-mitra-v9";  // bumped: a11y.js + global shell + GIGW info pages
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/a11y.js",
  "/org-config.js",
  "/shell.js",
  "/info-pages.js",
  "/call.js",
  "/vendor/socket.io.min.js",
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

  // Live call state must never be served from the cache, even if someone adds
  // it to API_CACHE by mistake.
  if (url.pathname.startsWith("/api/webcall/")) return;

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

/* =================================================================
   Web Push — incoming call notification
   -----------------------------------------------------------------
   The payload carries *identification only* (call id, caller display name,
   language, reason). No phone number and no call state are trusted from the
   push: clicking it focuses/opens the veterinary portal, which re-reads the
   authoritative call state from the backend with the user's own JWT.

   Platform honesty: this runs only when the browser/OS delivers the push.
   A fully closed browser, a device that is offline, or disabled notifications
   means no notification is shown — there is no way for a web page to
   guarantee a "WhatsApp-style" ring in those conditions.
   ================================================================= */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { type: "generic", body: event.data ? event.data.text() : "" };
  }
  if (!payload || payload.type !== "incoming_call" || !payload.call_id) {
    // Non-call pushes keep the previous behaviour: show a plain notification.
    if (payload && (payload.title || payload.body)) {
      event.waitUntil(self.registration.showNotification(payload.title || "Pashu-Mitra", {
        body: payload.body || "",
        icon: "/manifest.json",
      }));
    }
    return;
  }

  const target = payload.url || ("/#/vet/calls?incoming=" + encodeURIComponent(payload.call_id));
  event.waitUntil(
    self.registration.showNotification(payload.title || "Incoming web call", {
      body: payload.body || "A farmer is calling you in the Pashu-Mitra veterinary portal.",
      tag: "pm-call-" + payload.call_id,
      renotify: true,
      requireInteraction: true,
      data: { call_id: payload.call_id, url: target },
    })
  );
});

/* Notification click — open/focus the veterinary portal and recover the call */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || "/#/vet/calls", self.location.origin).href;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: "pm-focus-call", call_id: data.call_id || null });
        return;
      }
    }
    const opened = await self.clients.openWindow(targetUrl);
    if (opened) opened.postMessage({ type: "pm-focus-call", call_id: data.call_id || null });
  })());
});
