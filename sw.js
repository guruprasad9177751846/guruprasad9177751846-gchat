// Service Worker for PWA caching & background sync (works on GitHub Pages /repo/ paths)
const CACHE_NAME = 'gchat-v13';
const BASE = new URL('./', self.location.href).href;
const urlsToCache = [
  BASE,
  new URL('index.html', BASE).href,
  new URL('css/style.css', BASE).href,
  new URL('js/app.js', BASE).href,
  new URL('js/github-api.js', BASE).href
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Background notifications (periodic sync)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(BASE));
});

// Push (future)
self.addEventListener('push', event => {
  const options = {
    body: event.data.text(),
    icon: 'data:image/png;base64,...',
    badge: 'data:image/png;base64,...'
  };
  event.waitUntil(self.registration.showNotification('GChat', options));
});

