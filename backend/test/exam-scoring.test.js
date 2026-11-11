// End-to-end through the services: an exam's Easy / Medium / Hard category
// decides which scoring sheet grades it, on the scoreboard and on the
// student's report alike.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/env');
const sheets = require('../src/services/scoring-sheet.service');
const programs = require('../src/services/program.service');
const exams = require('../src/services/exam.service');
const db = require('../src/services/db.service');
const { resolveExamCurve, describeExamScoring } = require('../src/services/exam-curve.service');
const { getExamScoreboard, getSatScoresForStudent, getExamClassAverage } = require('../src/services/sat.service');

const MATH = fixture('math-range-curve.json').curve; // raw 30 → 580 lower / 630 upper
const RW = fixture('rw-single-curve.json').curve; // raw 36 → 580
const RW_STRICT = RW.map((p) => ({ raw: p.raw, lower: Math.max(200, p.lower - 30), upper: Math.max(200, p.upper - 30) }));

const STUDENT = { id: '9001', name: 'Avery Stone', email: 'avery@example.com' };
const TESTS = { 1: 'rw-m1', 2: 'rw-m2', 3: 'math-m1', 4: 'math-m2' };
const RAW = { 'rw-m1': 20, 'rw-m2': 16, 'math-m1': 15, 'math-m2': 15 }; // RW 36, Math 30

let exam;

async function seedAttempt(student, testId, score, finishedAt) {
  await db.upsertRecord({
    key: `group:${student.id}:${testId}:g1:${finishedAt - 1800}`,
    student: {
      userId: student.id,
      email: student.email,
      name: student.name,
      normalizedName: student.name.toLowerCase().replace(/[^a-z0-9]+/g, ''),
      normalizedEmail: student.email,
    },
    test: { testId, testName: `Test ${testId}` },
    group: { groupId: 'g1', groupName: 'Fall SAT' },
    score,
    maxScore: 27,
    percentage: Math.round((score / 27) * 100),
    timeStarted: finishedAt - 1800,
    timeFinished: finishedAt,
    date: new Date(finishedAt * 1000).toISOString().split('T')[0],
    questions: [],
    categoryResults: [],
  });
}

const row = async () => (await getExamScoreboard(exam.examId)).rows.find((r) => r.studentId === STUDENT.id);

test.before(async () => {
  const program = programs.createProgram({ name: 'Fall SAT 2026', studentIds: [STUDENT.id] });
  exam = exams.createExam({
    name: 'Test 1',
    date: '2026-11-07',
    programId: program.programId,
    sections: Object.fromEntries(Object.entries(TESTS).map(([k, testId]) => [k, { testId, testName: `Test ${testId}` }])),
  });
  const finished = Math.floor(Date.parse('2026-11-07T15:00:00Z') / 1000);
  for (const [testId, score] of Object.entries(RAW)) await seedAttempt(STUDENT, testId, score, finished);
});

test('a new exam is uncategorised and shows raw scores only', async () => {
  assert.deepEqual(exam.difficulty, { rw: null, math: null });
  assert.deepEqual(resolveExamCurve(exam, 'rw'), { source: null, level: null, curve: null });
  const r = await row();
  assert.deepEqual([r.rwRaw, r.mathRaw], [36, 30]);
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [null, null, null]);
});

test('without a category the exam is graded by its own custom sheet, as before', async () => {
  sheets.saveCurve(exams.examCurveKey(exam.examId), 'rw', { curve: RW_STRICT });
  sheets.saveCurve(exams.examCurveKey(exam.examId), 'math', { curve: MATH, bound: 'lower' });
  const r = await row();
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [550, 580, 1130]);
  const scoring = describeExamScoring(exams.getExam(exam.examId));
  assert.deepEqual([scoring.rw.source, scoring.rw.level, scoring.rw.ready], ['custom', null, true]);
});

test('categorising a subject switches it to the shared sheet of that level', async () => {
  sheets.saveCurve(sheets.libraryKey('easy'), 'rw', { curve: RW });
  sheets.saveCurve(sheets.libraryKey('easy'), 'math', { curve: MATH, bound: 'upper' });
  sheets.saveCurve(sheets.libraryKey('hard'), 'math', { curve: MATH, bound: 'lower' });

  // One subject at a time: Math stays on its custom sheet.
  exam = exams.updateExam(exam.examId, { difficulty: { rw: 'easy' } });
  assert.deepEqual(exam.difficulty, { rw: 'easy', math: null });
  let r = await row();
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [580, 580, 1160]);

  exam = exams.updateExam(exam.examId, { difficulty: { math: 'easy' } });
  assert.deepEqual(exam.difficulty, { rw: 'easy', math: 'easy' });
  r = await row();
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [580, 630, 1210]);

  exam = exams.updateExam(exam.examId, { difficulty: { math: 'hard' } });
  r = await row();
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [580, 580, 1160]);
});

test('the student report uses the same sheets as the scoreboard', async () => {
  exam = exams.updateExam(exam.examId, { difficulty: { rw: 'easy', math: 'easy' } });
  const sat = await getSatScoresForStudent(STUDENT);
  assert.equal(sat.latestEnglishScore, 580);
  assert.equal(sat.latestMathScore, 630);
  assert.equal(sat.latestTestScore, 1210);
  assert.equal(sat.superScore, 1210);
  assert.equal(sat.allScores.length, 1);
  assert.deepEqual(
    { total: sat.allScores[0].total, english: sat.allScores[0].english, math: sat.allScores[0].math },
    { total: 1210, english: 580, math: 630 }
  );
  const avg = await getExamClassAverage(exam.examId);
  assert.deepEqual([avg.total, avg.rw, avg.math, avg.n], [1210, 580, 630, 1]);
});

