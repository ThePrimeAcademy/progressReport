#!/usr/bin/env node
// scripts/seed-demo.js
// Fills an EMPTY data directory with made-up programs, exams, students and
// test results so the app can be run and tested locally without ClassMarker
// credentials and without any real student data.
//
//   npm run seed:demo                      # into backend/data
//   DATA_DIR=/some/dir npm run seed:demo   # into another directory
//   npm run seed:demo -- --empty-library   # leave the Easy/Medium/Hard sheets
//                                          # un-uploaded (to try the upload flow)
//   npm run seed:demo -- --force           # wipe the directory first
//
// Everything is generated from a fixed seed, so two runs produce the same
// data. Names and emails are invented (example.com addresses).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = new Set(process.argv.slice(2));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
process.env.DATA_DIR = DATA_DIR;
// Seed from stored data only: never reach out to ClassMarker.
delete process.env.CLASSMARKER_API_KEY;
delete process.env.CLASSMARKER_API_SECRET;

if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in a production environment.');
  process.exit(1);
}

const existing = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((f) => !f.startsWith('.')) : [];
if (existing.length > 0) {
  if (!args.has('--force')) {
    console.error(`${DATA_DIR} already has data (${existing.slice(0, 4).join(', ')}${existing.length > 4 ? ', …' : ''}).`);
    console.error('Run with --force to wipe it and start over.');
    process.exit(1);
  }
  for (const entry of existing) fs.rmSync(path.join(DATA_DIR, entry), { recursive: true, force: true });
}
fs.mkdirSync(DATA_DIR, { recursive: true });

// Required only after DATA_DIR is settled: the services read it on load.
const db = require('../src/services/db.service');
const programs = require('../src/services/program.service');
const exams = require('../src/services/exam.service');
const sheets = require('../src/services/scoring-sheet.service');

// ── Deterministic randomness ──────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const pick = (list) => list[Math.floor(rand() * list.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Made-up people ────────────────────────────────────────────
const FIRST = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Quinn', 'Rowan', 'Skyler', 'Emerson', 'Hayden', 'Parker', 'Reese', 'Sawyer', 'Dakota', 'Finley', 'Harper', 'Kendall', 'Logan', 'Marlow', 'Noel', 'Oakley', 'Peyton', 'Remy', 'Sage', 'Tatum', 'Blake', 'Cameron', 'Devon', 'Ellis', 'Frankie'];
const LAST = ['Abara', 'Bianchi', 'Castellan', 'Dvorak', 'Eklund', 'Fontaine', 'Galloway', 'Hale', 'Ibarra', 'Jovanovic', 'Kessler', 'Lindqvist', 'Marchetti', 'Novak', 'Okafor', 'Pemberton', 'Quillen', 'Rosales', 'Sorensen', 'Thackeray', 'Umeda', 'Varga', 'Whitlock', 'Yoon', 'Zielinski'];

let nextUserId = 4100001;
const usedNames = new Set();
function makeStudent() {
  let name;
  do { name = `${pick(FIRST)} ${pick(LAST)}`; } while (usedNames.has(name));
  usedNames.add(name);
  const [first, last] = name.split(' ');
  return {
    id: String(nextUserId++),
    first,
    last,
    name,
    email: `${first}.${last}`.toLowerCase() + '@example.com',
    parentEmail: `parent.${last}`.toLowerCase() + '@example.com',
    // Starting ability per subject (share of questions they get right) and how
    // much they improve each week.
    rw: 0.42 + rand() * 0.4,
    math: 0.42 + rand() * 0.45,
    growth: 0.004 + rand() * 0.016,
  };
}

// ── Question categories ───────────────────────────────────────
const RW_CATEGORIES = ['Central Ideas and Details', 'Command of Evidence', 'Inferences', 'Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections', 'Rhetorical Synthesis', 'Transitions', 'Boundaries', 'Form, Structure, and Sense'];
const MATH_CATEGORIES = ['Linear Equations in One Variable', 'Linear Functions', 'Systems of Linear Equations', 'Linear Inequalities', 'Nonlinear Functions', 'Quadratic Equations', 'Ratios, Rates, and Proportions', 'Percentages', 'Probability', 'Area and Volume', 'Right Triangles and Trigonometry', 'Circles'];
const categoryId = (name) => String(7000 + [...RW_CATEGORIES, ...MATH_CATEGORIES].indexOf(name));

