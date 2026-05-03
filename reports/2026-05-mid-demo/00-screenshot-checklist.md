# ForestMRV 工作坊素材 — 截圖拍攝 checklist

> 50 張截圖，依「角色 + 裝置 + 場景」分 7 批拍攝。每批一次到位，避免反覆切換帳號／裝置。
> 拍完一張勾一張 ☐ → ☑。完成後把檔案放進 `_build/images/`，依下方建議檔名命名。

**進度**：☐ 0 / 50

---

## 拍攝前置

### A. 環境
- [ ] 已輪換的 Anthropic + PlantNet API key 已重新貼進 PWA admin 全域（**否則 AI 辨識相關截圖全廢**）
- [ ] admin 帳號（cct7366488 系列）已準備
- [ ] 1 個示範 surveyor 帳號（建議用個人 Gmail，與 admin 分離）
- [ ] 1 個示範 reviewer 帳號（同上）
- [ ] 桌機瀏覽器：Chrome（含 PWA 安裝圖示）+ 開發者工具關閉
- [ ] 手機瀏覽器：Chrome / Safari（拍 PWA 安裝、相機 capture、GPS 等手機限定畫面）
- [ ] **截圖前清版**：開無痕視窗或刪除其他 tab，避免上方 tab bar 露出與工作坊無關的資訊

### B. 截圖規格
- 桌機畫面：1920×1080，視窗最大化，顯示 100%
- 手機畫面：直拍 1080×2340 或類似比例，狀態列保留
- **建議副檔名**：`.png`（無壓縮，文字清晰）
- **檔名格式**：`{編號}-{簡述}.png`（編號用 M01 / H01 / P01 三系列）

### C. 預先建好的 demo 資料（見 `00-demo-project-SOP.md`）
- [ ] 「示範林班 2026」專案已建（DEMO-2026-001）
- [ ] 至少 2 個樣區（一個矩形 20×25 + 一個圓形或不規則）
- [ ] 至少 5–10 棵立木（含 1 棵 🟢綠 + 1 棵 🟡黃 + 1 棵 🟠橘 公式徽章）
- [ ] 至少 1 棵已用 AI 辨識並寫入照片
- [ ] 至少 1 個 plot 已 verified（供 reviewer 抽樣示範）

---

## 批 1 — admin 桌機（系統入口 + 字典 + AI 全域）｜共 7 張

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 1 | M01 | `M01-首頁版本徽章.png` | ForestMRV 首頁（含 v2.11.7 版本徽章）| admin 登入後不點任何專案，停留首頁 | 手冊 壹章末（系統總覽）|
| 2 | M04 | `M04-admin首頁全系統概況.png` | admin 登入後的首頁，含 admin 徽章與全系統概況 | 同上，加上 admin 徽章與「全系統概況」區塊清晰可見 | 手冊 肆-一 |
| 3 | M05 | `M05-字典管理頁.png` | 樹種字典管理頁，左列表 + 右編輯區 | admin 首頁右上頭像 → 「📚 樹種字典管理」，左列表選一筆樹種讓右側編輯區有內容 | 手冊 肆-三 |
| 4 | M06 | `M06-AI全域設定modal.png` | AI 辨識全域設定 modal（admin 編輯模式）| 任一專案 → 任一樣區 → 任一立木 → 「+ 新立木」→ 「📸 AI 辨識」→ 右上「⚙️ 編輯全域設定」（**API key 欄位請塗黑或改為示意文字 `sk-xxx`**）| 手冊 肆-四 / PPT slide32 替代 |
| 5 | M02 | `M02-Firestore資料結構.png` | Firebase Console 中的 Firestore 資料結構檢視畫面 | Firebase Console → Firestore → 展開 `projects/{}/plots/{}/trees/{}` 的層級，**截圖前確認 `app_settings/aiConfig` 不在畫面內**（避免再度曝光 key）| 手冊 貳章末 |
| 6 | M03 | `M03-成員角色下拉.png` | 專案成員管理頁面 + 角色下拉選單 | admin 進「示範林班 2026」→ 設定 → 成員管理 → 點某成員角色下拉打開 | 手冊 參章末 |
| 7 | M07 | `M07-PI專案管理含lock.png` | PI 端的專案管理介面，含成員管理與 lock 按鈕 | 切到 PI 帳號（或 admin god view 模擬 PI 視角）→ 進專案 → 設定，畫面包含成員列表與 🔒 lock 按鈕 | 手冊 伍章末 |

