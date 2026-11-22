// Club AID — the part that keeps working in the background:
// • opens fast: the newest version is asked for first, but if the connection is slow (over 2.5 s) the saved copy opens at once
//   and the new version is saved for the next open. Unchanged files cost only a tiny check, never a full download.
// • fonts, icons and Club Feed pictures are kept on the phone, so they appear instantly the next time
// • phone notifications for new Club Feed posts (the message itself is asked from Club AID when it arrives)
// Questions, accounts and the Club Feed text always go live to Club AID's server (never saved here).
const CACHE = "clubaid-v54", PICS = "clubaid-pics-v1", FONTS = "clubaid-fonts-v1";
const BRIDGE = new URL(self.location.href).searchParams.get("b") || "";
const FILES = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"];
const KEEP = [CACHE, PICS, FONTS], PIC_MAX = 120, PAGE_WAIT = 2500;
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return KEEP.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
function put(name, key, res) { return caches.open(name).then(function (c) { return c.put(key, res); }); }
function trim(name, max) { return caches.open(name).then(function (c) { return c.keys().then(function (k) { return k.length > max ? Promise.all(k.slice(0, k.length - max).map(function (r) { return c.delete(r); })) : null; }); }); }
// the page itself: newest first (a quick "has it changed?" check), saved copy if the network is slow or off
function page(e) {
  const key = "./";
  const net = fetch(e.request, { cache: "no-cache" }).then(function (res) {
    if (res && res.ok) { const copy = res.clone(); e.waitUntil(put(CACHE, key, copy)); }
    return res;
  });
  const saved = caches.match(key);
  return new Promise(function (done) {
    let settled = false; const finish = function (r) { if (!settled && r) { settled = true; done(r); } };
    const t = setTimeout(function () { saved.then(finish); }, PAGE_WAIT);
    net.then(function (r) { clearTimeout(t); if (r && r.ok) finish(r); else saved.then(function (s) { finish(s || r); }); })
       .catch(function () { clearTimeout(t); saved.then(function (s) { finish(s || Response.error()); }); });
    e.waitUntil(net.catch(function () {}));
  });
}
// saved copy at once, refreshed quietly in the background (icons, manifest, font styles, feed pictures)
function savedThenRefresh(e, name, max) {
  return caches.open(name).then(function (c) {
    return c.match(e.request).then(function (hit) {
      const net = fetch(e.request).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); e.waitUntil(c.put(e.request, copy).then(function () { return max ? trim(name, max) : null; })); }
        return res;
      });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  });
}
// fonts never change once published: saved copy forever
function savedForever(e) {
  return caches.open(FONTS).then(function (c) {
    return c.match(e.request).then(function (hit) { return hit || fetch(e.request).then(function (res) { if (res && (res.ok || res.type === "opaque")) e.waitUntil(c.put(e.request, res.clone())); return res; }); });
  });
}
self.addEventListener("fetch", function (e) {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (req.mode === "navigate") return e.respondWith(page(e));
    if (u.pathname.endsWith("/sw.js")) return;
    return e.respondWith(savedThenRefresh(e, CACHE, 0));
  }
  if (u.hostname === "fonts.gstatic.com") return e.respondWith(savedForever(e));
  if (u.hostname === "fonts.googleapis.com") return e.respondWith(savedThenRefresh(e, FONTS, 0));
  if (u.hostname === "lh3.googleusercontent.com" && req.destination === "image") return e.respondWith(savedThenRefresh(e, PICS, PIC_MAX));
  // everything else (Club AID's server, Google Drive, forms) goes straight to the network, untouched
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
        if (/#order\b/.test(url)) c.postMessage({ openOrder: 1 });                 // (v.84) Rocky's order status
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