// DSAT module sizes: Reading & Writing 27 + 27, Math 22 + 22.
const SECTION_SIZE = { 1: 27, 2: 27, 3: 22, 4: 22 };
const SECTION_LABEL = { 1: 'English Module 1', 2: 'English Module 2', 3: 'Math Module 1', 4: 'Math Module 2' };

let nextTestId = 880001;
let nextQuestionId = 5500001;
function makeTest(name, section) {
  const categories = section <= 2 ? RW_CATEGORIES : MATH_CATEGORIES;
  return {
    testId: String(nextTestId++),
    testName: name,
    section,
    questions: Array.from({ length: SECTION_SIZE[section] }, (_, i) => {
      const categoryName = categories[i % categories.length];
      return {
        questionId: String(nextQuestionId++),
        categoryId: categoryId(categoryName),
        categoryName,
        // Later questions in a module are harder.
        difficulty: -0.12 + (i / SECTION_SIZE[section]) * 0.3 + (rand() - 0.5) * 0.1,
      };
    }),
  };
}

// ── Scoring curves ────────────────────────────────────────────
// A smooth 200 → 800 curve. A lower exponent is a more generous sheet.
function curvePoints(maxRaw, lowerExp, upperExp = lowerExp) {
  const at = (raw, exp) => (raw === 0 ? 200 : raw === maxRaw ? 800 : Math.round((200 + 600 * (raw / maxRaw) ** exp) / 10) * 10);
  return Array.from({ length: maxRaw + 1 }, (_, raw) => ({
    raw,
    lower: Math.min(at(raw, lowerExp), at(raw, upperExp)),
    upper: Math.max(at(raw, lowerExp), at(raw, upperExp)),
  }));
}
const RW_MAX = 54;
const MATH_MAX = 44;

// ── Results ───────────────────────────────────────────────────
// The app reads results from two stores: the webhook database (per-question
// detail) and a cache of ClassMarker's results API (the test lists). A real
// attempt lands in both, so the seed writes both.
const apiCache = { results: [], groupMap: {}, testMap: {} };

async function recordAttempt(student, group, test, weekIndex, finishedAt) {
  const ability = (test.section <= 2 ? student.rw : student.math) + student.growth * weekIndex;
  const questions = test.questions.map((q, i) => {
    const correct = rand() < clamp(ability - q.difficulty, 0.05, 0.97);
    return {
      questionId: q.questionId,
      questionType: 'multiplechoice',
      categoryId: q.categoryId,
      categoryName: q.categoryName,
      sectionNumber: 1,
      questionNumber: i + 1,
      correct,
      result: correct ? 'correct' : 'incorrect',
      pointsScored: correct ? 1 : 0,
      pointsAvailable: 1,
    };
  });
  const score = questions.filter((q) => q.correct).length;
  const byCategory = new Map();
  for (const q of questions) {
    const c = byCategory.get(q.categoryId) || { categoryId: q.categoryId, name: q.categoryName, correct: 0, total: 0 };
    c.total += 1;
    if (q.correct) c.correct += 1;
    byCategory.set(q.categoryId, c);
  }
  const minutes = 20 + Math.floor(rand() * 14);
  const timeStarted = finishedAt - minutes * 60;
  await db.upsertRecord({
    key: `group:${student.id}:${test.testId}:${group.groupId}:${timeStarted}`,
    student: {
      userId: student.id,
      email: student.email,
      name: student.name,
      normalizedName: student.name.toLowerCase().replace(/[^a-z0-9]+/g, ''),
      normalizedEmail: student.email,
    },
    test: { testId: test.testId, testName: test.testName },
    group,
    percentage: Math.round((score / questions.length) * 1000) / 10,
    score,
    maxScore: questions.length,
    passed: score / questions.length >= 0.5,
    duration: `00:${String(minutes).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`,
    timeStarted,
    timeFinished: finishedAt,
    date: new Date(finishedAt * 1000).toISOString().split('T')[0],
    questions,
    categoryResults: [...byCategory.values()].map((c) => ({
      ...c,
      percentage: Math.round((c.correct / c.total) * 1000) / 10,
    })),
    raw: { source: 'demo-seed' },
    receivedAt: new Date(finishedAt * 1000 + 60000).toISOString(),
  });

  apiCache.groupMap[group.groupId] = group.groupName;
  apiCache.testMap[test.testId] = test.testName;
  apiCache.results.push({
    user_id: Number(student.id),
    first: student.first,
    last: student.last,
    email: student.email,
    test_id: Number(test.testId),
    group_id: Number(group.groupId),
    points_scored: score,
    points_available: questions.length,
    percentage: Math.round((score / questions.length) * 1000) / 10,
    passed: score / questions.length >= 0.5,
    duration: `00:${String(minutes).padStart(2, '0')}:00`,
    time_started: timeStarted,
    time_finished: finishedAt,
    category_results: [...byCategory.values()].map((c) => ({
      category_id: c.categoryId,
      category_name: c.name,
      correct: c.correct,
      total: c.total,
    })),
    questions: null,
  });
}

