# -*- coding: utf-8 -*-
"""
土肉桂修枝施肥試驗 — 長格式 → ForestMRV 複查 payload ETL（DRY-RUN）
========================================================================
來源：土肉桂試驗_長格式.xlsx（工作表「長格式」，一列＝一株一莖一季）
輸出：dry-run/payload.json（projects→plots→trees→measurements 結構，供 node-admin writer 寫入 Firestore）
      dry-run/qa_crosscheck.csv（與檔案自帶 QA 摘要逐單元比對）
      dry-run/_summary.txt（人讀摘要）

⚠ 本腳本「不」寫入 Firestore。寫入由後續 node-admin writer 消費 payload.json，且須在 prod 備份後執行。

設計決策（2026-06-09 user 拍板）：
  - 處理建模：16 個 plot（樣區×處理），plotCode = {樣區}-{處理}
  - 多莖：聚合成一棵，dbh = 二次平均徑 Dq = sqrt(mean(d^2))；樹高 = 算術平均
  - 碳量：本輪全部不算（含成熟林）→ biomass/carbon/co2 = None
  - 幼齡 3 區量地徑 → diameterType='basal'（暫不算碳）；115121 成熟林 diameterType='breast'
  - 日期：載推定季末日 + dateProvisional=True
  - 物種：seed 土肉桂 Cinnamomum osmophloeum（verified=False）
"""
import pandas as pd
import numpy as np
import json, math, os

SRC = r"H:\我的雲端硬碟\cct\林業技師事務所\標案\012林業保育署台中分署\114-115年林業及自然保育署臺中分署轄區林業永續多元輔導計畫\土肉桂修枝矮化及施肥對生長影響之研究\土肉桂試驗_長格式.xlsx"
OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dry-run")

# 季別 → 期別 seq + 推定季末日（provisional）
SEASON_MAP = {
    "114Q3": {"seq": 1, "date": "2025-09-30"},
    "114Q4": {"seq": 2, "date": "2025-12-31"},
    "115Q1": {"seq": 3, "date": "2026-03-31"},
}
TREATMENT_ZH = {"C0": "對照", "P1": "修剪矮化", "F150": "施肥150g", "P1F150": "修剪+施肥150g"}
TREATMENT_FACTORS = {  # (pruning 0/1, fertilizer_g 0/150)
    "C0": (0, 0), "P1": (1, 0), "F150": (0, 150), "P1F150": (1, 150),
}
SPECIES_ZH = "土肉桂"
SPECIES_SCI = "Cinnamomum osmophloeum"


# 樟樹式（土肉桂 alias→樟樹）— 與 app species-equations.js 完全一致：V = a·D^b·H^c（D cm, H m, V m³）
CAMPHOR_EQ = {"a": 4.89823e-05, "b": 1.6045, "c": 1.25502, "bef": 0.637, "cf": 0.4691,
              "source": "羅紹麟·馮豐隆 1986 全省 power（土肉桂 alias→樟樹；公式信心 genus-default 🟡）"}


