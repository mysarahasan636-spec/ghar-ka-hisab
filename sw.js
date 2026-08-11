/* گھر کا حساب — Service Worker
   مقصد: صرف ایپ کا خول (Shell) آف لائن کیش کرنا تاکہ ایپ فوراً کھلے۔
   خرچ کا ڈیٹا ہمیشہ Supabase (انٹرنیٹ) سے تازہ لایا جاتا ہے — یہ کبھی کیش نہیں ہوتا۔ */

const CACHE_NAME = 'ghar-ka-hisab-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase یا کسی اور API کال کو کبھی کیش نہ کریں — ہمیشہ نیٹ ورک سے لیں
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
