// yapping mobile service worker: network-first, falls back to the last copy
// so the app opens (and runs its in-page world) with no connection at all.
const CACHE = 'yapping-mobile-v2'
const SHELL = ['./', './index.html', './style.css', './app.js', './art.js', '../../shared/chibi.js', './manifest.json', './icons/icon.svg', '../../shared/yap-client.js', '../../shared/sim.js']
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})) })
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).pathname.startsWith('/api')) return
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && new URL(req.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
    return res
  }).catch(() => caches.match(req, { ignoreSearch: true })))
})
