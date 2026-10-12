/* Pocket Code SW — cache the shell, never the API; handle push notifications */
const V = 'pc-v92';
const SHELL = ['/theme.js?v=92', '/', '/release.json?v=92', '/app.css?v=92', '/app.js?v=92', '/workspace.js?v=92', '/projects.js?v=92', '/documents.js?v=92', '/tasks.js?v=92', '/vault.js?v=92', '/secret-detect.js?v=92', '/approvals.js?v=92', '/split.js?v=92', '/tips.js?v=92', '/format.js?v=92', '/voice-text.js?v=92', '/voice.js?v=92', '/voice-worklet.js?v=92', '/vendor/marked.js?v=92', '/vendor/purify.js?v=92', '/manifest.webmanifest', '/icon-192.png'];
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
  const opts = {
    body: d.body || '',
    tag: d.tag || 'pc',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', ...(d.vaultRequest ? { vaultRequest: String(d.vaultRequest) } : {}) },
  };
  // 1.41: a Vault request carries Allow and Deny, answered from the notification without opening Pocket.
  if (Array.isArray(d.actions) && d.actions.length) opts.actions = d.actions.filter(a => a && a.action && a.title).map(a => ({ action: String(a.action), title: String(a.title) }));
  e.waitUntil(self.registration.showNotification(d.title || 'Pocket Code', opts));
});
const openUrl = url => clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
  // split-view panes are window clients too; open the notification in the top-level window
  for (const c of list) if (c.frameType !== 'nested' && 'focus' in c) { c.navigate(url); return c.focus(); }
  return clients.openWindow(url);
});
// Allow answers once (never Always allow from a lock screen); Deny denies. If the answer does not land (signed out,
// expired, already answered, offline), open the Requests list instead so the owner sees what happened.
const answerVault = (request, action, url) => fetch('/api/vault/act', {
  method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'answer', request, decision: action === 'allow' ? 'once' : 'deny' }),
}).then(r => { if (!r.ok) return openUrl(url); }, () => openUrl(url));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}, url = data.url || '/';
  if ((e.action === 'allow' || e.action === 'deny') && data.vaultRequest) { e.waitUntil(answerVault(data.vaultRequest, e.action, url)); return; }
  e.waitUntil(openUrl(url));
});
