// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.7.18';  // v2.7.18：QAQC 4 衍生小機會（progress pill / 種子 banner + 重現抽樣 / .doc 查證說明書 / 5 步教學導覽精靈）
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/forms.js',
  './js/analytics.js',
  './js/species-equations.js',
  './js/species-dict.js',     // v2.0：物種字典（樹種/動物/草本/入侵）
  './js/code-tables.js',
  './js/project-status.js',   // v2.3：階段 2 狀態機
  './js/import-wizard.js',    // v2.5：Excel 匯入 wizard（雛形 / DRY-RUN）
  './js/distribution.js',     // v2.6.2：立木分布散布圖（Canvas）
  './js/species-admin.js',    // v2.7.10：admin 樹種字典管理 UI
  './js/plot-geometry.js',    // v2.7.15：樣區幾何 + 坡度修正 utility
  './js/plot-qaqc.js',        // v2.7.17：reviewer QAQC（抽樣 / 誤差 / 閾值）utility
  './firebase-config.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 不攔截 Firebase / Google API（它們自己處理離線）
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firestore.googleapis.com')) {
    return;
  }
  // App shell：cache first，再背景更新
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
