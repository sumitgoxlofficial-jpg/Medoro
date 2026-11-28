/* Medoro service worker: keeps the app installable and lets a counter keep billing with no network.
   It never caches signed-in pages or API answers; only the static offline billing page and build files. */
const SHELL = "medoro-shell-v2";
/** Build files are cached per release (/sw.js?v=<build id>): a new release starts a new cache and drops the old one. */
const BUILD = new URL(self.location.href).searchParams.get("v") || "1";
const STATIC = "medoro-static-v1-" + BUILD.replace(/[^\w-]/g, "").slice(0, 40);
const OFFLINE_URL = "/offline";
/** Drive mode counter page and the SQLite build it loads: kept so a Drive mode counter opens with no network. */
const DEVICE_URL = "/device";
const SQLITE = ["/drivedb/sqlite/index.mjs", "/drivedb/sqlite/sqlite3.wasm"];
const CORE = [OFFLINE_URL, DEVICE_URL, ...SQLITE, "/manifest.webmanifest", "/medoro-mark.png", "/icons/icon-192.png", "/icons/icon-512.png"];

// Fetch the offline page plus every script, stylesheet and font it references.
async function warm() {
  const cache = await caches.open(SHELL);
  const res = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "omit" });
  if (!res.ok) return;
  const dev = await fetch(DEVICE_URL, { cache: "no-store", credentials: "omit" }).catch(() => null);
  const html = (await res.clone().text()) + (dev?.ok ? await dev.clone().text() : "");
  const assets = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
  const st = await caches.open(STATIC);
  await Promise.all([...assets].map((u) => st.match(u).then((hit) => hit || fetch(u).then((r) => (r.ok ? st.put(u, r) : undefined))).catch(() => undefined)));
  // Stylesheets pull in fonts.
  for (const u of [...assets].filter((x) => x.endsWith(".css"))) {
    const css = await (await st.match(u))?.text();
    if (!css) continue;
    const fonts = [...css.matchAll(/url\((\/_next\/static\/[^)]+)\)/g)].map((m) => m[1]);
    await Promise.all(fonts.map((f) => st.match(f).then((hit) => hit || fetch(f).then((r) => (r.ok ? st.put(f, r) : undefined))).catch(() => undefined)));
  }
  await cache.put(OFFLINE_URL, res);
  if (dev?.ok) await cache.put(DEVICE_URL, dev);
  await Promise.all(CORE.slice(1).map((u) => fetch(u).then((r) => (r.ok ? cache.put(u, r) : undefined)).catch(() => undefined)));
}

self.addEventListener("install", (e) => { e.waitUntil(warm().catch(() => undefined).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("medoro-") && k !== SHELL && k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "warm") e.waitUntil(warm().catch(() => undefined)); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Build files never change once published: serve from cache, fill it as we go.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.open(STATIC).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.pathname === OFFLINE_URL || url.pathname === DEVICE_URL) {
    const key = url.pathname;
    e.respondWith(fetch(req).then((r) => { if (r.ok) caches.open(SHELL).then((c) => c.put(key, r.clone())); return r; }).catch(async () => (await caches.match(key)) || Response.error()));
    return;
  }
  // The SQLite build: network first (it changes with app updates), the kept copy when offline.
  if (SQLITE.includes(url.pathname)) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) caches.open(SHELL).then((c) => c.put(url.pathname, r.clone())); return r; }).catch(async () => (await caches.match(url.pathname)) || Response.error()));
    return;
  }
  // Any page that can't load because the network is down opens offline billing instead.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(async () => ((await caches.match(OFFLINE_URL)) ? Response.redirect(OFFLINE_URL, 302) : new Response("You’re offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
    return;
  }
  if (CORE.includes(url.pathname)) e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

// Naina's calls (AI HR): a ringing notification even when the HRMS isn't open. Tapping it opens Naina in Team Chat.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  if (!d || !d.title) return;
  e.waitUntil(self.registration.showNotification(String(d.title).slice(0, 80), {
    body: String(d.body || "").slice(0, 200), tag: String(d.tag || "medoro"), renotify: true, requireInteraction: true,
    icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", vibrate: [400, 200, 400, 200, 400],
    data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/staff/hrms" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/staff/hrms", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (cs) => {
    const tab = cs.find((c) => c.url.startsWith(self.location.origin + "/staff/"));
    if (tab) { try { await tab.navigate(url); } catch { /* not controlled: open a new tab instead */ return self.clients.openWindow(url); } return tab.focus(); }
    return self.clients.openWindow(url);
  }));
});
