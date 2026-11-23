// Guarda a casca do app para abrir rápido e continuar abrindo se a internet cair.
// Os dados das encomendas sempre vêm do banco (nunca ficam em cache).
const CACHE = 'portaria-shell-v2';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/db.js', 'js/config.js', 'manifest.json', 'icons/icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // rede primeiro (pega atualizações do app), cache se estiver sem internet
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
