// Service Worker for PWA caching & background sync
const CACHE_NAME = 'gchat-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/github-api.js'
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
  event.waitUntil(clients.openWindow('/'));
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

