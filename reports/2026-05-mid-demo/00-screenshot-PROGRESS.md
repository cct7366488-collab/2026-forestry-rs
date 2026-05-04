# Screenshot 進度追蹤（即時更新）

> 50 張總目標 → ✅ 15 自動完成 / 📸 24 你 snip / ❌ 11 跳過或 user 自備

## ✅ 已完成（15 張，存在 `_build/images/`）

| # | 編號 | 檔名 | 狀態 |
|---|---|---|---|
| 1 | M01 | `M01-首頁版本徽章.png` | 高品質 |
| 2 | M03 | `M03-成員角色下拉.png` | 高品質 |
| 3 | M04 | `M04-admin首頁全系統概況.png` | = M01 複本 |
| 4 | M05 | `M05-字典管理頁.png` | 高品質 |
| 5 | M07 | `M07-PI專案管理含lock.png` | = M03 複本 |
| 6 | M09 | `M09-專案首頁分頁列.png` | 高品質 |
| 7 | M10 | `M10-雙軸坡度面積計算.png` | 高品質 |
| 8 | M11 | `M11-樹種picker海拔band.png` | = P06 複本 |
| 9 | M13 | `M13-樣區verified對照.png` | 部分（plot 列表在下方） |
| 10 | P05 | `P05-樣區form.png` | = M10 早期版 |
| 11 | P06 | `P06-樹種picker下拉.png` | 高品質 |
| 12 | P08 | `P08-樣區subtab切換.png` | = M09 複本 |
| 13 | H03 | `H03-專案內6大分頁.png` | = M09 複本 |
| 14 | H04 | `H04-樣區建立form完整.png` | = M10 早期版 |
| 15 | H06 | `H06-立木form樹種picker.png` | = P06 複本 |

---

## 📸 你 snip 的 24 張（按最少切換順序）

### 工具
- **Snipping Tool**：`Win + Shift + S` → 框選範圍 → 自動到剪貼簿
- **直接存檔**：貼上到「小畫家」/ 任何畫圖工具 → 另存為 `_build/images/{檔名}.png`
- **進階替代**：Chrome F12 → 三點選單 → `More Tools → Capture screenshot`（畫質完美但只 viewport）

### 起點
1. 確保 Chrome 開著，登入 admin (`cct7366488@gmail.com`)
2. 點擊 ForestMRV tab 切到前景（**Claude 偵錯黑屏只影響我這邊截圖，不影響你眼睛看 + Snipping Tool**）
3. 從 https://forestry-rs-monitor.web.app 開始

---

### 批 A — 在 demo 專案底下（最多張，預估 12 張，~15 min）

**進入 demo 專案**：點「示範林班 2026」card

| # | 操作 | snip 後存檔名 |
|---|---|---|
| A1 | （已在專案首頁）| `H07-立木列表綠徽章.png` ← 但要先進 plot 1，見 A4 |
| A2 | 點「**儀表板**」tab → 滑到上半 | `P09-Dashboard全專案.png` + `H12-dashboard上半部.png`（同畫面複製2份）|
| A3 | 同畫面下方滑動到 per-plot 區，切到「示範林班-A 區」| `P10-PerPlotDashboard.png` + `H13-公式來源覆蓋率KPI.png` + `M19-perPlot完整.png`（同畫面複製 3 份）|
| A4 | 同畫面找到「樹種組成矩陣」區塊 | `M18-樹種組成熱力矩陣.png` |
| A5 | 滑到底找「QAQC 誤差直方圖」 | `M20-QAQC誤差直方圖.png` |
| A6 | 點「**地圖**」tab | `P11-地圖立木分布.png` + `H05-地圖分頁樣區點位.png`（同畫面複 2 份）|
| A7 | 點「**審查（QAQC）**」tab | `P12-QAQCtab入口.png` + `M14-審查QAQC分頁入口.png`（同畫面複 2 份）|
| A8 | QAQC 頁面找 config 設定面板 | `M15-QAQCconfig面板.png` |
| A9 | 滑下找抽中的 plot → 點某棵已抽樣樹 → 重測表單 | `M16-重測表單三色badge.png` + `H14-合格簽發按鈕.png` |
| A10 | 點「✓ 合格簽發」按鈕（**注意：點完別真的確認，只 snip 對話框**）| `M17-合格簽發確認對話.png` |
| A11 | **取消對話框**（不要簽發，留示範用）→ 點「**匯出**」tab → 點「📥 匯出 Excel」按鈕 → 對話框 | `M21-Excel匯出選項.png` |

