const test = require('node:test');
const assert = require('node:assert/strict');
const { detectScoreTable, detectScoreTables, gridFromText } = require('../src/services/sheet-parser.service');
const { fixture } = require('./helpers/env');
const { LEVEL_SCORES, levelTablesGrid } = require('./helpers/layouts');

const MATH = fixture('math-range-curve.json').curve; // raw 0-44, lower/upper range
const RW = fixture('rw-single-curve.json').curve; // raw 0-54, one score each

// The layout of the sheets Prime Academy has been uploading: a title row, a
// merged header row, a sub-header row, then the table split into two blocks
// side by side with a blank column between them.
function sideBySideGrid(points) {
  const half = Math.ceil(points.length / 2);
  const left = points.slice(0, half);
  const right = points.slice(half);
  const grid = [
    ['2026 DSAT Math Scoring Sheet - count the correct answers, then read across'],
    ['Raw Score', 'Section Score Range', null, null, 'Raw Score', 'Section Score Range'],
    ['Correct Answers', 'Lower', 'Upper', null, 'Correct Answers', 'Lower', 'Upper'],
  ];
  for (let i = 0; i < half; i++) {
    const l = left[i];
    const r = right[i];
    grid.push(r
      ? [l.raw, l.lower, l.upper, null, r.raw, r.lower, r.upper]
      : [l.raw, l.lower, l.upper]);
  }
  return grid;
}

const asPoints = (table, lowerIndex = 0, upperIndex = lowerIndex) =>
  table.rows.map((row) => ({ raw: row.raw, lower: row.values[lowerIndex], upper: row.values[upperIndex] }));

test('reads the existing side-by-side Lower/Upper layout exactly', () => {
  const table = detectScoreTable(sideBySideGrid(MATH));
  assert.deepEqual(table.columns.map((c) => c.label), ['Lower', 'Upper']);
  assert.deepEqual(asPoints(table, 0, 1), MATH);
  assert.equal(table.rawMin, 0);
  assert.equal(table.rawMax, 44);
  assert.deepEqual(table.warnings, []);
});

test('keeps the first rows when the sheet has a single header row', () => {
  // The previous parser skipped three rows no matter what and lost raw 0-1 here.
  const grid = [['Raw', 'Lower', 'Upper'], ...MATH.map((p) => [p.raw, p.lower, p.upper])];
  assert.deepEqual(asPoints(detectScoreTable(grid), 0, 1), MATH);
});

test('reads a plain two-column raw/score sheet', () => {
  const grid = [['# Correct', 'Scaled Score'], ...RW.map((p) => [p.raw, p.upper])];
  const table = detectScoreTable(grid);
  assert.deepEqual(table.columns.map((c) => c.label), ['Scaled Score']);
  assert.deepEqual(asPoints(table), RW);
});

test('reads a sheet with no header at all', () => {
  const table = detectScoreTable(RW.map((p) => [p.raw, p.upper]));
  assert.deepEqual(table.columns.map((c) => c.label), ['Score']);
  assert.equal(table.rows.length, 55);
});

test('reads one sheet holding Easy / Medium / Hard columns', () => {
  const grid = [
    ['Math conversion'],
    ['Raw', 'Easy', 'Medium', 'Hard'],
    ...MATH.map((p) => [p.raw, p.upper, Math.round((p.lower + p.upper) / 20) * 10, p.lower]),
  ];
  const table = detectScoreTable(grid);
  assert.deepEqual(table.columns.map((c) => c.label), ['Easy', 'Medium', 'Hard']);
  assert.deepEqual(table.rows[6], { raw: 6, values: [270, 250, 230] });
  assert.deepEqual(asPoints(table, 2), MATH.map((p) => ({ raw: p.raw, lower: p.lower, upper: p.lower })));
});

test('reads Easy, Medium and Hard tables printed side by side as one column per level', () => {
  // Before, the three tables were read as one table continued across the
  // page: every level but the last was overwritten, with a warning per row.
  const table = detectScoreTable(levelTablesGrid(MATH));
  assert.deepEqual(table.columns.map((c) => c.label), ['Easy', 'Medium', 'Hard']);
  assert.deepEqual(table.rows.map((r) => r.raw), MATH.map((p) => p.raw));
  for (const [i, level] of ['Easy', 'Medium', 'Hard'].entries()) {
    assert.deepEqual(
      asPoints(table, i),
      MATH.map((p) => ({ raw: p.raw, lower: LEVEL_SCORES[level](p), upper: LEVEL_SCORES[level](p) }))
    );
  }
  assert.deepEqual(table.warnings, []);
});

test('side-by-side level tables with a Lower/Upper range each keep both ends', () => {
  const grid = [
    ['Easy', null, null, null, 'Hard'],
    ['Raw', 'Lower', 'Upper', null, 'Raw', 'Lower', 'Upper'],
    ...MATH.map((p) => [p.raw, p.lower, p.upper, null, p.raw, p.lower, p.upper]),
  ];
  const table = detectScoreTable(grid);
  assert.deepEqual(table.columns.map((c) => c.label), ['Easy Lower', 'Easy Upper', 'Hard Lower', 'Hard Upper']);
  assert.deepEqual(asPoints(table, 2, 3), MATH);
});

