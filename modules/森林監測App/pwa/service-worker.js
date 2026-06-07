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
// v2.11.44：tab 順序改流程序（修枝申請→修枝審核→葉片採收回報及結案→葉片採收彙整）；事後回報流程
//   用詞由「產出」改回「葉片採收」（user 定案，修枝=申請主體、葉片採收=事後實際量）；核准欄位
//   「核准採取數量」→「核准葉片採收量」。純文案＋排序，無 schema/rules 變動。
// v2.11.43：🚨 修「手機卡舊版死鎖」根因 — Firebase Hosting 對 index.html / service-worker.js
//   預設回 Cache-Control: max-age=3600 → 瀏覽器 HTTP 快取釘住舊殼＋舊 SW 腳本 1 小時，
//   network-first 連網路那步就被攔截、reg.update() 也拿到舊 SW → 永遠裝不上新版（卡 v2.11.39）。
//   解：(A) firebase.json 對 index.html / "/" / service-worker.js 設 no-cache,must-revalidate
//   （deploy 設定，未進 git）；(B) SW 註冊（index.html inline + app.js）加 updateViaCache:'none'，
//   SW 腳本更新檢查一律繞過 HTTP 快取。已卡死的裝置需一次性清除網站資料才會吃到新 headers。
// v2.11.42：列印新分頁救援 — 申請公文稿/許可單列印改在新分頁頂端加「🖨️ 列印 / ✕ 關閉並返回」
//   按鈕列（@media print 隱藏）並移除自動列印；修手機點公文稿後被新分頁困住、回不到主畫面的問題。
// v2.11.41：修枝申請表單精簡（5/20 後 user 細修）— 按鈕/標題去「新」、估計株數→土肉桂修枝株數、
//   移除「預計鮮葉產出量」與「用途」欄（林農對預估落差有顧慮、無估計機制）；申請函/許可單/卡片/
//   合作社彙整連動移除 estAmount_kg+uses 顯示，合作社彙整簡化為「林農/案件數/已回報產出量」。
//   ?v= lockstep 21140 → 21141。
// v2.11.40：B1 文案「採葉/採收 → 修枝/產出」全系統調整（2026-05-20 分署意見）— 申請主體=修枝、
//   事後實際量=產出；HARVEST_METHODS 收斂為 ['修枝','其他']（移除「截幹採葉」「修枝採葉」）；
//   文號中段 採葉→修枝；tab/表單/許可單/申請函全面文案 mapping。Firestore field 名一律不動（保 prod 資料）。
//   依規則 A 全檔 ?v= lockstep 21139 -> 21140（js/*.js + index.html）+ JS_VERSION 21139 -> 21140。
// v2.11.39：採收回報及結案全鏈路 — 新「🌾 採收回報及結案」分頁（renderHarvestReport）；
//   G1 結案閘門 client + firestore.rules 雙擋零回報結案；G2 未回報紅幅明示「一定要回報」；
//   G3 合作社彙整並列「申請量 / 已回報 / 達成率」。本版 harvest-permits.js / app.js /
//   index.html 內容已改 → 依規則 A 全檔 ?v= lockstep 21137 -> 21139（js/*.js + index.html）
//   + JS_VERSION 21137 -> 21139，避免 v2.10.2 ESM 雙實例雷。併入上述 v2.11.38 iOS 死鎖修
//   一次乾淨部署。
// v2.11.45：每專案模組可組合系統 — 依計畫類型/調查需求自由開關分頁與子調查模組。
//   新增 module-registry.js（軸 A modules + 軸 B surveyMethod/monitoring，沿用 methodology.modules 為唯一儲存）；
//   新專案表單依計畫類型帶套餐預設 + 可勾選微調；方法學編輯器擴充頂層模組（qaqc/export/admin_harvest/soil）
//   + 修存檔吃掉新 key bug；頂層分頁與樣區子分頁 gating 改「角色 AND 模組已啟用」。
//   向後相容：缺 methodology.modules 視為全開，既有專案不受影響（plan A）。?v=21144 -> ?v=21145 全檔。
// v2.11.68：6/6 demo 前 pre-flight 兩項 polish：
//   (A) 純行政專案地圖頁清掉立木 UI 殘留 — 5/30 dry-run 發現 v2.11.64 雖然藏了
//   樣區/設計/儀表板三個 tab，但地圖頁面的「著色依據（QA/立木密度/斷面積密度）」三個
//   radio + 「疊加圖層：樣區邊界」checkbox 仍露出（純行政專案 0 立木 0 樣區）→ 暴露
//   「為什麼有這些?」的疑問、6/6 demo 時會干擾承辦/合作社代表理解。修法：沿用
//   v2.11.64 同條件 data-module 機制，在 index.html 第一個 row（著色依據）和「樣區邊界」
//   label 加 data-module="tree,regeneration,understory,soilCons,soil,wildlife,harvest"；
//   border-t 殘留由 style.css `#map-layer-toggle > div.hidden + div` sibling selector
//   去掉 border-top + padding-top，避免出現孤兒分隔線。既有有 plot 模組的專案完全不
//   受影響（data-module 任一模組啟用就顯示）。
//   (B) 修枝申請表單欄位順序調整 — 原順序申請人姓名 → 聯絡方式 → picker → mini-map → 林班/地號…
//   違背 v2.11.63 picker 自動覆蓋申請人姓名的設計（user 還沒選承租人就先看到姓名欄、
//   邏輯顛倒）。改為：picker → mini-map → 申請人姓名 → 聯絡方式 → 林班/地號 → …
//   讓「先選作業位置 → 申請人姓名自動由承租人帶入 → 補聯絡方式」順序更自然。
//   提示文案順帶從「下方選承租人後會自動帶入」改成「上方選承租人後會自動帶入」。
//   ?v=21167 -> ?v=21168 全 15 檔。
// v2.11.69：拿掉「核准採收量」概念（業務拍板）— 許可只許可修枝作業、不預估/限制採收量；
//   採收量以實際回報為準、不設預估上限。理由：土肉桂每塊地年齡不同、每株產出葉量差異
//   大，事先預估反而誤導承辦與林農（5/30 dry-run 發現吳宏斌核准量空白、陳璽元 0.9 kg
//   像 placeholder，user 拍板砍掉預估概念）。改動：
//     (A) harvest-permits.js 核准 modal 拿掉「核准葉片採收量 (kg)」input、寫 null；改顯示
//         一句宣告「本案核准後即許可進行修枝作業；所採取葉片重量由林農實際回報，不設上限」。
//     (B) 卡片（申請、回報、合作社）全部不顯示核准量行；累計回報量單獨顯示、不對照、不算
//         達成率、不顯示超量警告。reportCard / openHarvestLogForm toast / closePermit confirm
//         全清。
//     (C) 採取許可單（modal preview + printPermit HTML）拿掉「核准葉片採收量」整行，加一句
//         宣告「本許可只許可修枝作業；所採取葉片重量以實際回報為準、不設預估上限」於 box 末
//         並加 dashed border-top 區隔；累計列只顯示鮮葉總量，拿掉「／核准 X kg」與超量字色。
//     (D) index.html 採收回報頁說明文字「系統即時對照核准量」→「系統即時累計顯示」。
//     (E) quotaInfo() 函式廢除（沒人 call）。
//   schema 保留 approvedAmount_kg 欄位（向後相容；既有兩筆 null/0.9 kg 不動，UI 隱藏不顯示
//   即可）。rules 不動（清單 200 行 approvedAmount_kg 在白名單，可寫可不寫、寫 null 也合法）。
//   結案閘門邏輯不變（totalLogged_kg > 0 才能結 completed，rules + client 雙擋）。
//   ?v=21168 -> ?v=21171 全 15 檔。
// v2.11.67：申請函嵌入作業位置示意圖（地圖視覺優化 Phase 3 / 公文整合終章）
//   harvest-permits.js 新增 buildLocationSvg(project, meta, opts) — 純 inline SVG 自製、無外部依賴：
//     - 讀 project.boundaryGeoJsonStr (FC) 找出 meta.unitId 對應目標作業單元
//     - 收集 1.5× target bbox 範圍內鄰近作業單元為 context
//     - 緯度補償（lon * cos(lat_center)）保留正確 aspect ratio
//     - 等比例縮放置中到 420×300 viewBox；目標紅色（#fecaca 填 / #991b1b 邊）、context 灰色
//     - 加 N 北方箭頭（右上）、目標 unitId 粗體紅標籤、鄰近單元小灰標籤
//   printApplicationLetter signature 改為 (permit, project)；caller permitCard 改傳 state.project
//   申請函 HTML 在 <table> 表列資料 與 <div class="sign"> 之間插入 .loc-map 區塊：
//     標題「附圖：作業位置示意圖」+ 副說明 + SVG + meta 行（作業單元/專區/承租人）
//   print CSS .loc-map page-break-inside:avoid 確保附圖不被分頁切開。
//   無 landParcelMeta.unitId（舊申請 / 邊界格式舊）→ locationSvg=null，附圖區自動省略不渲染。
//   ?v=21166 -> ?v=21167 全檔（無 rules 變動）。
// v2.11.66：申請表單內嵌迷你地圖（地圖視覺優化 Phase 2）— picker 選作業單元 → 自動 zoom 預覽
//   harvest-permits.js 新增 buildApplicationMiniMap(project)：
//     - 讀 project.boundaryGeoJsonStr（需 FC 格式）。舊 polygon/MultiPolygon → 顯示提示無圖。
//     - 240px 高 Leaflet 地圖嵌入藍框 wrap：
//       - 初始所有 polygon 灰色淡填、fit 全 boundary
//       - picker partial（zone+lessee）→ 紅色高亮該承租人所有圖塊、fit 對應 bounds
//       - picker full（含 unitId）→ 紅色高亮該作業單元、fit 並 maxZoom: 18
//     - status 行同步顯示「✓ 已定位：橫流溪 / 陳世允 / 8_1_1（1 個圖塊）」之類訊息。
//   openHarvestPermitForm 把 miniMap.wrap 插在 picker 與 林班/地號 之間；picker callback 同步呼叫
//   miniMap.setSelectedUnit(wu)；openModal 後 queueMicrotask 呼叫 miniMap.invalidateSize() 修
//   Leaflet 容器在 modal 顯示前無法量大小的問題。編輯既有申請時依 landParcelMeta 預先高亮。
//   ?v=21165 -> ?v=21166 全檔（無 rules 變動）。
// v2.11.65：作業單元代碼地圖 label + 點面 popup（地圖視覺優化 Phase 1）
//   analytics.js renderProjectBoundary 的 L.geoJSON 加 onEachFeature：
//     - bindTooltip permanent + className='work-unit-code-label' 顯示作業區/標示/unitId 代碼
//     - bindPopup 顯示 7 欄結構化 metadata（作業單元/專區/承租人/契約樹種/面積/工作站/契約書）
//   style.css 補 .leaflet-tooltip.work-unit-code-label（白底藍框、bold 10px、無箭頭）
//   user 進入專案 → 地圖即看到 115 個作業單元代碼疊在邊界上，點任一面跳出該單元完整資訊。
//   ?v=21164 -> ?v=21165 全檔（無 rules 變動）。
// v2.11.64：純行政專案隱藏 樣區/設計/儀表板 分頁（user 5/30 拍板，土肉桂葉片監測會計系統需求）
//   背景：土肉桂專案僅啟用 admin_harvest 模組，但 樣區/設計/儀表板 一直顯示且無法關閉
//        （CORE_TABS 硬編、BASE_ON 強制開 tree/regen）→ admin 介面雜訊大。
//   (A) index.html：樣區/設計/儀表板 三個 tab link + 對應 section 加
//       data-module="tree,regeneration,understory,soilCons,soil,wildlife,harvest"
//       → 任一 plot 家族模組啟用才顯示；全部關閉時 applyModuleVisibility 自動隱藏 tab + 內容。
//   (B) module-registry.js：BASE_ON 從 ['tree','regen','export'] 縮為 ['export']；
//       basic_sampling / census_urban / full_ecology 套餐自帶 tree/regen。
//       既有專案不受影響（Firestore 已存值優先），僅影響新建專案預設。
//       RES/OTHER 類型用 admin_harvest 套餐 → 新建即不啟用 plot 模組 → 三 tabs 預設隱藏。
//   (C) app.js：設定分頁新增「⚙️ 方法學與調查模組」備援卡片，含「✏️ 編輯方法學」+「＋ 批量建立空殼樣區」
//       兩個按鈕（PI/admin），讓 admin 在設計分頁被隱藏後仍可重新啟用 plot 模組（避免雞生蛋）。
//   (D) app.js renderProjectHome：加 queueMicrotask 偵測預設 active tab 是否被隱藏，自動點第一個可見 tab
//       （否則 user 看到「樣區清單 0/50 尚無樣區」誤導畫面）。
//   ?v=21163 -> ?v=21164 全檔。
// v2.11.63：申請人姓名自動帶入＋聯絡方式必填（user 5/30 拍板）
//   (A) buildWorkUnitPicker 升級：refreshUnits（zone+lessee 選定但 unit 未選）改 fire partial onPick
//       回傳 { zone, lessee, unitId: null, partial: true }。完整三層選定 refreshSummary 仍 fire 完整 wu
//       （無 partial 旗標），caller 依 partial 區分「資料部分已知 / 完整 commit metadata」。
//   (B) openHarvestPermitForm 把 applicantName / contact 從 fld() 抽出為獨立 input element。
//       picker callback 升級：wu.lessee 任何時點已知（partial 或 full）→ 永遠覆蓋
//       applicantNameInput.value（user 原則：承租人＝申請人，單一可信來源）；wu.unitId 完整
//       → commit metadata + 帶入 landParcel + 面積（同 v2.11.55 邏輯）。
//   (C) 聯絡方式改 required + submit 端 validation；草稿亦擋（無聯絡方式則公文/許可單後續無法執行）。
//   ?v=21162 -> ?v=21163 全檔。
// v2.11.62：PI/admin 刪除申請案（任何狀態）— 練習用案件清理 / 誤鍵案件重設
//   (A) UI：permitCard 加紅框醒目按鈕「🗑️ 刪除申請案」，PI/admin 任何狀態皆可見；
//       既有「✕ 刪除草稿」連結保留給林農 owner（小型 underline，避免誤刪）。
//       同時加 !isPi() && !isSystemAdmin() 條件避免管理員看到雙刪除按鈕。
//   (B) deletePermit 升級：cascade 子集合 logs（含採收回報紀錄）；確認對話框列出申請人/林地/狀態/
//       發文字號/法定許可文號（如有，警示將同時失效）/ 累計回報量（如有），降低誤刪風險。
//   (C) firestore.rules：harvestPermits/{permitId}/logs 的 delete 規則 — 對 PI/admin 放寬至任何
//       父狀態（含 completed/rejected），允許徹底清案；owner 仍限 approved/harvesting（結案後個資
//       不該被林農自行刪改）。update 規則保持原樣。
//   ?v=21161 -> ?v=21162 全檔；rules 同步部署。
// v2.11.61：發文字號自動編號（user 5/30 拍板）
//   原「發文字號：__________（申請人自編／免填）」改為系統原子產生：
//     「大雪山林業合作社（修）字第001號」（三位零填補）
//   (A) harvest-permits.js 新增 buildApplicantDocNo(seq)；submit handler 偵測「送出」+ 尚未配發 → runTransaction
//       原子遞增 counters/applicantSeq（專案級，與 counters/harvestPermit 法定許可號獨立），寫入 applicantSeq +
//       applicantDocNo 兩個欄位到 harvestPermit doc。
//   (B) 申請函模板：發文字號改 ${permit.applicantDocNo ? esc(...) : '（送出申請後自動編號）'}。
//       已配發過的（含 revision → 再送）不重新編號，避免改卷時改文號破壞紙本連續性。
//   (C) firestore.rules：counters/{counterId} write 從「harvest_authority|pi|admin」放寬到「canCollect|
//       harvest_authority」— 林農 surveyor 才能執行送出 transaction；counter doc 無 PII、惡意寫亂頂多漂移序號。
//   ?v=21160 -> ?v=21161 全檔；rules 同步部署。
// v2.11.60：申請函說明段改為正式公文體 4 點（user 5/30 拍板）
//   原 6 點為「申請人/林地/採取標的/作業期間/系統聲明/查照」逐項條列，與下方表列重複、流水帳。
//   改 4 點官方公文風格：
//     (1) 申請目的與理由（撫育管理＋通風透光，採枝葉作後續利用）
//     (2) 作業原則（不損生長、不影響保育、避免過度修剪、現地維護）
//     (3) 範圍/數量/期間 → 詳如本函表列資料及所附文件
//     (4) ForestMRV 線上系統登錄聲明（草稿/送出兩種狀態文案）
//   表列資料（申請人/聯絡/林班地號/面積/方式/株數/作業期間/備註）保留於下方。
//   ?v=21159 -> ?v=21160 全檔（許可單無 6 點說明、未動）。
// v2.11.59：修枝申請表單 UX 細修（user 5/30 拍板）
//   (A) 土肉桂修枝株數改為「申請面積 × 1800 株/ha」自動計算（合作社契約假設密度），即時連動：
//       面積變更（picker 帶入 / 手動輸入）→ 株數自動 Math.round(area × 1800) 覆蓋，user 仍可手動覆蓋。
//       表單 hint「預設＝申請面積 × 1800 株/ha（合作社契約假設密度）；修改面積會即時連動，可手動覆蓋。」
//   (B) 修枝起日 / 修枝迄日改為必填（required 屬性 + submit 端 validation；起日 ≤ 迄日順序檢查）。
//       原為選填、林農常漏填造成審核分署退件；草稿亦擋（避免不完整資料散落 Firestore）。
//   ?v=21158 -> ?v=21159 全檔。
// v2.11.58：修申請修枝面積 step='0.01' 擋掉契約面積 0.2544 ha 等 4 位小數的 bug
//   事故：v2.11.55 picker 自動帶入契約面積（如 0.2544）→ 表單原 step='0.01' 只接受 2 位小數
//   → 瀏覽器原生 validation 跳「請輸入有效值。最接近的兩個有效值分別是 0.25 和 0.26。」→ 送不出去。
//   修：step '0.01' → '0.0001'（= 1 m² 精度，台灣林業契約標準；公頃 × 10^-4 = m²）。
//   ?v=21157 -> ?v=21158 全檔。
// v2.11.57：🚨 HOTFIX — 修 harvest-permits.js stale closure，picker 看不到升級後的邊界
//   事故：v2.11.55+56 上線後 user 走完「升級舊邊界」流程，但 picker 仍顯示「邊界格式為舊版」hint。
//   根因鏈：(1) user 點「修枝申請」分頁 → renderHarvestApply(state.project_v1) 把 v1 closure 抓死進
//     新建按鈕 click handler；(2) user 編輯專案、載入預設邊界、儲存 → forms.js 已同步 state.project
//     成 v2（FeatureCollection）並 dispatch project-updated event；(3) user 點＋新申請 → click handler
//     用 v1 closure 開 form → buildWorkUnitPicker(v1) 看到舊 Polygon → 永遠顯示「邊界格式為舊版」。
//   修：(A) renderHarvestApply 內所有 openHarvestPermitForm / submitPermit / permitCard 改用 state.project
//   動態取現值，不用 closure 抓的 project 參數。(B) 監聽 forestmrv:project-updated event 自動 re-render
//   harvestapply 分頁（若 visible），讓 user 升級邊界後不用手動切 tab。
//   ?v=21156 -> ?v=21157 全檔。
// v2.11.56：picker 空陣列時 hint 精細化 — 區分三種「為何沒料」原因並給可執行指引
//   (1) 完全沒上傳邊界 → 提示 admin 進編輯上傳
//   (2) 邊界格式為舊版 Polygon/MultiPolygon（v2.11.54 以前 parse） → 提示重載入預設集升級為 FeatureCollection
//   (3) 有 FeatureCollection 但屬性無 zone/lessee/unitId 可辨識 → 提示要合併檔格式
//   背景：5/29 user 升級到 v2.11.55 後既有專案邊界仍是舊格式 → picker 顯示「請手填」，user 不知道該怎麼修。
//   ?v=21155 -> ?v=21156 全檔。
// v2.11.55：修枝申請三層 dropdown — 林農選作業位置 → 自動帶出地籍（5/20 後 user 一直惦記的需求）
//   (A) parseProjectBoundaryGeoJson 升級為 FeatureCollection 輸出，保留 per-feature properties
//       — 原輸出 Polygon/MultiPolygon 砍掉所有屬性、dropdown 沒料可用。L.geoJSON 同樣吃 FC，地圖
//       render 無需改；舊版上傳的純 geometry 仍可顯示，只是 dropdown 沒 metadata → fallback 手填。
//   (B) harvest-permits.js 新增 normalizeWorkUnit() — 橫流溪/烏石坑 schema 差異統一：
//       承租人(橫)/name(烏)、樹種/契約樹種、面積/契約面積/area1、作業區(14_1_1)/標示(117-260-01)、
//       林班、假地號、工作站/事業區、契約書 → 統一 { zone, lessee, unitId, species, area_ha, ... }。
//   (C) buildWorkUnitPicker() 三層連動下拉（專區→承租人→作業單元）；選完自動帶入 landParcel + 面積，
//       並把結構化 meta 寫進 harvestPermit.landParcelMeta 給彙整/許可單溯源用。
//   (D) 申請卡片補「✓ 系統識別：橫流溪/鄭清標/14_1_1/土肉桂/0.0849 ha」摘要行，林農目視確認沒選錯。
//   ?v=21154 -> ?v=21155 全檔。
// v2.11.54：開案表單邊界 + 預設邊界一鍵 — admin 開新案時一站完成邊界準備（不用兩步入場）
//   (A) buildBoundarySection 在新建模式也顯示（先前只給編輯模式）；submit 採 addDoc→updateDoc 兩步
//       原子化（addDoc 失敗整個取消；boundary updateDoc 失敗不擋專案建立、僅 toast 警告）。
//   (B) buildBoundarySection 新增「📥 預設邊界」下拉 + 載入按鈕 — fetch pwa/data/presets/*.geojson
//       走既有 parse 流程。初版預設集：cinnamon-zones（土肉桂專區橫流溪+烏石坑合併 115 features）。
//   ⚠ PII 風險已知：預設檔含承租人姓名/契約書號；Hosting 靜態檔有 URL 即可下載。判定屬合作社契約半公開
//       資料、demo 風險可接受；6/6 後若要嚴格保護 → 改 Firestore boundaryPresets/{id} + rules 鎖 admin。
//   ?v=21153 -> ?v=21154 全檔。
// v2.11.53：編輯專案雙入口 — 補 v2.11.22 把唯一入口塞地圖分頁的 UX 缺口（admin 反映找不到）
//   (A) 所有分頁頂部「← 返回我的專案」旁加 ✏️ 編輯專案 按鈕（pi,admin 可見）
//   (B) 設定分頁新增「📋 專案資訊與邊界」區塊（含邊界已上傳狀態摘要 + 編輯入口）
//   同呼 forms.openProjectForm(state.project)、與既有 #btn-edit-project-boundary 並存。?v=21152 -> ?v=21153 全檔。
// v2.11.52：樣區 GeoJSON 上傳防呆 — 偵測「這檔看起來是專案邊界、不是樣區」並主動引導
//   背景：5/29 user 把整個土肉桂專區作業單元（115 feature / TWD97 / 141 KB）GeoJSON 丟到「新樣區」
//   表單，原本只在頂點 > VERTEX_MAX 時 toast 一行、preview box 仍卡在「目前 0」→ user 困惑。
//   修：forms.js 新增 looksLikeProjectBoundary() peek 原始 JSON（FeatureCollection>1 feature /
//   MultiPolygon 多 polygon / 頂點>50 / bbox 跨度>500 m 任一觸發）→ confirm() 對話框講白問題
//   並建議改去「編輯專案 → 📐 專案邊界」上傳。VERTEX_MAX toast 同步加上引導文案。?v=21151 -> ?v=21152 全檔。
// v2.11.51：Admin 可編輯 PI 專案的方法學/調查模組 — 設計分頁「編輯方法學」「批量建立空殼樣區」
//   工作流提示原本只開 PI（data-role-show="pi"），Admin（總管理者）看不到、無法回頭修正開案時設錯的
//   調查模組。改 data-role-show="pi,admin"。rules 早已允許 isSystemAdmin 更新專案 methodology（line 93），
//   點擊 handler 與 openMethodologyForm 也無內部角色限制 → 純 UI gating 放行即可。?v=21150 -> ?v=21151 全檔。
// v2.11.50：立木定位模式三選項 RWD 真正修好（v2.11.49 改壞了，本版修正）。根因＝全域
//   .field input{width:100%;padding;border}（style.css）也套到黃框內的 radio → radio 撐滿整列、
//   圓圈置中、CJK 標籤被 min-w-0 擠成逐字直書。修：radio 改 inline style width:auto/flex:0 0 auto/
//   無 padding 無 border（inline 勝過 class）→ radio 13px 靠左、標籤貼齊並可換行收在黃框內。
//   已用 preview DOM 注入實測 radio 寬 13px、靠左。?v=21149 -> ?v=21150 全檔。
// v2.11.49：（改壞，已被 v2.11.50 修正）立木定位模式 RWD — flex items-start + flex-shrink-0，
//   但 radio 仍受 .field input{width:100%} 撐滿、標籤直書，更糟。
// v2.11.48：樣區清單卡片重複/閃爍修 — plot-list onSnapshot handler 是 async（await 子集合
//   verified 統計），Firestore cache→server 兩次 fire 都「先清空、各自 await 後再 append」→
//   樣區卡片重複（001/002 各兩張）、有時又消失。加 generation guard：只有最新一次 fire 在 await
//   後才清空+render，較舊 fire 放棄。（全開型專案啟用模組多、await 久，race window 更大更易觸發。）
//   ?v=21147 -> ?v=21148 全檔。
// v2.11.47：座標防呆 — 修「立木 X/Y 誤填 TWD97 絕對座標 → 散布圖 span 暴衝、整頁卡死」。
//   根因：學生在 offset（皮尺）模式把絕對座標（如 200282）填進「樣區內 X/Y 偏移」欄，
//   表單無範圍檢查 → 產生距樣區數十萬公尺的點。雙層防呆：(A) 立木表單 offset 模式 X/Y 超出
//   「樣區邊長×4+100 m」即擋下並提示「請勿填 TWD97 絕對座標」；(B) 散布圖排除座標離譜的立木、
//   併入「未設位置」清單，既有壞資料也不會再讓畫面爆掉。（事故樣區那筆壞資料已手動清空座標。）
//   ?v=21146 -> ?v=21147 全檔。
// v2.11.46：🚨 HOTFIX — 修 v2.11.45 樣區詳情頁卡死。重構子分頁 gating 時誤刪了
//   renderPlotDetail 內的 `const mods = methodology.modules`，但下方 understory/soilCons/
//   wildlife/harvest 子集合訂閱仍引用 mods → ReferenceError 在 render 中段 throw → router
//   render promise reject、route 卡鎖 → 進樣區詳情後無法返回、無法新增立木。修：補回 mods 宣告。
//   ?v=21145 -> ?v=21146 全檔。
const CACHE = 'forest-monitor-v2.11.71';  // v2.11.71：P5b 開新期蓋印 tree.priorSnapshot + 可列印複查野外清單；以下歷史
// v2.11.69（歷史）：拿掉「核准採收量」概念（業務拍板）。
// v2.11.68（歷史）：純行政專案地圖頁藏立木/樣區 UI 殘留 + 修枝申請表單欄位順序調整（6/6 demo polish）。
// v2.11.67（歷史）：申請函嵌入作業位置 SVG（buildLocationSvg）+ printApplicationLetter signature 改 (permit, project)。
// v2.11.50（歷史）：立木定位模式三選項 RWD 真正修好（radio inline width 覆蓋 .field input）。
// v2.11.48（歷史）：樣區清單卡片重複/閃爍修（plot-list async onSnapshot race，generation guard）。
// v2.11.47（歷史）：立木座標防呆（X/Y 誤填 TWD97 絕對座標→卡死）。
// v2.11.46（歷史）：HOTFIX 修 v2.11.45 樣區詳情卡死（誤刪 mods 宣告 ReferenceError）。
// v2.11.45（歷史）：每專案模組可組合系統 — 依計畫類型/調查需求開關分頁與子調查；新增 module-registry.js。
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
const JS_VERSION = '21171';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './firebase-config.js',
  // v2.11.32 (J-4)：所有 19 支 JS 預快取（與 index.html / app.js import 的 ?v= 一致）
  `./js/app.js?v=${JS_VERSION}`,
  `./js/module-registry.js?v=${JS_VERSION}`,
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
