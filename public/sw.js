/* Pocket Code SW — cache the shell, never the API; handle push notifications */
const V = 'pc-v83';
const SHELL = ['/', '/release.json?v=83', '/app.css?v=83', '/app.js?v=83', '/workspace.js?v=83', '/projects.js?v=83', '/documents.js?v=83', '/tasks.js?v=83', '/approvals.js?v=83', '/split.js?v=83', '/tips.js?v=83', '/format.js?v=83', '/voice-text.js?v=83', '/voice.js?v=83', '/voice-worklet.js?v=83', '/vendor/marked.js?v=83', '/vendor/purify.js?v=83', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/share/')) return; // network only; documents are never cached
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