test('each level split into two blocks still reads as one column per level', () => {
  // Easy 0-22 | Easy 23-44 | Medium 0-22 | Medium 23-44 | Hard 0-22 | Hard 23-44
  const blocks = ['Easy', 'Medium', 'Hard'].flatMap((level) => [{ level, from: 0 }, { level, from: 23 }]);
  const across = (cells) => blocks.flatMap((block, i) => [...(i ? [null] : []), ...cells(block)]);
  const grid = [
    across((block) => [block.from === 0 ? block.level : null, null]),
    across(() => ['Raw', 'Score']),
    ...Array.from({ length: 23 }, (_, k) => across((block) => {
      const p = MATH[block.from + k];
      return p ? [p.raw, LEVEL_SCORES[block.level](p)] : [null, null];
    })),
  ];
  const table = detectScoreTable(grid);
  assert.deepEqual(table.columns.map((c) => c.label), ['Easy', 'Medium', 'Hard']);
  assert.deepEqual(asPoints(table, 1), MATH.map((p) => ({ raw: p.raw, lower: LEVEL_SCORES.Medium(p), upper: LEVEL_SCORES.Medium(p) })));
  assert.deepEqual(table.warnings, []);
});

test('side-by-side tables with nothing to tell them apart are numbered', () => {
  const grid = [['Raw', 'Score', null, 'Raw', 'Score'], ...MATH.map((p) => [p.raw, p.lower, null, p.raw, p.upper])];
  assert.deepEqual(detectScoreTable(grid).columns.map((c) => c.label), ['Table 1', 'Table 2']);
});

test('a table continued beside itself may repeat the row at the seam', () => {
  const grid = (seamScore) => [
    ['Raw', 'Score', null, 'Raw', 'Score'],
    ...Array.from({ length: 23 }, (_, k) => {
      const right = MATH[22 + k];
      return [MATH[k].raw, MATH[k].upper, null, right?.raw ?? null, right?.raw === 22 ? seamScore : right?.upper ?? null];
    }),
  ];
  const same = detectScoreTable(grid(MATH[22].upper));
  assert.deepEqual(same.columns.map((c) => c.label), ['Score']);
  assert.deepEqual(asPoints(same), MATH.map((p) => ({ raw: p.raw, lower: p.upper, upper: p.upper })));
  assert.deepEqual(same.warnings, []);

  const different = detectScoreTable(grid(MATH[22].upper + 10));
  assert.equal(different.columns.length, 1);
  assert.deepEqual(different.warnings, ['Raw score 22 appears more than once with different scores - the last one was used.']);
});

test('splits a "480-520" range column into Lower and Upper', () => {
  const grid = [['Raw', 'Score range'], ...MATH.map((p) => [p.raw, `${p.lower}-${p.upper}`])];
  const table = detectScoreTable(grid);
  assert.deepEqual(table.columns.map((c) => c.label), ['Lower', 'Upper']);
  assert.deepEqual(asPoints(table, 0, 1), MATH);
});

test('accepts a table listed from the highest raw score down', () => {
  const grid = [['Raw', 'Score'], ...[...RW].reverse().map((p) => [p.raw, p.upper])];
  assert.deepEqual(asPoints(detectScoreTable(grid)), RW);
});

test('ignores unrelated columns such as question totals and notes', () => {
  const grid = [
    ['Raw', 'Score', 'Notes'],
    ...RW.map((p, i) => [p.raw, p.upper, i === 3 ? 'see teacher' : null]),
  ];
  const table = detectScoreTable(grid);
  assert.equal(table.columns.length, 1);
  assert.deepEqual(asPoints(table), RW);
});

test('numbers stored as text are still numbers', () => {
  const grid = [['Raw', 'Score'], ...RW.map((p) => [String(p.raw), ` ${p.upper} `])];
  assert.deepEqual(asPoints(detectScoreTable(grid)), RW);
});

test('warns about skipped raw scores and scores that go down', () => {
  const points = RW.filter((p) => p.raw !== 12 && p.raw !== 13).map((p) => [p.raw, p.raw === 30 ? 300 : p.upper]);
  const table = detectScoreTable([['Raw', 'Score'], ...points]);
  assert.equal(table.warnings.length, 2);
  assert.match(table.warnings[0], /No score listed for raw 12, 13/);
  assert.match(table.warnings[1], /goes down/);
});

test('explains what is missing when there is no usable table', () => {
  assert.throws(() => detectScoreTable([]), /empty/);
  assert.throws(
    () => detectScoreTable([['Name', 'Email'], ['A', 'a@example.com']]),
    /No scaled-score column found/
  );
  // Scores but nothing counting correct answers next to them.
  assert.throws(
    () => detectScoreTable(RW.map((p) => ['x', p.upper])),
    /No raw-score column found/
  );
});

test('finds the table on every worksheet that has one', () => {
  const tables = detectScoreTables([
    { name: 'Instructions', rows: [['Read me first']] },
    { name: 'English', rows: [['Raw', 'Score'], ...RW.map((p) => [p.raw, p.upper])] },
    { name: 'Math', rows: sideBySideGrid(MATH) },
  ]);
  assert.deepEqual(tables.map((t) => t.sheetName), ['English', 'Math']);
  assert.equal(tables[1].columns.length, 2);
});

test('reads cells pasted from a spreadsheet (tab separated)', () => {
  const text = ['Raw\tLower\tUpper', ...MATH.map((p) => `${p.raw}\t${p.lower}\t${p.upper}`)].join('\n');
  assert.deepEqual(asPoints(detectScoreTable(gridFromText(text)), 0, 1), MATH);
});

test('reads CSV, including quoted headers', () => {
  const text = ['"Raw score","Scaled, final"', ...RW.map((p) => `${p.raw},${p.upper}`)].join('\r\n');
  const table = detectScoreTable(gridFromText(text));
  assert.deepEqual(table.columns.map((c) => c.label), ['Scaled, final']);
  assert.deepEqual(asPoints(table), RW);
});

test('reads space-separated columns copied from a PDF', () => {
  const text = RW.map((p) => `${p.raw}   ${p.upper}`).join('\n');
  assert.deepEqual(asPoints(detectScoreTable(gridFromText(text))), RW);
});
