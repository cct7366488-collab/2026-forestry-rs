// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

const CACHE = 'forest-monitor-v2.11.30';  // v2.11.30：離線野外調查強化（路 J 起手）— Auth ID token 上線即 force refresh（window.online listener 主動跟 Google 換新 token，避免野外 3-6 hr 離線回駐地 SDK 內部 race 把 stale token 帶進 sync queue）+ 設定頁加「🔑 登入狀態」區塊（顯示登入有效至 / 剩餘分鐘、剩 <30 min 黃 / <15 min 紅 + 「🔄 立即重新整理登入」按鈕讓 PI 在出工前一刻把 token 計時器歸零、延長下個離線 window 1 hr）。state 加 tokenExpiresAt 欄位、onAuthStateChanged 內 getIdTokenResult 後寫入。研究結論：Firebase Auth refresh token free tier 永久有效、ID token 1 hr SDK 自動 refresh（要網路），Firestore offline persistence 用 cached auth 不重驗 token → 3-6 hr 離線寫入仍排 queue、上線 sync 時自動補。本版 patch 是防禦性 + UX 透明化、不必改 Firebase Console。SW cache v2.11.29 -> v2.11.30，?v=21129 -> ?v=21130 全 14 檔。後續路 J-1 GPS 模式手動 fallback / J-4 SW 預快取 JS / J-5 出工 pre-flight 全項待續。
// v2.11.29：plot detail 樣區地圖（Commit 2 of GPS-mode 2-commit plan）— 新分頁「🗺️ 樣區地圖」（插在「🌳 立木調查」與「📍 立木分布」之間），Leaflet 畫樣區邊界 polygon（rectangle/square/circle/irregular 都支援，含雙軸坡度 cos 校正 + slopeAspect 旋轉）+ 所有立木 DivIcon marker。Marker 顏色按 QA 狀態（綠已審 / 黃待審 / 紅退回），實心=GPS、空心=皮尺、精度>10m 虛線邊。Tooltip 顯示 treeCode / 樹種 / DBH / 來源 / 精度。「✏️ 編輯位置」toggle (canCollect 角色可見) → 所有 marker 可拖移 → 批次「💾 儲存 N 個變動」/「✕ 取消」，拖完一律轉 positionSource='gps' + manuallyAdjusted=true（✋ badge 亮）。新檔 tree-map.js + plot-geometry.computePlotCorners() / treeToWgs84() helpers。SW cache v2.11.28 -> v2.11.29，?v=21128 -> ?v=21130 全 13 檔。
// v2.11.28：立木 GPS 直接定位（樣區級雙模式）— workshop 痛點「公園 / 大面積普查皮尺拉不動」修。新增 plot.positionMode（offset / gps / mixed，預設 offset 向後相容）+ tree.positionSource / gpsAccuracy_m / fixedAt / manuallyAdjusted 4 欄位。Tree form 依 plot.positionMode 動態切換：offset → 原 X/Y 皮尺；gps → 新 emerald「📍 抓取目前位置」按鈕 + 精度顯示（>10m 黃 warning / >25m 紅 warning）+ 反算 localX/Y；mixed → 紫框 radio 每棵切換。雙軌存 lat/lon GeoPoint + locationTWD97。立木列表加 📐/📍/✋ badge 與精度 tooltip（✋ 為 Commit 2 地圖長壓微調預留）。SW cache forest-monitor-v2.11.27 -> v2.11.28，?v=21127 -> ?v=21128 全 13 檔。
// v2.11.27：成員管理三件套 — (A) PI 可自助加成員修（rules /users read 開放給所有登入者，舊版只 admin 可 query → PI 加成員 query email 整批被擋誤導為「目前的角色無法變更成員」；同步修好設定分頁成員清單只顯示 uid 不顯示姓名的 silent fail）；(B) 設定分頁成員列加「✕ 移除」按鈕（admin 可移除任何人含其他 PI；PI 可移除 surveyor/reviewer；都不可移除自己、PI 不可移除其他 PI 避免互踢無主）；(C) 移除只刪 members map / memberUids 陣列，被踢出者的子集合資料（plots/trees/regen/...）保留，同 email 加回即恢復權限。?v=21126 -> ?v=21127 全 13 檔。
// v2.11.26：新立木表單「📸 AI 辨識」按鈕修 — 3 連雷：(1) ai-identify-modal wrap z-50 < #modal z-[2000] → AI modal 被新立木 modal 蓋住看不到，user 重複按累積多個 bg-black/50 → 螢幕慢慢變暗；改 z-[2050]。(2) 沒 dedup → 重複點累積多個 wrap；加 [data-ai-identify-modal] querySelector 守門。(3) species-picker input listener 不分 e.isTrusted → forms.js onPick 後 dispatchEvent('input') 也誤開 dropdown panel，全螢幕物種清單蓋住表單，user 看似「跳到字典畫面」；改 synthetic event 只 refresh _filtered 不 openPanel。?v=21125 -> ?v=21126 全 13 檔。
// v2.11.25：地圖 auto-zoom 從 6-7s 縮到 ~300ms — Phase 1 只 fetch plots → 立即 fitBounds，Phase 2 背景 parallel fetch 子集合。
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
