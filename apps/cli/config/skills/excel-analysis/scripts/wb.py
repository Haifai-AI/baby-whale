"""wb — opinionated helpers for polished analysis workbooks (openpyxl).

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent))  # this skill's scripts/
    from wb import WorkbookBuilder
    ...

Why this exists: openpyxl writes formulas WITHOUT cached results, so every
formula cell shows `=SUM(...)` instead of a number in previews, Quick Look,
and any tool that reads stored values. The builder below computes values in
Python anyway (you need them for charts and assertions), so it can inject
each result into the saved XML as the cell's cached value and set
fullCalcOnLoad — Excel still recalculates live, but every reader sees real
numbers immediately. `finalize()` does the injection; never save via
`wb.save()` directly.
"""

from __future__ import annotations

import shutil
import zipfile
import xml.etree.ElementTree as ET

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.data_source import AxDataSource, StrRef
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

# The workbook palette: one navy for structure, one accent for data highlights.
# Nothing else gets color — deliberateness beats decoration.
NAVY = "1E3A5F"
ACCENT = "2E7D5B"
GREY_TEXT = "5A6572"

FONT = "Calibri"

class WorkbookBuilder:
    """Builds a styled workbook and remembers every formula's computed value."""

    def __init__(self) -> None:
        self.wb = Workbook()
        self.wb.remove(self.wb.active)  # drop the default sheet; builders add real ones
        # {(sheet_title, cell_ref): computed_value} for the XML injection.
        self._cached: dict[tuple[str, str], object] = {}

    # ---- sheets ----------------------------------------------------------

    def sheet(self, title: str, tab_color: str | None = None):
        """Add a named sheet. Order of creation = order of tabs."""
        ws = self.wb.create_sheet(title=title)
        ws.sheet_view.showGridLines = False  # gridlines read as "unfinished"
        if tab_color is not None:
            ws.sheet_properties.tabColor = tab_color
        return ws

    def readme(self, title: str, purpose: str, sheets: list[tuple[str, str]],
               source: str | None = None) -> None:
        """First-tab documentation: what this file is, one line per sheet."""
        ws = self.sheet("Read Me", tab_color=GREY_TEXT)
        ws.column_dimensions["A"].width = 26
        ws.column_dimensions["B"].width = 90
        ws["B2"] = title
        ws["B2"].font = Font(name=FONT, size=18, bold=True, color=NAVY)
        ws["B3"] = purpose
        ws["B3"].font = Font(name=FONT, size=11, color=GREY_TEXT)
        row = 5
        ws.cell(row=row, column=1, value="Sheet").font = Font(name=FONT, bold=True, color=NAVY)
        ws.cell(row=row, column=2, value="What it contains").font = Font(name=FONT, bold=True, color=NAVY)
        for name, description in sheets:
            row += 1
            ws.cell(row=row, column=1, value=name).font = Font(name=FONT, bold=True)
            ws.cell(row=row, column=2, value=description).font = Font(name=FONT)
        if source:
            row += 2
            ws.cell(row=row, column=1, value="Source").font = Font(name=FONT, bold=True, color=NAVY)
            ws.cell(row=row, column=2, value=source).font = Font(name=FONT, size=10, color=GREY_TEXT)

    def summary(self, kpis: list[tuple[str, str, str]], findings: list[str]) -> None:
        """Headline sheet: KPI blocks (label, value, delta/context) + findings.

        `kpis` values may be ("Revenue", 1234567.0, '"$"#,##0,K" K"') or text.
        Write this LAST so the numbers reflect the finished analysis.
        """
        ws = self.sheet("Summary", tab_color=NAVY)
        ws.sheet_view.showGridLines = False
        col = 2
        for label, value, fmt in kpis:
            ws.cell(row=2, column=col, value=label).font = Font(name=FONT, size=10, bold=True, color=GREY_TEXT)
            cell = ws.cell(row=3, column=col, value=value)
            cell.font = Font(name=FONT, size=20, bold=True, color=NAVY)
            if any(ch in str(fmt) for ch in "#0%$"):
                cell.number_format = fmt
            # The 20pt number needs room for its FORMATTED text ("$11,613,905":
            # separators + symbol add ~1/3 again), scaled up for the big font.
            width = len(str(value)) + len(str(value)) // 3 + 4
            ws.column_dimensions[get_column_letter(col)].width = max(20, round(width * 2.2, 1))
            col += 2
        ws.cell(row=6, column=2, value="What the data says").font = Font(
            name=FONT, size=12, bold=True, color=NAVY)
        for i, finding in enumerate(findings):
            cell = ws.cell(row=7 + i, column=2, value=f"• {finding}")
            cell.font = Font(name=FONT, size=11)
            cell.alignment = Alignment(wrap_text=False)
        ws.column_dimensions["A"].width = 3

    # ---- data ------------------------------------------------------------

    def table(self, ws, name: str, headers: list[str], rows: list[list],
              formats: dict[int, str] | None = None, start_col: int = 1,
              title: str | None = None) -> Table:
        """A real Excel Table (banded, filterable) with fitted widths + formats.

        `formats` keys are 0-based column indexes into `headers`. The range
        starts at (1, start_col) or one row below `title`. Freeze panes sit
        under the header. Real Tables (not just styled ranges) are what make
        the sheet feel native: filters, structured refs, banded rows.
        """
        first_row = 3 if title else 1
        if title:
            ws.cell(row=1, column=start_col, value=title).font = Font(
                name=FONT, size=12, bold=True, color=NAVY)
        for j, header in enumerate(headers):
            ws.cell(row=first_row, column=start_col + j, value=str(header))
        for i, row_values in enumerate(rows):
            for j, value in enumerate(row_values):
                ws.cell(row=first_row + 1 + i, column=start_col + j, value=value)
        last_row = first_row + len(rows)
        last_col = start_col + len(headers) - 1
        ref = f"{get_column_letter(start_col)}{first_row}:{get_column_letter(last_col)}{last_row}"
        table = Table(displayName=name, ref=ref)
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleMedium9", showFirstColumn=False, showLastColumn=False,
            showRowStripes=True, showColumnStripes=False)
        ws.add_table(table)
        # Column widths from content (headers can be long; cap the fit).
        for j, header in enumerate(headers):
            width = max([len(str(header))] + [len(str(row_values[j])) for row_values in rows if j < len(row_values)])
            ws.column_dimensions[get_column_letter(start_col + j)].width = min(34, max(9, width + 3))
        # Number formats column-by-column (header row + data rows).
        for j, fmt in (formats or {}).items():
            for row in range(first_row + 1, last_row + 1):
                ws.cell(row=row, column=start_col + j).number_format = fmt
        ws.freeze_panes = ws.cell(row=first_row + 1, column=start_col).coordinate
        return table

    def set_formula(self, ws, ref: str, formula: str, cached, number_format: str | None = None,
                    bold: bool = False) -> None:
        """Write a live formula together with its computed value.

        `cached` is the value YOU computed in Python for that formula (a
        number, or a string for text results). It lands in the saved XML so
        previews show numbers; `fullCalcOnLoad` keeps Excel authoritative.
        """
        cell = ws[ref]
        cell.value = formula
        if number_format:
            cell.number_format = number_format
        if bold:
            cell.font = Font(name=FONT, bold=True, color=NAVY)
        self._cached[(ws.title, ref)] = cached

    # ---- charts ----------------------------------------------------------

    def chart(self, ws, anchor: str, kind: str, title: str, data: Reference,
              cats: Reference | None = None, colors: list[str] | None = None,
              y_title: str | None = None, x_title: str | None = None,
              data_labels: bool = False, label_numfmt: str | None = None,
              width: float = 12.5, height: float = 8) -> None:
        """A styled native chart. `kind` ∈ {col, bar, line, pie}.

        Claim-style titles ("North leads at $120k") beat label-style ones
        ("Revenue by region") — the chart should carry the finding. Series
        colors come from the workbook palette unless overridden.
        """
        chart = {"col": BarChart, "bar": BarChart, "line": LineChart, "pie": PieChart}[kind]()
        if kind == "bar":
            chart.type = "bar"
        elif kind == "col":
            chart.type = "col"
        chart.title = title
        chart.style = 2
        chart.add_data(data, titles_from_data=True)
        if cats is not None:
            # Must follow add_data — categories attach to the series that
            # add_data just created.
            chart.set_categories(cats)
            # openpyxl stores categories as a numeric reference; text labels
            # then render as 1, 2, 3 in non-Excel renderers. Re-point the
            # series at the same cells through a string reference.
            for series in chart.series:
                if series.cat is not None and series.cat.numRef is not None:
                    series.cat = AxDataSource(strRef=StrRef(f=series.cat.numRef.f))
        if kind != "pie":
            chart.y_axis.title = y_title
            chart.x_axis.title = x_title
        for i, series in enumerate(chart.series):
            if colors and i < len(colors):
                if kind == "line":
                    # On a line chart the line IS the data — color it, never fill.
                    series.graphicalProperties = GraphicalProperties()
                    series.graphicalProperties.line = LineProperties(solidFill=colors[i], w=28575)
                else:
                    series.graphicalProperties = GraphicalProperties(solidFill=colors[i])
                    series.graphicalProperties.line = LineProperties(noFill=True)
        if data_labels:
            chart.dataLabels = DataLabelList(showVal=True)
            if label_numfmt:
                chart.dataLabels.numFmt = label_numfmt
        if kind == "pie":
            chart.dataLabels = DataLabelList(showPercent=True)
        chart.width = width
        chart.height = height
        ws.add_chart(chart, anchor)

    # ---- finalize ----------------------------------------------------------

    def save(self, path: str) -> str:
        """fullCalcOnLoad + save + inject cached formula values into the XML."""
        self.wb.calculation.fullCalcOnLoad = True
        self.wb.save(path)
        if not self._cached:
            return path
        return _inject_cached_values(path, {sheet: dict(refs) for sheet, refs in
                                            _group_by_sheet(self._cached).items()})


