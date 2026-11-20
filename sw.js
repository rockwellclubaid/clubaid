// Club AID — the part that keeps working in the background:
// • the home-screen app opens even on a weak connection (newest version first; the saved copy only when offline)
// • phone notifications for new Club Feed posts (the message itself is asked from Club AID when it arrives)
// Questions, accounts and the Club Feed always go live to Club AID's server (never saved here).
const CACHE = "clubaid-v4";
const BRIDGE = new URL(self.location.href).searchParams.get("b") || "";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   // only this site's own files
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined); });
  }));
});
// ---- notifications ----
self.addEventListener("push", function (e) {
  e.waitUntil((async function () {
    let info = { title: "Club AID", body: "There's something new in the Club Feed.", url: "./", tag: "clubaid" };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (BRIDGE) {
        const r = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
                                        body: JSON.stringify({ action: "pushPeek", endpoint: sub ? sub.endpoint : "" }) });
        const j = await r.json(); if (j && j.ok && j.title) info = j;
      }
    } catch (x) {}
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(1); } catch (x) {}
    const opts = { body: info.body, icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: info.tag || "clubaid", renotify: true, data: { url: info.url || "./" } };
    if (info.image) opts.image = info.image;
    return self.registration.showNotification(info.title, opts);
  })());
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  const m = url.match(/#post=([^&]+)/), post = m ? decodeURIComponent(m[1]) : "";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        if (post) c.postMessage({ openPost: post });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