def compute_metrics(stem_rows, diameter_type, mean_h):
    """多莖逐莖計算後加總（whole-tree）。基面積純幾何（胸徑/地徑皆算）；
    材積/生物量/碳/CO₂ 僅胸徑（成熟林）算，地徑（幼齡）留 None 並標 carbonSkipped。"""
    eq = CAMPHOR_EQ
    ba_sum, v_sum, any_d = 0.0, 0.0, False
    for _, r in stem_rows.iterrows():
        d = r["直徑_cm"]
        if pd.isna(d):
            continue
        any_d = True
        d = float(d)
        ba_sum += math.pi * (d / 200.0) ** 2
        if diameter_type == "breast":
            h = float(r["樹高_m"]) if pd.notna(r["樹高_m"]) else (mean_h or 0)
            v = eq["a"] * (d ** eq["b"]) * (h ** eq["c"]) if h and h > 0 else 0
            if v < 0 or v > 100:
                v = 0
            v_sum += v
    if not any_d:
        return {"basalArea_m2": None, "volume_m3": None, "biomass_kg": None,
                "carbon_kg": None, "co2_kg": None, "carbonSkipped": None}
    basal = round(ba_sum, 4)
    if diameter_type == "breast":
        biomass_t = v_sum * eq["bef"]
        carbon_t = biomass_t * eq["cf"]
        co2_t = carbon_t * 44 / 12
        return {"basalArea_m2": basal, "volume_m3": round(v_sum, 3),
                "biomass_kg": round(biomass_t * 1000, 1), "carbon_kg": round(carbon_t * 1000, 1),
                "co2_kg": round(co2_t * 1000, 1), "carbonSkipped": None}
    return {"basalArea_m2": basal, "volume_m3": None, "biomass_kg": None,
            "carbon_kg": None, "co2_kg": None, "carbonSkipped": "juvenile-basal-diameter"}


def quadratic_mean(diams):
    arr = [float(d) for d in diams if pd.notna(d)]
    if not arr:
        return None
    return round(math.sqrt(sum(d * d for d in arr) / len(arr)), 2)