**批 1 小結**：☐ 7 張 — 全部桌機 admin / PI 視角

---

## 批 2 — 工作坊宣傳照（人像 / 外景）｜共 2 張

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 8 | P01 | `P01-講者照片.png` | 講者照片 | user 自拍或現有專業頭像，建議方形比例 800×800 | PPT slide 3 |
| 9 | P02 | `P02-野外調查照.png` | 野外 surveyor 調查照片 | 既有的紙漿廠樣區現場照，或任一張野外執業照（含人物 + DBH 卷尺 / 手機操作 PWA 的構圖更好）| PPT slide 5 |

**批 2 小結**：☐ 2 張 — 不需登入系統，可從相簿直接挑

---

## 批 3 — surveyor 桌機（登入 + 進專案 + 分頁）｜共 6 張

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 10 | P03 | `P03-登入頁專案卡片.png` | 登入頁 + 專案卡片（合成圖或兩張並列）| surveyor 登出狀態 → 截登入頁；登入後 → 截「我的專案」列表（含「示範林班 2026」卡片）。可在 PowerPoint 內並排 | PPT slide 18 |
| 11 | M08 | `M08-Chrome安裝圖示.png` | Chrome 「安裝」圖示位置 | Chrome 桌機開 forestry-rs-monitor.web.app，網址列右側「⊕ 安裝」圖示要在畫面內，**用標註框紅圈圈起** | 手冊 陸-(二) |
| 12 | M09 | `M09-專案首頁分頁列.png` | 專案首頁與分頁列 | surveyor 進「示範林班 2026」→ 預設停在「樣區」分頁，畫面要看得到頂部分頁列：📍樣區 / 🌳立木 / 📊 dashboard / ⚙ 設定 | 手冊 陸-(三) |
| 13 | P08 | `P08-樣區subtab切換.png` | 樣區 subtab 切換（樣區概覽 / 立木 / regen / 設定 等子分頁）| 進任一樣區，截 subtab 列（樣區資訊 / 立木 / 自然更新 / 地被 / 水保 / 野生動物 等）| PPT slide 23 |
| 14 | H02 | `H02-PWA登入首頁.png` | PWA 登入首頁，可看到「Google 登入」按鈕 | surveyor 登出 → 開首頁，「使用 Google 登入」按鈕在中央 | hands-on 情境 1 |
| 15 | H03 | `H03-專案內6大分頁.png` | 專案內 6 大分頁列，當前停留在「樣區」分頁 | surveyor 進專案，分頁列完整露出（樣區 / 設計 / 待審核 / 儀表板 / 地圖 / 審查 / 匯出 / 設定）| hands-on 情境 1 |

**批 3 小結**：☐ 6 張 — 桌機 surveyor / admin（PWA 安裝那張可用 admin 拍）

---

## 批 4 — surveyor 手機（戶外建樣區 + GPS + 雙軸坡度）｜共 6 張

