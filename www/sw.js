// Service Worker — network-first during development so rebuilt ROM UI is visible.
const CACHE_NAME = 'space-invaders-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/game.css',
  './js/game.js',
  './js/cup-pipe.js',
  './js/joystick.js',
  './js/filters/load_rom.js',
  './js/filters/read_input.js',
  './js/filters/execute_frame.js',
  './js/filters/render_frame.js',
  './js/filters/update_audio.js',
  './wasm/space_invaders_emu_bg.wasm',
  './wasm/space_invaders_emu.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const response_clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response_clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
