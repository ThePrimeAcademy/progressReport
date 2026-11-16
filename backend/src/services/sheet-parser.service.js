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
// Easy/Medium/Hard table, and two side-by-side layouts:
//   - one long table continued in a second block to fit the page (raw 0-22
//     on the left, 23-44 on the right), read as one table
//   - separate tables next to each other, each with its own raw column and
//     covering the same raw scores (Easy | Medium | Hard), read as one score
//     column per table, named after the header above it ("Easy")
//
// Pure functions, no I/O - see test/sheet-parser.test.js.

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

// The raw → scores rows of one block (a raw column and its score columns), in
// sheet order, plus the row they start on.
function readBlock(grid, block) {
  const rows = [];
  let firstRow = Infinity;
  grid.forEach((row, r) => {
    const raw = toNumber(row[block.rawColumn]);
    if (!isRaw(raw)) return;
    const values = block.scoreColumns.map((c) => {
      const v = toNumber(row[c]);
      return isScore(v) ? v : null;
    });
    if (values.every((v) => v == null)) return;
    if (r < firstRow) firstRow = r;
    rows.push({ raw, values });
  });
  return { ...block, rows, firstRow, raws: new Set(rows.map((row) => row.raw)) };
}

// True when the two sets share more than half of the smaller one. A table
// continued in a second block shares no raw scores with the first block (one
// repeated row at the seam at most); separate tables share nearly all of them.
function sharesMostRaws(a, b) {
  let shared = 0;
  for (const raw of b) if (a.has(raw)) shared++;
  return shared * 2 > Math.min(a.size, b.size);
}

// Groups blocks into tables, left to right. A block continues the first table
// whose raw scores it mostly does not repeat (see sharesMostRaws), otherwise
// it starts a table of its own. Within a table a raw score listed twice keeps
// its last scores.
//   → [{ blocks, firstRow, width, byRaw: Map(raw → values), duplicates: Set(raw) }]
function groupBlocks(blocks) {
  const groups = [];
  for (const block of blocks) {
    const home = groups.find((group) => !sharesMostRaws(group.raws, block.raws));
    if (!home) {
      groups.push({ blocks: [block], raws: new Set(block.raws) });
      continue;
    }
    if (home.blocks[0].scoreColumns.length !== block.scoreColumns.length) {
      throw fail('The side-by-side tables in this sheet do not have the same number of score columns. Fix the sheet, or paste just the raw and score columns instead.');
    }
    home.blocks.push(block);
    for (const raw of block.raws) home.raws.add(raw);
  }
  return groups.map(({ blocks: members }) => {
    const byRaw = new Map();
    const duplicates = new Set();
    for (const block of members) {
      for (const { raw, values } of block.rows) {
        const previous = byRaw.get(raw);
        if (previous && previous.some((v, i) => v !== values[i])) duplicates.add(raw);
        byRaw.set(raw, values);
      }
    }
    return {
      blocks: members,
      firstRow: members[0].firstRow,
      width: members[0].scoreColumns.length,
      byRaw,
      duplicates,
    };
  });
}

// Labels for one table's score columns, from the header above each column.
function columnLabels(grid, halves, table) {
  const block = table.blocks[0];
  const fallback = defaultLabels(block.scoreColumns.length);
  // A split "480-520" column is labelled by its half; otherwise use the
  // sheet's own header, falling back to a generic name.
  const labels = block.scoreColumns.map((c, i) => halves[c] || headerFor(grid, c, table.firstRow) || fallback[i]);
  // Two columns sharing one merged header ("Section Score Range") would both
  // get the same label - tell them apart.
  return labels.map((label, i) => (labels.indexOf(label) === labels.lastIndexOf(label) ? label : fallback[i]));
}

// Names for side-by-side tables: the nearest header text above each table that
// no other table has. For
//          Math                 Math                 Math
//          Easy                 Medium               Hard
//   Raw Score | Score    Raw Score | Score    Raw Score | Score
// that is "Easy", "Medium" and "Hard". A title merged across a table keeps its
// text in the left-most cell, above the raw column, so the raw column is
// searched as well as the score columns.
function tableTitles(grid, tables) {
  const texts = tables.map(({ blocks: [block], firstRow }) => {
    const found = [];
    const lastColumn = block.scoreColumns[block.scoreColumns.length - 1];
    for (let r = firstRow - 1; r >= Math.max(0, firstRow - HEADER_LOOKBACK_ROWS); r--) {
      for (let c = block.rawColumn; c <= lastColumn; c++) {
        const label = cleanLabel(grid[r]?.[c]);
        if (label) found.push(label);
      }
    }
    return found;
  });
  const owners = (label) => texts.filter((list) => list.some((x) => x.toLowerCase() === label.toLowerCase())).length;
  return texts.map((list, i) => list.find((label) => owners(label) === 1) || `Table ${i + 1}`);
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
  const tables = groupBlocks(usable.map((block) => readBlock(grid, block)).filter((block) => block.rows.length > 0));
  const allRaws = [...new Set(tables.flatMap((table) => [...table.byRaw.keys()]))].sort((a, b) => a - b);
  if (allRaws.length < 2) throw fail('Fewer than two raw → score rows were found in this sheet.');

  // Side-by-side tables become one score column each (one per table column
  // when a table has several, e.g. "Easy Lower" and "Easy Upper").
  const titles = tables.length > 1 ? tableTitles(grid, tables) : null;
  const columns = tables.flatMap((table, t) => {
    const labels = columnLabels(grid, halves, table);
    if (!titles) return labels.map((label) => ({ label }));
    return labels.map((label) => ({ label: labels.length === 1 ? titles[t] : `${titles[t]} ${label}` }));
  });
  const rows = allRaws.map((raw) => ({
    raw,
    values: tables.flatMap((table) => table.byRaw.get(raw) || Array(table.width).fill(null)),
  }));

  const warnings = [];
  tables.forEach((table, t) => {
    const repeated = [...table.duplicates].sort((a, b) => a - b);
    if (repeated.length === 0) return;
    const one = repeated.length === 1;
    warnings.push(`Raw score${one ? '' : 's'} ${formatList(repeated)}${titles ? ` in "${titles[t]}"` : ''} ${one ? 'appears' : 'appear'} more than once with different scores - the last one was used.`);
  });

  const rawMin = rows[0].raw;
  const rawMax = rows[rows.length - 1].raw;

  const listed = new Set(allRaws);
  const missing = [];
  for (let raw = rawMin; raw <= rawMax; raw++) if (!listed.has(raw)) missing.push(raw);
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

  return { columns, rows, rawMin, rawMax, warnings: [...new Set(warnings)] };
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
