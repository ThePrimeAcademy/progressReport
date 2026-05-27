"""Parse a DSAT-style raw-to-scaled scoring sheet (.xlsx) into a JSON curve.

The expected sheet layout (matches "2026 DSAT Math Scoring Sheet.xlsx"):
  Row 0: free-form title / instructions blob.
  Row 1: merged headers ("Raw Score", "Section Score Range").
  Row 2: sub-headers ("Correct Answers", "Lower", "Upper", blank, repeat).
  Row 3+: data rows. Up to two side-by-side blocks of
          (correct_answers, lower, upper) separated by a blank column.

Output:
  { "curve": [ { "raw": int, "lower": int, "upper": int }, ... ] }

The script reuses the minimal pure-Python xlsx parsing from
read_sat_scores.py (no third-party dependencies).
"""

import json
import sys
import zipfile
from pathlib import Path

import read_sat_scores as base


def numeric(value):
    try:
        return int(value) if value is not None and str(value).strip() != "" else None
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def parse_curve(rows):
    """Walk every data row, scan left-to-right in (raw, lower, upper) triples,
    skipping any cell that doesn't parse as an integer. Tolerant of the
    side-by-side dual-column layout where a blank gap separates the two blocks.
    """
    points = {}
    for row in rows[3:]:
        i = 0
        while i + 2 < len(row):
            raw = numeric(row[i])
            lower = numeric(row[i + 1])
            upper = numeric(row[i + 2])
            if raw is not None and lower is not None and upper is not None:
                points[raw] = {"raw": raw, "lower": lower, "upper": upper}
                i += 3
            else:
                i += 1
    return [points[k] for k in sorted(points)]


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: parse_scoring_sheet.py <xlsx_path>")

    path = Path(sys.argv[1]).expanduser()
    if not path.exists():
        raise SystemExit(f"Workbook not found: {path}")

    with zipfile.ZipFile(path) as zf:
        shared = base.read_shared_strings(zf)
        sheet_path = base.first_sheet_path(zf)
        rows = base.parse_sheet_rows(zf, sheet_path, shared)

    curve = parse_curve(rows)
    if not curve:
        raise SystemExit("No (raw, lower, upper) data points found in sheet")

    print(json.dumps({"curve": curve}))


if __name__ == "__main__":
    main()