def arith_mean(vals):
    arr = [float(v) for v in vals if pd.notna(v)]
    if not arr:
        return None
    return round(sum(arr) / len(arr), 2)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    df = pd.read_excel(SRC, sheet_name="長格式")
    log = []

    # --- 清洗：丟棄解析雜訊列（樣木編號==0，leading_blank_treeno）---
    n0 = len(df)
    artifact = df[(df["樣木編號"] == 0)]
    dropped = artifact.groupby(["樣區代碼", "處理代碼", "季別"]).size().reset_index(name="dropped")
    df = df[df["樣木編號"] != 0].copy()
    log.append(f"原始列數 {n0} → 丟棄 樣木編號=0 雜訊 {n0 - len(df)} 列 → 剩 {len(df)} 列")

    project = {
        "code": "CINNAMON-TRIAL",
        "name": "土肉桂修枝矮化及施肥對生長影響之研究",
        "projectType": "research-monitoring",
        "species": {"zh": SPECIES_ZH, "sci": SPECIES_SCI, "verified": False},
        "design": "析因試驗 2(修剪)×2(施肥) + 對照；4 樣區 × 4 處理 × 3 期複查",
        "dataProvenance": "土肉桂試驗_長格式.xlsx（114-115 臺中分署多元輔導計畫）",
        "methodology": {
            "modules": ["tree-survey", "resurvey"],
            "plotOriginType": None,         # 無逐株座標
            "carbonComputed": False,        # 本輪不算碳
        },
        "notes": "日期為推定季末（provisional）；幼齡區量地徑；多莖以 Dq 聚合、樹高算術平均。",
    }

    plots = []
    qa_rows = []

    for (plot_code_num, trt), unit in df.groupby(["樣區代碼", "處理代碼"]):
        plot_code = f"{plot_code_num}-{trt}"
        diameter_type = "breast" if plot_code_num == 115121 else "basal"
        pruning, fert = TREATMENT_FACTORS[trt]
        area_ha = float(unit["面積ha"].iloc[0])
        compartment = str(unit["林班地"].iloc[0])
        stand_age = str(unit["林齡階段"].iloc[0])

        seasons_present = sorted(unit["季別"].unique(), key=lambda s: SEASON_MAP[s]["seq"])
        periods = []
        for i, s in enumerate(seasons_present):
            seq = SEASON_MAP[s]["seq"]
            nxt = seasons_present[i + 1] if i + 1 < len(seasons_present) else None
            periods.append({
                "seq": seq,
                "label": f"第{seq}期（{s}）",
                "season": s,
                "openedAt": SEASON_MAP[s]["date"],
                "closedAt": SEASON_MAP[nxt]["date"] if nxt else None,
                "dateProvisional": True,
                "note": None,
            })
        current_period = max(SEASON_MAP[s]["seq"] for s in seasons_present)

        trees = []
        for treeNum, tg in unit.groupby("樣木編號"):
            treeNum = int(treeNum)
            treeCode = f"{plot_code}-{treeNum:03d}"
            measurements = {}
            latest = None
            for s in seasons_present:
                seq = SEASON_MAP[s]["seq"]
                sg = tg[tg["季別"] == s]
                if len(sg) == 0:
                    continue  # 缺期：該期不建 measurement
                all_dead = (sg["狀態"] == "死亡").all()
                nstem = int(len(sg))
                if all_dead:
                    m = {
                        "periodId": seq, "season": s,
                        "dbh_cm": None, "height_m": None, "nstem": nstem,
                        "vitality": "standing-dead", "resurveyFate": "dead",
                        "diameterType": diameter_type,
                        "basalArea_m2": None, "volume_m3": None,
                        "biomass_kg": None, "carbon_kg": None, "co2_kg": None,
                        "carbonSkipped": None, "equationSource": None,
                        "recordedDate": SEASON_MAP[s]["date"], "dateProvisional": True,
                        "source": "etl-long-format",
                    }
                else:
                    dq = quadratic_mean(sg["直徑_cm"])
                    h = arith_mean(sg["樹高_m"])
                    met = compute_metrics(sg, diameter_type, h)
                    m = {
                        "periodId": seq, "season": s,
                        "dbh_cm": dq, "height_m": h, "nstem": nstem,
                        "vitality": "healthy", "resurveyFate": "alive",
                        "diameterType": diameter_type,
                        "basalArea_m2": met["basalArea_m2"], "volume_m3": met["volume_m3"],
                        "biomass_kg": met["biomass_kg"], "carbon_kg": met["carbon_kg"],
                        "co2_kg": met["co2_kg"], "carbonSkipped": met["carbonSkipped"],
                        "equationSource": (CAMPHOR_EQ["source"] if diameter_type == "breast" else None),
                        "recordedDate": SEASON_MAP[s]["date"], "dateProvisional": True,
                        "source": "etl-long-format",
                    }
                measurements[str(seq)] = m
                latest = m  # 最後一個有資料的期別 = tree doc 最新快照

            if not measurements:
                continue  # 無任何有效期別（理論上不會）

            tree = {
                "treeNum": treeNum,
                "treeCode": treeCode,
                "speciesZh": SPECIES_ZH,
                "speciesSci": SPECIES_SCI,
                "diameterType": diameter_type,
                # 最新期快照（持 tree doc 頂層）
                "dbh_cm": latest["dbh_cm"],
                "height_m": latest["height_m"],
                "vitality": latest["vitality"],
                "resurveyFate": latest["resurveyFate"],
                "nstem": latest["nstem"],
                # 無座標
                "localX_m": None, "localY_m": None, "locationTWD97": None,
                # 最新期即算量（成熟林=樟樹式全算；幼齡=僅基面積）
                "basalArea_m2": latest.get("basalArea_m2"),
                "volume_m3": latest.get("volume_m3"),
                "biomass_kg": latest.get("biomass_kg"),
                "carbon_kg": latest.get("carbon_kg"),
                "co2_kg": latest.get("co2_kg"),
                "carbonSkipped": latest.get("carbonSkipped"),
                "qaStatus": "imported",
                "measurements": measurements,
            }
            trees.append(tree)

            # QA cross-check 累計
            for s in seasons_present:
                pass  # 在下方統一算

        # 逐單元-季 QA：獨立樣木數 + 死亡株數（全莖死）
        for s in seasons_present:
            sg = unit[unit["季別"] == s]
            ntree = sg["樣木編號"].nunique()
            dead = sum(1 for _, tg2 in sg.groupby("樣木編號") if (tg2["狀態"] == "死亡").all())
            qa_rows.append({"plot": plot_code, "season": s, "trees_etl": int(ntree), "dead_etl": int(dead)})

        plots.append({
            "code": plot_code,
            "plotCodeNum": int(plot_code_num),
            "treatment": trt,
            "treatmentZh": TREATMENT_ZH[trt],
            "pruning": pruning,
            "fertilizer_g": fert,
            "area_ha": area_ha,
            "compartment": compartment,
            "standAge": stand_age,
            "diameterType": diameter_type,
            "species": {"zh": SPECIES_ZH, "sci": SPECIES_SCI},
            "periods": periods,
            "currentPeriod": current_period,
            "treeCount": len(trees),
            "trees": trees,
        })

    payload = {"project": project, "plots": plots}

    # --- 與檔案自帶 QA 摘要交叉驗證 ---
    qa_src = pd.read_excel(SRC, sheet_name="QA摘要")
    qa_src = qa_src.rename(columns={"樣區": "plot_num", "處理": "trt", "季別": "season",
                                    "獨立樣木數": "trees_file", "死亡數": "dead_file"})
    qa_src["plot"] = qa_src["plot_num"].astype(str) + "-" + qa_src["trt"]
    qa_etl = pd.DataFrame(qa_rows)
    merged = qa_etl.merge(qa_src[["plot", "season", "trees_file", "dead_file"]],
                          on=["plot", "season"], how="outer")
    merged["trees_diff"] = merged["trees_etl"].fillna(0) - merged["trees_file"].fillna(0)
    merged["dead_diff"] = merged["dead_etl"].fillna(0) - merged["dead_file"].fillna(0)
    merged.to_csv(os.path.join(OUTDIR, "qa_crosscheck.csv"), index=False, encoding="utf-8-sig")

    # --- 寫 payload ---
    with open(os.path.join(OUTDIR, "payload.json"), "w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)

    # --- 摘要 ---
    n_plots = len(plots)
    n_trees = sum(p["treeCount"] for p in plots)
    n_meas = sum(len(t["measurements"]) for p in plots for t in p["trees"])
    dead_mismatch = merged[merged["dead_diff"] != 0]
    tree_mismatch = merged[merged["trees_diff"] != 0]

    lines = []
    lines.append("===== 土肉桂 ETL DRY-RUN 摘要 =====")
    lines += log
    lines.append(f"plots={n_plots}  trees={n_trees}  measurement docs={n_meas}")
    lines.append(f"預估 Firestore 寫入 ≈ {n_plots + n_trees + n_meas} 筆")
    lines.append("")
    lines.append("--- QA 交叉驗證（vs 檔案 QA摘要）---")
    lines.append(f"死亡數不符單元數：{len(dead_mismatch)}（應為 0）")
    if len(dead_mismatch):
        lines.append(dead_mismatch[["plot", "season", "dead_etl", "dead_file", "dead_diff"]].to_string(index=False))
    lines.append(f"獨立樣木數不符單元數：{len(tree_mismatch)}（預期：僅丟棄 樣木編號=0 雜訊的單元 -1）")
    if len(tree_mismatch):
        lines.append(tree_mismatch[["plot", "season", "trees_etl", "trees_file", "trees_diff"]].to_string(index=False))
    lines.append("")
    lines.append("--- 每樣區 tree 數 ---")
    for p in plots:
        lines.append(f"  {p['code']}: {p['treeCount']} trees, periods={p['currentPeriod']}, "
                     f"area={p['area_ha']}ha, diam={p['diameterType']}, "
                     f"pruning={p['pruning']}, fert={p['fertilizer_g']}g")
    summary = "\n".join(lines)
    with open(os.path.join(OUTDIR, "_summary.txt"), "w", encoding="utf-8") as fp:
        fp.write(summary)
    print(summary)


if __name__ == "__main__":
    main()
