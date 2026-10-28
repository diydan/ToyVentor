/* ToyVentor app-shell cache. Static assets cache-first so the demo opens
   offline with seed content; /api/* always goes to the network so scan
   results are never stale. Bump the version when the shell changes. */
const CACHE = "toyventor-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      return cached ?? network;
    }),
  );
});
