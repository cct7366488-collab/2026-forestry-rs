# ForestMRV 測試

目前涵蓋：

| 測試 | 對象 | 需要 fixtures |
|---|---|---|
| `test-shapefile-loader.mjs` | **Shapefile 邊界上傳**（`pwa/js/shapefile-loader.js`，v2.11.91 / v2.11.92） | 是 |
| `test-boundary-containment.mjs` | **樣區界內／界外判定**（`plot-polygon.js` 的 `isPointInBoundaryGeoJson`，v2.11.93） | 否 |
| `browser-image-compress.html` | **上傳前影像壓縮**（`image-compress.js`，v2.11.95）— 只能在真瀏覽器跑 | 否 |
| `test-rules-users.mjs` | **`/users` 安全規則**（自我提權漏洞，v2.11.96）— 需 `firebase login` | 否 |

```bash
node test-rules-users.mjs
```

本機沒有 Java、跑不了 Firestore emulator，而 `scripts/` 下的 owner-token 腳本走 REST 會**繞過**
Security Rules、證明不了規則擋不擋得住。這支改走 Firebase 的 `firebaserules projects.test` API
（Rules Playground 背後那支）：把規則原始碼連同模擬請求送上去、由 Google 端評估回傳 ALLOW／DENY，
不需 emulator、不寫入任何資料。`get()` 一律以 `functionMocks` 回應，不依賴線上實際資料。

用 `--rules <路徑>` 可指向別的規則檔。修補當下即以此拿修補前的舊規則回跑，確認三個自我提權
案例在舊規則下確實被 ALLOW（漏洞為真、測試不是空轉）：

```bash
node test-rules-users.mjs --rules /path/to/old/firestore.rules
```

```bash
node test-boundary-containment.mjs
```

界外判定直接決定地圖上樣區點位標不標紅，誤判會讓調查員白跑現場、漏判則等於警訊失效；
測試釘死 ray casting 的三個典型破口（凹多邊形凹口、孔洞環、MultiPolygon 只中其中一塊），
並確認「判不出來時回 `null` 而非 `false`」——否則沒上傳邊界的專案會整批被誤標成紅點。

## 為什麼需要這組測試

Shapefile 是二進位多檔格式，光讀程式碼看不出「Big5 有沒有解對」「zip 有沒有解開」
「投影對不對」。這裡一律用 geopandas 產的**真檔**驗，不用 mock；
座標刻意取橫流溪一帶，讓測試能斷言「最終一定落在台灣中部」，而不是只比對數字有沒有變動。

## 跑法

### 壹、產生 fixtures（第一次、或改過 `make_fixtures.py` 才需要）

需要 Python + geopandas。

```bash
python make_fixtures.py
```

產出 `fixtures/`（已 gitignore，隨時可重生）：

| 案例 | 內容 | 驗什麼 |
|---|---|---|
| case1 | WGS84 + `.prj` + UTF-8 `.cpg` | QGIS 標準輸出 |
| case2 | TWD97 + `.prj` + **Big5 且無 `.cpg`** | 台灣政府圖資最常見的坑 |
| case3 | TWD97 **無 `.prj`** | 座標範圍自動判斷 CRS |
| case4 | 線圖層 | 應擋下並給明確訊息 |
| case5 | zip（deflate） | 原生 DecompressionStream |
| case6 | zip（stored 未壓縮） | ZIP method=0 分支 |
| case7 | 20×25 m 樣區 | 樣區路徑：local m 換算、面積 |

### 貳、Node 回歸測試

```bash
node test-shapefile-loader.mjs
```

第三方 UMD（shpjs、proj4）會自動下載到 `.cache/`，版本與 `pwa/index.html` 的 CDN 標籤對齊；
改版時只要改 `_harness.mjs` 的 `VENDOR` 常數。

涵蓋兩條下游路徑：

- 專案邊界 → `parseProjectBoundaryGeoJson()`（絕對座標、CRS 自動偵測）
- 樣區邊界 → `parseGeoJsonPolygon()`（local m 換算、`VERTEX_MAX`、Shoelace 面積）

### 參、真瀏覽器驗證

有三件事 Node 測不到、只有瀏覽器算數：`TextDecoder('big5')` 的行為、
原生 `DecompressionStream('deflate-raw')`、shpjs 走 `<script>` CDN lazy load。

從 `modules/森林監測App/` 這一層起服務（讓 `../pwa` 與 `./fixtures` 都拿得到）：

```bash
python -m http.server 8765
```

再開 <http://localhost:8765/tests/browser-shapefile-loader.html>
與 <http://localhost:8765/tests/browser-image-compress.html>（後者不需 fixtures，素材在頁內即時產生；
另附手動拖檔區，可拿真手機原檔看實際壓縮率）。

> 影像壓縮那支之所以只能在瀏覽器跑：canvas、`toBlob()`、影像解碼全是瀏覽器 API。
> 開發時踩到的雷已寫進測試註解——`img.decode()` 在某些環境圖片明明載入完成 promise 卻永不 resolve
> （改用 `onload`），以及「壓完反而變大」這條分支需要極小的純色 PNG 才測得到。

> 本目錄不在 firebase hosting 的 public（`pwa/`）底下，**不會被部署**。

## 改動 shapefile-loader 後請至少跑完 壹＋貳

瀏覽器那支在動到編碼、解壓、CDN 載入邏輯時務必補跑。
