// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.10.9';  // v2.10.9：Phase 1 Step 3（完整收尾）— DEM 海拔自動偵測。新檔 dem-elevation.js 用 open-meteo 免費 API（無 key、~90m SRTM 解析度）：getElevation(lat,lng) async fetch 含 10s timeout + module Map 快取（4 位小數座標 key ~10m 精度）+ Taiwan sanity check (-50~4500m) + 失敗 cache null 避重打。elevationToBand 與 picker ELEV_BANDS 切分一致。species-picker setBand 加 {auto:true} 旗標 + _userTouched 紀錄 user 是否手動點過 pill（auto 不覆蓋手動選擇、auto 不寫 localStorage 避污染全域偏好）。openTreeForm 流程：plot.elevation_m 已存 → initialBand 直接傳 picker；不存且有 GPS → 背景 fetch + toast 「📍 DEM 偵測 plot 海拔 1234m → 中海拔」+ setBand({auto:true}) + writeback Firestore（PI/admin 才寫 elevation_m / elevationSource='open-meteo' / elevationFetchedAt）下次開省 fetch
// v2.10.2：SHELL 拿掉所有 ./js/*.js（保留 HTML / CSS / manifest）
//   原因：之前 SHELL 預快取 ./js/app.js（無 qs），同時 index.html 用 ./js/app.js?v=NNNNN，
//   兩個 URL 在 ESM 看是不同 module → app.js 被載入兩個實例。第一個 [projects query] 印兩遍、
//   initializeFirestore() 第二次 throw、preview UI 的 el() 跑到舊版。
//   改成 .js 全靠 fetch handler 動態快取（cache-first by URL）+ index.html 帶 ?v=NNNNN cache bust。
//   離線冷啟動：第一次 online 訪問會 cache 所有用到的 ?v= JS，之後 offline 仍可用。
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
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
