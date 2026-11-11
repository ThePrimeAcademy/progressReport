"""Dump every worksheet of an .xlsx workbook as a plain grid of cell values.

Output (stdout, JSON):
  { "sheets": [ { "name": "Sheet1", "rows": [[cell, ...], ...] }, ... ] }

Cells are numbers, strings, booleans or null. Rows keep their real column
positions (a blank column stays a null cell) so the caller can reason about
side-by-side blocks. Empty rows are dropped.

This script only converts the file format. Working out which columns hold raw
scores and which hold scaled scores is done in Node
(services/sheet-parser.service.js), where it is unit tested.

Reuses the dependency-free xlsx reading helpers from read_sat_scores.py.
"""

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import read_sat_scores as base

REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def sheet_targets(zf):
    """[(sheet name, path inside the zip)] in workbook tab order."""
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("rel:Relationship", base.REL_NS)
    }
    out = []
    for sheet in workbook.findall("main:sheets/main:sheet", base.NS):
        target = rel_map.get(sheet.attrib.get(REL_ID, ""), "")
        if not target:
            continue
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        # Chart sheets and macro sheets have no cell grid.
        if "worksheets/" not in target:
            continue
        out.append((sheet.attrib.get("name") or f"Sheet{len(out) + 1}", target))
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: xlsx_to_grid.py <xlsx_path>")

    path = Path(sys.argv[1]).expanduser()
    if not path.exists():
        raise SystemExit(f"Workbook not found: {path}")

    sheets = []
    with zipfile.ZipFile(path) as zf:
        shared = base.read_shared_strings(zf)
        for name, target in sheet_targets(zf):
            if target not in zf.namelist():
                continue
            sheets.append({"name": name, "rows": base.parse_sheet_rows(zf, target, shared)})

    print(json.dumps({"sheets": sheets}))


if __name__ == "__main__":
    main()