// One program: its students, a ClassMarker-style group, and a weekly exam.
// plan: [{ name, date, upcoming?, custom?: { rwExp, mathBound }, difficulty? }]
async function seedProgram({ name, groupName, studentCount, plan, archived }) {
  const students = Array.from({ length: studentCount }, makeStudent);
  const program = programs.createProgram({ name, studentIds: students.map((s) => s.id) });
  const group = { groupId: String(31000 + programs.listPrograms().length), groupName };

  for (const s of students) {
    // Leave a few without a parent email so the "missing contact" states show.
    await db.setContacts(s.id, { studentEmail: s.email, parentEmail: rand() < 0.85 ? s.parentEmail : '' });
  }

  for (let week = 0; week < plan.length; week++) {
    const item = plan[week];
    const tests = item.upcoming ? [] : [1, 2, 3, 4].map((sec) => makeTest(`${item.name} ${SECTION_LABEL[sec]}`, sec));
    const exam = exams.createExam({
      name: item.name,
      date: item.date,
      programId: program.programId,
      sections: Object.fromEntries(tests.map((t) => [String(t.section), { testId: t.testId, testName: t.testName }])),
      difficulty: item.difficulty,
    });
    if (item.custom) {
      const key = exams.examCurveKey(exam.examId);
      sheets.saveCurve(key, 'rw', { curve: curvePoints(RW_MAX, item.custom.rwExp), originalFilename: `${item.name} English Scoring.xlsx` });
      sheets.saveCurve(key, 'math', { curve: curvePoints(MATH_MAX, 1.12, 0.92), bound: item.custom.mathBound, originalFilename: '2026 DSAT Math Scoring Sheet.xlsx' });
    }
    if (item.upcoming) continue;

    // 9:00 AM Eastern on the exam date, one module after another.
    const start = Math.floor(Date.parse(`${item.date}T14:00:00Z`) / 1000);
    for (const s of students) {
      if (rand() < 0.06) continue; // absent that week
      for (const t of tests) {
        await recordAttempt(s, group, t, week, start + t.section * 2400 + Math.floor(rand() * 600));
      }
    }
  }
  if (archived) programs.updateProgram(program.programId, { archived: true });
  return { program, students, group };
}

