/* BusFieber – Service Worker für Offline-Nutzung */
const CACHE = 'busfieber-v3';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/engine.js',
  'js/sound.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/fonts/nunito-latin.woff2',
  'assets/img/apple-touch-icon.png',
  'assets/img/back.svg',
  'assets/img/bay.svg',
  'assets/img/bus.svg',
  'assets/img/vip.svg',
  'assets/img/hero.webp',
  'assets/img/icon-192.png',
  'assets/img/icon-512.png',
  'assets/img/icon.svg',
  'assets/img/jam.svg',
  'assets/img/person.svg',
  'assets/img/restart.svg',
  'assets/img/settings.svg',
  'assets/img/sort.svg',
  'assets/sfx/click.m4a',
  'assets/sfx/combo2.m4a',
  'assets/sfx/combo3.m4a',
  'assets/sfx/dialog.m4a',
  'assets/sfx/enter.m4a',
  'assets/sfx/fail.m4a',
  'assets/sfx/hint.m4a',
  'assets/sfx/music.m4a',
  'assets/sfx/unx.m4a',
  'assets/sfx/win.m4a',
  'assets/sfx/wrong.m4a',
  'assets/sfx/x.m4a'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Netzwerk zuerst (damit Updates sofort ankommen), offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (new URL(e.request.url).origin === location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
