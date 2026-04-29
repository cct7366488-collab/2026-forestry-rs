# 資料 Schema（Firestore）

> v2.6（2026-04-29，app v2.7.15）：樣區幾何 schema 升級 — plotShape 加 'rectangle'、新增 dimensionType（沿坡距 / 水平投影）、slopeDegrees / slopeAspect / slopeSource、areaHorizontal_m2（cos 校正）、migrationPending（既有資料待補登 flag）
> v2.5（2026-04-27）：立木個體座標（localX/Y + absolute TWD97/WGS84）+ methodology.plotOriginType
> v1.5（2026-04-25）：5 角色 + 方法學 + Lock + QA 機制
> 歷史：v1.0 簡易 schema（無 methodology / qa / lock）

---

## 壹、總覽（Collection 樹）

```
/users/{uid}                                  ← 使用者（含 systemRole）
/projects/{projectId}                         ← 案件（含 methodology / lock）
  /plots/{plotId}                             ← 永久樣區（含 qaStatus）
    /trees/{treeId}                           ← 立木（含 qaStatus）
    /regeneration/{regenId}                   ← 自然更新（含 qaStatus）
/lookups/species/{speciesId}                  ← 樹種字典
```

---

## 貳、Collections

### 一、`/users/{uid}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| email | string | ✅ | Firebase Auth 帶入 |
| displayName | string | ✅ | 中文姓名 |
| affiliation | string | ⭕ | 機構 |
| **systemRole** | enum | ✅ | `admin` / `member` — v1.5 重命名（原 globalRole） |
| createdAt | timestamp | ✅ | 自動 |

### 二、`/projects/{projectId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| code | string | ✅ | 案件代碼 |
| name | string | ✅ | 顯示名 |
| description | string | ⭕ | |
| boundaryGeoJSON | string (JSON) | ⭕ | 林班界 |
| coordinateSystem | string | ✅ | 預設 `TWD97_TM2` |
| **pi** | uid | ✅ | 主 PI 的 uid（members 中也會有） |
| members | map<uid, role> | ✅ | `{ uid1: 'pi', uid2: 'dataManager', uid3: 'surveyor' }` |
| **memberUids** | array<uid> | ✅ | members 的 keys 陣列（給 onSnapshot 查詢用） |
| **methodology** | map | ⭕ | 方法學設計（PI 設定，見下表） |
| **locked** | bool | ⭕ | 預設 false；true 後資料無法寫入 |
| **lockedAt** | timestamp | ⭕ | Lock 時間 |
| **lockedBy** | uid | ⭕ | Lock 者 |
| createdBy | uid | ✅ | 建立者（admin） |
| createdAt | timestamp | ✅ | |

#### `methodology` 子結構

```js
{
  targetPlotCount: 50,             // 目標樣區數
  plotShape: 'circle',             // v2.6：'circle' | 'square' | 'rectangle'
  plotAreaOptions: [500, 1000],    // 允許的面積選項（surveyor 只能挑這些）
  dimensionType: 'slope_distance', // v2.6：'slope_distance'（野外皮尺沿坡）| 'horizontal'（水平投影）— 預設 slope_distance；舊資料 normalize 預設 horizontal（最保守）
  plotOriginType: 'center',        // v2.5：'center'（plot.GPS=樣區中心，皮尺四象限） | 'corner'（plot.GPS=左下角，皮尺第一象限）
  required: {                      // 必填欄位開關
    photos: false,
    branchHeight: false,
    pestSymptoms: false
  },
  modules: {                       // 啟用的調查模組
    plot: true,
    tree: true,
    regeneration: true,
    understory: false,             // v2
    soil: false,                   // v2
    disturbance: false             // v2
  },
  description: '方法學說明文字...'
}
```

