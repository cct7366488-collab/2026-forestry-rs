// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.8.5';  // v2.8.5：方形樣區也走雙軸坡度（mirror rectangle）— 寬/長 inputs auto-fill 自 √(area)/cos；submit/distribution 把 square 與 rectangle 同路徑處理；修 v2.8.4 bug（圓/不規則公式顯示單 cos 但計算曾誤套雙 cos）— 圓/不規則改回單 cos 與顯示一致
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
  './js/plot-polygon.js',     // v2.8.0：irregular plot 多邊形 utility（Shoelace / point-in-polygon / GeoJSON）
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
