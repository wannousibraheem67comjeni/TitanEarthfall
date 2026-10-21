// Offline cache for the installable web build (PWA). The Android app does not use it.
const CACHE = 'hopinet-__VERSION__';
const FILES = ['./', 'index.html', 'game.js', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'fonts/baloo-arabic.woff2', 'fonts/baloo-latin.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
