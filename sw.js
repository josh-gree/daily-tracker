// Bump VERSION (and APP_VERSION in app.js) whenever any app-shell file changes.
const VERSION = "v14";
const CACHE = `daily-tracker-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "pdf-export.js",
  "vendor/pdf-lib.min.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];
const NETWORK_TIMEOUT_MS = 4000;

// cache: "reload" skips the browser's HTTP cache, which GitHub Pages lets hold
// files for 10 minutes; without it a new version could be stored with old files.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("daily-tracker-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so the app is always current when online; the cached copy is
// used when offline or when the network is too slow to answer.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // The cloud backup API is never cached: it must always talk to the server.
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromCache = () => cache.match(req, { ignoreSearch: true })
      .then((hit) => hit || (req.mode === "navigate" ? cache.match("./") : undefined));
    const fromNetwork = fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    fromNetwork.catch(() => {}); // handled below; avoid an unhandled-rejection warning
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([fromNetwork, timeout]);
      if (res) return res;
      return (await fromCache()) || (await fromNetwork);
    } catch {
      const hit = await fromCache();
      if (hit) return hit;
      throw new Error("offline and not cached");
    }
  })());
});
