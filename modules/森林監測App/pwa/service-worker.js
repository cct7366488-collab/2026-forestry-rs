// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.11.25';  // v2.11.25：地圖 auto-zoom 從 6-7s 縮到 ~300ms — root cause：fetchAllData 跑 19 plots × 6 子集合 = 115 個 SERIAL Firestore queries 才 fitBounds。改兩段式 fetch：Phase 1 只 fetch plots（1 個 query）→ 立即 fitBounds + skeleton markers；Phase 2 背景 parallel fetch 所有子集合（~6 round-trips）→ 完成後重畫 markers 帶完整 stems/ha BA/ha。地圖角落加 loading indicator「⏳ 載入樣區位置… → 載入立木統計…」讓 user 看得到 progress。?v=21124 -> ?v=21125 全 13 檔。
// v2.11.24：Firestore array-of-array 限制修 — boundaryGeoJson 改用 stringify 存 boundaryGeoJsonStr 字串。
// v2.11.23：地圖分頁 modal z-index 修 + 按鈕 click feedback。
// v2.11.22：地圖分頁加「✏️ 編輯專案 / 上傳邊界 GeoJSON」按鈕入口 — 補 v2.11.19 邊界上傳 UI 從沒入口可進的問題。(本版發現 modal 被 Leaflet 蓋住的 z-index bug → v2.11.23 修)
// v2.11.21：auto-zoom 改 double-RAF + radius 5→3 + popup helper 掛 polygon 與 marker。(已被 v2.11.22 補 entry button)
// v2.11.20：v2.11.19 地圖 follow-up 修 — auto-zoom + marker 縮小 + SW 角錨點 + 坡向 D1 復活 + D2 N-S 註記。(已被 v2.11.21 三項 user 實測修正再補強)
// v2.11.19：地圖大改 — 新增 plot 邊界 + 專案邊界 GeoJSON 上傳/疊加圖層。(已被 v2.11.20 的 4 個 user 實測修正補強)
// v2.11.17：F1 字典外候選 auto-suggest 補洞 + G iNat 速率守門 — (F1) ai-identify-modal onPick 寫入 species/{zh}（verified=false + addedFrom: ai-identify-iNat|LLM + addedBy=uid + sci/zh/family）；只在 admin/PI 觸發；session-level dedup；已存在則 skip 不覆寫；admin 在「⏳ 待補充」filter 1-鍵 verify。(G) lookupChineseName 加 module-level 串行佇列 ≥ 600ms 間距 + 429 exponential backoff retry。Firestore rules /species/{docId} create 放寬：admin 全權 OR 非 admin 限 verified=false + addedFrom in ai-identify-* + addedBy=自己 + zh/sci 非空字串；update/delete 仍 admin only。?v=21116 -> ?v=21117 全 13 檔。
// v2.11.16：A+B 中文名功能重 ship — 重新套用 v2.11.14 的 ai-identify-modal.js 改動（字典外候選 iNat zh-TW + LLM chineseName fallback、rowStates 動態更新標題、updateZhName 守門只升不降、來源徽章 字典/iNat/LLM/英文）。v2.11.15 root cause 確認：worktree 缺 firebase-config.js（gitignored）→ Firebase Hosting 回 SPA fallback (text/html) → 瀏覽器嚴格 MIME 拒當 ESM → app.js 整個 module graph 崩 = 主畫面空白。本版 deploy 前已確認 worktree 內 firebase-config.js 在位（25 files）。?v=21115 -> ?v=21116 全 13 檔。
// v2.11.15：HOTFIX rollback — 因 worktree 缺 firebase-config.js 導致 v2.11.14 主畫面空白；本版 rollback ai-identify-modal.js + 補回 firebase-config.js + 25 files 部署，prod 復工。
// v2.11.14：（已被 v2.11.15 rollback；A+B 重 ship 於 v2.11.16）AI 樹種辨識中文名功能首版 — root cause 不在程式碼而在 deploy SOP（worktree gitignored 檔遺漏）。
// v2.11.13：GPS 量測位置 SVG 文字重疊修正 — 貳區「面積=1500m²」label 與底部 italic 撞行；panel 高度 200->230、底部 italic 從 y=180 下移到 y=210；連帶下移 section 參(560->590)、肆(1000->1030)、總高度 1320->1350、PNG 重渲。?v=21112 -> ?v=21113 全 12 檔。
// v2.11.11：plot 表單錯誤訊息系統升級 — 四項變更：(A) form novalidate + 集中式 JS 驗證 + 頂部 inline messages panel；(B) 上傳 GeoJSON 後 GPS 變動自動平移多邊形；(C) 重心離 GPS 中心 > 200 m 警告；(D) 折疊式 GPS 量測位置 UI 說明。
// v2.11.10：修復 irregular（不規則多邊形）樣區無法儲存 — 隱藏的 slopeLengthDeg input 仍帶 required 屬性導致 HTML5 native validation 卡住 submit（Console: "An invalid form control with name='slopeLengthDeg' is not focusable."）。recompute() 改為依 isDualSlopeShape 同步切換 .required，circle/irregular 形狀下 release。純前端 form bugfix、無 schema / rules / API 變動。
// v2.11.9：執行/委託單位下拉清單微調（code-tables.js AGENCY_CODES）— 大學群刪 NDHU 東華、加 NIU 宜蘭；其他群加 TPFTA 臺北市林業技師公會（排在 PRIV/OTHER 之上）。純資料表變更、無 schema / rules / API 變動。
// v2.11.8：admin 後門 — review+auto-Lock 強制退回作業中（解鎖）。新增 applyStatusForceUnlockReview() (project-status.js) + 設定頁 admin amber 按鈕 + 修 line 2173 stale 提示文字。
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
