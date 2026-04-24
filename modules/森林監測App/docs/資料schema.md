# 資料 Schema（Firestore）

> v1 MVP 範圍。單位、座標、必填欄位都明列，避免實作時漂移。

---

## 壹、總覽（Collection 樹）

```
/users/{uid}                                  ← 使用者
/projects/{projectId}                         ← 案件（FMP 計畫）
  /plots/{plotId}                             ← 永久樣區
    /trees/{treeId}                           ← 立木（樣區子集合）
    /regeneration/{regenId}                   ← 自然更新（樣區子集合）
/lookups/species/{speciesId}                  ← 樹種字典（autocomplete 來源）
```

---

## 貳、Collections

### 一、`/users/{uid}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| email | string | ✅ | Firebase Auth 帶入 |
| displayName | string | ✅ | 中文姓名 |
| affiliation | string | ⭕ | 機構 |
| globalRole | enum | ✅ | `admin` / `user`（system-level） |
| createdAt | timestamp | ✅ | 自動 |

> 專案內角色（surveyor/pi/reviewer）放在 `/projects/{projectId}.members[uid]`，不放這裡（一個人可在不同專案有不同角色）。

### 二、`/projects/{projectId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| code | string | ✅ | 案件代碼，例：`DEMO`、`LHC-2026` |
| name | string | ✅ | 顯示名，例：「示範林班」 |
| description | string | ⭕ | |
| boundaryGeoJSON | string (JSON) | ⭕ | 林班界（簡單案件可省，用 plotsBBox 算） |
| coordinateSystem | string | ✅ | 預設 `TWD97_TM2` |
| members | map<uid, role> | ✅ | `{ uid1: "pi", uid2: "surveyor", ... }` |
| createdBy | uid | ✅ | |
| createdAt | timestamp | ✅ | |

### 三、`/projects/{projectId}/plots/{plotId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| code | string | ✅ | 全案唯一，例：`DEMO-001` |
| forestUnit | string | ⭕ | 林班-小班，例：「123-2」 |
| location | geopoint | ✅ | WGS84（Firestore 內建） |
| locationTWD97 | map | ✅ | `{ x: number, y: number }` |
| locationAccuracy_m | number | ⭕ | GPS 精度 |
| insideBoundary | bool | ⭕ | 是否落在 boundary 內（自動算） |
| shape | enum | ✅ | `circle` / `square` |
| area_m2 | number | ✅ | 例：500 |
| establishedAt | timestamp | ✅ | 設置日期 |
| photos | array<string> | ⭕ | Storage 路徑 |
| notes | string | ⭕ | |
| createdBy | uid | ✅ | |
| createdAt | timestamp | ✅ | |
| updatedAt | timestamp | ✅ | 每次寫入更新 |
| treeCount | number | ⭕ | 快取（Cloud Function 維護，v2） |
| basalArea_m2 | number | ⭕ | 快取 |

### 四、`/projects/{projectId}/plots/{plotId}/trees/{treeId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| treeNum | number | ✅ | 樣區內序號 |
| speciesZh | string | ✅ | 中文名 |
| speciesSci | string | ⭕ | 學名（autocomplete 帶入） |
| conservationGrade | string \| null | ⭕ | 保育等級（autocomplete 帶入：第 I/II/III 級 或 null） |
| dbh_cm | number | ✅ | 胸徑 |
| height_m | number | ✅ | 樹高 |
| branchHeight_m | number | ⭕ | 枝下高 |
| vitality | enum | ✅ | `healthy` / `weak` / `standing-dead` / `fallen` |
| pestSymptoms | array<string> | ⭕ | `["leaf-spot", "borer", ...]` |
| marking | enum | ⭕ | `paint` / `tag` / `none` |
| photos | array<string> | ⭕ | Storage 路徑 |
| notes | string | ⭕ | |
| basalArea_m2 | number | auto | 自動算：π × (DBH/200)² |
| volume_m3 | number | auto | 自動算（前端，用 carbon-volume-calculator 公式） |
| carbon_kg | number | auto | 自動算 |
| createdBy | uid | ✅ | |
| createdAt | timestamp | ✅ | |
| updatedAt | timestamp | ✅ | |

### 五、`/projects/{projectId}/plots/{plotId}/regeneration/{regenId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| speciesZh | string | ✅ | |
| speciesSci | string | ⭕ | |
| heightClass | enum | ✅ | `<30` / `30-130` / `>130` |
| count | number | ✅ | 該級株數 |
| competitionCover_pct | number | ⭕ | 0–100 |
| notes | string | ⭕ | |
| createdBy | uid | ✅ | |
| createdAt | timestamp | ✅ | |

### 六、`/lookups/species/{speciesId}`

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| zh | string | ✅ | 中文名 |
| sci | string | ✅ | 學名 |
| family | string | ⭕ | 科 |
| conservationGrade | string \| null | ⭕ | I / II / III / null |
| commonNames | array<string> | ⭕ | 別名 |

> v1：手動 seed 30 個常見樹種；v2：對接 `species-conservation-lookup` 全清單。

---

## 參、單位與格式約定

| 項目 | 單位 | 格式 |
|------|------|------|
| 長度 | m | 一位小數 |
| 胸徑 DBH | cm | 一位小數 |
| 面積 | m² | 整數 |
| 體積 | m³ | 三位小數 |
| 碳量 | kg | 一位小數 |
| 座標（WGS84） | 度 | 6 位小數 |
| 座標（TWD97 TM2） | m | 整數 |
| 時間 | UTC ISO8601 | Firestore Timestamp |

---

## 肆、計算公式（前端即時算，存欄位）

### 一、胸高斷面積（Basal Area, m²）
```
BA = π × (DBH / 200)²
```

### 二、單木材積（m³，**v1 用簡式，v2 對接 carbon-volume-calculator**）
```
V = 0.0000785 × DBH² × H × FormFactor
（FormFactor 預設 0.45；針葉 0.5、闊葉 0.45）
```

### 三、單木碳量（kg）
```
Biomass = V × WoodDensity（kg/m³）× BEF
Carbon = Biomass × 0.5（IPCC 預設碳分率）
```

> 預設 WoodDensity = 500 kg/m³, BEF = 1.4。**v2 接 carbon-volume-calculator 取樹種別參數。**

---

## 伍、Indexes（複合索引，部署時要建）

| Collection | Fields |
|------------|--------|
| `/projects/{p}/plots` | `createdBy ASC, createdAt DESC` |
| `/projects/{p}/plots` | `forestUnit ASC, code ASC` |
| `/projects/{p}/plots/{pl}/trees` | `treeNum ASC` |

> 開發初期會有自動提示，跟著 Firebase Console 連結建即可。
