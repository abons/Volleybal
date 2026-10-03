// Service worker: de app werkt offline, en bekeken teams blijven beschikbaar.
const BUILD = "__BUILD__";
const SHELL = `shell-${BUILD}`;
const DATA = "data-v1";
const FILES = ["./", "index.html", "app.js", "shared.js", "firebase-config.js", "style.css", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  // cache: "reload": nooit een verouderd bestand uit de HTTP-cache van de browser of van Pages in de nieuwe versie stoppen.
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.includes("/data/")) {
    // Teamlijst: meteen uit de cache, op de achtergrond verversen. Wedstrijden: eerst netwerk.
    const swr = url.pathname.endsWith("/teams.json");
    e.respondWith(
      caches.open(DATA).then(async (cache) => {
        const cached = await cache.match(req);
        // Geeft de server een fout (bijvoorbeeld net tijdens een nieuwe publicatie), dan houden we de bewaarde versie.
        const net = fetch(req).then((res) => {
          if (res.ok) { e.waitUntil(cache.put(req, res.clone())); return res; }
          return cached || res;
        });
        if (swr && cached) { net.catch(() => {}); return cached; }
        // Bij slecht bereik niet eindeloos wachten als we een bewaarde versie hebben.
        const slow = cached ? new Promise((resolve) => setTimeout(() => resolve(cached), 4000)) : null;
        return (slow ? Promise.race([net, slow]) : net).catch(() => cached || Response.error());
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match("index.html")))
  );
});
