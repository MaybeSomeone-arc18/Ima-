// Minimal service worker: exists mainly to satisfy PWA installability
// criteria. Deliberately conservative about caching, since this app's
// whole point is live/current content:
// - API calls (/api/*) always go to the network - never cache news data.
// - Hashed build assets (JS/CSS from Vite's content-hashed filenames)
// are safe to cache-first, since a changed file gets a new filename.
// - Everything else (index.html, navigations) is network-first with a
// cache fallback, so a previous visit still loads while offline.

const CACHE_NAME = 'ima-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return; // let the network handle it untouched
  }

  const isHashedAsset = /\/assets\/.+\.[a-f0-9]{6,}\.(js|css)$/.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
