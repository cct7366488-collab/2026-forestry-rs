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
# 輸出目錄可用環境變數 CINNAMON_OUT 覆寫（worktree 為暫時目錄，產出請指到主 checkout 或 GDrive）
OUT = os.environ.get("CINNAMON_OUT") or os.path.join(BASE, "output")
FIGS = os.path.join(OUT, "figs")
os.makedirs(FIGS, exist_ok=True)

TRT_ORDER = ["C0", "P1", "F150", "P1F150"]
TRT_ZH = {"C0": "對照", "P1": "修剪", "F150": "施肥", "P1F150": "修剪+施肥"}
TRT_FACTORS = {"C0": (0, 0), "P1": (1, 0), "F150": (0, 150), "P1F150": (1, 150)}
ALIVE_FATES = {"alive"}
DEAD_FATES = {"dead", "missing", "tag-lost"}
MATURE_SITE = 115121
# 期別 → 季別標籤與推定季末日（第 1–3 期為 xlsx 匯入、無實測日，沿用 ETL 之推定值）
SEASON = {1: ("114Q3", "2025-09-30"), 2: ("114Q4", "2025-12-31"), 3: ("115Q1", "2026-03-31"), 4: ("115Q2", "2026-06-30")}
IMPORTED_SEQS = {1, 2, 3}


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
    df["dateSource"] = "推定季末"
    return df, pj


