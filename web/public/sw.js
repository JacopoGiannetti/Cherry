// Cherry: l'app si apre anche offline (al supermercato la rete va e viene).
// Le pagine: rete prima, cache se manca. Gli asset con hash: cache prima.
// v2: la v1 poteva aver salvato una pagina HTML al posto di un file degli asset (durante una pubblicazione) e servirla per sempre.
const CACHE = 'cherry-v2';
const SHELL = ['/app/', '/manifest.webmanifest', '/assets/mascot.png', '/assets/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/app/', copy));
      return res;
    }).catch(() => caches.match('/app/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Si tiene solo un file vero: mai una pagina HTML (quella che arriva se il file non c'è ancora).
    const real = (res) => res && res.ok && !(res.headers.get('content-type') || '').includes('text/html');
    e.respondWith(caches.match(req).then((hit) => (real(hit) ? hit : fetch(req, { cache: 'reload' }).then((res) => {
      if (real(res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))));
  }
});