> ⚠ 戶外實拍才有真實 GPS 與環境感。建議在校園 / 試驗林空地一次拍完。

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 16 | P05 | `P05-樣區form.png` | 樣區 form（v2.10.9，含 GPS、形狀、坡度、日期欄位）| 手機開 PWA → 進專案 → 「+ 新樣區」→ form 全欄位捲到上方截一張 | PPT slide 20 |
| 17 | M10 | `M10-雙軸坡度面積計算.png` | 樣區表單的雙軸坡度輸入區，含即時面積計算 | 上述 form 中段：寬邊坡度 + 長邊坡度兩欄填入後，下方「areaSlope_m2」與「areaHorizontal_m2」即時顯示處 | 手冊 陸-二 |
| 18 | H04 | `H04-樣區建立form完整.png` | 樣區建立 form，含編號、GPS、形狀、坡度、日期等欄位 | 同 P05，但構圖把全欄位儘量塞進一張（手機長截圖）| hands-on 情境 2 |
| 19 | H05 | `H05-地圖分頁樣區點位.png` | 地圖分頁顯示新建樣區的位置點位 + popup | 樣區建立完成 → 點「地圖」分頁 → 點剛建好的樣區點 → popup 出現 | hands-on 情境 2 |
| 20 | M08-mob | `M08m-PWA手機安裝.png` | （備用）PWA 手機端「加到主畫面」步驟示意 | iOS Safari 分享按鈕展開 → 「加入主畫面」選項，或 Android Chrome 三點選單 → 「加到主畫面」| 手冊 陸-(二) 補充 |
| 21 | M13 | `M13-樣區verified對照.png` | 樣區列表，verified 與 pending 樣區的徽章對照 | 樣區列表至少有 1 個 verified（綠）+ 1 個 pending（灰）並列在同一畫面 | 手冊 陸末（自動切換 review）|

**批 4 小結**：☐ 6 張 — 全戶外手機，建議連帶批 5 一次拍完

---

## 批 5 — surveyor 手機 / 桌機（立木 + AI 辨識 + 子集合）｜共 10 張

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 22 | P06 | `P06-樹種picker下拉.png` | 樹種 picker 下拉（v2.10.5+，含搜尋框 + 海拔 band pills + 結果列表）| 進立木 form → 點樹種欄位 → picker 展開，搜尋「紅檜」讓結果與徽章顯示 | PPT slide 21 |
| 23 | M11 | `M11-樹種picker海拔band.png` | 樹種 picker 開啟狀態，含海拔 band pills 與徽章 | 同 P06，但海拔 pills（如「中海拔 1500-2500 m」）要明顯露出 | 手冊 陸-三 |
| 24 | H06 | `H06-立木form樹種picker.png` | 立木建立 form，最上方是樹種 picker 搜尋框 | 進立木 form 截上半部 | hands-on 情境 3 |
| 25 | P07 | `P07-立木form試算.png` | 立木 form + 試算欄（DBH/H 填好後，下方碳量試算與公式來源 label）| DBH=35、H=18 填入後，下方 5 欄試算（斷面積 / 材積 / 生物量 / 碳 / CO₂）+ 公式來源 label | PPT slide 22 |
| 26 | H07 | `H07-立木列表綠徽章.png` | 立木列表顯示新增的紅檜，右側有 🟢 綠色徽章 | 紅檜 submit 後返回立木列表 | hands-on 情境 3 |
| 27 | M06+ | `H08-AI全域設定4欄位.png` | AI 全域設定 modal，4 個欄位：PlantNet key / proxy URL / Claude key / Claude model | （= M06 同畫面，可重用一張）| hands-on 情境 4 |
| 28 | H09 | `H09-AI辨識modal主畫面.png` | AI 辨識 modal 開啟，含「拍照」按鈕、器官選擇器、辨識按鈕 | 立木 form → 「📸 AI 辨識」→ modal 主畫面（尚未拍照）| hands-on 情境 4 |
| 29 | M12 | `M12-AI拍照介面.png` | AI 辨識 modal 拍照介面 | 點「📷 拍照」後手機相機介面（capture=environment）| 手冊 陸-四 |
| 30 | H10 / P14 | `H10-辨識結果top3.png` | top-3 辨識結果列表，三色信心顯示 | 上傳葉照後辨識完成的 top-3 結果（含學名 / 中名 / 信心 % 三色）| hands-on 情境 4 + PPT slide 32 |
| 31 | P13 | `P13-AI辨識demo動圖.gif` ⚠ | AI 辨識 demo gif（拍照 → 辨識結果整段流程）| 用手機螢幕錄影 5–10 秒，後製剪成 gif（或備用：3 連張靜態圖）| PPT slide 28 |

