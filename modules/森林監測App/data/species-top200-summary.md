# Species Top-200 Draft — Summary 報告

- 檔案：`modules/森林監測App/data/species-top200-draft.csv`
- 編碼：UTF-8 NO BOM（已驗證 first 3 bytes = `72 61 6E` = "ran"）
- Schema 版本：v2.10（18 欄）
- 產出時間：2026-05-02

---

## 壹、欄位 Schema

| # | 欄位 | 說明 |
|---|------|------|
| 1 | rank | 1-200，常見度排序 |
| 2 | zh | 中文名（與 species-dict.js 一致） |
| 3 | sci | 學名（不含 author） |
| 4 | aliases | 別名，分號分隔 |
| 5 | family | 科 |
| 6 | genus | 屬 |
| 7 | treeType | broadleaf / conifer / bamboo / palm / mangrove |
| 8 | elevationMin_m | 海拔下限（公尺） |
| 9 | elevationMax_m | 海拔上限（公尺） |
| 10 | forestTypePreference | 林型偏好，分號分隔 |
| 11 | conservationGrade | I / II / III / 空白 |
| 12 | woodDensity_g_cm3 | 木材基本密度 |
| 13 | woodDensitySource | taiwan-tfri / ipcc-tier2 / ipcc-tier1-global / genus-default |
| 14 | equationSource | species-specific / genus-default / type-default-ipcc |
| 15 | equationConfidence | high / medium / low |
| 16 | equationCitation | 文獻引用 |
| 17 | notes | 備註 |
| 18 | _confidence | 整列資料的信心評估（low 者請優先 review） |

---

## 貳、統計摘要

### 一、treeType 分布
| treeType | count | 占比 |
|----------|-------|------|
| broadleaf | 148 | 74.0% |
| conifer | 30 | 15.0% |
| bamboo | 9 | 4.5% |
| palm | 8 | 4.0% |
| mangrove | 5 | 2.5% |
| **合計** | **200** | 100% |

### 二、equationSource 分布
| equationSource | count | 占比 |
|----------------|-------|------|
| species-specific | 29 | 14.5% |
| genus-default | 57 | 28.5% |
| type-default-ipcc | 114 | 57.0% |
| **合計** | **200** | 100% |

註：species-specific 29 筆即 `species-equations.js` 的 SP map（24 直接定義 + 透過 alias 解析到 SP 的物種，如紅楠/香楠/大葉楠/烏心石/牛樟 → 楠木類；青剛櫟/赤皮/長尾尖葉櫧 → 櫧櫟類；台灣赤楓/楓香 → 闊葉式）。

### 三、equationConfidence 分布
| equationConfidence | count |
|--------------------|-------|
| high | 25 |
| medium | 143 |
| low | 32 |

### 四、_confidence 分布（整列）
| _confidence | count |
|-------------|-------|
| high | 130 |
| medium | 52 |
| low | 18 |

---

## 參、_confidence='low' 清單（user QA 優先看）

以下 18 筆有較高不確定性，建議林業專家優先核對。多數為（1）分類學變動、（2）分布資料稀少、（3）藤本/樹蕨/灌木幼株被列入但材積估算困難、（4）罕見特有種或同屬借用無充分依據。

| rank | zh | 主要疑點 |
|------|----|----------|
| 49 | 油葉石櫟 | 分類地位與小西氏石櫟有爭議，可能應併入 |
| 90 | 小葉白蠟樹 | 台灣分布資料稀少，是否常見有疑 |
| 112 | 欖仁舅 | 南部低海拔分布細節需確認 |
| 114 | 水筆仔屬其他 (Bruguiera gymnorrhiza) | 野生在台灣已滅絕；是否仍納入 |
| 133 | 鬼石櫟 | 分布資料少 |
| 134 | 赤柯 (Limlia uraiana) | 屬名分類學變動，與 Castanopsis 區分仍有討論 |
| 135 | 圓葉布勒登 | 是否為台灣常見次生種有疑 |
| 155 | 水黃皮屬其他 (Pongamia glabra) | 已是 Pongamia pinnata 同義詞，建議移除 |
| 156 | 茄苳屬其他 (Bischofia polycarpa) | 與 Bischofia javanica 是否為獨立種有爭議 |
| 162 | 鋸葉長尾栲 | 罕見台灣特有種，分布資料少 |
| 163 | 南華氏鈍葉櫟 | 學名格式與分類爭議大 |
| 166 | 包籜矢竹 | 北部低海拔的竹屬，常見度有疑 |
| 168 | 長枝竹 | 與刺竹屬其他種區分困難 |
| 170 | 八角金盤 (Trevesia palmata) | 台灣自然分布存疑，可能僅栽培 |
| 176 | 森氏紅淡比 | 變種地位有疑 |
| 181 | 克蘭樹 | 南部低海拔分布需確認 |
| 188 | 倒地鈴 | 是藤本草本，並非樹木，應移除或歸入特例 |
| 199 | 野桐屬其他 (Mallotus repandus) | 為藤狀小喬木，分布細節需確認 |

---

## 肆、與既有 species-dict.js TREES (98 種) 的差異 (diff)

