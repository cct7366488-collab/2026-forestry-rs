# ForestMRV 系統 context primer（給 demo 教材 agents 共用）

> 此文件是給做簡報 / 操作手冊 / 練習指南的 3 個 agents 共用的 baseline。讀這份就掌握全系統概況，不用各自重讀 codebase。

---

## 一、系統一句話

**ForestMRV 智慧森林監測平臺** — 台灣林業野外調查 + FMP 撰寫 + 碳匯專案的整合性 PWA，符合 IPCC LULUCF + MRV 原則。

- 生產網址：https://forestry-rs-monitor.web.app
- 當前版本：**v2.11.7**（2026-05-03）
- repo：[2026-forestry-rs](https://github.com/cct7366488-collab/2026-forestry-rs)

---

## 二、技術 stack

| 層 | 工具 | 用途 |
|---|---|---|
| 前端 | PWA（HTML + Vanilla JS + Tailwind CSS） | 跨平台、離線可用、自動更新 |
| 後端 | 無傳統後端 | Firebase serverless |
| 資料庫 | Firebase Firestore | 即時同步、offline persistence |
| 認證 | Firebase Auth | Google 登入 / Email 密碼 |
| 儲存 | Firebase Storage | 樣木照片 |
| 託管 | Firebase Hosting | CDN + SSL |
| AI 辨識 | Pl@ntNet API + Claude Haiku 4.5 | 主辨識 + 補詳細 |
| CORS proxy | Cloudflare Worker（自架，free） | 解 PlantNet 拒 browser 直連 |
| DEM | open-meteo API | 自動偵測樣區海拔 |
| 座標系 | TWD97 TM2 ↔ WGS84 | proj4 自動轉換 |

---

## 三、5 種角色

| 角色 | 權限 | 典型工作 |
|---|---|---|
| **systemAdmin** | god view，跨專案 | 建專案、加成員、AI 全域設定、字典管理、退回查證 |
| **PI（主持人）** | 自己專案內全權 | 規劃方法學、排樣區、改成員、最後 lock |
| **surveyor（調查員）** | 自己專案內 collect + 編輯自己建的資料 | 野外建樣區、調立木、拍照、AI 辨識 |
| **reviewer（審查員）** | 唯讀 + QAQC 抽樣重測 + 簽發查證 | 抽樣 → 現場核對 → 誤差統計 → 合格簽發 |
| **dataManager（已淘汰）** | 早期角色，v1.7 後移除 | — |

**權限優先序**：admin > PI > surveyor / reviewer

---

## 四、資料模型

```
users/{uid}
  systemRole: 'admin' | null

projects/{projectId}
  code (FMP-XXX-YYYY-NNN)
  pi (uid)
  members: { uid: 'pi' | 'surveyor' | 'reviewer' }
  memberUids: [uid, ...]
  methodology: { plotShape, plotAreaOptions, dimensionType, ... }
  status: 'created'/'planning'/'active'/'review'/'verified'/'archived'
  locked, lockedAt, lockedBy, autoLockReason
  qaqcConfig (reviewer 設定抽樣比例與閾值)
  qaqcSummary (簽發後的查證摘要)

projects/{}/plots/{plotId}
  code (project.code-NNN)
  shape: 'rectangle' / 'square' / 'circle' / 'irregular'
  area_m2, areaHorizontal_m2, areaSlope_m2
  dimensions: { width, length } 或 radius / vertices
  slopeWidthDeg, slopeLengthDeg (雙軸坡度)
  location (Firestore GeoPoint), locationTWD97 {x, y}
  elevation_m, elevationSource, elevationFetchedAt (DEM 自動填)
  qaStatus: 'pending'/'verified'/'flagged'/'rejected'
  qaqc (reviewer 抽樣資料)

projects/{}/plots/{}/trees/{treeId}
  treeNum, treeCode (plot.code-NNN)
  speciesZh, speciesSci, treeType, conservationGrade
  dbh_cm, height_m, branchHeight_m
  basalArea_m2, volume_m3, biomass_kg, carbon_kg, co2_kg (自動算)
  vitality, pestSymptoms[]
  localX_m, localY_m → treeLocationTWD97, treeLocationWGS84
  photos[]
  qaqc (reviewer 重測資料)

子集合：regeneration / understory / soilCons / wildlife / harvest

species/{zh}  — Firestore 共用樹種字典 (224 種)
  sci, family, genus, treeType, popularityRank
  elevationMin_m, elevationMax_m, forestTypePreference[]
  conservationGrade
  woodDensity_g_cm3, woodDensitySource
  equationSource, equationConfidence, equationCitation
  aliases[], notes
  verified, addedFrom, addedBy, addedAt

app_settings/aiConfig — admin 全域 AI 設定
  plantnetApiKey, plantnetProxyUrl
  llmApiKey, llmModel
  updatedAt, updatedBy
```

---

## 五、核心工作流

### (一) 樣區建立流程

1. 開新樣區 → form
2. 填樣區編號 / 林班
3. **抓 GPS**（v2.10.4 升級：失敗 auto-retry 低精度 + 手動輸入 fallback）
4. 選樣區形狀（**預設 rectangle 20×25**，台灣永久樣區慣例）
5. **填雙軸坡度**：寬邊（20 m，沿坡）+ 長邊（25 m，沿等高線）— **紙漿廠 SOP 已驗證**
6. 系統自動算：areaHorizontal_m2、areaSlope_m2（cos 修正）
7. 設置日期 / 上傳樣區照片
8. submit → Firestore

**v2.10.9 新功能**：plot.elevation_m 若無 → 開 form 時背景 fetch open-meteo API → 寫回 plot doc → 自動推 picker 海拔 band。

### (二) 立木調查流程

1. 進樣區 → trees subtab → 「+ 新立木」
2. 填個體編號（自動續號）
3. **選樹種**（v2.10.5+ picker）：
   - 從 Firestore 224 種搜尋（中文 / 學名 / 別名 fuzzy match）
   - 海拔 band pills 自動帶（DEM 偵測結果）
   - 列出 top-30 常用 + 公式來源徽章 🟢🟡🟠
4. **或點「📸 AI 辨識」**（v2.11+）：
   - 拍葉照（手機 capture=environment）
   - 選器官（leaf 預設）
   - 點辨識 → PlantNet top-3 → 點選套用
   - 同步寫進 tree.photos
   - 若 admin 設了 LLM key → 5-15 秒後補詳細（imageQuality + 特徵 + 棲地）
5. 填 DBH（cm）+ 樹高（m）
6. 即時試算：斷面積 / 材積 / 全株生物量 / 碳蓄積 / CO₂ 當量
7. 顯示公式來源 label：例「[紅檜] BEF 0.58 / CF 0.49 ｜ 陳朝圳 1985 大雪山」
8. 填活力 / 病蟲害 / 局部 X/Y 座標 / 上傳特徵照
9. submit → 自動寫 treeLocationTWD97 + treeLocationWGS84

### (三) 自然更新 / 地被 / 水保 / 野生動物 / 採收 — 各子集合表單類似流程

### (四) QAQC reviewer 工作流（v2.7.17 + v2.8.1）

1. 全資料 surveyor 已標 verified → 自動進 status='review'
2. reviewer 進「審查（QAQC）」分頁
3. 設 QAQC config：抽樣比例（plots % + trees per plot）、閾值（slope °、area %、DBH cm）
4. 系統隨機抽 plots → reviewer 現場重測
5. 系統算誤差 → 三色 badge（綠 ≤ 閾值 / 黃 ≤ 2× / 紅 > 2×）
6. reviewer 對紅色 flag 處理（remeasure / accept / reject）
7. 通過 approval gate → 「合格簽發」按鈕 → status='verified' + lock
8. 全 QAQC 摘要寫進 project.qaqcSummary

### (五) Dashboard / 統計分析

- **全專案 dashboard**：KPI（樣區/立木/碳量/CO₂）、DBH 分布、IV 排名、活力 donut、樹種組成矩陣、空間密度 heat map
- **per-plot dashboard**：立木 KPI、碳量單位智能切（max 1000 kg → t）、DBH histogram、QAQC 誤差直方圖、**公式來源覆蓋率 + reviewer 信心**

### (六) Excel 匯入匯出

- **匯入**：import wizard 五步驟 — 上傳 → 比對欄位 → 預覽 → DRY-RUN → 寫入
- **匯出**：dashboard tab 點匯出 → 多 sheet xlsx（plots / trees / regen / 樹種組成 / QAQC）

---

## 六、版本歷程速覽

- **v2.0**（早期）：5 角色 + Lock + 基本 CRUD
- **v2.3-v2.7**：狀態機 + reviewer 階段 + QAQC 雛形
- **v2.7.10-15**：樹種字典 + import wizard + 樣區幾何 schema（v2.6/v2.7.16）
- **v2.7.17**：reviewer QAQC 工作流（抽樣→重測→誤差→簽發）
- **v2.8.0-v2.8.6**：irregular plot + tree-level QAQC + 雙軸坡度
- **v2.9.0-v2.9.3**：dashboard 升級（per-plot 概況 / 樹種矩陣 / 空間密度 / PWA 自動更新橫幅）
- **v2.10.0-v2.10.9**：**Phase 1 樹種 DB 擴充**
  - 224 物種 Firestore + picker fuzzy 搜尋 + 海拔 band + 5 樹型 fallback 公式 + 公式來源徽章 + DEM 自動偵測
- **v2.11.0-v2.11.7**：**Phase 2 AI 樹種辨識**
  - PlantNet 整合 + CF Worker proxy + 照片自動入 + Firestore admin 全域 + Pl@ntNet+Claude Haiku 混合 + model 選擇器

---

## 七、AI 樹種辨識（重點功能 — demo 主打）

### 雙 AI 混合架構

```
野外 → 拍葉照 (800px JPEG)
         ↓
PWA → CF Worker proxy → PlantNet API
         ↓
top-3 學名 + 信心 % + 中名（若字典命中）
         ↓
背景 fire → Claude Haiku 4.5（直連 browser，dangerous-direct-browser-access）
         ↓
+ imageQuality（good/poor）+ 每筆 characteristics/habitat/isNative/notes
         ↓
user 點選 → picker 自動填 + 照片自動入 tree.photos + 自動算碳量
```

### 為什麼要混合？

- **PlantNet**：植物專業模型、便宜（free 500/天）、快（3-5s）、精確 sci 名 — 但只回名字、無解釋
- **Claude Haiku**：給「為什麼像」解釋 + 圖片品質評估 — 補齊 reviewer 透明度需求
- **成本**：PlantNet $0 + Haiku $0.005/次 → 50 次/天約 $8/月（很便宜）

### 設定流程（admin 一次設好全 user 共用）

1. **PlantNet 註冊**：my.plantnet.org 註冊（**要點 email 認證信！**）→ Generate API key
2. **CF Worker proxy**：workers.cloudflare.com 註冊（無 CC）→ Create Worker → 貼 30 行 proxy code → Deploy → 拿 https URL
3. **Anthropic Claude（選填）**：console.anthropic.com 加值 $5+ → Generate key
4. **PWA AI modal → admin 編輯全域設定** → 4 欄位填好 → 儲存

學員端：0 設定，admin 設好就能直接用。

---

## 八、demo / workshop 用 — admin 預先準備

1. 預先建一個 **「示範林班 2026」** 專案
2. 把學員 email 都加進去（或開放 public read）
3. 建 1-2 個樣區、加 5-10 株 demo 立木
4. 確認 AI 辨識全域 settings 已設好
5. 學員建好自己的小專案（情境 1）

---

## 九、檔案結構速查

```
modules/森林監測App/pwa/
├── index.html
├── service-worker.js
├── firestore.rules
├── firebase.json
├── js/
│   ├── app.js (主程式 + 路由)
│   ├── forms.js (表單)
│   ├── analytics.js (dashboard / 圖表 / 匯出)
│   ├── species-picker.js (樹種搜尋下拉)
│   ├── species-equations.js (allometric 公式 24 種 + 5 樹型 fallback)
│   ├── species-dict.js (98 種 fallback 字典)
│   ├── species-admin.js (字典管理 UI + CSV 匯入)
│   ├── plot-geometry.js (樣區幾何 + 坡度修正)
│   ├── plot-qaqc.js (QAQC 抽樣 + 誤差)
│   ├── plot-polygon.js (irregular plot)
│   ├── ai-species.js (PlantNet API + Claude LLM)
│   ├── ai-identify-modal.js (AI 辨識 modal UI)
│   ├── dem-elevation.js (open-meteo DEM)
│   ├── distribution.js (立木分布散布圖)
│   ├── import-wizard.js (Excel 匯入)
│   ├── project-status.js (狀態機)
│   └── ...
└── data/
    ├── species-final.csv (196 物種匯入用)
    └── species-top200-summary.md
```

---

## 十、demo 帳號建構流程（admin 現場示範）

1. admin Google 登入 → 我的專案頁面 → 新專案
2. 填 project code（如 DEMO-2026-001）+ 主持人 + 啟用模組
3. 加成員：輸入學員 Google email → 設角色（surveyor）
4. 學員那端：用同 email Google 登入 → 自動看到此專案
5. （學員要先在 PWA 登入過至少一次，admin 才能加 — Firestore users doc 要存在）

---

## 十一、注意事項 / 限制

- **網路需求**：所有功能需要連網（Firestore + AI + DEM）。離線可填，回連自動同步（Firestore offline persistence）。AI 辨識**完全需要連網**。
- **手機相機權限**：拍照前瀏覽器會問權限，要點允許。
- **GPS 權限**：要點允許。失敗有手動輸入 fallback。
- **AI 配額**：PlantNet free 500/day，Haiku 看加值多少。
- **保育類樹種**：picker 自動標 ⚠ I/II/III 級。
- **碳量計算精度**：±20% 不確定性（IPCC tier-2 fallback 對非 species-specific 物種）— 公式來源徽章 🟢🟡🟠 透明顯示。
