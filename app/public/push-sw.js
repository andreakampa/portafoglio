// Notifiche push (avvisi di prezzo, ecc.): caricato dal service worker della PWA (vite.config.ts → importScripts).
self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Portafoglio', body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(data.title || 'Portafoglio', {
      body: data.body || '',
      tag: data.tag,
      icon: scope + 'icon-192.png',
      badge: scope + 'icon-192.png',
      data: { url: data.url || scope },
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.navigate(url).then(w => (w || c).focus())
      return self.clients.openWindow(url)
    }),
  )
})
