// service-worker.js
const CACHE_NAME = 'pwa-evento-shell-v1';
const FILES_TO_CACHE = [
  '/',               // start_url
  '/index.html',
  '/app.js',
  '/idb.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
  // si tienes más assets, agrégalos aquí
];

// instalamos y cacheamos el shell
self.addEventListener('install', (evt) => {
  console.log('[SW] install');
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// activación: limpiar caches viejos
self.addEventListener('activate', (evt) => {
  console.log('[SW] activate');
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null))
    ).then(() => self.clients.claim())
  );
});

// fetch: responder desde cache (primero) y fallbacks
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  // navigation requests -> serve index.html (app shell)
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    evt.respondWith(
      caches.match('/index.html').then(cached => cached || fetch('/index.html'))
    );
    return;
  }

  // otros recursos: cache-first para assets, network-first para API (opcional)
  evt.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // solo cachear GET y respuestas 200
        if (req.method === 'GET' && resp && resp.status === 200) {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
        }
        return resp;
      }).catch(() => {
        // fallback: si es imagen, devolver icon placeholder opcional
        if (req.destination === 'image') return caches.match('/icon-192.png');
        return new Response('', { status: 503, statusText: 'offline' });
      });
    })
  );
});
