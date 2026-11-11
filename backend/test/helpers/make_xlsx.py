"""Write a minimal but valid .xlsx workbook from a JSON description.

Usage:  python3 make_xlsx.py <out.xlsx>   (JSON on stdin)

  { "sheets": [ { "name": "Sheet1", "rows": [[cell, ...], ...] }, ... ] }

Cells are numbers, strings or null. Strings go through the shared-strings
table, the way Excel itself writes them, so tests exercise the same reading
path as a real upload. Test-only helper: lets the test suite build workbooks
in any layout without committing binary files.
"""

import json
import sys
import zipfile
from xml.sax.saxutils import escape


def col_letter(index):
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def main():
    out_path = sys.argv[1]
    spec = json.load(sys.stdin)
    sheets = spec["sheets"]

    shared = []
    shared_index = {}

    def shared_id(text):
        if text not in shared_index:
            shared_index[text] = len(shared)
            shared.append(text)
        return shared_index[text]

    sheet_xml = []
    for sheet in sheets:
        rows_xml = []
        for r, row in enumerate(sheet["rows"], start=1):
            cells = []
            for c, value in enumerate(row):
                if value is None:
                    continue
                ref = f"{col_letter(c)}{r}"
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                else:
                    cells.append(f'<c r="{ref}" t="s"><v>{shared_id(str(value))}</v></c>')
            rows_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
        sheet_xml.append(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(rows_xml)}</sheetData></worksheet>'
        )

    ns_r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'xmlns:r="{ns_r}"><sheets>'
        + "".join(
            f'<sheet name="{escape(s["name"], {chr(34): "&quot;"})}" sheetId="{i}" r:id="rId{i}"/>'
            for i, s in enumerate(sheets, start=1)
        )
        + "</sheets></workbook>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(
            f'<Relationship Id="rId{i}" Type="{ns_r}/worksheet" Target="worksheets/sheet{i}.xml"/>'
            for i in range(1, len(sheets) + 1)
        )
        + f'<Relationship Id="rId{len(sheets) + 1}" Type="{ns_r}/sharedStrings" Target="sharedStrings.xml"/>'
        "</Relationships>"
    )
    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f'<si><t xml:space="preserve">{escape(text)}</t></si>' for text in shared)
        + "</sst>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + "".join(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(1, len(sheets) + 1)
        )
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{ns_r}/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", rels)
        zf.writestr("xl/sharedStrings.xml", shared_xml)
        for i, xml in enumerate(sheet_xml, start=1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", xml)


if __name__ == "__main__":
    main()
