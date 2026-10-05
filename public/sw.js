/* Pocket Code SW — cache the shell, never the API; handle push notifications */
const V = 'pc-v38';
const SHELL = ['/', '/release.json?v=40', '/app.css?v=40', '/app.js?v=40', '/workspace.js?v=40', '/approvals.js?v=40', '/split.js?v=40', '/tips.js?v=40', '/format.js?v=40', '/voice-text.js?v=40', '/voice.js?v=40', '/voice-worklet.js?v=40', '/vendor/marked.js?v=40', '/vendor/purify.js?v=40', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // network only
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && e.request.method === 'GET') {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) // split-view panes load /?pane=1
  );
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { }
  e.waitUntil(self.registration.showNotification(d.title || 'Pocket Code', {
    body: d.body || '',
    tag: d.tag || 'pc',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // split-view panes are window clients too; open the notification in the top-level window
    for (const c of list) if (c.frameType !== 'nested' && 'focus' in c) { c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
