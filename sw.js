// Club AID — the part that keeps working in the background:
// • opens instantly: the saved copy opens at once; the newest version is fetched in the background, saved for the next open,
//   and the open page offers "Refresh" when a new build arrives. Unchanged files cost only a tiny check, never a full download.
// • fonts, icons and Club Feed pictures are kept on the phone, so they appear instantly the next time
// • phone notifications for new Club Feed posts (the message itself is asked from Club AID when it arrives)
// Questions, accounts and the Club Feed text always go live to Club AID's server (never saved here).
const CACHE = "clubaid-v153", PICS = "clubaid-pics-v1", FONTS = "clubaid-fonts-v1";
const BRIDGE = new URL(self.location.href).searchParams.get("b") || "";
const FILES = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/badge-96.png"];
const KEEP = [CACHE, PICS, FONTS], PIC_MAX = 120;
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return KEEP.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
function put(name, key, res) { return caches.open(name).then(function (c) { return c.put(key, res); }); }
function trim(name, max) { return caches.open(name).then(function (c) { return c.keys().then(function (k) { return k.length > max ? Promise.all(k.slice(0, k.length - max).map(function (r) { return c.delete(r); })) : null; }); }); }
// the page itself (v26.11.23): the saved copy opens AT ONCE (no waiting for the network), and the newest version is fetched in
// the background and saved. If it's a newer build, the open page is told ("A new version is ready" → Refresh) and every later open
// uses it. First visit (nothing saved yet) or a saved copy older than 7 days: straight from the network, as before.
function verOf(t) { const m = String(t || "").match(/WEB_VERSION\s*=\s*"(v[\d.]+-\d{4})"/) || String(t || "").match(/"(v\d\d\.\d\d\.\d\d-\d{4})"/); return m ? m[1] : ""; }
function page(e) {
  const key = "./";
  return caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (saved) {
      const savedText = saved ? saved.clone().text() : Promise.resolve("");     // read before the saved copy is handed to the page
      const net = fetch(e.request, { cache: "no-cache" }).then(function (res) {
        if (!res || !res.ok) return res;
        const copy = res.clone();
        e.waitUntil(Promise.all([copy.text(), savedText]).then(function (tx) {
          const nv = verOf(tx[0]), ov = verOf(tx[1]);
          return c.put(key, new Response(tx[0], { headers: { "Content-Type": "text/html; charset=utf-8", "X-Saved-At": String(Date.now()) } })).then(function () {
            if (saved && nv && ov && nv !== ov) return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) { list.forEach(function (w) { w.postMessage({ updateReady: nv }); }); });
          });
        }));
        return res;
      });
      const at = saved ? Number(saved.headers.get("X-Saved-At")) || Date.parse(saved.headers.get("Date") || "") || Date.now() : 0, age = saved ? Date.now() - at : Infinity;
      if (saved && age < 7 * 864e5) { e.waitUntil(net.catch(function () {})); return saved; }
      return net.then(function (r) { return r && r.ok ? r : (saved || r); }).catch(function () { return saved || Response.error(); });
    });
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
    if (u.pathname.indexOf("/clubaid-media/") === 0) return;   // (v26.11.26) HD videos stream straight from the media library, never cached
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
    let info = { title: "📰 New in the Club Feed", body: "Tap to see what's new at The Rockwell Club.", url: "./", tag: "clubaid" };
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
