// Offline support for the GitHub Pages build. Not part of the jam zip -- that is
// a single self-contained index.html -- so nothing here costs bytes.
//
// This was cache-first against a cache name that never changed, which meant the
// first build a browser ever saw was the only build it would ever run: every
// later fix was invisible, forever, with no way for a player to get past it.
// Network-first fixes that. The cache is now only a fallback for being offline.
const CACHE = 'unicorn-paparazzi';
const ASSETS = ['./index.html', './main.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})            // a failed precache must not block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Network first: always prefer a fresh build, fall back to the cache only when
// the network genuinely cannot answer.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
