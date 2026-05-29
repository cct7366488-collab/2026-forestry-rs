"""
產生：01-角色矩陣與演示腳本.docx
為 6/6 土肉桂專區系統說明會準備。

依 CLAUDE.md 全域排版規則：
  - 5 級標號：壹、 / 一、 / (一) / 1. / (1)
  - 段落首行縮排 2 字（半形空格不可用、用首行縮排屬性）
  - 無項目符號（編號清單）
  - 無全形空格（U+3000）
  - CJK 字型：宋體（Times New Roman 西文 + DFKai-SB 中文 / PMingLiU）

跑法：python _build_doc.py
"""

from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = Path(__file__).parent / "01-角色矩陣與演示腳本.docx"

# ===== 樣式設定 =====
CJK_FONT = "PMingLiU"   # 新細明體；可改 "DFKai-SB" 標楷體
ASCII_FONT = "Times New Roman"
INDENT_2CHAR_TWIPS = 480   # 約等於 2 個中文字（12pt × 2 × 20 twips）

def set_cjk_font(run, name=CJK_FONT, ascii_name=ASCII_FONT, size=12):
    """設定 run 的 CJK + ASCII 字型 + 字級。"""
    run.font.name = ascii_name
    run.font.size = Pt(size)
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:eastAsia'), name)
    rFonts.set(qn('w:ascii'), ascii_name)
    rFonts.set(qn('w:hAnsi'), ascii_name)

