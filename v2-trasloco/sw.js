// Sostituisce il vecchio service worker della v2 su GitHub Pages: si cancella, svuota la cache
// e manda le finestre aperte al nuovo indirizzo (miogruzzolo.pages.dev).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k)
    await self.registration.unregister()
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of list) {
      const u = new URL(c.url)
      c.navigate('https://miogruzzolo.pages.dev/' + u.search + u.hash).catch(() => undefined)
    }
  })())
})
