# 森林監測 App（v1 MVP）

> 跨平台 PWA + Firebase，野外調查員手機/平板填表 → 即時同步雲端 → 主持人看儀表板。

---

## 壹、定位

對應 FMP 範本「肆、經營規劃方案 — 監測」的數位化收集工具。

| 項目 | 設定 |
|------|------|
| 部署形式 | PWA（瀏覽器直接開，可裝桌面圖示） |
| 後端 | Firebase（Auth + Firestore + Storage） |
| 離線 | ✅ Firestore offline persistence + IndexedDB |
| 平台 | iOS Safari / Android Chrome / 桌面瀏覽器 |
| 角色分層 | ① 調查員 ② 主持人 ③ 審查委員（唯讀） |
| GPS | 必填，TWD97 TM2 + WGS84 雙座標 + 林班界檢核 |
| 照片 | Firebase Storage，自動壓縮，EXIF 保留 |

---

## 貳、v1 MVP 範圍（2–3 週）

### 一、收集模組
1. 永久樣區（PSP）
2. 立木調查（含 DBH、樹高、活力、病蟲害、保育等級自動帶入）
3. 自然更新調查（苗高分級、優勢種、競爭植被）

### 二、即時分析
- 進度地圖（樣區完成度套疊林班）
- 林分結構摘要（直徑分布、樹種優勢度、蓄積/碳量初估）
- Excel/CSV 匯出（給後續 R/Python 分析用）

### 三、目標案件
**示範林班 DEMO**（假資料），位於蓮華池研究中心附近虛構座標。

---

## 參、目錄結構

```
森林監測App/
├── README.md                    ← 本檔
├── docs/
│   ├── 需求規格.md
│   ├── 資料schema.md
│   ├── Firestore-security-rules.md
│   └── Firebase-設定步驟.md     ← ⚠️ 跑這份才能讓 App 動起來
├── pwa/                          ← 程式本體
│   ├── index.html
│   ├── style.css
│   ├── manifest.json
│   ├── service-worker.js
│   ├── firebase-config.example.js  ← 複製成 firebase-config.js + 填值
│   ├── firestore.rules           ← 部署到 Firebase
│   ├── js/
│   │   ├── app.js                ← 主邏輯（路由+狀態）
│   │   ├── auth.js
│   │   ├── plot.js
│   │   ├── tree.js
│   │   ├── regen.js
│   │   ├── map.js
│   │   ├── dashboard.js
│   │   └── export.js
│   └── data/
│       └── 示範林班-boundary.geojson
└── seed-data/
    └── 示範林班-假資料.json
```

---

## 肆、跑起來的順序

1. 跟著 `docs/Firebase-設定步驟.md` 建 Firebase 專案、抄 config
2. 把 `pwa/firebase-config.example.js` 複製成 `firebase-config.js`，貼上 config
3. 部署 `pwa/firestore.rules` 到 Firebase Console
4. 用 Firebase Hosting 部署 `pwa/`（或本機 `python -m http.server` 先試跑）
5. 用 demo 帳號登入，灌入 seed-data，玩一輪流程

---

## 伍、技術棧（CDN，零 build）

| 用途 | 函式庫 |
|------|------|
| UI | Tailwind CSS（CDN） |
| Firebase SDK | v10 modular（CDN ESM import） |
| 地圖 | Leaflet 1.9 + 林班 GeoJSON |
| 圖表 | Chart.js 4 |
| Excel 匯出 | SheetJS（xlsx） |
| 座標轉換 | proj4js（WGS84 ↔ TWD97 TM2） |

**為何零 build？** 學術專案，要可直接被別人 fork 跑起來，不要 npm/webpack 增加門檻。
