// features/report/scoring.js
// Shared vocabulary for scoring sheets: the three difficulty levels, the two
// subjects, and how a parsed spreadsheet table becomes the points we save.

export const LEVELS = ['easy', 'medium', 'hard'];

export const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// One hue per level so a column of exams can be scanned at a glance. None of
// them is red or amber: those already mean "delete" and "warning" here.
// Tailwind classes: `badge` for a level chip (with Badge variant="outline"),
// `on` for the selected button of a level picker.
export const LEVEL_STYLE = {
  easy: { badge: 'border-green-200 bg-green-50 text-green-700', on: 'data-[state=on]:bg-green-50 data-[state=on]:text-green-700' },
  medium: { badge: 'border-blue-200 bg-blue-50 text-blue-700', on: 'data-[state=on]:bg-blue-50 data-[state=on]:text-blue-700' },
  hard: { badge: 'border-purple-200 bg-purple-50 text-purple-700', on: 'data-[state=on]:bg-purple-50 data-[state=on]:text-purple-700' },
};

// `key` is the section name the API uses.
export const SUBJECTS = [
  { key: 'rw', label: 'English', long: 'English (Reading & Writing)' },
  { key: 'math', label: 'Math', long: 'Math' },
];

export const subjectLabel = (key) => SUBJECTS.find((s) => s.key === key)?.label || key;

// Which score column of a parsed table to preselect: the one whose header
// names the level being filled (a sheet with Easy / Medium / Hard columns),
// otherwise the last column - for a Lower/Upper sheet that is Upper, the
// choice this app has always defaulted to.
export function defaultColumnIndex(table, level) {
  const columns = table?.columns || [];
  if (level) {
    const match = columns.findIndex((c) => String(c.label || '').toLowerCase().includes(level));
    if (match >= 0) return match;
  }
  return Math.max(0, columns.length - 1);
}

// Which worksheet of a parsed workbook to preselect: the tab named after the
// level being filled, otherwise the first.
export function defaultTableIndex(tables, level) {
  if (level) {
    const match = (tables || []).findIndex((t) => String(t.sheetName || '').toLowerCase().includes(level));
    if (match >= 0) return match;
  }
  return 0;
}

// Turn the chosen column of a parsed table into the points to save.
// → { curve: [{ raw, lower, upper }], bound, columnLabel, isRange }
//
// A sheet with exactly two score columns where one is never above the other is
// a score RANGE: both ends are kept and `bound` records which was chosen, so
// it can be flipped later without re-uploading. Anything else saves just the
// chosen column.
export function buildCurve(table, columnIndex) {
  const columnLabel = table.columns[columnIndex]?.label || null;
  if (table.columns.length === 2) {
    const other = 1 - columnIndex;
    const complete = table.rows.every((r) => r.values[0] != null && r.values[1] != null);
    const neverAbove = table.rows.every((r) => r.values[columnIndex] <= r.values[other]);
    const neverBelow = table.rows.every((r) => r.values[columnIndex] >= r.values[other]);
    if (complete && (neverAbove || neverBelow)) {
      return {
        curve: table.rows.map((r) => ({
          raw: r.raw,
          lower: Math.min(r.values[0], r.values[1]),
          upper: Math.max(r.values[0], r.values[1]),
        })),
        bound: neverAbove && !neverBelow ? 'lower' : 'upper',
        columnLabel,
        isRange: true,
      };
    }
  }
  return {
    curve: table.rows
      .filter((r) => r.values[columnIndex] != null)
      .map((r) => ({ raw: r.raw, lower: r.values[columnIndex], upper: r.values[columnIndex] })),
    bound: 'upper',
    columnLabel,
    isRange: false,
  };
}

// Where in the file a saved sheet came from, when there was a choice: which
// worksheet tab and which score column. Shown next to the filename later. A
// score range keeps both columns (the Lower/Upper switch says which is in
// use), so it has no single column to name.
export function sourceDetail(tables, table, picked) {
  const parts = [];
  if (tables.length > 1 && table.sheetName) parts.push(`"${table.sheetName}" tab`);
  if (table.columns.length > 1 && !picked.isRange && picked.columnLabel) parts.push(`"${picked.columnLabel}" column`);
  return parts.join(', ') || null;
}

// "Nov 11, 2026" from an ISO timestamp, or '' when missing/invalid.
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
