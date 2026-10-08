// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Bump VERSION when files change so phones pick up the new release.
const VERSION = 'agendus-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/skin-2007.css',
  './css/assistant.css',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './js/app.js',
  './js/actions.js',
  './js/components.js',
  './js/editors.js',
  './js/gestures.js',
  './js/i18n.js',
  './js/icons.js',
  './js/icons-data.js',
  './js/interop.js',
  './js/query.js',
  './js/recur.js',
  './js/reminders.js',
  './js/store.js',
  './js/strings.js',
  './js/ui.js',
  './js/util.js',
  './js/views/agenda.js',
  './js/views/calendar.js',
  './js/views/contacts.js',
  './js/views/memos.js',
  './js/views/settings.js',
  './js/views/tasks.js',
  './js/ai/assistant.js',
  './js/ai/insights.js',
  './js/ai/panel.js',
  './js/ai/voice.js',
  './js/vendor/anthropic-sdk.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});

// Tapping an alarm notification brings the app to the front.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const c = list.find((x) => 'focus' in x);
      return c ? c.focus() : self.clients.openWindow('./');
    })
  );
});
