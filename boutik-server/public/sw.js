// Boutik — fonctionne hors connexion : réseau d'abord, sinon la copie enregistrée
const C = 'boutik-v9';
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
