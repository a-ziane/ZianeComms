/* Demo offline shells + immutable application assets only. Never cache API responses or protected documents. */
const CACHE = 'ziane-shell-product-v3';
const SHELLS = ['/help', '/offline'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of SHELLS) {
      const response = await fetch(path, { credentials: 'omit', cache: 'reload' });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw Error('Offline shell unavailable');
      const html = await response.clone().text();
      const assets = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
      await cache.put(path, response);
      await Promise.all([...new Set(assets)].map(async asset => {
        const url = new URL(asset, self.location.origin);
        if (url.origin !== self.location.origin) return;
        const result = await fetch(url.href, { credentials: 'omit' });
        if (!result.ok) throw Error('Offline asset unavailable');
        await cache.put(url.href, result);
      }));
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('ziane-shell-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), cached = await cache.match(event.request);
      if (cached) return cached;
      const result = await fetch(event.request);
      if (result.ok) await cache.put(event.request, result.clone());
      return result;
    })());
  } else if (event.request.mode === 'navigate' && ['/', ...SHELLS].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (SHELLS.includes(url.pathname) && response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(CACHE); await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE);
        return await cache.match(url.pathname === '/help' ? '/help' : '/offline') || new Response('Offline interface not cached. Reconnect and load it once.', { status: 503 });
      }
    })());
  }
});
