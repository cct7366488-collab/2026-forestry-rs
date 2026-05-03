// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.11.5';  // v2.11.5：Phase 2 polish 第三棒 — Pl@ntNet + LLM 混合架構（抄參考系統的 LLM rich metadata，但用 PlantNet 當主辨識）。ai-species 加 enrichWithLLM(imageBlob, candidates) → 用 Anthropic Claude Messages API（claude-sonnet-4-5、anthropic-dangerous-direct-browser-access 直連 browser）+ blobToBase64 + system prompt 扮演「臺灣植物學家」要求純 JSON 回 imageQuality + per-candidate {characteristics/habitat/isNative/notes}。LLM key 三組 API getLlmKey/setLlmKey/clearLlmKey + getEffectiveLlmKey async（同 PlantNet 優先序）。setGlobalAiConfig 加 llmApiKey 欄位。ai-identify-modal admin setup 加「Anthropic Claude API key（選填）」欄位 + 取得方式 hint。主流程 PlantNet 結果 render 完背景 fire enrichWithLLM → 顯示 imageQuality 警告框（good 綠 / poor 黃 / unknown 灰）+ 每 row 下方 detail box（特徵/棲地/原生 tag/備註）。LLM key 沒設則跳過 enrich（pure PlantNet 行為）。每次 enrich 約 $0.008 成本
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