def add_para(doc, text, size=12, bold=False, indent=True, color=None, align=None, after_pt=4):
    """加段落。indent=True 套首行縮排 2 字。"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(after_pt)
    p.paragraph_format.line_spacing = 1.5
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.85)   # ~2 個 12pt 中文字
    if align == 'center':
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.bold = bold
    if color:
        run.font.color.rgb = color
    set_cjk_font(run, size=size)
    return p

def add_heading(doc, text, level, after_pt=6):
    """加標號（壹、一、(一)、1.、(1)）— 不用 Word 內建 Heading 樣式以保格式控制。"""
    sizes = {1: 16, 2: 14, 3: 13, 4: 12, 5: 12}
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(after_pt)
    if level >= 3:
        p.paragraph_format.first_line_indent = Cm(0.85)
    run = p.add_run(text)
    run.bold = True
    set_cjk_font(run, size=sizes.get(level, 12))
    return p

def add_title(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run(text)
    run.bold = True
    set_cjk_font(run, size=18)

def add_subtitle(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(16)
    run = p.add_run(text)
    set_cjk_font(run, size=12)
    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

def add_table_with_header(doc, headers, rows, col_widths=None):
    """加表格，第一列為表頭（粗體底色）。"""
    t = doc.add_table(rows=1 + len(rows), cols=len(headers))
    t.style = 'Light Grid Accent 1'
    # 表頭
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ''
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(h)
        run.bold = True
        set_cjk_font(run, size=11)
        # 表頭底色淺藍
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:fill'), 'DCE6F1')
        tcPr.append(shd)
    # 內容列
    for r_i, row in enumerate(rows, 1):
        for c_i, val in enumerate(row):
            cell = t.rows[r_i].cells[c_i]
            cell.text = ''
            p = cell.paragraphs[0]
            run = p.add_run(str(val))
            set_cjk_font(run, size=10)
    if col_widths:
        for col, w in enumerate(col_widths):
            for row in t.rows:
                row.cells[col].width = Cm(w)

# ===== 開始建文件 =====
doc = Document()

# 頁面邊距
for section in doc.sections:
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

add_title(doc, "ForestMRV 土肉桂專區系統")
add_title(doc, "角色矩陣與演示腳本")
add_subtitle(doc, "6/6 系統說明會準備文件 │ v2.11.58 │ 2026-05-29")

# ─────────────────────────────────────────────────────
# 壹、文件目的與系統定位
# ─────────────────────────────────────────────────────
add_heading(doc, "壹、文件目的與系統定位", 1)
add_para(doc,
    "本文件為 2026 年 6 月 6 日土肉桂專區葉片收穫監測會計系統說明會準備。"
    "對象包含林業保育署臺中分署承辦人員、土肉桂專區合作社代表、契約林農、"
    "以及計畫團隊內部成員。文件涵蓋五個系統角色之權責矩陣、五階段操作流程、"
    "30 分鐘說明會演示腳本，以及目前已知議題與後續工作。")

add_heading(doc, "一、系統定位與計畫脈絡", 2)
add_para(doc,
    "ForestMRV 為依循 IPCC LULUCF 與 MRV（測量、報告、查證）原則建構的森林"
    "監測平臺。針對土肉桂專區，本系統承接以下行政流程：林農申請修枝採取"
    "副產物（葉片）→ 林業保育署臺中分署核准並核發法定許可文號 → 林農回報"
    "實際葉片採收量 → 結案後資料移交合作社進行共同銷售彙整。")

add_heading(doc, "二、現階段與未來移交", 2)
add_para(doc,
    "現階段（計畫執行期）系統管理員與計畫主持人皆由計畫團隊負責人擔任。"
    "計畫結束移交後，系統管理員仍由計畫團隊保留以維護資料完整性；計畫主"
    "持人將移交予合作社主席，由合作社接手後續日常營運。林農、審核人員之"
    "角色設計於兩階段皆保持一致。")

# ─────────────────────────────────────────────────────
# 貳、角色與權責矩陣
# ─────────────────────────────────────────────────────
add_heading(doc, "貳、角色與權責矩陣", 1)

add_heading(doc, "一、角色定義", 2)
role_def = [
    ["角色（系統名）", "現階段擔任", "未來移交對象", "核心職責"],
    ["系統管理員（admin）", "計畫團隊", "不變", "開案、設邊界、人員指派、QAQC 監督"],
    ["計畫主持人（pi）", "計畫團隊指派", "合作社主席", "方法學設定、樣區規格、邀請成員"],
    ["林農（surveyor）", "契約承租林農", "不變", "修枝申請、實際葉片採收量回報、結案"],
    ["審核人員（harvest_authority）", "林業保育署臺中分署承辦", "不變", "核准／駁回／要求補件、核發法定許可文號"],
    ["合作社（coop）", "合作社主席", "升級為計畫主持人", "唯讀彙整檢視、共同銷售匯出 Excel"],
]
add_table_with_header(doc, role_def[0], role_def[1:], col_widths=[3.0, 3.0, 3.0, 6.5])

add_heading(doc, "二、權限矩陣對照表", 2)
add_para(doc,
    "下表列示五個角色於系統七項主要功能之權限對照。「✅」表示具完整存取與"
    "操作權；「⚠️」表示部分受限或唯讀；「❌」表示無存取權。權限以"
    "Firestore Security Rules 強制執行，介面層 UI gating 為輔助。")

perm_matrix = [
    ["功能", "admin", "pi", "surveyor", "harvest_authority", "coop"],
    ["專案開案", "✅", "❌", "❌", "❌", "❌"],
    ["上傳／更新專案邊界", "✅", "✅", "❌", "❌", "❌"],
    ["方法學設定", "✅", "✅", "❌", "❌", "❌"],
    ["新增樣區與立木", "✅", "✅", "✅（限派任）", "❌", "❌"],
    ["提出修枝申請", "❌", "✅", "✅", "❌", "❌"],
    ["審核修枝申請", "✅", "❌", "❌", "✅", "❌"],
    ["填報葉片採收量", "❌", "✅", "✅（限本人）", "❌", "❌"],
    ["合作社彙整檢視", "✅", "✅", "❌", "❌", "✅"],
    ["匯出 Excel", "✅", "✅", "❌", "❌", "✅"],
]
add_table_with_header(doc, perm_matrix[0], perm_matrix[1:], col_widths=[4.5, 1.8, 1.8, 1.8, 2.5, 1.8])

add_heading(doc, "三、設計原則說明", 2)
add_heading(doc, "(一) 邊界資料受法律約束", 3)
add_para(doc,
    "土肉桂專區作業單元邊界源自合作社與林業保育署簽訂之契約附圖，具法律"
    "約束力。系統設計允許 admin 與 pi 修改邊界，但於 6 月 6 日說明會後將"
    "視 PI 移交合作社主席之時程，再評估是否將邊界寫入權限收緊至 admin only。")

add_heading(doc, "(二) 林農權限單一化", 3)
add_para(doc,
    "林農（surveyor）角色於本系統內僅負責申請與回報，不得修改邊界、不得"
    "審核他人申請、不得跨案讀寫。同一林農於不同專案理論上可被指派不同角"
    "色，但於土肉桂專區內角色固定為 surveyor。")

add_heading(doc, "(三) 合作社唯讀並具未來升級路徑", 3)
add_para(doc,
    "合作社現階段為唯讀彙整角色，主要用於共同銷售前彙整各林農已結案之葉"
    "片採收量並匯出 Excel。下一輪開發將開放合作社對申請單之留言註記功能"
    "（無否決權），協助合作社與林農溝通採收時程或品質要求。未來移交後合"
    "作社主席將升級為 pi 角色，接手日常營運。")

# ─────────────────────────────────────────────────────
# 參、目前系統已實作功能（v2.11.58）
# ─────────────────────────────────────────────────────
add_heading(doc, "參、目前系統已實作功能（v2.11.58）", 1)

add_heading(doc, "一、5 月 20 日說明會後重要更新", 2)
update_log = [
    ["版本", "主要更新", "對應角色"],
    ["v2.11.40", "B1 文案調整：申請主體＝「修枝」、事後實際量＝「葉片採收」", "全角色"],
    ["v2.11.41", "申請表單精簡：移除預估產出量與用途欄位", "surveyor"],
    ["v2.11.52", "樣區上傳防呆：偵測誤將專案邊界當樣區上傳", "admin"],
    ["v2.11.53", "編輯專案雙入口：頂部按鈕＋設定分頁區塊", "admin / pi"],
    ["v2.11.54", "開案表單支援邊界上傳＋預設邊界一鍵載入", "admin"],
    ["v2.11.55", "修枝申請三層連動下拉：專區→承租人→作業單元，自動帶出地籍", "surveyor"],
    ["v2.11.56", "Picker 空清單提示精細化：區分三種無資料原因", "admin"],
    ["v2.11.57", "HOTFIX：修 stale closure 導致 picker 不更新", "全角色"],
    ["v2.11.58", "修申請面積欄位 step 精度：允許 4 位小數（1 m² 精度）", "surveyor"],
]
add_table_with_header(doc, update_log[0], update_log[1:], col_widths=[2.2, 9.3, 3.5])

add_heading(doc, "二、申請帶出地籍的演示亮點", 2)
add_para(doc,
    "v2.11.55 為本次說明會主秀。林農於修枝申請表單將依以下三層連動完成"
    "作業位置選擇：")
add_heading(doc, "(一) 第一層 — 專區", 3)
add_para(doc,
    "下拉選單列出本專案邊界涵蓋之專區清單。土肉桂專區包含「橫流溪」與"
    "「烏石坑」兩個地理區域。")
add_heading(doc, "(二) 第二層 — 承租人", 3)
add_para(doc,
    "依第一層所選之專區自動篩選該區所有契約承租人。橫流溪約有 N 位、烏"
    "石坑約有 M 位。系統依姓名字典序排列。")
add_heading(doc, "(三) 第三層 — 作業單元", 3)
add_para(doc,
    "依第二層所選之承租人列出其名下之所有作業單元。每筆顯示作業單元編號"
    "（如「14_1_1」或「117-260-01」）、契約面積（ha）、契約樹種摘要。")
add_heading(doc, "(四) 自動帶入欄位", 3)
add_para(doc,
    "完成三層選擇後，系統自動帶入「林班 / 假地號」與「申請修枝面積」兩"
    "個欄位（仍可手動編輯覆蓋）。同時於下方顯示「✓ 已帶入下方林班 / 地"
    "號欄位」之確認摘要，含 7 欄結構化資料：專區、承租人、作業單元、契"
    "約樹種、契約面積、工作站 / 事業區、契約書號。")
add_heading(doc, "(五) 結構化資料保留", 3)
add_para(doc,
    "提交申請時，三層選擇結果以結構化 metadata 儲存至 Firestore（欄位名"
    "為 landParcelMeta），供後續合作社彙整、許可單溯源、報表分析使用。"
    "申請卡片亦顯示「✓ 系統識別」摘要行，協助林農目視確認未選錯。")

# ─────────────────────────────────────────────────────
# 肆、6/6 演示腳本（30 分鐘）
# ─────────────────────────────────────────────────────
add_heading(doc, "肆、6 月 6 日演示腳本（30 分鐘）", 1)

add_heading(doc, "一、演示前置作業", 2)
add_para(doc,
    "建議演示時準備五個瀏覽器帳號（或一台筆電多分頁，登入不同帳號），分"
    "別代表系統管理員、計畫主持人、林農、審核人員、合作社五個角色。若無"
    "法準備五帳號，可採用簡化版：以系統管理員一個帳號穿越各分頁示範（admin"
    "權限涵蓋全部功能），於切換場景時口頭說明「現在切換為某某角色」。")

add_heading(doc, "二、演示流程分段", 2)

add_heading(doc, "(一) 第 1 段（0-5 分鐘）── 系統概觀與角色介紹", 3)
add_para(doc, "1. 開啟 https://forestry-rs-monitor.web.app 主畫面、確認版本徽章為 v2.11.58。")
add_para(doc, "2. 簡介五個角色及其分工，引用本文件「貳、角色與權責矩陣」之表格。")
add_para(doc, "3. 進入「土肉桂專區葉片收穫監測、會計系統」專案首頁，介紹分頁佈局。")

add_heading(doc, "(二) 第 2 段（5-10 分鐘）── 系統管理員開案與邊界準備", 3)
add_para(doc, "1. 切換至系統管理員視角，回到「我的專案」首頁。")
add_para(doc, "2. 點「＋ 新專案」展示開案表單；填入示範資料但不送出。")
add_para(doc, "3. 重點演示「📐 專案邊界（GeoJSON，選填）」區塊內的「📥 預設邊界」下拉。")
add_para(doc, "4. 選擇「土肉桂專區（橫流溪 + 烏石坑，合作社契約）」後按「載入」，展示綠字確認摘要。")
add_para(doc, "5. 說明此預設集為合併檔（橫流溪 45 + 烏石坑 70 = 115 個作業單元），含完整契約 metadata。")
add_para(doc, "6. 切到「地圖」分頁，展示 115 個作業單元邊界疊圖。")

add_heading(doc, "(三) 第 3 段（10-15 分鐘）── 林農修枝申請（演示主秀）", 3)
add_para(doc, "1. 切換至林農視角。")
add_para(doc, "2. 點「🌿 修枝申請」分頁，點「＋ 修枝申請」開啟表單。")
add_para(doc, "3. 重點演示三層連動下拉（專區 → 承租人 → 作業單元）。")
add_para(doc, "4. 完成三層選擇後展示自動帶入之「林班 / 地號」欄位與「申請修枝面積」欄位。")
add_para(doc, "5. 展示下方 7 欄結構化摘要「✓ 已帶入下方林班 / 地號欄位」。")
add_para(doc, "6. 補填修枝株數、修枝方式、修枝起訖日、備註後送出申請。")
add_para(doc, "7. 回到申請清單，展示申請卡片上之「✓ 系統識別」摘要行。")
add_para(doc, "8. 點「申請公文稿」展示自動產出之林務署正式公文格式（受文者、主旨、說明、附件）。")

add_heading(doc, "(四) 第 4 段（15-20 分鐘）── 審核人員核准", 3)
add_para(doc, "1. 切換至審核人員（林業保育署臺中分署承辦人）視角。")
add_para(doc, "2. 點「📋 修枝審核」分頁，展示待審清單。")
add_para(doc, "3. 開啟剛才送出之申請，演示「核准」流程；填入核准數量（kg）與效期。")
add_para(doc, "4. 確認送出後系統以 Firestore runTransaction 原子產生法定許可文號。")
add_para(doc, "5. 切換回林農視角，展示「許可單」按鈕及其列印出之正式許可格式。")

add_heading(doc, "(五) 第 5 段（20-25 分鐘）── 林農回報與結案", 3)
add_para(doc, "1. 切到「🌾 葉片採收回報及結案」分頁。")
add_para(doc, "2. 點開剛核准之案件，演示「填報葉片採收量」（可分批多次回報）。")
add_para(doc, "3. 展示累計回報量 vs 核准量之百分比指示（綠 / 黃 / 紅警示）。")
add_para(doc, "4. 全數回報完成後按「✅ 回報完畢並結案」結束本筆案件。")

add_heading(doc, "(六) 第 6 段（25-30 分鐘）── 合作社彙整與 Q&A", 3)
add_para(doc, "1. 切換至合作社視角，點「📊 葉片採收彙整」分頁。")
add_para(doc, "2. 展示已結案案件之依林農 / 狀態彙整表，與「申請量 / 已回報 / 達成率」指標。")
add_para(doc, "3. 演示「匯出 Excel」供共同銷售前資料整理。")
add_para(doc, "4. 預留 Q&A 時間。")

# ─────────────────────────────────────────────────────
# 伍、已知議題與後續工作
# ─────────────────────────────────────────────────────
add_heading(doc, "伍、已知議題與後續工作", 1)

add_heading(doc, "一、6/6 後規劃之開發工作", 2)
todo_list = [
    ["優先序", "工作項目", "規模", "建議完成時程"],
    ["P0", "合作社（coop）對申請單留言註記功能（無否決權）", "1-2 小時", "6 月中"],
    ["P1", "邊界圖檔自動套疊地籍圖以驗證契約面積", "0.5 天", "6 月底"],
    ["P2", "未來移交時 admin 收緊邊界寫入權至 admin only", "需與合作社協調", "移交前"],
    ["P3", "預設邊界檔從 Hosting 靜態檔遷至 Firestore boundaryPresets 集合（PII 保護）", "1 天", "視風險評估"],
    ["P4", "其他未對照計畫類型補套餐（TRAIN、公園碳匯等）", "1 天", "下季度"],
]
add_table_with_header(doc, todo_list[0], todo_list[1:], col_widths=[1.5, 7.5, 2.5, 3.0])

add_heading(doc, "二、已知技術限制與風險", 2)
add_heading(doc, "(一) 預設邊界檔含承租人姓名 PII", 3)
add_para(doc,
    "目前合併檔放置於 Hosting 公開靜態目錄，URL 已知者皆可下載。判定為合"
    "作社契約半公開資料（林業保育署本身有開放類似 dataset）、demo 演示風"
    "險可接受。若 6/6 後利害關係人對 PII 保護有疑慮，可遷至 Firestore 並"
    "設 rules 鎖 admin 才能讀。")

add_heading(doc, "(二) 烏石坑檔案部分欄位名 UTF-8 截斷", 3)
add_para(doc,
    "原始檔案（烏石坑土肉桂作業單元.geojson）「契約樹種」「伐木作業」「造"
    "林作業」「撫育作業」「契約面積」等欄位名於 export 過程中末字組節被"
    "截斷。合併腳本已自動修補，但建議下次匯出時於來源端使用 UTF-8 嚴格"
    "模式檢查避免汙染。")

add_heading(doc, "(三) 既有舊版邊界需手動升級一次", 3)
add_para(doc,
    "v2.11.54 以前上傳之邊界僅保留 geometry、未保留 properties。升級至"
    "v2.11.55 後，須由 admin 進入「✏️ 編輯專案 → 📐 專案邊界 → 📥 預"
    "設邊界 → 載入 → 儲存」一次性升級為含 metadata 之 FeatureCollection。"
    "此手動步驟僅需做一次，後續上傳即自動為新格式。")

# ─────────────────────────────────────────────────────
# 附錄
# ─────────────────────────────────────────────────────
add_heading(doc, "附錄", 1)

add_heading(doc, "一、詞彙對照表", 2)
glossary = [
    ["系統內名稱", "中文說明", "權限類別"],
    ["admin / isSystemAdmin", "系統管理員（總管理者）", "頂層"],
    ["pi", "計畫主持人", "專案層"],
    ["surveyor", "調查員（本系統中為林農）", "專案層"],
    ["harvest_authority", "採取許可審核人員（林業保育署承辦）", "專案層"],
    ["coop", "林業合作社（彙整觀察者）", "專案層"],
    ["reviewer", "QAQC 查證員", "專案層"],
    ["harvestPermit", "修枝申請（含葉片採收）", "資料表"],
    ["landParcelMeta", "申請單地籍結構化 metadata", "欄位"],
    ["boundaryGeoJsonStr", "專案邊界（FeatureCollection JSON 字串）", "欄位"],
]
add_table_with_header(doc, glossary[0], glossary[1:], col_widths=[5.0, 6.5, 3.0])

add_heading(doc, "二、相關文件", 2)
add_para(doc,
    "本系統其他相關文件存放於 reports/2026-05-mid-demo/，包括：")
add_para(doc, "1. 01-簡報-ForestMRV 系統介紹.pptx：系統整體概念簡報")
add_para(doc, "2. 02-操作手冊-ForestMRV.docx：使用者操作詳細手冊")
add_para(doc, "3. 03-現場練習指南-下午 hands-on.docx：實機操作練習")
add_para(doc, "4. 04-土肉桂採收許可-520 說明會 demo 腳本.md：5/20 demo 原始腳本")
add_para(doc, "5. 05-土肉桂採收許可-520 說明會簡報.pptx：5/20 簡報")

add_heading(doc, "三、聯絡窗口", 2)
add_para(doc,
    "系統技術問題：計畫團隊（陳朝圳教授）。"
    "土肉桂專區契約與作業協調：合作社主席。"
    "修枝許可審核：林業保育署臺中分署承辦人員。")

# 存檔
doc.save(OUT)
print(f"OK: {OUT}")
print(f"Size: {OUT.stat().st_size / 1024:.1f} KB")
