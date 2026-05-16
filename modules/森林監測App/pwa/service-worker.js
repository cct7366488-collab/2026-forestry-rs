// Service Worker — App Shell 快取（離線可開）
// 注意：Firestore 自己有 offline persistence，這裡只快取 App 殼。

// v2.11.34：土肉桂採收許可全鏈路完成（5/20 stakeholder 說明會 demo-complete）—
//   (1) 核准時 Firestore runTransaction 原子遞增 counters/harvestPermit → 生法定許可文號（不可重號）
//   (2) 收穫量登錄 harvestPermits/{id}/logs 子集合 + 累計 vs 核准量 + 超量黃/紅警示
//   (3) 狀態機延伸 approved→harvesting→completed（首筆收穫推進 / 結案）
//   (4) 採收許可單／收穫總結視覺化 + window.open 列印（雙方檢視）
//   rules：clause B 加 permitNo/permitSeq、新 clause C（採收期申請人受限寫）、logs 子集合、counters。
//   SW cache v2.11.33 -> v2.11.34，?v=21133 -> ?v=21134 全檔（SHELL 已含 harvest-permits.js）。
// v2.11.35：🚨 HOTFIX — 修白畫面/無法登入。harvest-permits.js 在模組頂層 `const {db,...}=fb`，
//   而 app.js ⇄ harvest-permits.js 為循環 import：模組求值時 app.js body 尚未執行、export const fb
//   仍在 TDZ → 該行 throw → 整個 ESM module graph 崩 → 主畫面空白、無法登入。此雷 v2.11.33 起埋下，
//   v2.11.34 首次實機載入才暴露。修法：移除頂層 destructure，改 lazy bind（bindFb() 於各進入點呼叫，
//   與 forms.js 一律 fb.x 同理）。SW cache v2.11.34 -> v2.11.35，?v=21134 -> ?v=21135 全檔。
// v2.11.36：申請端「申請公文函稿」— 林農草稿/送出後可印標準公文「函」格式（受文者=林保署臺中分署、
//   主旨/說明/申請明細表/具名用印欄/分署收文欄），window.open + 列印/另存 PDF（與許可單同機制）。
//   電子＋紙本雙軌：公文稿即時由線上記錄產生，非另存副本 → 不漂移。SW cache v2.11.35 -> v2.11.36，
//   ?v=21135 -> ?v=21136 全檔。
// v2.11.37：新增第三方角色「林業合作社（coop）」唯讀彙整分頁 — 掌握各林農申請（已送出起，排除草稿）
//   + 依林農/狀態/用途收穫彙整供共同銷售；唯讀靠 rules 結構天然保證（coop 非 canCollect/非審核者/非
//   owner，0 rules 變更）。SW cache v2.11.36 -> v2.11.37，?v=21136 -> ?v=21137 全檔。
// v2.11.36（歷史）：申請端公文「函」稿（列印/另存 PDF），電子＋紙本雙軌即時同產。
// v2.11.35（歷史）：HOTFIX — harvest-permits.js 頂層 destructure fb 循環 import TDZ → 白畫面；改 lazy bindFb()。
// v2.11.34（歷史）：土肉桂採收許可全鏈路（文號 transaction / 收穫登錄 / 許可單列印 / 結案）。
// v2.11.33（歷史）：收穫採取許可 P1 vertical slice — 新增 harvestPermits 子集合 + 角色 harvest_authority。
// v2.11.38：🚨 修 iOS PWA 卡死死鎖（5/20 demo 風險）。事故：iPhone 安裝版卡 v2.11.34、無更新橫幅、
//   重整無效、白畫面。根因鏈：(1) fetch 為 cache-first → 開 app 吐快取舊殼 + 預快取 ?v=21134 整串 JS；
//   (2) 該串正是 v2.11.35 修掉的循環 import TDZ 白畫面版；(3) install 不 skipWaiting，新 SW 只能等
//   橫幅點擊；(4) 橫幅 + SW 註冊 + controllerchange→reload 全在 app.js（ESM graph），module 一崩就全
//   不執行 → 無逃生口。三管齊下：(A) install 加 self.skipWaiting() 讓修好的 SW 立即接管；(B) 導航
//   請求改 network-first（線上一定拿最新殼 → 最新 ?v= JS），離線才退快取（野外離線仍可開）；
//   (C) index.html 加 module graph 外的 inline SW 引導（崩了也會跑、自動 reload）。
//   僅 SW 內容變更即觸發全裝置 SW 更新生命週期，CACHE 改名讓 activate 清掉中毒舊快取。
// v2.11.39：採收回報及結案全鏈路 — 新「🌾 採收回報及結案」分頁（renderHarvestReport）；
//   G1 結案閘門 client + firestore.rules 雙擋零回報結案；G2 未回報紅幅明示「一定要回報」；
//   G3 合作社彙整並列「申請量 / 已回報 / 達成率」。本版 harvest-permits.js / app.js /
//   index.html 內容已改 → 依規則 A 全檔 ?v= lockstep 21137 -> 21139（js/*.js + index.html）
//   + JS_VERSION 21137 -> 21139，避免 v2.10.2 ESM 雙實例雷。併入上述 v2.11.38 iOS 死鎖修
//   一次乾淨部署。
// v2.11.40：I-2 永久樣區複查期別管理 vertical slice — plot.periods[] + currentPeriod 期別模型
//   + plot detail「📅 開啟新一期複查」banner 入口；firestore.rules 加 admin/pi 鎖定後門
//   （diff 僅 periods/currentPeriod/updatedAt）補核心缺口「verified 後無回頭路」。純加欄位、
//   零強制 migration、不動 tree schema。本版 forms.js / app.js / index.html / firestore.rules
//   內容已改 → 依規則 A 全檔 ?v= lockstep 21139 -> 21140 + JS_VERSION 21139 -> 21140。
// v2.11.41：I-1 永久樣區複查地基 — 立木逐期歷史測值（reader-safe 完整版 A）。tree 文件維持
//   「最新一期快照」（reader 零遷移）＋ 每次存檔 write-through 一筆 trees/{id}/measurements/
//   {periodId} 逐期歷史；forms.openTreeForm + import-wizard 批次皆寫穿（純加性、失敗不阻斷）。
//   firestore.rules 顯式 match measurements 子集合（append-only、client 不可刪）。既有立木由
//   scripts/backfill-i1-measurements.mjs 一次性 owner-token 補建（idempotent、可 --undo）。
//   本版 forms.js / app.js? / import-wizard.js / firestore.rules 已改 → 全檔 ?v= lockstep
//   21140 -> 21141 + JS_VERSION 21140 -> 21141。⚠ 本輪只 commit 分支、未跑 prod backfill、未部署。
// v2.11.42：I-2b 期別感知專案重啟 — 解「第一期 verified→鎖定後第二期採集被擋」關鍵缺口。
//   forms.openNewPeriod 改為「開新一期＝重啟採集」：PI/admin 同步把專案降回 status=active /
//   locked=false（project update 對 PI/admin 本無 isLocked 閘，無需改 rules），並先把關閉中
//   那期查證狀態存入新 project.periodVerifications[] 期別查證簿（「曾查證」不遺失）。第 N-1
//   期測值已凍結於 measurements（I-1 delete:false）→ 重啟採集 MRV 安全；第二期全 verified
//   後既有狀態機自動再 review+lock。純 client 邏輯 + 封存防呆 + 過時 I-1 警示文案修正。
//   本版 forms.js / firestore.rules(僅註解) 已改 → 全檔 ?v= lockstep 21141 -> 21142 +
//   JS_VERSION 21141 -> 21142。⚠ 本輪只 commit 分支、未跑 prod backfill、未部署。
// v2.11.43：I-3 樹牌號碼跳轉（純 UX）— 複查現場面對數十棵立木免捲列表。trees 子分頁加
//   「🔖 樹牌跳轉」輸入框（numeric inputmode）：輸入樹牌號（treeNum 或完整 treeCode /
//   結尾 -NNN）→ 查當前 onSnapshot 的 _lastTreesArr（即時、零額外 fetch）→ 秒開該樹編輯
//   表單（存檔由 I-1 write-through 當期 measurement）。查無→明確 toast；locked→提示先開新
//   一期重啟。純前端、無 schema / rules / API 變動。本版 index.html / app.js 已改 → 全檔
//   ?v= lockstep 21142 -> 21143 + JS_VERSION 21142 -> 21143。⚠ 本輪只 commit 分支、未部署。
const CACHE = 'forest-monitor-v2.11.43';  // v2.11.43：I-3 樹牌號碼跳轉；以下歷史
// v2.11.32（歷史）：路 J-4 + J-5 合 ship — (J-4) SHELL 補回所有 19 支 JS 預快取（與 index.html / app.js import 一致 ?v=21132，解決 v2.10.2 雙實例雷）。動機：新裝置 / 新成員直接帶到山上訓練（駐地無 wifi）情境，原本 SHELL 只快取 HTML/CSS → JS 沒 cache → 離線開 app 黑屏；現在 install event 一次 addAll 全 JS、保證離線可開。(J-5) 設定頁加「🚀 完整出工檢查」按鈕 + 5 項本機檢查（不需網路）：(1) 登入狀態 + token 剩餘分鐘、(2) Service Worker 已啟動、(3) App cache 完整（JS+HTML+CSS）、(4) Firestore 離線持久化試讀 user doc confirm、(5) 已開啟專案（plots/trees 透過 onSnapshot 預載 cache）。結果 inline 顯示 ✅綠/⚠️黃/❌紅、summary 一句話結論（5 項全綠可放心出工 / 紅項先連網處理 / 黃項可出工但建議）。順手修 species-dict.js / code-tables.js 在 forms.js / species-picker.js 用 ?v=2000 vs import-wizard 用 ?v=21131 ESM 雙 module 不一致（3 處）。SW cache v2.11.31 -> v2.11.32，?v=21131 -> ?v=21132 全 14 檔（48 處）+ ?v=2000 -> ?v=21132（3 處）。路 J 全 5 項 ship 完成。
// v2.11.31：路 J-1 立木 GPS 模式手動 fallback — 野外山區 GPS 完全無訊號（3-6 hr 離線常見情境）時兩條 escape：(1) 手動輸入 lat/lng（gpsBlock 內加 <details>「✏️ 無 GPS 訊號？手動輸入座標」、套用按鈕驗證 Taiwan 範圍 21-26°N/119-123°E、超範圍黃警仍套、套用後 ✋ 標記、treeGpsManualEntry flag）；(2) 退回皮尺 X/Y 模式（plotPosMode='gps' 才顯示「📐 退回皮尺 X/Y 模式（GPS 完全無訊號緊急用）」amber details、按鈕切換 currentPosSource='offset' + 顯示 offsetBlock + 隱藏 gpsBlock；offsetBlock 對應加「📍 切換回 GPS 量測模式」emerald details 反向切回）。submit 時 manuallyAdjusted=treeGpsManualEntry（gps 模式）/false（offset），覆寫舊邏輯。applyPosVisibility 改成 gps 模式也尊重 currentPosSource（之前 hardcoded 隱藏 offsetBlock）。GPS 失敗自動展開手動輸入 details。編輯既有 manually-adjusted 樹預設 treeGpsManualEntry=true 保留標記；GPS 重抓成功 reset false。SW cache v2.11.30 -> v2.11.31，?v=21130 -> ?v=21132 全 14 檔。
// v2.11.30：離線野外調查強化（路 J 起手）— Auth ID token 上線即 force refresh（window.online listener 主動跟 Google 換新 token，避免野外 3-6 hr 離線回駐地 SDK 內部 race 把 stale token 帶進 sync queue）+ 設定頁加「🔑 登入狀態」區塊（顯示登入有效至 / 剩餘分鐘、剩 <30 min 黃 / <15 min 紅 + 「🔄 立即重新整理登入」按鈕讓 PI 在出工前一刻把 token 計時器歸零、延長下個離線 window 1 hr）。state 加 tokenExpiresAt 欄位、onAuthStateChanged 內 getIdTokenResult 後寫入。研究結論：Firebase Auth refresh token free tier 永久有效、ID token 1 hr SDK 自動 refresh（要網路），Firestore offline persistence 用 cached auth 不重驗 token → 3-6 hr 離線寫入仍排 queue、上線 sync 時自動補。本版 patch 是防禦性 + UX 透明化、不必改 Firebase Console。SW cache v2.11.29 -> v2.11.30，?v=21129 -> ?v=21132 全 14 檔。後續路 J-1 GPS 模式手動 fallback / J-4 SW 預快取 JS / J-5 出工 pre-flight 全項待續。
// v2.11.29：plot detail 樣區地圖（Commit 2 of GPS-mode 2-commit plan）— 新分頁「🗺️ 樣區地圖」（插在「🌳 立木調查」與「📍 立木分布」之間），Leaflet 畫樣區邊界 polygon（rectangle/square/circle/irregular 都支援，含雙軸坡度 cos 校正 + slopeAspect 旋轉）+ 所有立木 DivIcon marker。Marker 顏色按 QA 狀態（綠已審 / 黃待審 / 紅退回），實心=GPS、空心=皮尺、精度>10m 虛線邊。Tooltip 顯示 treeCode / 樹種 / DBH / 來源 / 精度。「✏️ 編輯位置」toggle (canCollect 角色可見) → 所有 marker 可拖移 → 批次「💾 儲存 N 個變動」/「✕ 取消」，拖完一律轉 positionSource='gps' + manuallyAdjusted=true（✋ badge 亮）。新檔 tree-map.js + plot-geometry.computePlotCorners() / treeToWgs84() helpers。SW cache v2.11.28 -> v2.11.29，?v=21128 -> ?v=21132 全 13 檔。
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
// v2.11.32 (J-4)：JS 預快取補回，但這次帶 ?v=NNNNN 跟 index.html / app.js import 完全一致
//   解決 v2.10.2 的雙實例雷（兩個 URL → 兩個 module）。
//   為什麼要補：之前的「first online → 動態快取」模式對新裝置 / 新成員「沒有 first online」
//   情境（直接帶設備到山上訓練、駐地無 wifi）會崩潰 — JS 沒 cache → 離線 fetch fail → app 黑屏。
//   現在 SHELL 一次 addAll() 把所有 JS 預快取，install 完成就保證離線可開。
//   缺點：每次版號 bump 整批重下載（~200KB 級，可接受；行動網路 ~3 秒）
const JS_VERSION = '21143';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './firebase-config.js',
  // v2.11.32 (J-4)：所有 19 支 JS 預快取（與 index.html / app.js import 的 ?v= 一致）
  `./js/app.js?v=${JS_VERSION}`,
  `./js/forms.js?v=${JS_VERSION}`,
  `./js/analytics.js?v=${JS_VERSION}`,
  `./js/import-wizard.js?v=${JS_VERSION}`,
  `./js/distribution.js?v=${JS_VERSION}`,
  `./js/tree-map.js?v=${JS_VERSION}`,
  `./js/species-admin.js?v=${JS_VERSION}`,
  `./js/plot-qaqc.js?v=${JS_VERSION}`,
  `./js/species-equations.js?v=${JS_VERSION}`,
  `./js/project-status.js?v=${JS_VERSION}`,
  `./js/ai-identify-modal.js?v=${JS_VERSION}`,
  `./js/ai-species.js?v=${JS_VERSION}`,
  `./js/species-picker.js?v=${JS_VERSION}`,
  `./js/species-dict.js?v=${JS_VERSION}`,
  `./js/code-tables.js?v=${JS_VERSION}`,
  `./js/dem-elevation.js?v=${JS_VERSION}`,
  `./js/migration-v2715.js?v=${JS_VERSION}`,
  `./js/plot-geometry.js?v=${JS_VERSION}`,
  `./js/plot-polygon.js?v=${JS_VERSION}`,
  // v2.11.33：收穫採取許可模組（土肉桂葉片採收申請/審核）
  `./js/harvest-permits.js?v=${JS_VERSION}`
];

self.addEventListener('install', e => {
  // v2.11.38：恢復 self.skipWaiting()。v2.9.3 曾為「避免表單填一半被打斷」拿掉，但實證
  //   代價是「中毒舊版卡死、逃生口在崩潰 JS 裡 → 永久白畫面」遠比偶爾中斷重整嚴重（5/20 demo
  //   現場卡死 = 開天窗）。skipWaiting + activate clients.claim + inline controllerchange→reload
  //   → 修好的 SW 不必靠崩潰中的橫幅就能自己接管。
  self.skipWaiting();
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
  // v2.11.38：導航（HTML 文件）改 network-first — 線上一定拿最新殼（→最新 ?v= JS），
  //   離線才退快取殼。直接打破「cache-first 釘住中毒舊殼」死鎖；野外離線開 app 仍可用。
  const isNav = e.request.mode === 'navigate' ||
    (e.request.method === 'GET' && (e.request.destination === 'document' ||
      (e.request.headers.get('accept') || '').includes('text/html')));
  if (isNav) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(e.request).then(c => c || caches.match('./index.html') || caches.match('./'))
      )
    );
    return;
  }
  // 其餘資產（?v= 版號化 JS / CSS / manifest）：cache-first + 背景更新（stale-while-revalidate）
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
