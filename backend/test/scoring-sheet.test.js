const test = require('node:test');
const assert = require('node:assert/strict');
const { makeXlsxBase64, fixture } = require('./helpers/env');
const sheets = require('../src/services/scoring-sheet.service');

const MATH = fixture('math-range-curve.json').curve;
const RW = fixture('rw-single-curve.json').curve;

function legacyWorkbook(points, title) {
  const half = Math.ceil(points.length / 2);
  const rows = [
    [title],
    ['Raw Score', 'Section Score Range', null, null, 'Raw Score', 'Section Score Range'],
    ['Correct Answers', 'Lower', 'Upper', null, 'Correct Answers', 'Lower', 'Upper'],
  ];
  for (let i = 0; i < half; i++) {
    const l = points[i];
    const r = points[half + i];
    rows.push(r ? [l.raw, l.lower, l.upper, null, r.raw, r.lower, r.upper] : [l.raw, l.lower, l.upper]);
  }
  return { sheets: [{ name: 'Sheet1', rows }] };
}

test('an uploaded .xlsx in the existing layout parses to the same table as before', async () => {
  const { tables } = await sheets.parseSheet({ fileBase64: makeXlsxBase64(legacyWorkbook(MATH, 'Math')) });
  assert.equal(tables.length, 1);
  assert.equal(tables[0].sheetName, 'Sheet1');
  assert.deepEqual(tables[0].columns.map((c) => c.label), ['Lower', 'Upper']);
  assert.deepEqual(
    tables[0].rows.map((r) => ({ raw: r.raw, lower: r.values[0], upper: r.values[1] })),
    MATH
  );
});

test('a workbook with one tab per level returns a table per tab', async () => {
  const tab = (name, pick) => ({ name, rows: [['Raw', 'Score'], ...MATH.map((p) => [p.raw, pick(p)])] });
  const { tables } = await sheets.parseSheet({
    fileBase64: makeXlsxBase64({ sheets: [tab('Easy', (p) => p.upper), tab('Hard', (p) => p.lower)] }),
  });
  assert.deepEqual(tables.map((t) => t.sheetName), ['Easy', 'Hard']);
  assert.equal(tables[0].rows[6].values[0], 270);
  assert.equal(tables[1].rows[6].values[0], 230);
});

test('pasted text and CSV uploads are read without a workbook', async () => {
  const text = ['Raw\tScore', ...RW.map((p) => `${p.raw}\t${p.upper}`)].join('\n');
  assert.equal((await sheets.parseSheet({ text })).tables[0].rows.length, 55);
  const csv = Buffer.from(['Raw,Score', ...RW.map((p) => `${p.raw},${p.upper}`)].join('\n')).toString('base64');
  assert.equal((await sheets.parseSheet({ fileBase64: csv })).tables[0].rows.length, 55);
});

test('unreadable uploads are rejected with a clear message', async () => {
  await assert.rejects(sheets.parseSheet({}), /Upload a file or paste/);
  // Binary that is not a zip, e.g. an old .xls file.
  const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).toString('base64');
  await assert.rejects(sheets.parseSheet({ fileBase64: xls }), /not supported/);
  // A zip that is not a workbook.
  const notWorkbook = Buffer.concat([Buffer.from('PK'), Buffer.alloc(64, 1)]).toString('base64');
  await assert.rejects(sheets.parseSheet({ fileBase64: notWorkbook }), /Could not read this file as an Excel workbook/);
});

test('one-step upload still works for an unambiguous file', async () => {
  const record = await sheets.saveCurveFromBase64('exam:one-step', 'math', makeXlsxBase64(legacyWorkbook(MATH, 'Math')), 'math.xlsx');
  assert.equal(record.bound, 'upper');
  assert.deepEqual(record.curve, MATH);
  assert.deepEqual(sheets.getCurve('exam:one-step', 'math').curve, MATH);
});

test('one-step upload refuses a file that needs a choice', async () => {
  const rows = [['Raw', 'Easy', 'Medium', 'Hard'], ...MATH.map((p) => [p.raw, p.upper, p.upper, p.lower])];
  await assert.rejects(
    sheets.saveCurveFromBase64('exam:ambiguous', 'math', makeXlsxBase64({ sheets: [{ name: 'S', rows }] }), 'm.xlsx'),
    /3 score columns \(Easy, Medium, Hard\)/
  );
  assert.equal(sheets.getCurve('exam:ambiguous', 'math'), null);
});

