const CACHE = 'pwa-cache-v2'; // Incrementar versión
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/idb.js',
  '/supabase-config.js',
  '/service-worker.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  // Estrategia: Network First, luego Cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Clonar para guardar en caché
        const responseClone = response.clone();
        caches.open(CACHE)
          .then(cache => cache.put(e.request, responseClone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});