def _group_by_sheet(cached: dict[tuple[str, str], object]) -> dict[str, dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}
    for (sheet, ref), value in cached.items():
        grouped.setdefault(sheet, {})[ref] = value
    return grouped


_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _inject_cached_values(path: str, per_sheet: dict[str, dict[str, object]]) -> str:
    """Rewrite sheet XML so formula cells carry `<v>` cached results.

    openpyxl writes `<f>` with no `<v>`; readers that don't recalculate
    (previews, Quick Look, pandas) then show nothing. Excel ignores the
    stored values when fullCalcOnLoad is set, so this is pure win.
    """
    tmp = f"{path}.cache.xlsx"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        # Map sheet order to xml part names via workbook.xml + its rels.
        sheet_parts = _sheet_part_names(zin, list(per_sheet))
        for info in zin.infolist():
            data = zin.read(info.filename)
            target_sheet = sheet_parts.get(info.filename)
            if target_sheet is not None:
                data = _patch_sheet(data, per_sheet[target_sheet])
            zout.writestr(info, data)
    shutil.move(tmp, path)
    return path


def _sheet_part_names(archive: zipfile.ZipFile, titles: list[str]) -> dict[str, str]:
    """sheet title -> worksheet xml part path, via workbook.xml + rels."""
    wb_xml = ET.fromstring(archive.read("xl/workbook.xml"))
    rels_xml = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_target = {rel.get("Id"): rel.get("Target")
                  for rel in rels_xml.iter() if rel.get("Id")}
    r_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    wanted: dict[str, str] = {}
    for sheet in wb_xml.iter(f"{_NS}sheet"):
        name = sheet.get("name")
        target = rel_target.get(sheet.get(r_ns, ""), "")
        if name in titles:
            part = target.lstrip("/")
            part = part if part.startswith("xl/") else f"xl/{part}"
            wanted[part] = name
    return wanted


def _patch_sheet(data: bytes, refs: dict[str, object]) -> bytes:
    root = ET.fromstring(data)
    patched = False
    for cell in root.iter(f"{_NS}c"):
        ref = cell.get("r")
        if ref not in refs or cell.find(f"{_NS}f") is None:
            continue
        value = refs[ref]
        for old in cell.findall(f"{_NS}v"):
            cell.remove(old)
        value_node = ET.SubElement(cell, f"{_NS}v")
        if isinstance(value, str):
            cell.set("t", "str")  # formula string result, not a shared string
            value_node.text = value
        else:
            if cell.get("t") == "str":
                del cell.attrib["t"]
            value_node.text = repr(float(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
        patched = True
    if not patched:
        return data
    ET.register_namespace("", _NS[1:-1])
    out = ET.tostring(root, xml_declaration=True, encoding="UTF-8")
    # ElementTree drops the standalone flag Excel likes; restore it.
    return out.replace(b"'/>", b"' standalone='yes'/>", 1) if out.startswith(b"<?xml") else out
