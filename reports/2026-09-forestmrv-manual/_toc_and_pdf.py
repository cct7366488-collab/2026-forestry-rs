# -*- coding: utf-8 -*-
"""在使用者已修改的 docx 的「目次」標題下插入真正的目錄欄位（Heading 1-3、含頁碼），
   存回同檔，再匯出 PDF。全程用 Word COM，不重生內文、不動使用者的修改。"""
import sys, io, time
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pathlib import Path
import pythoncom
import win32com.client as win32
from pywintypes import com_error

# 路徑依本檔位置解析 — 舊版寫死 6 月版資料夾，複製到新版資料夾會改到錯的檔
DOCX = Path(__file__).parent / "操作手冊-ForestMRV智慧森林監測平臺.docx"
PDF = DOCX.with_suffix(".pdf")
WD_FORMAT_PDF = 17
WD_COLLAPSE_START = 1

pythoncom.CoInitialize()
word = win32.gencache.EnsureDispatch("Word.Application")
word.Visible = False
word.DisplayAlerts = False
try:
    doc = word.Documents.Open(str(DOCX))   # 可寫，存回

    # 先移除既有的目錄欄位，再插入 —— _build_manual.py 產生的 docx 本來就帶一個
    # 「請按 F9 更新功能變數」的 TOC 佔位欄位；不先刪就再 Add 一個，會變成兩份目錄
    # 疊在一起（9 月版首次產生時實際踩到：目次由 3 頁膨脹為 6 頁、每個條目各出現兩次）。
    _existing = doc.TablesOfContents.Count
    for _ in range(_existing):
        doc.TablesOfContents(1).Delete()
    if _existing:
        print('已移除既有目錄欄位', _existing, '份')

    # 找「目次」標題段落
    target_idx = None
    paras = doc.Paragraphs
    for i in range(1, paras.Count + 1):
        txt = paras(i).Range.Text.replace('\r', '').replace('\x07', '').strip()
        if txt == '目次':
            target_idx = i
            break
    if target_idx is None:
        raise RuntimeError('找不到「目次」標題段落')
    print('目次標題在第', target_idx, '段')

    # 在「目次」標題的下一段起始處插入 TOC（Heading 1~3、含頁碼、超連結）
    nxt = paras(target_idx + 1).Range
    nxt.Collapse(WD_COLLAPSE_START)
    toc = doc.TablesOfContents.Add(
        Range=nxt, UseHeadingStyles=True,
        UpperHeadingLevel=1, LowerHeadingLevel=3,
        RightAlignPageNumbers=True, IncludePageNumbers=True,
        UseHyperlinks=True)
    toc.Update()
    print('TOC 已插入並更新，項目數約', toc.Range.Paragraphs.Count)

    # 全域更新欄位（保險）
    try:
        doc.Fields.Update()
    except com_error as e:
        print('Fields.Update 警告（可忽略）：', e)

    doc.Save()
    print('docx 已存回（含目錄）')

    doc.ExportAsFixedFormat(
        OutputFileName=str(PDF), ExportFormat=WD_FORMAT_PDF,
        OpenAfterExport=False, OptimizeFor=0,
        BitmapMissingFonts=True, DocStructureTags=False, CreateBookmarks=1)
    doc.Close(False)
    print('PDF 匯出完成：', PDF.name, '(%d KB)' % (PDF.stat().st_size // 1024))
finally:
    try: word.Quit()
    except Exception: pass
    pythoncom.CoUninitialize()
print('DONE')
