# office/

[English](README.md) | 中文

面向模型的 Office 文件访问：把用户上传的电子表格和文档读取成模型可以分析的结构化数据。Office 产物的创建走代码路径——模型通过 bash 工具编写并运行 Python（openpyxl／python-pptx／python-docx／reportlab），再用 `deliver` 呈现结果。

## 包

| 包 | 负责 | `ctx` 键 |
|---|---|---|
| [`tool-office/`](tool-office/README.zh.md) | 基于 `ctx.fs` 的 `xlsx_read`／`csv_read`／`docx_text` 提取工具，以及 `tool:office` 与 `tool:office-reads` 读取指引 | — |
