// services/sheet-parser.service.js
// Turns a spreadsheet grid (from an uploaded .xlsx, a .csv, or cells pasted
// out of Excel / Google Sheets) into a raw-score → scaled-score table.
//
// Scoring sheets arrive in whatever layout the person who made them liked, so
// nothing here depends on fixed row or column positions. Columns are
// classified by what they contain:
//   - a RAW column holds small consecutive whole numbers (0, 1, 2, … correct)
//   - a SCORE column holds SAT section scores (200 - 800)
// Each raw column owns the score columns to its right, up to the next raw
// column. That covers a plain two-column table, a Lower/Upper range table, an
// Easy/Medium/Hard table, and the "two tables side by side" layout used to fit
// a long sheet on one page.
//
// Pure functions, no I/O - see sheet-parser.service.test.js.

const SCORE_MIN = 200;
const SCORE_MAX = 800;
// Highest plausible raw score. A DSAT section tops out at 54 (Reading &
// Writing) or 44 (Math); the headroom keeps a longer custom test working while
// still staying clear of the 200+ score range.
const RAW_MAX = 150;
// A column needs at least this many matching cells before it counts as a raw
// or score column, so stray numbers in titles and notes are ignored.
const MIN_COLUMN_CELLS = 5;
const COLUMN_PURITY = 0.8;
const HEADER_LOOKBACK_ROWS = 4;

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// "200", " 200 ", 200, "200.0" → 200. Anything else → null.
function toNumber(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const text = cell.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

// "480-520", "480 to 520" (hyphen, en dash, em dash, tilde or "to") → [480, 520].
// Anything else → null.
function toRange(cell) {
  if (typeof cell !== 'string') return null;
  const m = cell.trim().match(/^(\d{2,4})\s*(?:-|\u2013|\u2014|~|to)\s*(\d{2,4})$/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

const isScore = (v) => Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX;
const isRaw = (v) => Number.isInteger(v) && v >= 0 && v <= RAW_MAX;

function cleanLabel(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || toNumber(text) != null) return null;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

// A column written as one "480-520" cell per row is really two columns. Split
// it so the rest of the pipeline only ever sees one number per cell. Returns
// the widened grid plus, for each output column, the half it came from.
function expandRangeColumns(grid) {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  const rangeColumns = new Set();
  for (let c = 0; c < width; c++) {
    let ranges = 0;
    for (const row of grid) if (toRange(row[c])) ranges++;
    if (ranges >= MIN_COLUMN_CELLS) rangeColumns.add(c);
  }
  if (rangeColumns.size === 0) {
    return { grid, halves: Array.from({ length: width }, () => null) };
  }
  const halves = [];
  for (let c = 0; c < width; c++) {
    if (rangeColumns.has(c)) halves.push('Lower', 'Upper');
    else halves.push(null);
  }
  const out = grid.map((row) => {
    const next = [];
    for (let c = 0; c < width; c++) {
      const cell = row[c] ?? null;
      if (!rangeColumns.has(c)) { next.push(cell); continue; }
      const range = toRange(cell);
      if (range) next.push(range[0], range[1]);
      else next.push(cell, cell); // header text stays above both halves
    }
    return next;
  });
  return { grid: out, halves };
}

// What kind of column is this? 'raw' | 'score' | null.
function classifyColumn(values) {
  if (values.length < MIN_COLUMN_CELLS) return null;
  const scores = values.filter(isScore).length;
  if (scores >= MIN_COLUMN_CELLS && scores / values.length >= COLUMN_PURITY) return 'score';

  const raws = values.filter(isRaw);
  if (raws.length < MIN_COLUMN_CELLS || raws.length / values.length < COLUMN_PURITY) return null;
  // Raw scores count up (or down) one at a time. Requiring that keeps other
  // small-number columns (percentiles, question counts) from being mistaken
  // for the raw score.
  const distinct = [...new Set(raws)].sort((a, b) => a - b);
  if (distinct.length / raws.length < COLUMN_PURITY) return null;
  let consecutive = 0;
  for (let i = 1; i < distinct.length; i++) if (distinct[i] - distinct[i - 1] === 1) consecutive++;
  return consecutive / (distinct.length - 1) >= 0.7 ? 'raw' : null;
}

// Nearest header text above a column's first data row.
function headerFor(grid, column, firstDataRow) {
  for (let r = firstDataRow - 1; r >= Math.max(0, firstDataRow - HEADER_LOOKBACK_ROWS); r--) {
    const label = cleanLabel(grid[r]?.[column]);
    if (label) return label;
  }
  return null;
}

function defaultLabels(count) {
  if (count === 1) return ['Score'];
  if (count === 2) return ['Lower', 'Upper'];
  return Array.from({ length: count }, (_, i) => `Column ${i + 1}`);
}

// grid: array of rows, each an array of cells (number | string | null).
// Returns { columns: [{ label }], rows: [{ raw, values: [number|null] }],
//           rawMin, rawMax, warnings: [string] } or throws a 400 with a
// message written for the person uploading the sheet.
function detectScoreTable(inputGrid) {
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) {
    throw fail('The sheet is empty.');
  }
  const { grid, halves } = expandRangeColumns(inputGrid.map((row) => (Array.isArray(row) ? row : [])));
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);

  const kinds = [];
  for (let c = 0; c < width; c++) {
    const values = [];
    for (const row of grid) {
      const n = toNumber(row[c]);
      if (n != null) values.push(n);
    }
    kinds.push(classifyColumn(values));
  }

  // Each raw column owns the score columns that follow it.
  const blocks = [];
  let current = null;
  for (let c = 0; c < width; c++) {
    if (kinds[c] === 'raw') {
      current = { rawColumn: c, scoreColumns: [] };
      blocks.push(current);
    } else if (kinds[c] === 'score' && current) {
      current.scoreColumns.push(c);
    }
  }
  const usable = blocks.filter((b) => b.scoreColumns.length > 0);
  if (usable.length === 0) {
    if (!kinds.includes('score')) {
      throw fail(`No scaled-score column found. The sheet needs a column of section scores between ${SCORE_MIN} and ${SCORE_MAX}.`);
    }
    throw fail('No raw-score column found. The sheet needs a column counting correct answers (0, 1, 2, …) to the left of the scores.');
  }
  const scoreCount = usable[0].scoreColumns.length;
  if (usable.some((b) => b.scoreColumns.length !== scoreCount)) {
    throw fail('The side-by-side tables in this sheet do not have the same number of score columns. Fix the sheet, or paste just the raw and score columns instead.');
  }

  const warnings = [];
  const byRaw = new Map();
  let firstDataRow = Infinity;
  for (const block of usable) {
    grid.forEach((row, r) => {
      const raw = toNumber(row[block.rawColumn]);
      if (!isRaw(raw)) return;
      const values = block.scoreColumns.map((c) => {
        const v = toNumber(row[c]);
        return isScore(v) ? v : null;
      });
      if (values.every((v) => v == null)) return;
      if (block === usable[0] && r < firstDataRow) firstDataRow = r;
      const previous = byRaw.get(raw);
      if (previous && previous.some((v, i) => v !== values[i])) {
        warnings.push(`Raw score ${raw} appears more than once with different scores - the last one was used.`);
      }
      byRaw.set(raw, values);
    });
  }

  const rows = [...byRaw.entries()]
    .map(([raw, values]) => ({ raw, values }))
    .sort((a, b) => a.raw - b.raw);
  if (rows.length < 2) throw fail('Fewer than two raw → score rows were found in this sheet.');

  const fallback = defaultLabels(scoreCount);
  const columns = usable[0].scoreColumns.map((c, i) => ({
    // A split "480-520" column is labelled by its half; otherwise use the
    // sheet's own header, falling back to a generic name.
    label: halves[c] || headerFor(grid, c, firstDataRow) || fallback[i],
  }));
  // Two columns sharing one merged header ("Section Score Range") would both
  // get the same label - tell them apart.
  const seen = new Map();
  for (const col of columns) seen.set(col.label, (seen.get(col.label) || 0) + 1);
  columns.forEach((col, i) => {
    if (seen.get(col.label) > 1) col.label = fallback[i];
  });

  const rawMin = rows[0].raw;
  const rawMax = rows[rows.length - 1].raw;

  const missing = [];
  for (let raw = rawMin; raw <= rawMax; raw++) if (!byRaw.has(raw)) missing.push(raw);
  if (missing.length) {
    warnings.push(`No score listed for raw ${formatList(missing)}. A student with one of those raw scores gets the score of the next lower raw score.`);
  }
  if (rawMin !== 0) warnings.push(`The sheet starts at raw score ${rawMin}, not 0.`);

  columns.forEach((col, i) => {
    const blanks = rows.filter((row) => row.values[i] == null).map((row) => row.raw);
    if (blanks.length) warnings.push(`"${col.label}" has no score for raw ${formatList(blanks)}.`);
    let last = null;
    for (const row of rows) {
      const v = row.values[i];
      if (v == null) continue;
      if (last != null && v < last.value) {
        warnings.push(`"${col.label}" goes down from ${last.value} (raw ${last.raw}) to ${v} (raw ${row.raw}). Scores normally rise with the raw score - check for a typo.`);
        break;
      }
      last = { raw: row.raw, value: v };
    }
  });

  return { columns, rows, rawMin, rawMax, warnings };
}

function formatList(numbers) {
  return numbers.length > 6 ? `${numbers.slice(0, 6).join(', ')} and ${numbers.length - 6} more` : numbers.join(', ');
}

// Every worksheet that contains a score table, in tab order.
// sheets: [{ name, rows }]. Throws the first sheet's error if none qualify.
function detectScoreTables(sheets) {
  const tables = [];
  let firstError = null;
  for (const sheet of sheets || []) {
    try {
      tables.push({ sheetName: sheet.name || null, ...detectScoreTable(sheet.rows || []) });
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }
  if (tables.length === 0) throw firstError || fail('The workbook has no sheets.');
  return tables;
}

// Text → grid. Handles cells pasted from a spreadsheet (tab separated), CSV
// (with quoted fields), and plain space-separated columns copied from a PDF.
function gridFromText(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!source.trim()) throw fail('Nothing to read - the text is empty.');
  const hasTabs = source.includes('\t');
  const hasCommas = !hasTabs && source.includes(',');
  if (hasCommas) return parseCsv(source);
  const splitter = hasTabs ? /\t/ : /\s+/;
  return source
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => (hasTabs ? line : line.trim()).split(splitter).map((cell) => {
      const trimmed = cell.trim();
      return trimmed === '' ? null : trimmed;
    }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const pushField = () => { const v = field.trim(); row.push(v === '' ? null : v); field = ''; };
  const pushRow = () => { pushField(); if (row.some((c) => c != null)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

module.exports = {
  detectScoreTable,
  detectScoreTables,
  gridFromText,
  SCORE_MIN,
  SCORE_MAX,
  RAW_MAX,
};
