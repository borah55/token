/* Service worker — offline shell + asset cache */
const VERSION = 'otcsg-v1.2.0';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './css/animations.css',
  './js/storage.js',
  './js/notifications.js',
  './js/indicators.js',
  './js/patterns.js',
  './js/api.js',
  './js/fx-rates.js',
  './js/strategy.js',
  './js/chart.js',
  './js/app.js',
  './js/pwa.js',
  './assets/icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache cross-origin API calls (Binance, Telegram)
  if (url.origin !== self.location.origin) return;

  // App shell: stale-while-revalidate
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