**批 5 小結**：☐ 10 張 — 1 張為動圖，其餘可在室內模擬

---

## 批 6 — dashboard / per-plot 分析｜共 7 張

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 32 | P09 | `P09-Dashboard全專案.png` | Dashboard tab（v2.9.0+，全專案 KPI + DBH 直方圖 + IV 排名）| 進「示範林班 2026」→ dashboard 分頁 → 上半部 | PPT slide 24 |
| 33 | H12 | `H12-dashboard上半部.png` | dashboard 上半部：進度狀態卡 + 7 KPI + DBH 直方圖 | 同 P09 略微不同構圖 | hands-on 情境 5 |
| 34 | P10 | `P10-PerPlotDashboard.png` | Per-plot dashboard（v2.9.0 A，立木 KPI、碳量單位智能切換、公式來源覆蓋率）| dashboard 中部找「📍 per-plot 概況」分頁 → 切到 demo 樣區 | PPT slide 25 |
| 35 | H13 | `H13-公式來源覆蓋率KPI.png` | per-plot 概況：公式來源覆蓋率 KPI 卡，顯示 species-specific %、tree-type fallback %、generic % | 同 P10 局部放大公式來源 KPI 區 | hands-on 情境 5 |
| 36 | M19 | `M19-perPlot完整.png` | per-plot dashboard，含 KPI、DBH histogram、公式來源覆蓋率 | per-plot 完整一張長截圖 | 手冊 捌-四 |
| 37 | P11 | `P11-地圖立木分布.png` | 樣區地圖 + 立木分布散布圖（合成或並排）| 「地圖」分頁顯示樣區點位 + 進某樣區看立木 X/Y 分布散布圖 | PPT slide 26 |
| 38 | M18 | `M18-樹種組成熱力矩陣.png` | 樹種組成矩陣，含 4 metric 切換按鈕（株數 / BA / 碳 / IV%）| dashboard → 樹種組成矩陣模組（B 模組）| 手冊 捌-二 |

**批 6 小結**：☐ 7 張 — 全桌機 surveyor 視角

---

## 批 7 — reviewer QAQC + 簽發 + Excel｜共 12 張

> 需要先讓 demo project 進入 review 階段（所有 demo plots 標 verified），詳見 SOP。

