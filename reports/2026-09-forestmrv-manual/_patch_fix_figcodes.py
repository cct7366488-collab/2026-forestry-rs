# -*- coding: utf-8 -*-
"""修正佔位圖的圖號綁定與陸章圖號連號。

問題：舊版 add_placeholder 是「依文件出現順序自動編號」，忽略呼叫端傳入的 code。
      v2.11.95 改版在文件中間插入新小節後，images/N01..N11 這 11 張既有截圖
      會整批往後錯位、綁到別人的圖名上（實際跑出來已確認錯位）。

修法：
  1. add_placeholder 改為採用呼叫端指定的圖號（穩定識別，圖號即檔名），並擋重複。
  2. _content.py 內 11 個既有佔位圖，改標成「6 月版實際產生的位置編號」——
     那才是 images/Nxx.png 真正對應的內容；7 個新增佔位圖續編 N12–N18。
  3. 陸章因中間插入兩張新圖，圖名連號重新排序（6-1 ~ 6-9）。

跑法：python _patch_fix_figcodes.py
"""
import io
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HERE = Path(__file__).parent

# ────────────────────────────────────────────────────────────
# 1. _build_manual.py：改為採用呼叫端指定的圖號
# ────────────────────────────────────────────────────────────
BUILD = HERE / "_build_manual.py"
b = BUILD.read_text(encoding='utf-8')

old_ph = '''PH_SEQ = [0]   # 佔位圖序號（依文件出現順序，與是否已補圖無關）


def add_placeholder(doc, code, caption, shot_desc, width_inches=5.5):
    """新功能圖：依文件出現順序自動編號 N01、N02…
       若 images/Nxx.png 已存在 → 自動嵌入該截圖（不再列入待拍清單）；
       否則 → 畫灰底佔位框並登錄到待拍清單。"""
    PH_SEQ[0] += 1
    code = "N%02d" % PH_SEQ[0]
    img_path = IMG_NEW / (code + ".png")'''

new_ph = '''PH_SEEN = set()   # 已使用的圖號，防重複


def add_placeholder(doc, code, caption, shot_desc, width_inches=5.5):
    """新功能圖：圖號由呼叫端明確指定（穩定識別），不隨文件位置浮動。
       若 images/Nxx.png 已存在 → 自動嵌入該截圖（不再列入待拍清單）；
       否則 → 畫灰底佔位框並登錄到待拍清單。

       ⚠ 舊版此處是「依文件出現順序自動編號」，忽略傳入的 code。只要在文件中間
       插入一個新小節，後面每一張既有截圖都會被綁到別人的圖名上（v2.11.95 改版
       時實際踩到，11 張全錯位）。圖號即截圖檔名，必須是穩定識別、不可位置相關。"""
    if code in PH_SEEN:
        raise ValueError("佔位圖號重複：%s（圖號即檔名，必須唯一）" % code)
    PH_SEEN.add(code)
    img_path = IMG_NEW / (code + ".png")'''

assert b.count(old_ph) == 1, "add_placeholder 區塊沒對上"
b = b.replace(old_ph, new_ph)
BUILD.write_text(b, encoding='utf-8')
print("✅ _build_manual.py：圖號改為穩定識別")

# ────────────────────────────────────────────────────────────
# 2. _content.py：圖號綁定 + 陸章圖名連號
# ────────────────────────────────────────────────────────────
TARGET = HERE / "_content.py"
t = TARGET.read_text(encoding='utf-8')

PATCHES = []


def patch(old, new, label):
    PATCHES.append((old, new, label))


# ── 既有 11 張：改標成 6 月版實際產生的位置編號（＝images/Nxx.png 真正的內容）──
patch('PH(doc, "N10", "圖 3-2 方法學與調查模組編輯器',
      'PH(doc, "N01", "圖 3-2 方法學與調查模組編輯器', "方法學編輯器 → N01")
patch('PH(doc, "N01", "圖 4-3 樣區卡片的多人指派',
      'PH(doc, "N02", "圖 4-3 樣區卡片的多人指派', "多人指派 → N02")
patch('PH(doc, "N02", "圖 5-4 重複樹牌號防呆',
      'PH(doc, "N03", "圖 5-4 重複樹牌號防呆', "重複樹牌號 → N03")
patch('PH(doc, "N03", "圖 6-1 樣區詳情頁的複查期別資訊區',
      'PH(doc, "N04", "圖 6-1 樣區詳情頁的複查期別資訊區', "期別資訊區 → N04")
patch('PH(doc, "N04", "圖 6-2 開啟新一期複查對話框',
      'PH(doc, "N05", "圖 6-2 開啟新一期複查對話框', "開新期對話框 → N05")
patch('PH(doc, "N08", "圖 6-3 列印複查野外調查清單',
      'PH(doc, "N06", "圖 6-4 列印複查野外調查清單', "列印野外清單 → N06／圖 6-4")
patch('PH(doc, "N05", "圖 6-4 立木表單的上期值面板',
      'PH(doc, "N07", "圖 6-5 立木表單的上期值面板', "上期值面板 → N07／圖 6-5")
patch('PH(doc, "N06", "圖 6-5 立木清單的複查狀態徽章',
      'PH(doc, "N08", "圖 6-6 立木清單的複查狀態徽章', "狀態徽章 → N08／圖 6-6")
patch('PH(doc, "N07", "圖 6-6 單株逐棵歷期測值明細',
      'PH(doc, "N09", "圖 6-8 單株逐棵歷期測值明細', "歷期測值 → N09／圖 6-8")
patch('PH(doc, "N09", "圖 6-7 複查成長報表',
      'PH(doc, "N10", "圖 6-9 複查成長報表', "成長報表 → N10／圖 6-9")
# N11（其他監測模組）圖號與位置皆不變，無須改

# ── 新增的兩張陸章圖：圖名連號調整 ──
patch('PH(doc, "N16", "圖 6-3 樣區分頁的批次複查期別控制',
      'PH(doc, "N16", "圖 6-3 樣區分頁的批次複查期別控制',
      "批次開期（圖號本就 6-3，佔位確認）")
patch('PH(doc, "N17", "圖 6-6 複查立木清單的紅字（未複測）與本期進度',
      'PH(doc, "N17", "圖 6-7 複查立木清單的紅字（未複測）與本期進度',
      "紅字進度 → 圖 6-7")

fail = []
for old, new, label in PATCHES:
    n = t.count(old)
    if n != 1:
        fail.append("  [%s] 命中 %d 次（應為 1）" % (label, n))
    else:
        t = t.replace(old, new)

if fail:
    print("❌ 以下 patch 未能唯一命中，_content.py 未變更：")
    print("\n".join(fail))
    sys.exit(1)

TARGET.write_text(t, encoding='utf-8')
print("✅ _content.py：%d 條圖號／圖名修正完成" % len(PATCHES))
