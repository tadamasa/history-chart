// アプリ本体をキャッシュして、電波がなくても開けるようにする。AI(Gemini)や年表ハブはキャッシュしない。
// 出すたびに VERSION を上げ、ファイルを足したら SHELL にも足す。
const VERSION = 'v2';
const PREFIX = 'history-chart-';
const CACHE = `${PREFIX}${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/industry.css', 'css/app.css',
  'js/app.js', 'js/core.js', 'js/db.js', 'js/seed.js', 'js/text.js', 'js/sync.js', 'js/gemini.js', 'js/backup.js',
  'vendor/fonts/barlow-latin-400-normal.woff2', 'vendor/fonts/barlow-latin-500-normal.woff2', 'vendor/fonts/barlow-latin-600-normal.woff2',
  'vendor/fonts/barlow-condensed-latin-500-normal.woff2', 'vendor/fonts/barlow-condensed-latin-600-normal.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// 同じ github.io の別アプリのキャッシュは消さない
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// 同じオリジンのファイルは「ネット優先、だめならキャッシュ」。
// GitHub Pages はファイルを約10分ブラウザにキャッシュさせるので、no-cache で毎回サーバーに確かめる。
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