### 三、`/projects/{projectId}/plots/{plotId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| code | string | ✅ | 樣區編號 |
| forestUnit | string | ⭕ | 林班-小班 |
| location | geopoint | ✅ | WGS84 |
| locationTWD97 | map | ✅ | `{ x, y }` |
| locationAccuracy_m | number | ⭕ | GPS 精度 |
| insideBoundary | bool | ⭕ | |
| shape | enum | ✅ | v2.6：`circle` / `square` / `rectangle`（從 methodology 帶） |
| area_m2 | number | ✅ | 名目面積（單位由 dimensionType 決定，sloped or horizontal） |
| **plotDimensions** | map | ⭕ | v2.6：rectangle/square `{ width, length }` 或 circle `{ radius }`；單位 m |
| **dimensionType** | enum | ⭕ | v2.6：`slope_distance` \| `horizontal`；缺省 = methodology 帶；舊資料 normalize 預設 `horizontal` |
| **slopeDegrees** | number | ⭕ | v2.6：樣區平均坡度（°，0–90）；舊資料缺省為 0（平地） |
| **slopeAspect** | number | ⭕ | v2.6：坡向（°，0–360；0=北、順時針）；optional |
| **slopeSource** | enum | ⭕ | v2.6：`field`（野外斜度計）\| `dem`（DEM20m 推導）\| `dem_field_avg`（兩者平均；要同時有 slopeFieldDegrees + slopeDemDegrees） |
| **slopeFieldDegrees** | number | ⭕ | v2.6：野外斜度計值（slopeSource=`dem_field_avg` 時 reviewer 比對用） |
| **slopeDemDegrees** | number | ⭕ | v2.6：DEM 推導值（同上） |
| **areaHorizontal_m2** | number | ⭕ | v2.6：水平投影面積（m²）= `area_m2 × cos(slopeDegrees)`（dimensionType=`slope_distance` 時）；client 端寫入時自動算（見 `plot-geometry.js#computeAreaHorizontal`） |
| **migrationPending** | bool | ⭕ | v2.6：true = 待補登 v2.6 新欄位；migration helper（`migration-v2715.js`）批次標 |
| establishedAt | timestamp | ✅ | |
| photos | array<string> | ⭕ | Storage 路徑 |
| notes | string | ⭕ | |
| **qaStatus** | enum | ✅ | `pending` / `verified` / `flagged` / `rejected`（default `pending`） |
| **qaMarkedBy** | uid \| null | ⭕ | QA 標記者 |
| **qaMarkedAt** | timestamp \| null | ⭕ | QA 標記時間 |
| **qaComment** | string | ⭕ | QA 評論（v1.5 inline；v2 改子集合） |
| createdBy | uid | ✅ | |
| createdAt | timestamp | ✅ | |
| updatedAt | timestamp | ✅ | |

### 四、`/projects/{projectId}/plots/{plotId}/trees/{treeId}`

新增同樣 4 欄 QA 欄位（qaStatus / qaMarkedBy / qaMarkedAt / qaComment），其餘同 v1.0。

#### v2.5：立木個體座標（4 欄，林保署永久樣區格式）

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| **localX_m** | number | ⭕ | 樣區內局部 X 座標（m）；center 模式可正可負，corner 模式恆為正 |
| **localY_m** | number | ⭕ | 樣區內局部 Y 座標（m）；同上 |
| **locationTWD97** | map | ⭕ | `{ x, y }`：absolute = plot.locationTWD97 + (localX, localY)，自動算 |
| **location** | geopoint | ⭕ | WGS84：由 locationTWD97 反投影（proj4 EPSG:3826→EPSG:4326）自動算 |

**換算公式**（兩種 plotOriginType 公式相同，差別在 plot.locationTWD97 的語意）：
```
absX = plot.locationTWD97.x + localX_m
absY = plot.locationTWD97.y + localY_m
```
- **plotOriginType='center'**：plot.locationTWD97 是樣區中心；皮尺距中心可正可負
- **plotOriginType='corner'**：plot.locationTWD97 是樣區左下角；皮尺距左下恆為正

寫入時：filled by `forms.js openTreeForm` submit handler；schema 允許 null（既有立木 migration 補 null 即可）。

### 五、`/projects/{projectId}/plots/{plotId}/regeneration/{regenId}`

