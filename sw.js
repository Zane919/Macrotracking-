/* Service worker: l'app funziona anche senza rete (tranne la ricerca dei codici a barre). */
const CACHE = 'macrotracking-v2.0.1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './foods.js', './barcode.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return; // Open Food Facts: sempre in rete
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then((hit) => {
      const net = fetch(r).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
