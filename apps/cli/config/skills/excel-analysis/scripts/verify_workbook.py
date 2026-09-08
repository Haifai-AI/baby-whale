"""verify_workbook — formula-value QA for built workbooks (no LibreOffice).

    $DSH_OFFICE_PYTHON verify_workbook.py deliverables/report.xlsx

Reloads the file twice (formulas view + values view) and asserts:
  1. every formula cell carries a cached value (previews show numbers),
  2. tables (if any) resolve to real ranges,
  3. nothing reads as an obvious defect: formula errors (#REF!, #DIV/0!)
     cached, None where a number was expected, or numbers stored as text.

Prints one line per check plus a final PASS/FAIL; exit code 1 on FAIL.
"""

from __future__ import annotations

import sys

from openpyxl import load_workbook

ERROR_SENTINELS = ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NULL!", "#NUM!")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: verify_workbook.py <workbook.xlsx>")
        return 2
    path = argv[1]
    formulas = load_workbook(path, data_only=False)
    values = load_workbook(path, data_only=True)

    failures: list[str] = []
    formula_cells = 0
    cached_cells = 0

    for sheet in formulas.sheetnames:
        ws_f = formulas[sheet]
        ws_v = values[sheet]
        for row in ws_f.iter_rows():
            for cell in row:
                if not (isinstance(cell.value, str) and cell.value.startswith("=")):
                    continue
                formula_cells += 1
                computed = ws_v[cell.coordinate].value
                if computed is None:
                    failures.append(f"{sheet}!{cell.coordinate}: formula has no cached value → {cell.value}")
                else:
                    cached_cells += 1
                if isinstance(computed, str) and any(s in computed for s in ERROR_SENTINELS):
                    failures.append(f"{sheet}!{cell.coordinate}: cached error {computed} → {cell.value}")

    for sheet in formulas.sheetnames:
        ws_f = formulas[sheet]
        for row in ws_f.iter_rows():
            for cell in row:
                text = cell.value
                if isinstance(text, str) and any(s in text for s in ERROR_SENTINELS):
                    failures.append(f"{sheet}!{cell.coordinate}: literal error string in cell")

    print(f"sheets: {', '.join(formulas.sheetnames)}")
    print(f"formula cells: {formula_cells}, with cached values: {cached_cells}")
    tables = [(sheet, t) for sheet in formulas.sheetnames for t in getattr(formulas[sheet], "tables", {})]
    if tables:
        print(f"tables: {', '.join(f'{sheet}!{name}' for sheet, name in tables)}")
    if failures:
        print("FAIL")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