---

### 批 B — Plot 內（在 A 跑完後接著做）

**從 A 結束後**：返回專案 → 樣區 tab → 點 `DEMO-2026-001-001`（Plot 1）

| # | 操作 | snip 後存檔名 |
|---|---|---|
| B1 | （在 plot 1 頁）→ 點「**立木調查**」subtab → 看到立木列表（7 株含徽章）| `H07-立木列表綠徽章.png` |
| B2 | 點「+ 新立木」開表單 → 輸入紅檜 / DBH 35 / 樹高 18 / X=5 / Y=5 | `P07-立木form試算.png`（看下方斷面積/材積/碳量試算）|
| B3 | 同畫面點「📸 AI 辨識」按鈕 → modal 開啟 | `H09-AI辨識modal主畫面.png` |
| B4 | modal 右上「⚙ 編輯全域設定」（admin 才可見）| `M06-AI全域設定modal.png` + `H08-AI全域設定4欄位.png`（**API key 欄位塗黑或改成 sk-xxx 示意再 snip！**）|
| B5 | 關 modal → 點「拍照」按鈕（手機才有相機，桌機就跳過）→ **如有 API key**：上傳一張葉照 → 等辨識 → snip top-3 結果 | `H10-辨識結果top3.png` + `P14-AI辨識結果modal.png` |
| B6 | 關 AI modal、關立木表單 → 點「**自然更新**」subtab → 「+ 新苗木」→ 填樟樹 / h2 級 / 12 株 / 60% | `H11-regen自然更新列表.png` |

---

### 批 C — 登入登出狀態（最後做，避免 reset 流程）

| # | 操作 | snip 後存檔名 |
|---|---|---|
| C1 | 右上「登出」→ 看登入畫面 | `H02-PWA登入首頁.png` + `P03-登入頁專案卡片.png`（並排合成或拍兩張）|

---

### 批 D — 你相簿挑（不需 PWA）

| # | 內容 | 存檔名 |
|---|---|---|
| D1 | 你的講者頭像（建議方形 800×800）| `P01-講者照片.png` |
| D2 | 任何一張野外調查照（含人物 + 卷尺/手機操作 PWA 構圖加分）| `P02-野外調查照.png` |

---

## ❌ 跳過的 11 張（特殊狀況）

| 編號 | 原因 | 替代方案 |
|---|---|---|
| M02 Firebase Console | 不同網站 + Google Cloud 登入 | 工作坊現場 demo 即可，不放手冊 |
| M08 Chrome 安裝圖示 | Chrome native UI（網址列右側 ⊕）| 你直接用 Snipping Tool 框 Chrome 網址列 |
| M08m iOS 加到主畫面 | iOS Safari 專屬 | 工作坊現場用真手機 demo |
| M12 AI 拍照介面 | 手機原生相機 capture API | 用真手機拍辨識流程 |
| P13 AI demo gif | 動圖製作 | 退而用 3 張靜態圖（拍照→辨識中→結果）|
| M22 新版本就緒橫幅 | 需觸發 SW update 事件 | 等下次 deploy 自然出現再截 |
| H01 章節導引示意 | docx 內容截圖 | 用 Word 「插入螢幕擷取」自動截 hands-on 目錄頁 |
| extra PWA 桌面 icon | OS 桌面 | 手機 PWA 安裝完截手機桌面 |

---

## 拍完後

對我說「**全拍完了**」我就：
1. 驗證所有 50 張就位
2. 寫個 PowerShell 腳本一次塞回 PPT/docx 對應 placeholder
3. 跑 A4 收工 (commit + push)

**或**你自己 Ctrl+F 找編號塞回 — 我幫不上忙。
