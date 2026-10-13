# -*- coding: utf-8 -*-
"""用 Word 打开成品并刷新目录域（保持模板目录结构不变）。"""
from pathlib import Path

import win32com.client as win32

DOC = Path(r"E:\code\AgentEmployee-master\docs\雷达仿真系统软件需求规格说明-GJB438C-2021.docx")

app = win32.Dispatch("Word.Application")
app.Visible = False
app.DisplayAlerts = 0
doc = app.Documents.Open(str(DOC))
try:
    for toc in doc.TablesOfContents:
        toc.Update()
    doc.Fields.Update()
    doc.Repaginate()
    doc.Save()
    print("toc count:", doc.TablesOfContents.Count)
    print("pages:", doc.ComputeStatistics(2))
finally:
    doc.Close(0)
    app.Quit()
print("saved:", DOC)