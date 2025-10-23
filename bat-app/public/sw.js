const CACHE_VERSION = 'batapp-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.png',
  '/logo512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : Promise.resolve()))
      )
    )
  );
  self.clients.claim();
});

// Cache-first para estáticos; network-first para navegação
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Navegação SPA: responder com index.html do cache
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) =>
        cached || fetch(req).catch(() => caches.match('/index.html'))
      )
    );
    return;
  }

  const url = new URL(req.url);
  const isStatic = url.pathname.startsWith('/static/') || APP_SHELL.includes(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
      )
    );
  }
});