# -*- coding: utf-8 -*-
"""
土肉桂修枝矮化及施肥對生長影響之研究 — 逐樣區報表 + 跨樣區 ANOVA 分析管線
================================================================================
輸入：../dry-run/payload.json（ETL 產出，逐樹逐期 Dq/樹高/斷面積/處理因子）
輸出（analysis/output/）：
  01_逐樣區各期原始資料.xlsx   — 16 樣區，每樣區一工作表（逐棵 × 各期 徑/圍/高/狀態）
  02_逐樣區係數統計.xlsx        — 逐樣區逐期描述統計 + 逐樣區生長量/RGR/枯死率
  03_ANOVA統計分析.xlsx         — ANOVA / 混合模型 / 事後比較 表
  03_ANOVA統計分析報告.docx     — 文字分析報告（含圖、假設檢定、結論與限制）
  figs/*.png                    — 箱形圖等

設計決策（user 拍板 2026-06-09）：
  - 反應變數：年均增量（ΔD/yr、ΔH/yr）+ 相對生長率 RGR_D
  - 成熟林(115121, 胸徑) 與 幼齡林(117218/811/8110, 地徑) 分開分析
  - 複製單位：混合模型（處理固定、樣區隨機、樹巢狀）為主；幼齡另附樣區均值 2×2 ANOVA 為穩健交叉驗證
  - 處理為 2×2 析因：修剪(0/1) × 施肥(0/150 g)
"""
import json, math, os
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm
from statsmodels.stats.multicomp import pairwise_tukeyhsd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = os.path.dirname(os.path.abspath(__file__))
PAYLOAD = os.path.join(BASE, "..", "dry-run", "payload.json")
OUT = os.path.join(BASE, "output")
FIGS = os.path.join(OUT, "figs")
os.makedirs(FIGS, exist_ok=True)

TRT_ORDER = ["C0", "P1", "F150", "P1F150"]
TRT_ZH = {"C0": "對照", "P1": "修剪", "F150": "施肥", "P1F150": "修剪+施肥"}
ALIVE_FATES = {"alive"}
DEAD_FATES = {"dead", "missing", "tag-lost"}


def load_long():
    """payload → 逐 (plot, tree, period) 長表。"""
    pj = json.load(open(PAYLOAD, encoding="utf-8"))
    rows = []
    for pl in pj["plots"]:
        for tr in pl["trees"]:
            for seq, m in tr["measurements"].items():
                rows.append({
                    "plot": pl["code"], "site": int(pl["plotCodeNum"]),
                    "treatment": pl["treatment"], "pruning": int(pl["pruning"]),
                    "fertilizer": int(pl["fertilizer_g"]), "diameterType": pl["diameterType"],
                    "group": "mature" if pl["plotCodeNum"] == 115121 else "juvenile",
                    "area_ha": pl["area_ha"], "treeNum": tr["treeNum"], "treeCode": tr["treeCode"],
                    "seq": int(m["periodId"]), "season": m["season"], "date": m["recordedDate"],
                    "D": m["dbh_cm"], "H": m["height_m"], "nstem": m["nstem"],
                    "BA": m["basalArea_m2"], "vol": m.get("volume_m3"), "carbon": m.get("carbon_kg"),
                    "vitality": m["vitality"], "fate": m["resurveyFate"],
                })
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df, pj


# ===================== Tier 1：逐樣區各期原始資料 =====================
def tier1(df):
    path = os.path.join(OUT, "01_逐樣區各期原始資料.xlsx")
    seqs = sorted(df["seq"].unique())
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        for code in sorted(df["plot"].unique()):
            sub = df[df["plot"] == code]
            base = sub[["treeNum"]].drop_duplicates().sort_values("treeNum").set_index("treeNum")
            for s in seqs:
                ss = sub[sub["seq"] == s].set_index("treeNum")
                lab = ss["season"].iloc[0] if len(ss) else f"P{s}"
                base[f"P{s}_{lab}_徑cm"] = ss["D"]
                base[f"P{s}_{lab}_圍cm"] = ss["D"].apply(lambda d: round(math.pi * d, 1) if pd.notna(d) else None)
                base[f"P{s}_{lab}_高m"] = ss["H"]
                base[f"P{s}_{lab}_狀態"] = ss["fate"].map({"alive": "存活", "dead": "枯死", "missing": "失蹤", "tag-lost": "脫牌"})
            base.reset_index().to_excel(xw, sheet_name=code[:31], index=False)
    print("  ✓ Tier1:", path, f"({len(df['plot'].unique())} 樣區工作表)")


# ===================== Tier 2：逐樣區係數統計 =====================
def _desc(arr):
    a = pd.to_numeric(pd.Series(arr), errors="coerce").dropna()
    n = len(a)
    if n == 0:
        return dict(n=0, mean=None, sd=None, se=None, cv=None, min=None, max=None)
    sd = a.std(ddof=1) if n > 1 else 0.0
    mean = a.mean()
    return dict(n=n, mean=round(mean, 3), sd=round(sd, 3), se=round(sd / math.sqrt(n), 3) if n > 1 else 0.0,
                cv=round(100 * sd / mean, 1) if mean else None, min=round(a.min(), 2), max=round(a.max(), 2))


