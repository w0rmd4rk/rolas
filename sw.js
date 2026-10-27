const CACHE = 'rolas-v3';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting() });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // YouTube y APIs van directo a la red
  if (e.request.method !== 'GET') return;      // HEAD (revisar si hay versión nueva) va directo y no se guarda
  // no-cache: siempre se revalida con el servidor en vez de usar la caché HTTP de GitHub Pages (~10 min).
  // Sin internet se usa la copia guardada.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)) }
    return r;
  }).catch(() => caches.match(e.request)));
});
