// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.11.0';  // v2.11.0：Phase 2 啟動 — AI 樹種辨識（線上 Pl@ntNet API）。兩個新檔：(1) ai-species.js — Pl@ntNet API wrapper（POST /v2/identify/all + multipart images + organs；30s timeout；錯誤碼 401/403/404/429 友善訊息）、resizeImage(blob, 800px, q=0.85) 用 canvas 壓縮、matchToLocalSpecies(aiResult, allSpecies) 用 sci 完全/去 var. 對應 Firestore 224 種、API key localStorage 保存（forestmrv.plantnet.apiKey）。(2) ai-identify-modal.js — 首次無 key 顯示「請去 my.plantnet.org 註冊 free key」設定流程；主流程：file input (capture=environment) + image preview + 器官選擇 (auto/leaf/bark/flower/fruit/habit) + 「🔍 辨識」按鈕 → top-3 結果（含中文 zh + 學名 sci + 信心 % 顏色 + ✓字典中/⚠字典外 tag + ⚠保育級 tag）→ 點擊任一結果 → onPick callback 套用到 picker.setValue + dispatch input event + 自動關閉 modal。tree form openTreeForm 加「📸 AI 辨識」綠色按鈕在「樹種」label 旁邊
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
