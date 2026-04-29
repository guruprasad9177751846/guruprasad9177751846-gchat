// Service worker: network-first for HTML/JS/CSS so updates apply; cache as offline fallback only.
const CACHE_NAME = 'gchat-v21';
const BASE = new URL('./', self.location.href).href;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        BASE,
        new URL('index.html', BASE).href,
        new URL('css/style.css', BASE).href,
        new URL('js/app.js', BASE).href,
        new URL('js/github-api.js', BASE).href
      ])
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.url.startsWith('chrome-extension')) return;

  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;
  const isApi = url.pathname.startsWith('/api') || url.hostname === 'api.github.com';
  if (!sameSite || isApi) {
    event.respondWith(fetch(req));
    return;
  }

  // Network first: always get fresh app.js / index.html after deploy
  event.respondWith(
    fetch(req)
      .then(networkRes => {
        const copy = networkRes.clone();
        if (networkRes.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return networkRes;
      })
      .catch(() => caches.match(req).then(cached => cached || Promise.reject(new Error('offline'))))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(BASE));
});

self.addEventListener('push', event => {
  const options = {
    body: event.data && event.data.text ? event.data.text() : '',
    icon: 'data:image/png;base64,...',
    badge: 'data:image/png;base64,...'
  };
  event.waitUntil(self.registration.showNotification('GChat', options));
});