### 一、學名校正
- 原 `光蠟樹: Fraxinus formosana` → CSV 保留同學名（rank 25）
- 原 `茄苳: Bischofia javanica` → CSV 保留（rank 18），另新增 `Bischofia polycarpa` (rank 156, _confidence=low) 供 user 判斷

### 二、cons 補全
原 TREES 中下列物種 cons 為 null，但本 CSV 依 2019 修訂《保育類野生動植物名錄》補上：
- （無新增 cons 變更 — TREES 中 cons=null 的物種大多確實非保育類，已維持）
- 既有 cons 已標註者（紅檜以外的 8 種）保留：台灣油杉 I、台灣穗花杉 I、台灣紅豆杉 II、蘭嶼羅漢松 II、牛樟 II

### 三、新增 102 種（rank 99-200）
主要補充類別：
- **紅樹林**（再補 2 種）：Bruguiera 屬殘留紀錄
- **海岸林**（10+ 種）：林投、椰子、檳榔、蒲葵、台灣海棗、棋盤腳、水黃皮、刺桐、黃槿、欖仁、銀葉樹、蓮葉桐、瓊崖海棠、大葉山欖、白千層
- **特有種與保育類**（5 種）：台東蘇鐵 II、烏來杜鵑 I、百日青 II、台灣黃杉 II、筆筒樹 II
- **次生先驅**（補 6 種）：野桐、白匏子、粗糠柴、構樹（既有 alias 補入）、楊梅
- **殼斗科特有種與廣布種**（10+ 種）：森氏櫟、錐果櫟、狹葉櫟、台灣栲、卡氏櫧、大葉石櫟、烏皮石櫟、鋸葉長尾栲、高山櫟、烏來柯、短尾葉石櫟
- **杜鵑屬與杜鵑林帶**（4 種）：金毛杜鵑、玉山杜鵑、森氏杜鵑、西施花
- **行道樹/觀賞造林**（10+ 種）：黃花風鈴木、藍花楹（已在 TREES 中）、阿勃勒、鐵刀木、鳳凰木、羊蹄甲、洋紫荊、馬拉巴栗、美人樹、木棉、吉貝、南洋杉、肯氏南洋杉、銀杏、水杉、落羽松、榔榆
- **果樹/經濟林**：荔枝、龍眼（已在）、芒果（已在）、枇杷、山枇杷、土沉香、檳榔
- **針葉樹補強**：華山松、馬尾松、黑松、大葉羅漢松、百日青、竹柏、台灣黃杉、水杉、落羽松、南洋杉、肯氏南洋杉
- **竹類補強**（6 種）：孟宗竹、麻竹、刺竹、玉山箭竹、包籜矢竹、綠竹、長枝竹、蓬萊竹
- **油桐類**（2 種）：千年桐 (Aleurites)、木油桐 (Vernicia) — 兩者常被混淆
- **入侵種**：銀合歡（同時為 species-equations.js 中的 species-specific 物種，rank 200）

### 四、TREES 原有 98 種 → 全部保留並擴 enriched 欄位
無刪除。`species-dict.js` 的 TREES 為 CSV rank 1-98 的子集（順序略調以將最常見物種前移）。

---

## 伍、給 user 的 review 建議

1. **優先看 _confidence='low' 的 18 筆** — 上表已列。決定是否移除（如倒地鈴、八角金盤、Pongamia glabra）。
2. **複查 wood density 欄位** — 標 `taiwan-tfri` 但僅憑記憶填入的數字，建議由 林試所木材性質手冊覆核。可疑值：
   - 木麻黃 0.85（實值 0.83-0.95，OK）
   - 檸檬桉 0.85（高，但接近文獻）
   - 銀葉樹 0.85（高密度海岸樹，OK）
   - 紅海欖 0.85、欖李 0.85（紅樹林典型高密度，OK）
3. **檢視 forestTypePreference 集合是否完整** — 目前 12 類，若需補（如「沼澤森林」、「珊瑚礁石灰岩」）請告知。
4. **海拔範圍** — 多數沿用一般性「低/中/高」分布概念；若要更精確（特定事業區、林班），需另查文獻。
5. **保育等級 (conservationGrade)** — 已參照 2019 修訂名錄，但若 2024-2026 有公告新版，需重新校對。
6. **Equations 對應**：
   - 29 筆 species-specific 的 citation 直接抄 species-equations.js 的 source 欄
   - 57 筆 genus-default 走同屬借用
   - 114 筆 type-default-ipcc 走 IPCC 2006 LULUCF Vol.4 Ch.4 fallback
   - 對於 carbon-volume-calculator skill，CSV 的 equationSource 欄可直接用於決定計算路徑

---

## 陸、後續工作（非本 turn）

- [ ] User review CSV 後，回饋意見
- [ ] 修訂版 → 透過 PWA 批次匯入 wizard 寫入 Firestore species collection
- [ ] 同步更新 species-dict.js 的 TREES（增量；不在本 turn 改）
- [ ] 對於有實證生長量資料（如陳朝圳老師樣區）的物種，可進一步補 species-specific equation
