self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  // Minimal SW for PWA installability; caching can be added later.
});