| # | 編號 | 檔名建議 | 拍什麼 | 預備動作 | 對應素材 |
|---|---|---|---|---|---|
| 39 | P12 | `P12-QAQCtab入口.png` | QAQC tab（v2.7.17 + v2.8.1）| reviewer 進「示範林班 2026」→「🔍 審查（QAQC）」分頁 | PPT slide 27 |
| 40 | M14 | `M14-審查QAQC分頁入口.png` | reviewer 端的審查（QAQC）分頁入口 | 同 P12 局部 | 手冊 柒-一 |
| 41 | M15 | `M15-QAQCconfig面板.png` | QAQC config 設定面板 | 初次進 QAQC 分頁，config 面板含抽樣比例、tree per plot、各欄位閾值欄位 | 手冊 柒-二 |
| 42 | M20 | `M20-QAQC誤差直方圖.png` | QAQC 誤差直方圖，4 欄位並列（DBH / 樹高 / 坡度 / 面積）| dashboard 下方 QAQC 區塊（需先有重測資料）| 手冊 捌-五 |
| 43 | M16 | `M16-重測表單三色badge.png` | QAQC 重測表單，含原始值、重測值、誤差、三色 badge | 抽中 plot 的某棵樹 → 開重測表單 → 填重測值 → 三色 badge 顯示 | 手冊 柒-三 |
| 44 | H14 | `H14-合格簽發按鈕.png` | QAQC 重測結果列表，三色 badge 與「合格簽發」綠色按鈕 | 全部 flag 處理完後出現「✓ 合格簽發」按鈕的畫面 | hands-on 情境 6 |
| 45 | M17 | `M17-合格簽發確認對話.png` | 「合格簽發」確認對話框，含 QAQC 摘要 | 點「合格簽發」後彈出的確認 modal | 手冊 柒-三末 |
| 46 | M21 | `M21-Excel匯出選項.png` | Excel 匯出選項對話框，含 sheet 勾選 | dashboard 右上「📥 匯出 Excel」→ 對話框含 plots / trees / regen / 樹種組成 / QAQC 等 sheet 勾選 | 手冊 捌-六 |
| 47 | H11 | `H11-regen自然更新列表.png` | regen subtab 顯示新增的樟樹苗木紀錄 | 進樣區 → regen subtab → 新增一筆樟樹（h2 級、12 株、覆蓋度 60%）| hands-on 情境 5 |
| 48 | H01 | `H01-章節導引截圖示意.png` | 章節導引示意圖（任何能呈現「6 情境流程」的構圖；可截 hands-on docx 目錄頁本身）| 用 PowerPoint 或 Word 自製一張流程圖：情境 1 → 2 → ... → 6 | hands-on 章節導引 |
| 49 | M22 | `M22-新版本就緒橫幅.png` | 「新版本已就緒」橫幅樣式 | 觸發 PWA 自動更新（修改 service-worker.js 的 cache version 後 deploy；或截舊版橫幅截圖 archive）| 手冊 玖章末（FAQ）|
| 50 | (備用)| `extra-PWA安裝完成桌面.png` | 備用：PWA 安裝完成後的桌面捷徑 / 手機主畫面 icon | 手機主畫面看到 ForestMRV icon | 預備 |

**批 7 小結**：☐ 12 張 — reviewer 帳號 + 部分需手機 / 特殊狀態

---

## 拍攝後

- [ ] 全部 50 張放進 `_build/images/`，依檔名排序檢查無遺漏
- [ ] 開 `02-操作手冊-ForestMRV.docx` → Ctrl+F 搜尋「[此處插入 screenshot」→ 依編號逐一替換
- [ ] 開 `01-簡報-ForestMRV系統介紹.pptx` → 對應 slide 把 placeholder 文字框改為圖片
- [ ] 開 `03-現場練習指南-下午hands-on.docx` → 同上
- [ ] **重要：替換時記得清除 placeholder 文字方框**，避免照片下方仍有 `[此處插入...]` 殘字
- [ ] 全文搜尋 `XXX`、`此處插入`、`待補`、`TODO` 確認沒漏

---

## 拍攝風險清單

| 風險 | 對策 |
|---|---|
| 🔒 **API key 露出**（M02 / M06 / H08）| 截圖前用瀏覽器開發者工具改 input value 為 `sk-xxx` 示意，或截後用塗黑工具遮蔽 |
| GPS 截圖在室內無訊號 | 戶外或窗邊拍，或事先用「手動輸入」fallback 模擬 |
| AI 辨識需要連網 + 配額 | 拍前確認 PlantNet 配額未爆（free 500/day），手邊 1-2 片葉子備用 |
| 動圖（P13）後製麻煩 | 退而求其次：用 3 張靜態圖貼成「拍照 → 辨識中 → 結果」橫排 |
| 帳號切換頻繁 | 用 Chrome multi-profile 或無痕視窗開不同帳號避免登出登入 |
| 樣區地圖無資料 | demo project 至少建 2 plots 有 GPS 才看得到點位 |

---

**完成標準**：50 張全收 + 三份素材 placeholder 全部替換 + 全文無 `XXX` / `此處插入` 殘留 → 工作坊素材 ship-ready。
