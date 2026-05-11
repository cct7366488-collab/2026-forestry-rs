"""Re-export 3 PDFs from updated docx/pptx via Office COM automation.

Uses a single Word app instance for both docx, and a single PowerPoint instance
for the pptx. Retries on RPC_E_CALL_REJECTED (transient busy errors).
"""
import time
from pathlib import Path

import pythoncom
import win32com.client as win32
from pywintypes import com_error

BASE = Path(r"H:\我的雲端硬碟\2026 forestry_RS\reports\2026-05-mid-demo")

DOCX_FILES = [
    BASE / "02-操作手冊-ForestMRV.docx",
    BASE / "03-現場練習指南-下午hands-on.docx",
]
PPTX_FILE = BASE / "01-簡報-ForestMRV系統介紹.pptx"

WD_FORMAT_PDF = 17
PP_SAVE_AS_PDF = 32


def retry(fn, tries=6, delay=2.0):
    last = None
    for i in range(tries):
        try:
            return fn()
        except com_error as e:
            last = e
            print(f"  [retry {i + 1}/{tries}] {e.args[1] if len(e.args) > 1 else e}")
            time.sleep(delay)
    raise last


def export_all_docx(paths):
    word = win32.gencache.EnsureDispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    try:
        for p in paths:
            pdf = p.with_suffix(".pdf")
            def _open_and_export():
                doc = word.Documents.Open(str(p), ReadOnly=True)
                doc.ExportAsFixedFormat(
                    OutputFileName=str(pdf),
                    ExportFormat=WD_FORMAT_PDF,
                    OpenAfterExport=False,
                    OptimizeFor=0,
                    BitmapMissingFonts=True,
                    DocStructureTags=False,
                    CreateBookmarks=0,
                )
                doc.Close(False)
            retry(_open_and_export)
            print(f"[WORD] {p.name} -> {pdf.name}  ({pdf.stat().st_size // 1024} KB)")
            time.sleep(1.0)
    finally:
        retry(lambda: word.Quit())


def export_pptx(path):
    ppt = win32.gencache.EnsureDispatch("PowerPoint.Application")
    try:
        pdf = path.with_suffix(".pdf")
        def _open_and_save():
            pres = ppt.Presentations.Open(str(path), WithWindow=False)
            pres.SaveAs(str(pdf), PP_SAVE_AS_PDF)
            pres.Close()
        retry(_open_and_save)
        print(f"[PPT ] {path.name} -> {pdf.name}  ({pdf.stat().st_size // 1024} KB)")
    finally:
        retry(lambda: ppt.Quit())


pythoncom.CoInitialize()
try:
    export_all_docx(DOCX_FILES)
    export_pptx(PPTX_FILE)
finally:
    pythoncom.CoUninitialize()

print("\nDONE.")
