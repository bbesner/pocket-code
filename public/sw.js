/* Pocket Code SW — cache the shell, never the API; handle push notifications */
const V = 'pc-v237';
const SHELL = ['/theme.js?v=237', '/', '/release.json?v=237', '/app.css?v=237', '/app.js?v=237', '/cli-updates.js?v=237', '/workspace.js?v=237', '/sidechat.js?v=237', '/projects.js?v=237', '/documents.js?v=237', '/links.js?v=237', '/listtools.js?v=237', '/tasks.js?v=237', '/coordination.js?v=237', '/inbox.js?v=237', '/vault.js?v=237', '/secret-detect.js?v=237', '/phrases.js?v=237', '/approvals.js?v=237', '/automation.js?v=237', '/checkbacks.js?v=237', '/jobs.js?v=237', '/split.js?v=237', '/tips.js?v=237', '/format.js?v=237', '/voice-text.js?v=237', '/voice.js?v=237', '/voice-worklet.js?v=237', '/vendor/marked.js?v=237', '/vendor/purify.js?v=237', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/share/') || url.pathname.startsWith('/intake/')) return; // network only; documents and intake pages (1.110) are never cached
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

// 1.126: { session, request, shown } of an action approval's push, or null.
const approvalOf = d => d && d.approval && typeof d.approval === 'object' && typeof d.approval.session === 'string' && d.approval.session
  && typeof d.approval.request === 'string' && d.approval.request && typeof d.approval.shown === 'string'
  ? { session: d.approval.session, request: d.approval.request, shown: d.approval.shown } : null;
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { }
  const opts = {
    body: d.body || '',
    tag: d.tag || 'pc',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', ...(d.vaultRequest ? { vaultRequest: String(d.vaultRequest) } : {}), ...(d.docRequest ? { docRequest: String(d.docRequest) } : {}), ...(d.snooze && typeof d.snooze === 'object' ? { snooze: d.snooze } : {}),
      // 1.126: an action approval names its own conversation, request and the hash of what the server built for this device
      ...(approvalOf(d) && d.silent !== true ? { approval: approvalOf(d) } : {}), ...(d.approvalTest === true ? { approvalTest: true } : {}) },
  };
  // 1.41: a Vault request carries Allow and Deny, answered from the notification without opening Pocket.
  // 1.50: a due task or reminder carries Tomorrow (and Done for a task), answered the same way.
  if (Array.isArray(d.actions) && d.actions.length) opts.actions = d.actions.filter(a => a && a.action && a.title).map(a => ({ action: String(a.action), title: String(a.title) }));
  // 1.126: a replacement (the request was answered or withdrawn) shows silently, with no buttons
  if (d.silent === true) { opts.silent = true; delete opts.actions; }
  // 1.50: the count of due items on the app icon, when this device asked for it (the server sends it only then).
  // 1.50.2: set after the notification is shown and guarded, so a browser that refuses the badge never costs the notification.
  const setBadge = () => { if (typeof d.badge !== 'number' || !('setAppBadge' in self.navigator)) return; try { const p = d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge(); return p && p.catch(() => {}); } catch { } };
  e.waitUntil(self.registration.showNotification(d.title || 'Pocket Code', opts).then(setBadge, setBadge));
});
// 1.89: a notification opens only a page on Pocket's own origin; any other link (//host, /\host, a full outside address)
// opens Pocket's start page instead, whichever server code sent the push.
const ownPage = url => { try { const u = new URL(url, self.location.origin); return u.origin === self.location.origin ? u.href : '/'; } catch { return '/'; } };
const openUrl = url => clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
  url = ownPage(url);
  // split-view panes are window clients too; open the notification in the top-level window
  for (const c of list) if (c.frameType !== 'nested' && 'focus' in c) { c.navigate(url); return c.focus(); }
  return clients.openWindow(url);
});
// Allow answers once (never Always allow from a lock screen); Deny denies. If the answer does not land, Pocket opens at
// that request and says why (1.93, colleague request): signed out, the Vault locked, already answered or expired, or offline.
const missedWhy = status => status === 401 || status === 403 ? 'signin' : status === 423 ? 'locked' : status === 404 || status === 409 ? 'gone' : 'error';
const answerVault = (request, action, url) => {
  const missed = why => openUrl('/#/vault/request/' + encodeURIComponent(request) + '?missed=' + why + '&tap=' + (action === 'allow' ? 'allow' : 'deny'));
  return fetch('/api/vault/act', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'answer', request, decision: action === 'allow' ? 'once' : 'deny' }),
  }).then(r => { if (!r.ok) return missed(missedWhy(r.status)); }, () => missed('offline'));
};
// 1.118 (PC-04): an agent's share or publish of a file is answered the same way; if the answer does not land (signed out,
// already answered, expired, the file changed, offline), Files opens with the request card.
const answerDoc = (request, action) => fetch('/api/documents/requests/' + encodeURIComponent(request) + '/answer', {
  method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ decision: action === 'allow' ? 'allow' : 'deny' }),
}).then(r => { if (!r.ok) return openUrl('/#/documents'); }, () => openUrl('/#/documents'));
// 1.50: Tomorrow moves a due task or project reminder to 9 AM tomorrow in this device's zone; Done finishes a task.
// Both go through the ordinary routes with the signed-in cookie; if the answer does not land, Pocket opens instead.
const tomorrowNine = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const post = (path, body) => fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const answerDue = (snooze, action, url) => {
  const req = snooze.task && !snooze.project
    ? post('/api/tasks/act', action === 'done' ? { action: 'update', task: snooze.task, done: true } : { action: 'update', task: snooze.task, dueAt: tomorrowNine() })
    : post('/api/board/act', { action: 'remind', project: snooze.project, at: tomorrowNine(), task: snooze.task || undefined, text: snooze.label || '' });
  return req.then(r => { if (!r.ok) return openUrl(url); }, () => openUrl(url));
};
// 1.126 (notification-approvals.md, Part 3): Allow or Don't allow on an action approval posts to the request the
// notification itself names, with its `shown` and this device's own subscription endpoint, and never follows a redirect
// (an Access login is a sign-in problem, not success). It never looks up which request is waiting. If the answer does not
// land, a new notification says so (on a locked phone the page waits for the unlock, and a closed notification would look
// like success) and Pocket opens at the request with ?missed=<why>&tap=allow|deny.
const SAFE_ID = /^[A-Za-z0-9:._-]{1,200}$/;
const APPROVAL_MISSED = {
  signin: 'this device was signed out of Pocket', refused: 'Pocket refused the answer from this address', off: 'answering from notifications is turned off',
  gone: 'it was no longer waiting', answered: 'it was answered in Pocket',
  changed: "it didn't match what the notification showed, or a setting changed", old: 'the notification was too old',
  uncertain: 'delivery is uncertain, so stop the reply and review it; do not approve it again', offline: 'this device was offline', error: "Pocket couldn't take it",
};
const approvalMissedWhy = async r => {
  if (r.type === 'opaqueredirect' || r.status === 0 || (r.status >= 300 && r.status < 400) || r.status === 401) return 'signin';
  // 403: Pocket's same-origin check refused it (the address the answer came from is not the one Pocket expects, as behind
  // a proxy that doesn't pass the public Host on). Signing in again would not help, so the line doesn't say signed out.
  if (r.status === 403) return 'refused';
  if (r.status === 404) return 'off';
  if (r.status === 503) return 'uncertain';
  if (r.status === 409) { let code = ''; try { code = (await r.json()).code || ''; } catch { } return code === 'too_old' ? 'old' : code === 'changed' || code === 'not_offered' ? 'changed' : code === 'answered_in_app' ? 'answered' : 'gone'; }
  return 'error';
};
const ownEndpoint = () => Promise.resolve().then(() => self.registration.pushManager.getSubscription()).then(s => (s && s.endpoint) || null, () => null);
const answerApproval = (a, action) => {
  const tap = action === 'allow' ? 'allow' : 'deny';
  if (!SAFE_ID.test(a.session) || !SAFE_ID.test(a.request)) return openUrl('/');
  const page = '/#/chat/' + a.session + '?approval=' + encodeURIComponent(a.request);
  const missed = why => Promise.all([
    self.registration.showNotification('Pocket Code', { body: `Your ${tap === 'allow' ? 'Allow' : "Don't allow"} didn't go through: ${APPROVAL_MISSED[why] || APPROVAL_MISSED.error}. Open Pocket.`,
      tag: 'approval-missed:' + a.request, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: page + '&missed=' + why + '&tap=' + tap } }).catch(() => {}),
    openUrl(page + '&missed=' + why + '&tap=' + tap),
  ]);
  return ownEndpoint().then(endpoint => fetch('/api/session/' + encodeURIComponent(a.session) + '/approvals/' + encodeURIComponent(a.request) + '/decision', {
    method: 'POST', credentials: 'same-origin', redirect: 'manual', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: tap, via: 'notification', shown: a.shown, endpoint }),
  })).then(r => r.ok && r.type !== 'opaqueredirect' ? undefined : approvalMissedWhy(r).then(missed), () => missed('offline'));
};
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}, url = data.url || '/';
  // 1.126: the device test's buttons only open Settings; nothing is posted
  if (data.approvalTest) { e.waitUntil(openUrl(url)); return; }
  if ((e.action === 'allow' || e.action === 'deny') && data.approval && typeof data.approval === 'object') { e.waitUntil(answerApproval(data.approval, e.action)); return; }
  if ((e.action === 'allow' || e.action === 'deny') && data.vaultRequest) { e.waitUntil(answerVault(data.vaultRequest, e.action, url)); return; }
  if ((e.action === 'allow' || e.action === 'deny') && data.docRequest) { e.waitUntil(answerDoc(data.docRequest, e.action)); return; }
  if ((e.action === 'later' || e.action === 'done') && data.snooze) { e.waitUntil(answerDue(data.snooze, e.action, url)); return; }
  e.waitUntil(openUrl(url));
});