test('a level with no sheet uploaded yet is not scaled and says so', async () => {
  exam = exams.updateExam(exam.examId, { difficulty: { math: 'medium' } });
  const board = await getExamScoreboard(exam.examId);
  const r = board.rows.find((x) => x.studentId === STUDENT.id);
  // It must not quietly fall back to the custom sheet or another level.
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [580, null, null]);
  assert.equal(r.mathRaw, 30);
  assert.equal(board.hasMathCurve, false);
  assert.deepEqual(
    [board.scoring.math.source, board.scoring.math.level, board.scoring.math.ready, board.scoring.math.sheet],
    ['library', 'medium', false, null]
  );

  sheets.saveCurve(sheets.libraryKey('medium'), 'math', {
    curve: MATH.map((p) => ({ raw: p.raw, lower: 600, upper: 600 })),
  });
  assert.equal((await row()).mathScaled, 600);
});

test('an exam that was sat but cannot be scaled yet is pending, not "not taken"', async () => {
  // Math is set to a level whose sheet does not exist; English is scored.
  sheets.deleteCurve(sheets.libraryKey('medium'), 'math');
  exam = exams.updateExam(exam.examId, { difficulty: { rw: 'easy', math: 'medium' } });
  let card = (await getSatScoresForStudent(STUDENT)).allScores[0];
  assert.deepEqual(
    { total: card.total, english: card.english, math: card.math, pending: card.pending },
    { total: null, english: 580, math: null, pending: true }
  );

  // Neither subject can be scaled: the exam still shows, as a pending card.
  sheets.deleteCurve(exams.examCurveKey(exam.examId), 'rw');
  sheets.deleteCurve(exams.examCurveKey(exam.examId), 'math');
  exam = exams.updateExam(exam.examId, { difficulty: { rw: null, math: null } });
  const sat = await getSatScoresForStudent(STUDENT);
  assert.equal(sat.latestTestScore, null);
  assert.equal(sat.allScores.length, 1);
  card = sat.allScores[0];
  assert.deepEqual(
    { total: card.total, english: card.english, math: card.math, pending: card.pending },
    { total: null, english: null, math: null, pending: true }
  );

  // A rostered exam nobody has sat is a plain upcoming placeholder.
  const upcoming = exams.createExam({ name: 'Upcoming', date: '2026-12-05', programId: exam.programId, sections: {} });
  const cards = (await getSatScoresForStudent(STUDENT)).allScores;
  assert.equal(cards.find((c) => c.groupName === 'Upcoming').pending, false);
  exams.deleteExam(upcoming.examId);

  // Put the custom sheets back for the tests that follow.
  sheets.saveCurve(exams.examCurveKey(exam.examId), 'rw', { curve: RW_STRICT });
  sheets.saveCurve(exams.examCurveKey(exam.examId), 'math', { curve: MATH, bound: 'lower' });
  sheets.saveCurve(sheets.libraryKey('medium'), 'math', {
    curve: MATH.map((p) => ({ raw: p.raw, lower: 600, upper: 600 })),
  });
});

test('editing a shared sheet re-grades every exam that uses it', async () => {
  exam = exams.updateExam(exam.examId, { difficulty: { rw: 'easy', math: 'easy' } });
  assert.equal((await row()).mathScaled, 630);
  sheets.setBound(sheets.libraryKey('easy'), 'math', 'lower');
  assert.equal((await row()).mathScaled, 580);
  assert.equal((await getSatScoresForStudent(STUDENT)).latestMathScore, 580);
  sheets.setBound(sheets.libraryKey('easy'), 'math', 'upper');
});

test('clearing the category returns the exam to its custom sheet', async () => {
  exam = exams.updateExam(exam.examId, { difficulty: { rw: null, math: '' } });
  assert.deepEqual(exam.difficulty, { rw: null, math: null });
  const r = await row();
  assert.deepEqual([r.rwScaled, r.mathScaled, r.total], [550, 580, 1130]);
});

test('other edits leave the category alone and bad categories are rejected', () => {
  exam = exams.updateExam(exam.examId, { difficulty: { rw: 'hard', math: 'medium' } });
  exam = exams.updateExam(exam.examId, { name: 'Test 1 (renamed)' });
  assert.deepEqual(exam.difficulty, { rw: 'hard', math: 'medium' });
  assert.throws(() => exams.updateExam(exam.examId, { difficulty: { rw: 'extreme' } }), /difficulty\.rw must be one of: easy, medium, hard/);
  assert.throws(() => exams.updateExam(exam.examId, { difficulty: 'easy' }), /difficulty must be an object/);
  assert.deepEqual(exams.getExam(exam.examId).difficulty, { rw: 'hard', math: 'medium' });
});

test('exams can be categorised at creation, and a duplicate starts uncategorised', () => {
  const created = exams.createExam({
    name: 'Test 2',
    programId: exam.programId,
    sections: {},
    difficulty: { rw: 'Medium', math: 'hard' },
  });
  assert.deepEqual(created.difficulty, { rw: 'medium', math: 'hard' });
  assert.deepEqual(exams.duplicateExam(created.examId).difficulty, { rw: null, math: null });
});
