# 資料 Schema（Firestore）

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
  plotShape: 'circle',             // 'circle' | 'square'
  plotAreaOptions: [500, 1000],    // 允許的面積選項（surveyor 只能挑這些）
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
| shape | enum | ✅ | `circle` / `square`（從 methodology 帶） |
| area_m2 | number | ✅ | （從 methodology 帶） |
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

### 五、`/projects/{projectId}/plots/{plotId}/regeneration/{regenId}`

新增同樣 4 欄 QA 欄位，其餘同 v1.0。

---

## 參、單位與格式約定

不變（同 v1.0）。

---

## 肆、計算公式

不變（同 v1.0）。

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
