# 2026 forestry_RS — 林業研究、監測系統與計畫書撰寫主專案

> 本檔是**藍圖**（變動慢）。進度與最近更動在 Obsidian 工作筆記，不在這裡。

## 對話開始時請先讀

進度與最近更動都在 Obsidian 工作筆記：
`H:\我的雲端硬碟\secondbrain\10-專案\2026-forestry-rs\工作筆記.md`

**讀取策略（強制，避免脈絡爆量）**：
1. 用 **Read 工具直讀磁碟檔**（上述路徑），需要時用 offset/limit **分頁**讀。
2. **先只讀檔頂「📍 狀態速查」區塊**（約前 45 行）——通常已足夠掌握 prod 版本、硬期限、待辦並決定下一步，不必讀全檔。
3. 需要更早輪次細節時，再續讀近 2 輪，或開 `工作筆記-封存.md`（同樣 Read 工具分頁）。
4. **禁止用 obsidian MCP `read_note` dump 全檔**：MCP 回傳 JSON 會把中文逐字 escape 成 `\uXXXX`，1 字→6 字元，約 6× 膨脹（37K 檔→271K JSON），單次必爆讀取上限且灌爆脈絡。MCP 僅用於「精準小範圍查詢/更新」（如 search_notes、patch 某段），不要整檔讀。

寫工作筆記一律 UTF-8 **no BOM**；主檔只留近 2 輪＋清單＋踩坑，膨脹再無損封存（見 memory `feedback_worknotes_archival`）。
讀完狀態速查再決定下一步。

---

## 壹、專案定位

兩條主線並行：

1. **ForestMRV 森林監測系統**（`modules/森林監測App/`）— 本 repo **程式碼量最大、迭代最快**的部分。已上 prod、有真實使用者（林農、調查員、分署）。
2. **林業文件與分析**（`chapters/`、`reports/`、其餘 `modules/`）— 計畫書撰寫、碳匯專案文件、教材簡報、統計分析。

涵蓋業務：
- 森林經營計畫書（FMP）撰寫與審查
- 碳匯專案文件（AR-TMS0001 / 0002 / 0003 / 0004）
- 林業永續輔導計畫、林業政策與技術報告
- GIS 與空間分析（圖層裁切、套疊、坡度分析、變遷偵測）
- 永久樣區監測、複查與生長分析

所有輸出須符合：台灣林業實務、林業及自然保育署規範、IPCC 2006 Guidelines（LULUCF）、MRV（測量、報告、查證）原則、TACCC（透明、一致、可比、完整、準確）。

---

## 貳、工作桌 + 三個家

