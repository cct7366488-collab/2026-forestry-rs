// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.9.3';  // v2.9.3：手機 PWA 友善「新版可用」橫幅 — install 拿掉 self.skipWaiting（改 client 觸發），加 message handler 收 SKIP_WAITING；app.js 加 updatefound 監聽 → showUpdateBanner（topbar 下藍色橫幅 + 「立即套用」按鈕）→ postMessage SKIP_WAITING → controllerchange → location.reload。長期 PWA session 每 30 min reg.update() 主動戳一次。手機不用記「下拉重整 2 次」，且 user 控制更新時機（避免表單填一半被打斷）
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
  // v2.9.3：拿掉 self.skipWaiting() — 改由 client 收到「新版可用」橫幅後 user click 觸發 SKIP_WAITING
  // 動機：手機 PWA 沒 pull-to-refresh，cache-first SW 導致使用者要 reload 兩次才看到新版。改成 user 控制
  // 何時 activate，避免在表單填一半時被靜默更新打斷。
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// v2.9.3：收到 client 的 SKIP_WAITING → 立即從 waiting 切換到 active，觸發 controllerchange
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