def compute_increments(df):
    """逐棵：第一期→最後一期（兩端皆存活、徑>0）的年均ΔD/ΔH 與 RGR_D。"""
    recs = []
    for (plot, treeNum), g in df.groupby(["plot", "treeNum"]):
        g = g.sort_values("seq")
        alive = g[(g["fate"].isin(ALIVE_FATES)) & (g["D"].notna()) & (g["D"] > 0) & (g["H"].notna())]
        if len(alive) < 2:
            continue
        a0, a1 = alive.iloc[0], alive.iloc[-1]
        yrs = (a1["date"] - a0["date"]).days / 365.25
        if yrs <= 0:
            continue
        recs.append({
            "plot": plot, "site": a0["site"], "treatment": a0["treatment"],
            "pruning": a0["pruning"], "fertilizer": a0["fertilizer"], "group": a0["group"],
            "treeNum": treeNum, "years": round(yrs, 3),
            "D0": a0["D"], "D1": a1["D"], "H0": a0["H"], "H1": a1["H"],
            "dD_annual": (a1["D"] - a0["D"]) / yrs,
            "dH_annual": (a1["H"] - a0["H"]) / yrs,
            "RGR_D": (math.log(a1["D"]) - math.log(a0["D"])) / yrs,
        })
    return pd.DataFrame(recs)


def mortality_recruit(df):
    """逐樣區：第一期活木數、最後一期枯死數、枯死率、進界數。"""
    recs = []
    seqs = sorted(df["seq"].unique())
    s0, s1 = seqs[0], seqs[-1]
    for plot, g in df.groupby("plot"):
        first = g[g["seq"] == s0].set_index("treeNum")
        last = g[g["seq"] == s1].set_index("treeNum")
        alive0 = first[first["fate"].isin(ALIVE_FATES)].index
        dead_last = last[last["fate"].isin(DEAD_FATES)].index
        dead_n = len(set(alive0) & set(dead_last))
        recruit = last[(~last.index.isin(first.index)) & (last["fate"].isin(ALIVE_FATES))].index
        recs.append({
            "plot": plot, "treatment": g["treatment"].iloc[0], "group": g["group"].iloc[0],
            "alive_first": len(alive0), "dead_last": dead_n,
            "mortality_pct": round(100 * dead_n / len(alive0), 1) if len(alive0) else None,
            "recruit_last": len(recruit),
        })
    return pd.DataFrame(recs)


def tier2(df, inc):
    path = os.path.join(OUT, "02_逐樣區係數統計.xlsx")
    # 描述統計：逐樣區逐期（僅活木）
    drows = []
    for (plot, seq), g in df.groupby(["plot", "seq"]):
        a = g[g["fate"].isin(ALIVE_FATES)]
        dD, dH = _desc(a["D"]), _desc(a["H"])
        drows.append({
            "樣區": plot, "處理": g["treatment"].iloc[0], "立地": g["group"].iloc[0],
            "期別": int(seq), "季別": g["season"].iloc[0], "量測部位": g["diameterType"].iloc[0],
            "活立木n": dD["n"],
            "徑平均": dD["mean"], "徑SD": dD["sd"], "徑SE": dD["se"], "徑CV%": dD["cv"], "徑min": dD["min"], "徑max": dD["max"],
            "高平均": dH["mean"], "高SD": dH["sd"], "高SE": dH["se"], "高CV%": dH["cv"], "高min": dH["min"], "高max": dH["max"],
            "總斷面積m2": round(pd.to_numeric(a["BA"], errors="coerce").sum(), 4),
            "總材積m3": round(pd.to_numeric(a["vol"], errors="coerce").sum(), 4),
            "總碳kg": round(pd.to_numeric(a["carbon"], errors="coerce").sum(), 1),
        })
    desc = pd.DataFrame(drows).sort_values(["立地", "樣區", "期別"])
    # 逐樣區生長量
    grow = (inc.groupby(["plot", "treatment", "group"])
            .agg(n_survivor=("treeNum", "count"),
                 dD_annual=("dD_annual", "mean"), dD_se=("dD_annual", lambda x: x.std(ddof=1) / math.sqrt(len(x)) if len(x) > 1 else 0),
                 dH_annual=("dH_annual", "mean"),
                 RGR_D=("RGR_D", "mean"))
            .round(4).reset_index())
    mr = mortality_recruit(df)
    grow = grow.merge(mr[["plot", "alive_first", "dead_last", "mortality_pct", "recruit_last"]], on="plot", how="left")
    grow = grow.sort_values(["group", "plot"])
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        desc.to_excel(xw, sheet_name="描述統計_逐期", index=False)
        grow.to_excel(xw, sheet_name="生長量_RGR_枯死率", index=False)
    print("  ✓ Tier2:", path)
    return desc, grow


if __name__ == "__main__":
    df, pj = load_long()
    print(f"載入：{df['plot'].nunique()} 樣區 / {df[['plot','treeNum']].drop_duplicates().shape[0]} 樹 / {len(df)} 筆期測值")
    tier1(df)
    inc = compute_increments(df)
    print(f"可算增量樹數：{len(inc)}（成熟 {len(inc[inc.group=='mature'])} / 幼齡 {len(inc[inc.group=='juvenile'])}）")
    desc, grow = tier2(df, inc)
    print("\n=== 逐樣區生長量摘要 ===")
    print(grow.to_string(index=False))
    # 暫存供 Tier3
    inc.to_pickle(os.path.join(OUT, "_inc.pkl"))
    print("\nTier1/2 完成。Tier3 (ANOVA) 見 cinnamon_anova.py")