- 📋 **GDrive 工作桌**：`H:\我的雲端硬碟\2026 forestry_RS\`（自動跨電腦同步；本 repo 的實體位置）
- 🐙 **GitHub repo**：`cct7366488-collab/2026-forestry-rs`（**公開 repo — PII 一律不進**）
- 📘 **Obsidian 駕駛艙**：`H:\我的雲端硬碟\secondbrain\10-專案\2026-forestry-rs\工作筆記.md`（進度日誌；已連 obsidian MCP）
- 🔥 **Firebase prod**：專案 `forestry-rs-monitor`（asia-east1）— ForestMRV 的資料正本
- 🗺️ **公用圖層資料**：`C:\Users\cct\森林經營計畫書撰寫代理人\公用圖層資料\`（土壤、保安林、土地利用、DEM20m、植群、林班、棲地、火災點、土石流潛勢）
- 📑 **經營計畫書範本**：`C:\Users\cct\森林經營計畫書撰寫代理人\經營計畫書範本\`（FMP 技能會自動掛載）

---

## 參、目錄結構（實況）

```
2026 forestry_RS/
├── CLAUDE.md                      ← 本檔
├── .gitignore                     ← 資料治理的執行面，改動前先讀
├── modules/                       ← 分析模組 / 系統
│   ├── 森林監測App/                ← ★ ForestMRV：PWA + Firebase（主戰場）
│   │   ├── pwa/                   ← 程式本體（零 build）
│   │   ├── docs/                  ← 需求規格、資料schema、角色架構、Firebase 設定
│   │   ├── scripts/               ← Node admin SDK 一次性遷移/診斷腳本
│   │   ├── data/                  ← 樹種字典 CSV
│   │   └── seed-data/             ← 示範假資料
│   └── 土肉桂修枝施肥試驗/          ← ETL（長格式 Excel → ForestMRV payload）+ ANOVA 分析管線
├── chapters/                      ← 計畫書章節撰寫（每案件一子夾；目前空）
├── reports/                       ← 教材、簡報、操作手冊（含 Python/Node 產生器）
│   ├── 2026-05-mid-demo/
│   ├── 2026-06-cinnamon-demo/
│   ├── 2026-06-forestmrv-manual/
│   └── 2026-cinnamon-resurvey-sop/
└── data/                          ← 案件輸入資料（GIS 原始檔多被 .gitignore 擋下）
```

### 模組清單
| 模組 | 內容 |
|------|------|
| `森林監測App/` | ForestMRV — 野外調查 PWA、QAQC 查證、複查、修枝採收許可行政 |
| `土肉桂修枝施肥試驗/` | 析因試驗 ETL + 混合模型/ANOVA 分析 + Firestore writer |

### 章節撰寫案件清單
- （尚無）

---

## 肆、ForestMRV 森林監測 App — 架構

> 位置 `modules/森林監測App/pwa/`。**動這裡之前，先讀本節到底。**
> 補充文件：`docs/需求規格.md`、`docs/資料schema.md`、`docs/系統角色架構.md`、`docs/Firestore-security-rules.md`、`docs/Firebase-設定步驟.md`。
> ⚠️ `modules/森林監測App/README.md` 的目錄樹是 v1 MVP 舊稿（列 `auth.js`/`plot.js`/`tree.js` 等已不存在的檔名），**以實際檔案為準**。

### 一、技術棧 — 刻意零 build

CDN + 原生 ESM，**沒有 npm build、沒有 bundler、沒有測試框架、沒有 CI**。理由：學術專案要能被 fork 後直接跑起來。

| 用途 | 來源 |
|------|------|
| UI | Tailwind CSS（CDN） |
| 後端 | Firebase v10 modular（Auth + Firestore + Storage，CDN ESM import） |
| 地圖 | Leaflet 1.9.4 |
| 圖表 | Chart.js 4.4.1 |
| Excel | SheetJS xlsx 0.18.5 |
| 座標 | proj4 2.11.0（EPSG:3826 TWD97 TM2 ⇄ WGS84） |

**檔案配置**（`pwa/`）：`index.html`（含所有 `<template>` view）、`style.css`、`service-worker.js`、`manifest.json`、`firestore.rules`、`storage.rules`、`firebase.json`、`js/` 21 支模組。

**主要 JS 模組**（依規模）：
| 檔案 | 行數 | 職責 |
|------|------|------|
| `forms.js` | 5566 | 所有調查表單（立木/更新/下層/水保/野生動物/採收）存檔邏輯 |
| `app.js` | 3682 | 路由、全域 state、Firebase init、角色判定、共用工具（**其他模組的 import 樞紐**） |
| `analytics.js` | 2127 | 儀表板、統計、Excel/CSV 匯出 |
| `harvest-permits.js` | 1584 | 修枝採收許可行政全鏈路（申請→審核→採收回報→結案） |
| `import-wizard.js` | 1510 | 批次匯入精靈 |
| `species-admin.js` / `species-dict.js` / `species-picker.js` | 730/359/394 | 樹種字典管理、選擇器 |
| `distribution.js` / `tree-map.js` | 680/312 | 立木分布散布圖、Leaflet 地圖 |
| `plot-qaqc.js` | 406 | QAQC 抽樣、閾值、簽發閘門 |
| `plot-geometry.js` / `plot-polygon.js` | 391/363 | 樣區幾何、坡度水平投影、不規則多邊形 |
| `project-status.js` | 392 | 專案狀態機（draft→review→verified→locked） |
| `ai-species.js` / `ai-identify-modal.js` | 493/491 | AI 樹種辨識 |
| `species-equations.js` | 298 | 材積/生物量/碳量計算式 |
| `module-registry.js` | 132 | 每專案模組開關（單一事實來源） |
| `code-tables.js` / `dem-elevation.js` / `migration-v2715.js` | 108/58/204 | 代碼表、DEM 高程、schema 遷移 |

### 二、🚨 版本 lockstep（規則 A）— 改任何 JS 都要做

**這是本專案最容易踩、後果最嚴重的規則。** 曾造成 iOS PWA 死鎖、白畫面、手機卡舊版無法更新（v2.11.35 / 38 / 43 都是這類事故）。

改動 `pwa/` 下任何 `.js` 或 `index.html` 內容後，**必須同批**更新：

1. `service-worker.js` → `const CACHE = 'forest-monitor-vX.Y.Z'`（升版號 + 在同行註解寫本版摘要，舊摘要往後推）
2. `service-worker.js` → `const JS_VERSION = 'NNNNN'`（單調遞增計數器，+1）
3. **全檔 `?v=` 一起改成同一個新號**：`index.html`（2 處）+ `js/*.js` 所有 import specifier（目前共 53 處）

```bash
# 在 pwa/ 下，舊號 → 新號
grep -rl "?v=21189" index.html js/*.js | xargs sed -i 's/?v=21189/?v=21190/g'
# 再手動改 service-worker.js 的 CACHE 與 JS_VERSION
```

**為什麼三者都要**：
- `?v=` 不一致 → 同一支模組被載入兩份實例（v2.10.2 的 ESM 雙實例雷），state 分裂。
- `JS_VERSION` 驅動 SW 的 `SHELL` 預快取陣列與前景版本輪詢（app.js 比對 `import.meta.url` 的 `?v=` vs 線上 SW 的 `JS_VERSION`，不同就跳更新橫幅）。
- `CACHE` 改名才會觸發 SW `activate` 清掉舊快取。

**新增 JS 檔時**：務必同時加進 `service-worker.js` 的 `SHELL` 陣列（21 支都在裡面），否則離線開不起來。

**其他已內建的防死鎖機制**（別拆）：`install` 內 `self.skipWaiting()`、導航請求 network-first、`index.html` 裡刻意放在 ESM graph 之外的 inline SW 引導 script、`firebase.json` 對 `index.html` / `/` / `service-worker.js` 設 `no-cache, must-revalidate`、SW 註冊帶 `updateViaCache:'none'`。

### 三、🚨 循環 import 陷阱

`app.js` 匯出 `fb`（Firebase SDK 函式集合），其他模組又被 `app.js` import → **循環相依**。若在模組頂層寫 `const { db, doc } = fb;`，模組求值時 `app.js` body 尚未執行、`export const fb` 還在 TDZ → throw → 整個 ESM graph 崩 → 白畫面、無法登入（v2.11.34 事故）。

**規則**：
- 一律用 `fb.db`、`fb.doc(...)` 這種**點取用**（`forms.js` 全檔如此）；
- 或在每個進入點函式開頭呼叫 `bindFb()` 做 lazy bind（`harvest-permits.js` 的作法）。
- **永遠不要在模組頂層 destructure `fb`。**

### 四、其他已知踩坑（改動時留意）

- **body-level overlay 殘留**：所有全螢幕 overlay（modal、樹種字典、AI 辨識）掛在 `<body>`，而 `route()` 只清 `#app`。新增 overlay **必須標 `.app-overlay` class**，`route()` 開頭會統一 `closeModal()` + 移除所有 `.app-overlay`（v2.11.85 修手機卡死）。
- **onSnapshot listener**：註冊後推進 `state.unsubscribers`，`route()` 會全部退訂。頁面級 listener（如 species-admin）另提供 `disposeXxx()`。
- **非同步 render race**：`route()` 用 `_routeId` generation guard；清單內的 async 取名/計數也要在 await 後重新確認 generation。
- **座標防呆**：local 座標 ±1000m 硬擋（絕對座標誤填當場退回）；台灣範圍外 TWD97 X/Y 軟提示「沒填反」。

### 五、資料模型（Firestore）

```
/users/{uid}                                  ← systemRole: admin | member
/projects/{projectId}                         ← methodology / members / locked / qaqcConfig
  /plots/{plotId}                             ← 樣區幾何、坡度、qaStatus、qaqc、期別
    /trees/{treeId}                           ← 立木（DBH/樹高/活力/材積/碳）
      /measurements/{measurementId}           ← 複查逐期原始值（tree 頂層只存最新快照）
    /regeneration/{regenId}                   ← 自然更新
  /harvestPermits/{permitId}                  ← 修枝採收許可
    /logs/{logId}                             ← 收穫量登錄
/lookups/species/{speciesId}                  ← 樹種字典
/counters/{counterId}                         ← 法定文號流水（runTransaction 原子遞增）
```

**關鍵**：`trees/{id}` 只有**最新一期**快照；第 1..N-1 期原始值必須從 `measurements` 子集合還原。做複查匯出/歷期分析時別讀錯來源。

完整欄位表見 `docs/資料schema.md`（含每個 schema 版本的變更說明，改 schema 時**在檔頂加一行新版註記**）。

### 六、角色與權限（三層模型）

| 層 | 位置 | 值 |
|----|------|----|
| 系統層 | `/users/{uid}.systemRole` | `admin`（god view）/ `member` |
| 專案層 | `/projects/{pid}.members[uid]` | `pi` / `surveyor` / `reviewer` / `harvest_authority` / `coop` |
| 擁有權 | `doc.createdBy == uid` | surveyor 僅能編輯自己建立的資料 |

設計目的是 **雙重複核 + 鎖定後不可改**，對應 MRV／TACCC 可查證性。

- `firestore.rules`（360 行）是**權限的最終事實來源**；client 端 gating 只是 UX。**改權限必須 client + rules 兩邊一起改**（commit 訊息會註明 rules 是否變動）。
- 專案 `locked=true` 後全面禁寫（client + rules 雙擋）。
- QA 閉環：調查者修改自己建立且已 `verified` 的項目 → `qaStatus` 自動退回 `pending` 重新送審（`applySurveyorReQaReset`，7 處存檔共用）。

### 七、每專案模組開關（`module-registry.js`）

單一事實來源，沿用既有 `project.methodology.modules` 布林 map，**不要另開平行欄位**。

- **軸 A**：`methodology.modules[<id>] = true/false` — 控制頂層分頁與樣區子分頁
- **軸 B**：`methodology.surveyMethod`（`sampling` | `census`）、`methodology.monitoring`（`single` | `repeat`）
- 缺 key → 取模組 `default`（保既有專案行為不變）
- 核心分頁 `plots / dashboard / map / settings` 永不被關；`design`（方法學分頁）刻意不設為可關模組——它是開關本身的編輯入口，關掉會鎖死。

### 八、部署

```bash
cd modules/森林監測App/pwa
firebase deploy --only hosting                    # 前端
firebase deploy --only firestore:rules,storage    # 權限
```

本機試跑：`python -m http.server` 即可（零 build）。
首次設定：複製 `firebase-config.example.js` → `firebase-config.js` 填值（後者已 gitignore）。

### 九、驗證（沒有測試框架）

改完 JS 的標準驗證流程，commit 訊息裡要寫：
1. `node --check js/<改到的檔>.js`（語法）
2. cold-load 冒煙測試：登入 → render → 主要流程走一輪
3. 涉及 rules 的改動：用**非 admin 帳號**實測擋不擋得住

---

## 伍、資料治理（公開 repo，鐵則）

`.gitignore` 是這條規則的執行面。**新增檔案前先問：這是程式還是資料？**

| 類型 | 去處 |
|------|------|
| 程式碼、產生器腳本、schema/規格文件 | ✅ GitHub |
| 調查資料正本、payload、Firestore 內容 | 🔥 Firebase |
| 產出文件（docx/pdf）、截圖、含姓名教材 | 📋 GDrive（**不進 GitHub**） |
| 案件 GIS 原始檔（含承租人姓名/契約書號 PII） | 📋 GDrive（`data/*.shp` 等已擋） |

**絕不 commit**：
- `.claude/`（含 permissions、可能記錄 token）
- `serviceAccountKey.json` / `*-firebase-adminsdk-*.json`（**可繞過所有 Security Rules**，用完即刪）
- `firebase-config.js`、`.firebaserc`
- `.env`、`*.key`、`credentials.*`

樣區資料若涉及私有林地需去識別化；API Key 不寫死在程式碼。

---

## 陸、reports/ 文件產生器慣例

教材、簡報、操作手冊都是**程式產生**，不手工排版：

- `_build_*.py` / `_content.py` / `_qa.py` / `build_*.js` — 產生器，**進 git**
- 產出的 `.docx` / `.pptx` / `.pdf` / `images/` — 依資料治理留 GDrive，多數已 gitignore
- Python 依賴：`python-docx`、`python-pptx`、`Pillow`、`lxml`
- **PDF 轉檔用 `win32com.client`（Windows + Office only）** — Linux/容器環境跑不動，改動這類腳本時無法在此環境驗證，需在使用者機器上跑
- 檔名前綴 `_` = 建置工具；數字前綴 `01-`、`02-` = 交付物
- 改版前先備份成 `*.bak-YYYYMMDD-HHMMSS`（既有慣例）

---

## 柒、工作模式

| 場景 | 你說的話 | Claude 做什麼 |
|------|---------|---------------|
| 改監測 App | 「ForestMRV 加/修 XXX」 | 讀本檔第肆節 → 改 code → **版本 lockstep** → `node --check` → commit |
| 加新分析模組 | 「我想加一個 XXX 分析模組」 | 在 `modules/<模組名>/` 建子夾、引導建構工作流程 |
| 加新章節撰寫任務 | 「我想撰寫 XX 計畫書的 YY 章節」 | 在 `chapters/<計畫名>/` 建子夾、掛載範本目錄 |
| 結束工作 | **「收工」** | 三方自動同步：commit + push + 更新 Obsidian 工作筆記 |
| 接續工作 | 「讀工作筆記、告訴我上次做到哪」 | 摘要進度、建議下一步 |
| 查圖層 | 「裁切 XX 圖層到 YY 計畫範圍」 | 觸發 `fmp-spatial-analysis` 技能 |
| 查物種保育等級 | 「查 XX 的保育等級」 | 觸發 `species-conservation-lookup` 技能 |
| 計算材積/碳量 | 「計算這個樣區的碳蓄積」 | 觸發 `carbon-volume-calculator` 技能 |
| 審查計畫書 | 「審查這份 FMP」 | 觸發 `fmp-qa-audit` 技能（會先掛載範本目錄） |

---

## 捌、Git 慣例

**Commit 訊息格式**（繁中，資訊密度高）：

```
ForestMRV v2.11.90（QA 閉環）：調查者改到「已驗證」立木自動退回重新送審

需求（審查角度）：<為什麼要做、從哪個角度發現的問題>

修：<改了什麼函式/檔案，機制說明>

作用範圍界定：<邊界條件、什麼情況才觸發、與既有機制的連動>

驗證：node --check（forms/app/SW）過；fetch smoke 全綠；cold-load 乾淨
```

- ForestMRV 改動 → 標題前綴 `ForestMRV vX.Y.Z：`，與 SW 的 `CACHE` 版號一致
- 非 App 改動 → 直接寫做了什麼（如「土肉桂修枝施肥試驗：長格式 ETL→prod 匯入、複查 SOP 手冊」）
- **不要寫「更新」「修改」這種無資訊量的訊息**：要寫做了什麼 + 為什麼
- HOTFIX 標 `🚨 HOTFIX`
- rules 有無變動要在內文註明

**Push**：`git push -u origin <branch>`；網路錯誤才重試（2s/4s/8s/16s 退避）。

---

## 玖、林業專業慣例

- 座標系統一律 **TWD97 TM2**（EPSG:3826）
- 物種引用前必須先查 `species-conservation-lookup` 確認保育等級
- 碳匯計算須符合 IPCC LULUCF + 對應 TMS 方法學
- 章節層級格式：壹、 → 一、 →（一）→ 1. →（1）
- 面積：沿坡距 vs 水平投影要分清楚（`dimensionType`），水平投影 = 名目面積 × cos(坡度)
- 地徑 vs 胸徑（`diameterType: 'basal' | 'breast'`）不可混用；地徑資料不套胸徑材積式算碳

---

## 拾、全域 CLAUDE.md 已涵蓋的規範

請同時參照 `C:\Users\cct\.claude\CLAUDE.md`（全域），其中已載明：
- 文件輸出格式（壹、一、(一)、1.、(1)）
- 森林經營撰寫規範（林地、目標、作業法、撫育、保護）
- 碳匯與 MRV 規範（基線、專案、外加性、邊界、洩漏、監測）
- 審查模式輸出（主要問題、缺失、風險、建議 + Top 3 提問）
- 簡報輸出模式
- 品質標準（可直接提交政府）
- FMP 技能自動掛載範本目錄規則
