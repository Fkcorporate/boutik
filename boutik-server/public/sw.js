// Boutik — fonctionne hors connexion : réseau d'abord, sinon la copie enregistrée
const C = 'boutik-v13';
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(['/app/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  const keep = u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net' || u.hostname.endsWith('gstatic.com') || u.hostname === 'fonts.googleapis.com';
  if (!keep) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('/app/'))));
});

// Notifications envoyées par le serveur Boutik
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (x) { m = { title: 'Boutik', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Boutik', { body: m.body || '', tag: m.tag || undefined, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: m.url || '/app/#alertes' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/app/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { const w = ws.find(x => x.url.includes('/app')); if (w) { w.focus(); return w.navigate ? w.navigate(url) : null; } return clients.openWindow(url); }));
});