新增同樣 4 欄 QA 欄位，其餘同 v1.0。

---

## 參、單位與格式約定

不變（同 v1.0）。

---

## 肆、計算公式

不變（同 v1.0）。v2.6 新增坡度修正公式（見下節）。

### v2.6 坡度修正（slope correction）

```
areaHorizontal_m2 = area_m2 × cos(slopeDegrees × π / 180)   // 當 dimensionType='slope_distance'
areaHorizontal_m2 = area_m2                                  // 當 dimensionType='horizontal'
```

立木局部座標換算（沿等高線 X 不變、沿坡 Y 乘 cos）：
```
horizontalY_m = localY_m × cos(slopeDegrees × π / 180)        // dimensionType='slope_distance' 時
horizontalY_m = localY_m                                       // dimensionType='horizontal' 時
```

**MRV 對齊**：IPCC LULUCF 與 TMS 方法學的單位面積（m²/ha）皆指水平投影。`areaHorizontal_m2` 為碳計算 / 密度推算的分母；`area_m2` 留給野外管理（樣區放樣、皮尺驗收）。

實作見 `pwa/js/plot-geometry.js`。

---

## 伍、Indexes

新增：
- `/projects` — `memberUids ARRAY-CONTAINS` 自動建（單欄索引免設）
- `/projects/{p}/plots` — `qaStatus ASC, createdAt DESC`（給「待審核」清單）
- `/projects/{p}/plots/{pl}/trees` — `qaStatus ASC, createdAt DESC`
- `/projects/{p}/plots/{pl}/regeneration` — `qaStatus ASC, createdAt DESC`

開發時若 query 報 `index required`，跟著 Firebase Console 連結點下去自動建。

---

## 陸、v1.0 → v1.5 Migration

既有 2 專案（示範林班、大雪山林業合作社）需手動補欄位（見「Migration 指令清單」段，由實作後產生）。

關鍵新欄位：
- `/projects/{pid}.memberUids`：從 `members` 的 keys 取出
- `/projects/{pid}.pi`：等於 `members` 中 role=='pi' 的 uid
- `/projects/{pid}.methodology`：補預設樣板
- `/projects/{pid}.locked`：補 `false`
- 所有現有 plots/trees/regen：補 `qaStatus: 'pending'`

`/users/{uid}` 的 `globalRole` → `systemRole`：rules 同時讀兩個欄位過渡，最終手動 rename。

---

## 柒、v2.5 → v2.6 Migration（樣區幾何升級）

**策略（B 案）**：v2.7.15 schema 先落 db；migration helper 提供但**暫不在 prod 執行**（避免使用者看到一堆「待補登」黃 badge 卻沒地方填）。等 v2.7.16 UI 上線（樣區編輯加幾何欄位 + admin patch UI）後再批次標 `migrationPending=true`。

**Migration helper**：`pwa/js/migration-v2715.js`
- `await m.dryRun(projectId)` — 列出受影響樣區（不寫入）
- `await m.markPending(projectId, { execute: true })` — 批次標 `migrationPending=true` + 預設值

**預設值（最保守，避免錯誤套 cos）**：
```js
{
  slopeDegrees: 0,           // 平地假設
  slopeAspect: null,
  slopeSource: null,
  dimensionType: 'horizontal', // 假設既有 area_m2 已是水平投影（不再 cos 校正）
  areaHorizontal_m2: area_m2,  // 當 dimensionType='horizontal' → 直接 = area_m2
  migrationPending: true       // 提示需 reviewer / PI 補登真實坡度與 dimensions
}
```

**Reviewer 補登工作流**（v2.7.17 規劃）：
1. 樣區列表黃 badge「待補登幾何」→ 點開 patch UI
2. 依野外紀錄 / DEM 抽樣補 `slopeDegrees`、`slopeAspect`、`plotDimensions`、`dimensionType`
3. 補完後 `migrationPending: false`
4. 紙漿廠 19 樣區進 reviewer 抽樣現場核對 → 填 `slopeFieldDegrees` / `slopeDemDegrees` 比對誤差
