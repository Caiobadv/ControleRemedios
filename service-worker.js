const CACHE_NAME = 'remedios-v2';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

// ── IndexedDB helpers ────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('remedios-db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('medications'))
        db.createObjectStore('medications', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror  = e => reject(e.target.error);
  });
}

function getMeds(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('medications', 'readonly').objectStore('medications').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function checkAndNotify() {
  try {
    const db   = await openDB();
    const meds = await getMeds(db);
    const now  = new Date();

    for (const m of meds) {
      if (!m.nextDue) continue;
      const diff = now - new Date(m.nextDue);
      // Overdue within the last 20 minutes (covers periodic sync interval)
      if (diff >= 0 && diff < 20 * 60 * 1000) {
        await self.registration.showNotification('Hora do remédio 💊', {
          body: `${m.name} — ${m.dosage}`,
          icon:  '/icon-192.svg',
          badge: '/icon-192.svg',
          tag:   `med-${m.id}`,
          requireInteraction: true,
          vibrate: [200, 100, 200, 100, 200],
          data: { url: '/' },
        });
      }
    }
  } catch (_) {}
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(res => {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});

// ── Periodic Background Sync ─────────────────────────────────────────────────
// Works on installed PWA in Chrome/Android — checks meds from IndexedDB
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-medications') {
    event.waitUntil(checkAndNotify());
  }
});

// ── Push (future server integration) ────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Lembrete 💊', body: 'Hora do seu medicamento.' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/icon-192.svg',
      badge: '/icon-192.svg',
      requireInteraction: true,
      vibrate: [200, 100, 200],
    })
  );
});

// ── Notification click → open app ────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
