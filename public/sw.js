/* ToyVentor app-shell cache.
   - Navigations, the app shell (/) and the app root are
     network-first: a redeploy must reach returning visitors. The cached
     copy is only a fallback when the network fails, so the demo still
     opens offline with seed content.
   - Content-hashed build assets and versioned static payloads
     (/assets/..., /fonts/..., /parts-glb/..., /parts-stl/..., /kip/...)
     are cache-first: their URLs change whenever their bytes change.
   - /api/* always goes to the network so scan results are never stale.
   - /sw.js itself is never cached: a cached worker can never update itself.
   Bump the version when this file's strategy changes. */
const CACHE = "toyventor-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const IMMUTABLE_PREFIXES = ["/assets/", "/fonts/", "/parts-glb/", "/parts-stl/", "/kip/"];

function isImmutable(pathname) {
  return IMMUTABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    void caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(isImmutable(url.pathname) ? cacheFirst(request) : networkFirst(request));
});
