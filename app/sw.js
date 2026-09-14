/* Offline support + notification handling for Lamp & Light. */
const SHELL = "lamp-light-shell-v4";
const BIBLE = "lamp-light-bible-v3";
const ASSETS = ["./", "index.html", "styles.css", "data.js", "plans.js", "app.js", "capacitor.js", "icon.svg", "manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== BIBLE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Bible books never change: cache-first so each book works offline after one read.
  if (url.origin === self.location.origin && url.pathname.includes("/bible/")) {
    event.respondWith(
      caches.open(BIBLE).then(async cache => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // App files: network-first so updates arrive, cache fallback when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })   // always revalidate so app updates aren't hidden by the HTTP cache
        .then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put(request, copy)); return res; })
        .catch(() => caches.match(request).then(r => r || caches.match("index.html")))
    );
  }
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => "focus" in c);
      return existing ? existing.focus() : self.clients.openWindow("./");
    })
  );
});