test('saving validates and sorts the points', () => {
  const shuffled = [...RW].reverse();
  const record = sheets.saveCurve('exam:sorted', 'rw', { curve: shuffled, originalFilename: 'rw.xlsx', columnLabel: 'Score' });
  assert.deepEqual(record.curve, RW);
  assert.equal(record.columnLabel, 'Score');

  const bad = (curve, pattern) => assert.throws(() => sheets.saveCurve('exam:bad', 'rw', { curve }), pattern);
  bad([], /at least two/);
  bad([{ raw: 0, lower: 200, upper: 200 }, { raw: 0, lower: 210, upper: 210 }], /listed twice/);
  bad([{ raw: 0, lower: 200, upper: 200 }, { raw: 1.5, lower: 210, upper: 210 }], /Raw scores must be whole numbers/);
  bad([{ raw: 0, lower: 200, upper: 200 }, { raw: 1, lower: 'x', upper: 210 }], /Scaled scores must be whole numbers/);
  assert.throws(() => sheets.saveCurve('exam:bad', 'science', { curve: RW }), /section must be one of/);
  assert.equal(sheets.getCurve('exam:bad', 'rw'), null);
});

test('replacing a sheet keeps its Lower/Upper choice unless told otherwise', () => {
  sheets.saveCurve('exam:bound', 'math', { curve: MATH });
  sheets.setBound('exam:bound', 'math', 'lower');
  assert.equal(sheets.saveCurve('exam:bound', 'math', { curve: MATH }).bound, 'lower');
  assert.equal(sheets.saveCurve('exam:bound', 'math', { curve: MATH, bound: 'upper' }).bound, 'upper');
});

test('grading matches the stored table at every raw score, for both bounds', () => {
  const upper = { curve: MATH, bound: 'upper' };
  const lower = { curve: MATH, bound: 'lower' };
  for (const p of MATH) {
    assert.equal(sheets.gradeScaled(upper, p.raw), p.upper);
    assert.equal(sheets.gradeScaled(lower, p.raw), p.lower);
  }
  // No bound recorded (oldest files) means upper.
  assert.equal(sheets.gradeScaled({ curve: MATH }, 30), 630);
});

test('grading clamps beyond the sheet and bridges a skipped raw score', () => {
  const record = { curve: MATH, bound: 'upper' };
  assert.equal(sheets.gradeScaled(record, 99), 800);
  assert.equal(sheets.gradeScaled(record, -3), 200);
  assert.equal(sheets.gradeScaled(null, 10), null);
  assert.equal(sheets.gradeScaled({ curve: [] }, 10), null);

  const gappy = { curve: MATH.filter((p) => p.raw !== 20 && p.raw !== 21 && p.raw !== 0), bound: 'upper' };
  const at = (raw) => MATH.find((p) => p.raw === raw).upper;
  assert.equal(sheets.gradeScaled(gappy, 21), at(19)); // next lower listed score
  assert.equal(sheets.gradeScaled(gappy, 0), at(1)); // nothing lower: next higher
});

test('the library has three levels per subject and reports what is uploaded', () => {
  assert.deepEqual(sheets.LEVELS, ['easy', 'medium', 'hard']);
  assert.throws(() => sheets.libraryKey('impossible'), /level must be one of/);

  const before = sheets.listLibrary();
  assert.deepEqual(Object.keys(before).sort(), ['math', 'rw']);
  assert.deepEqual(before.math, { easy: null, medium: null, hard: null });

  sheets.saveCurve(sheets.libraryKey('easy'), 'math', { curve: MATH, bound: 'upper', originalFilename: 'math.xlsx' });
  sheets.copyCurve(sheets.libraryKey('easy'), sheets.libraryKey('hard'), 'math');
  sheets.setBound(sheets.libraryKey('hard'), 'math', 'lower');
  sheets.saveCurve(sheets.libraryKey('medium'), 'rw', { curve: RW });

  const after = sheets.listLibrary();
  assert.equal(after.math.medium, null);
  assert.equal(after.math.easy.bound, 'upper');
  assert.equal(after.math.hard.bound, 'lower');
  assert.equal(after.math.easy.hasRange, true);
  assert.equal(after.rw.medium.hasRange, false);
  assert.equal(after.math.easy.points, 45);
  assert.deepEqual([after.math.easy.rawMin, after.math.easy.rawMax], [0, 44]);
  // Same points, so the UI can tell these two are one sheet read two ways.
  assert.equal(after.math.easy.hash, after.math.hard.hash);
  assert.notEqual(after.math.easy.hash, after.rw.medium.hash);
  assert.deepEqual(after.math.hard.copiedFrom, { groupId: 'library:easy', section: 'math' });

  assert.equal(sheets.deleteCurve(sheets.libraryKey('hard'), 'math'), true);
  assert.equal(sheets.deleteCurve(sheets.libraryKey('hard'), 'math'), false);
  assert.equal(sheets.listLibrary().math.hard, null);
});

test('every change bumps the version that invalidates cached reports', () => {
  const v0 = sheets.getCurvesVersion();
  sheets.saveCurve('exam:version', 'rw', { curve: RW });
  sheets.setBound('exam:version', 'rw', 'lower');
  sheets.deleteCurve('exam:version', 'rw');
  assert.equal(sheets.getCurvesVersion(), v0 + 3);
});