async function main() {
  const emptyLibrary = args.has('--empty-library');

  if (!emptyLibrary) {
    // The three shared sheets per subject. Easy is the most generous.
    const levels = { easy: 0.88, medium: 1.0, hard: 1.12 };
    for (const [level, exp] of Object.entries(levels)) {
      sheets.saveCurve(sheets.libraryKey(level), 'rw', { curve: curvePoints(RW_MAX, exp), originalFilename: `English ${level} scoring sheet.xlsx` });
      sheets.saveCurve(sheets.libraryKey(level), 'math', { curve: curvePoints(MATH_MAX, exp), originalFilename: `Math ${level} scoring sheet.xlsx` });
    }
  }
  const tag = (rw, math) => (emptyLibrary ? undefined : { rw, math });

  // Two finished summer programs, graded the old way: a custom sheet uploaded
  // to every exam.
  await seedProgram({
    name: 'VA Summer 2026',
    groupName: 'VA Summer SAT 2026',
    studentCount: 26,
    plan: [
      { name: 'Diagnostic Test', date: '2026-06-22', custom: { rwExp: 1.05, mathBound: 'upper' } },
      { name: 'Test 1', date: '2026-07-03', custom: { rwExp: 0.95, mathBound: 'lower' } },
      { name: 'Test 2', date: '2026-07-10', custom: { rwExp: 0.92, mathBound: 'lower' } },
      { name: 'Test 3', date: '2026-07-17', custom: { rwExp: 0.92, mathBound: 'lower' } },
      { name: 'Test 4', date: '2026-07-24', custom: { rwExp: 0.9, mathBound: 'upper' } },
      { name: 'Test 5', date: '2026-07-31', custom: { rwExp: 0.9, mathBound: 'upper' } },
      { name: 'Test 6', date: '2026-08-07', custom: { rwExp: 0.88, mathBound: 'upper' } },
      { name: 'Test 7', date: '2026-08-15', custom: { rwExp: 0.88, mathBound: 'upper' } },
    ],
  });
  await seedProgram({
    name: 'GA Summer 2026',
    groupName: 'GA Summer SAT 2026',
    studentCount: 9,
    plan: [
      { name: 'Diagnostics', date: '2026-05-25', custom: { rwExp: 1.05, mathBound: 'lower' } },
      { name: 'Test 1', date: '2026-06-05', custom: { rwExp: 0.95, mathBound: 'lower' } },
      { name: 'Test 2', date: '2026-06-12', custom: { rwExp: 0.95, mathBound: 'lower' } },
      { name: 'Test 3', date: '2026-06-19', custom: { rwExp: 0.95, mathBound: 'lower' } },
      { name: 'Test 4', date: '2026-06-26', custom: { rwExp: 0.95, mathBound: 'upper' } },
    ],
  });

  // The current Saturday program: graded with the shared Easy / Medium / Hard
  // sheets, with two exams still to be categorised and two still to be taken.
  await seedProgram({
    name: 'Saturday SAT - March 2027',
    groupName: 'Saturday SAT Fall 2026',
    studentCount: 18,
    plan: [
      { name: 'Diagnostic', date: '2026-10-03', difficulty: tag('medium', 'medium') },
      { name: 'Test 1', date: '2026-10-10', difficulty: tag('easy', 'medium') },
      { name: 'Test 2', date: '2026-10-17', difficulty: tag('hard', 'easy') },
      { name: 'Test 3', date: '2026-10-24', difficulty: tag('medium', 'hard') },
      { name: 'Test 4', date: '2026-10-31' },
      { name: 'Test 5', date: '2026-11-07' },
      { name: 'Test 6', date: '2026-11-14', upcoming: true },
      { name: 'Test 7', date: '2026-11-21', upcoming: true },
    ],
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'classmarker-cache.json.gz'),
    zlib.gzipSync(JSON.stringify({ cacheTime: Date.now(), ...apiCache }))
  );

  // db.service flushes on a timer; make sure everything is on disk before exit.
  await new Promise((resolve) => setTimeout(resolve, 5500));

  const total = await db.getTotalResults();
  console.log(`Seeded ${DATA_DIR}`);
  console.log(`  ${programs.listPrograms().length} programs, ${exams.listExams().length} exams, ${usedNames.size} students, ${total} test results`);
  console.log(`  shared scoring sheets: ${emptyLibrary ? 'none (use the Scoring Sheets tab to add them)' : 'Easy / Medium / Hard for English and Math'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
