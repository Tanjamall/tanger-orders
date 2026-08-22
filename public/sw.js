const CACHE = 'tanger-orders-v5'
const ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))))
})

self.addEventListener('push', (event) => {
  let payload = { title: 'New order added', body: 'A new order is ready to view.', orderId: null }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    if (event.data) payload.body = event.data.text()
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.orderId ? `${payload.event || 'created'}-order-${payload.orderId}` : 'order-update',
    renotify: true,
    data: { url: payload.orderId ? `/?orderId=${encodeURIComponent(payload.orderId)}` : '/', orderId: payload.orderId },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const app = clients.find((client) => new URL(client.url).origin === self.location.origin)
    if (app) {
      await app.navigate(targetUrl)
      return app.focus()
    }
    return self.clients.openWindow(targetUrl)
  }))
})
