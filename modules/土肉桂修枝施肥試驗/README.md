# 土肉桂修枝施肥試驗 — ETL 模組

將「土肉桂修枝矮化及施肥對生長影響之研究」的**長格式 Excel**轉成 **ForestMRV 複查（路 I）payload**，匯入監測系統做多期生長追蹤。

## 試驗設計
- 析因試驗：2（修剪 0/1）× 2（施肥 0/150g）＋對照，共 4 處理（C0／P1／F150／P1F150）
- 4 樣區：`115121`（大安溪 15-20 年生成熟林，量胸徑）、`117218`／`811`／`8110`（1-2 年生幼齡林，量地徑）
- 3 期複查：114Q3 / 114Q4 / 115Q1
- 樹種：土肉桂 *Cinnamomum osmophloeum*

## 設計決策（2026-06-09 拍板）
1. **處理建模 → 16 個 plot**（樣區×處理），plotCode = `{樣區}-{處理}`（如 `115121-C0`）
2. **多莖 → 聚合成一棵**：dbh = 二次平均徑 Dq = √(Σd²/n)；樹高 = 各莖算術平均
3. **碳量 → 本輪全部不算**（含成熟林）；幼齡區 `diameterType='basal'` 旗標備查，115121 為 `'breast'`
4. **日期 → 推定季末**（114Q3=2025-09-30、114Q4=2025-12-31、115Q1=2026-03-31）＋ `dateProvisional=true`
5. **物種 → seed** 土肉桂（verified=false，後續補保育/木材參數）

## 清洗規則
- 丟棄 `樣木編號=0` 的 `leading_blank_treeno` 解析雜訊列（null 徑；共 8 列、影響 6 單元各 −1 株，已列報於 QA 交叉驗證）
- 活立木單莖徑空值：Dq 只取非空莖
- 死亡判定：某樹某期「全莖死亡」→ 該樹該期 `resurveyFate=dead`、`vitality=standing-dead`、dbh/h=null
- 缺期（如 117218 部分樹未於 115Q1 複查）：該期不建 measurement，tree 頂層持「最後有資料期」快照

## 用法
```powershell
$env:PYTHONIOENCODING="utf-8"
python etl_long_to_forestmrv.py
```
輸出至 `dry-run/`：
- `payload.json` — projects→plots→trees→measurements 結構（供後續 node-admin writer 消費）
- `qa_crosscheck.csv` — 與檔案自帶「QA摘要」逐單元比對（獨立樣木數、死亡數）
- `_summary.txt` — 人讀摘要

## DRY-RUN 結果（2026-06-09）
- 16 plots／480 trees／1,428 measurement docs／≈1,924 Firestore 寫入
- **QA 交叉驗證：死亡數 0 不符**；獨立樣木數僅 6 單元 −1（＝刻意丟棄的 `樣木編號=0` 雜訊，符合預期）

## 後續（未做）
- **node-admin Firestore writer**：消費 `payload.json` 寫入 prod（`forestry-rs-monitor`）。**須先 prod 備份**，再建專案 `CINNAMON-TRIAL` + 16 plots + trees + measurements。
- 真實調查日期回填（取代 provisional 季末日）
- 土肉桂專屬木材密度/BEF → 補碳量計算

## ⚠ 資料治理
- 本腳本 + 範例 → commit GitHub。
- **資料正本（payload / Firestore）走 Firebase**，本機 `dry-run/` 僅工作副本。
- 來源 xlsx 不在本 repo（在 H:\…林業技師事務所\標案\…）。
