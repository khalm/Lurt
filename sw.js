// sw.js — gjør appen installerbar og lar den åpne uten nett
const VERSION = 'lurt-2.1.0';
const CORE = ['./', 'index.html', 'style.css', 'config.js', 'app.js', 'api.js', 'verdict.js', 'scan.js', 'ai.js', 'brands.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-48.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' = hent alltid ferske filer fra serveren, ikke nettleserens hurtigbuffer
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'lurt-libs').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Prisdata: aldri fra service worker (appen har egen lagring)
  if (url.hostname.includes('kassal.app') || url.hostname.includes('workers.dev') || url.hostname.includes('googleapis.com')) return;
  // Biblioteker og språkdata fra CDN: lagre første gang (stor fil, endres ikke)
  if (/jsdelivr|fonts\.(googleapis|gstatic)/.test(url.hostname)) {
    e.respondWith(caches.open('lurt-libs').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // Egne filer: nett først (får oppdateringer), ellers lagret kopi
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
