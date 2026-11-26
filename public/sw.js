// Offline shell: lets the installed app open without a connection.
// (Playing still needs the network to reach the relays.)
const CACHE = 'cottontale-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Hashed build files never change: cache first. Everything else: network
    // first, so a new deploy is picked up on the next load.
    if (url.pathname.includes('/assets/')) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});