def load_long_from_export(xlsx):
    """ForestMRV「匯出 → 逐棵逐期原始值」Excel → 與 load_long() 同欄位之長表。

    日期：第 1–3 期（xlsx 匯入）沿用推定季末日；App 內實測之期別取「記錄時間」之樣區中位日，
    缺記錄時間時退回「期別日期」（開期日），再退回推定季末日。來源記於 dateSource 欄。
    """
    raw = pd.read_excel(xlsx, sheet_name=0, dtype={"樣區": str})
    num = lambda c: pd.to_numeric(raw[c], errors="coerce") if c in raw else np.nan
    code = raw["樣區"].astype(str).str.strip()
    site = pd.to_numeric(code.str.split("-").str[0], errors="coerce")
    trt = code.str.split("-").str[1]
    bad = sorted(set(trt.dropna()) - set(TRT_FACTORS))
    if bad or site.isna().any():
        raise ValueError(f"樣區代碼無法解析為「樣區-處理」：{bad or code[site.isna()].unique().tolist()}")
    seq = num("期別").astype(int)
    df = pd.DataFrame({
        "plot": code, "site": site.astype(int), "treatment": trt,
        "pruning": trt.map(lambda t: TRT_FACTORS[t][0]), "fertilizer": trt.map(lambda t: TRT_FACTORS[t][1]),
        "diameterType": np.where(site == MATURE_SITE, "breast", "basal"),
        "group": np.where(site == MATURE_SITE, "mature", "juvenile"),
        "area_ha": np.nan, "treeNum": num("立木編號"), "treeCode": raw.get("treeCode"),
        "seq": seq, "season": seq.map(lambda s: SEASON.get(s, (f"P{s}", None))[0]),
        "D": num("DBH_cm"), "H": num("樹高_m"), "nstem": np.nan,
        "BA": num("斷面積_m2"), "vol": num("材積_m3"), "carbon": num("碳_kg"),
        "vitality": raw.get("活力"), "fate": raw["狀態"].fillna("alive") if "狀態" in raw else "alive",
    })
    rec = pd.to_datetime(raw.get("記錄時間"), errors="coerce").dt.normalize()
    opened = pd.to_datetime(raw.get("期別日期"), errors="coerce")
    season_end = pd.to_datetime(seq.map(lambda s: SEASON.get(s, (None, None))[1]))
    imported = seq.isin(IMPORTED_SEQS)
    # 同一樣區同一期取記錄日中位數，避免同批調查跨日造成同樣區期距不一
    rec_med = rec.groupby([df["plot"], df["seq"]]).transform(lambda x: x.dropna().sort_values().iloc[len(x.dropna()) // 2] if x.notna().any() else pd.NaT)
    df["date"] = np.where(imported, season_end, rec_med.fillna(opened).fillna(season_end))
    df["date"] = pd.to_datetime(df["date"])
    df["dateSource"] = np.where(imported, "推定季末", np.where(rec_med.notna(), "記錄時間", np.where(opened.notna(), "開期日", "推定季末")))
    if df["date"].isna().any():
        raise ValueError(f"有 {int(df['date'].isna().sum())} 筆無法決定調查日（期別 {sorted(df.loc[df['date'].isna(), 'seq'].unique())}）")
    return df, {"source": os.path.basename(xlsx)}


# ===================== Tier 0：最新一期資料檢核（期間比對） =====================
def qa_latest_period(df, d_drop_pct=10.0, h_change_pct=30.0):
    """最新一期逐株與前一有效期比對。門檻為篩檢用，非剔除依據；結果供人工覆核。"""
    seqs = sorted(df["seq"].unique())
    last = seqs[-1]
    recs = []
    for (plot, treeNum), g in df.groupby(["plot", "treeNum"]):
        cur = g[g["seq"] == last]
        prev = g[g["seq"] < last].sort_values("seq")
        if cur.empty:
            if not prev.empty and prev.iloc[-1]["fate"] in ALIVE_FATES:
                recs.append({"樣區": plot, "立木編號": treeNum, "檢核": "最新一期無紀錄（前期存活）"})
            continue
        c = cur.iloc[0]
        if prev.empty:
            recs.append({"樣區": plot, "立木編號": treeNum, "檢核": "僅最新一期有紀錄（進界或新增）", "本期徑": c["D"], "本期高": c["H"]})
            continue
        p = prev.iloc[-1]
        row = {"樣區": plot, "立木編號": treeNum, "前期": int(p["seq"]), "前期徑": p["D"], "本期徑": c["D"],
               "前期高": p["H"], "本期高": c["H"], "前期狀態": p["fate"], "本期狀態": c["fate"]}
        flags = []
        c_alive, p_alive = c["fate"] in ALIVE_FATES, p["fate"] in ALIVE_FATES
        if c_alive and not p_alive:
            flags.append("前期枯死／失蹤、本期存活")
        if c_alive and (pd.isna(c["D"]) or pd.isna(c["H"])):
            flags.append("本期存活但徑或高缺值")
        if c_alive and p_alive and pd.notna(c["D"]) and pd.notna(p["D"]) and p["D"] > 0:
            if c["D"] == p["D"] and c["H"] == p["H"]:
                flags.append("徑高與前期完全相同（疑未實測、沿用前期值）")
            dd = 100 * (c["D"] - p["D"]) / p["D"]
            row["徑變動%"] = round(dd, 1)
            if dd < -d_drop_pct:
                flags.append(f"徑倒退逾 {d_drop_pct:g}%")
        if c_alive and p_alive and pd.notna(c["H"]) and pd.notna(p["H"]) and p["H"] > 0:
            dh = 100 * (c["H"] - p["H"]) / p["H"]
            row["高變動%"] = round(dh, 1)
            if abs(dh) > h_change_pct:
                flags.append(f"樹高變動逾 ±{h_change_pct:g}%")
        for f in flags:
            recs.append({**row, "檢核": f})
    detail = pd.DataFrame(recs)
    cur_all = df[df["seq"] == last]
    summ = (cur_all.groupby("plot").agg(本期筆數=("treeNum", "count"),
                                        存活=("fate", lambda x: int(x.isin(ALIVE_FATES).sum())),
                                        調查日=("date", lambda x: x.iloc[0].date()),
                                        日期來源=("dateSource", "first")).reset_index().rename(columns={"plot": "樣區"}))
    if len(detail):
        piv = detail.pivot_table(index="樣區", columns="檢核", values="立木編號", aggfunc="count", fill_value=0).reset_index()
        summ = summ.merge(piv, on="樣區", how="left").fillna(0)
    path = os.path.join(OUT, f"00_第{last}期資料檢核.xlsx")
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        summ.to_excel(xw, sheet_name="逐樣區摘要", index=False)
        (detail if len(detail) else pd.DataFrame({"檢核": ["無異常"]})).to_excel(xw, sheet_name="逐株異常明細", index=False)
    print(f"  ✓ Tier0: {path}（第 {last} 期 {len(cur_all)} 筆；異常旗標 {len(detail)} 項）")
    return summ, detail


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
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", help="ForestMRV 匯出之「逐棵逐期原始值」xlsx；未給則讀 ../dry-run/payload.json")
    args = ap.parse_args()
    df, pj = load_long_from_export(args.export) if args.export else load_long()
    print(f"載入：{df['plot'].nunique()} 樣區 / {df[['plot','treeNum']].drop_duplicates().shape[0]} 樹 / {len(df)} 筆期測值")
    seqs = sorted(int(s) for s in df["seq"].unique())
    print("各期筆數與日期來源：")
    print(df.groupby(["seq", "dateSource"]).agg(n=("treeNum", "count"), 最早=("date", "min"), 最晚=("date", "max")).to_string())
    if len(seqs) >= 2:
        qa_latest_period(df)
    json.dump({"seqs": seqs, "seasons": [SEASON.get(s, (f"P{s}",))[0] for s in seqs],
               "source": args.export and os.path.basename(args.export) or "payload.json",
               "lastDateSources": sorted(df[df["seq"] == seqs[-1]]["dateSource"].unique().tolist())},
              open(os.path.join(OUT, "_meta.json"), "w", encoding="utf-8"), ensure_ascii=False)
    tier1(df)
    inc = compute_increments(df)
    print(f"可算增量樹數：{len(inc)}（成熟 {len(inc[inc.group=='mature'])} / 幼齡 {len(inc[inc.group=='juvenile'])}）")
    desc, grow = tier2(df, inc)
    print("\n=== 逐樣區生長量摘要 ===")
    print(grow.to_string(index=False))
    # 暫存供 Tier3
    inc.to_pickle(os.path.join(OUT, "_inc.pkl"))
    print("\nTier1/2 完成。Tier3 (ANOVA) 見 cinnamon_anova.py")
