// services/sat.service.js
// Computes SAT section + total + super scores from webhook question data
// and per-group scoring curves uploaded via /api/scoring-sheets.
//
// Section convention (matches webhook.service.js):
//   Sections 1 & 2 → Reading & Writing (RW)
//   Sections 3 & 4 → Math
//
// Display value is the UPPER bound of each curve at the student's raw correct count.
// Total = RW_upper + Math_upper for the most recently attempted group.
// Super = best RW ever + best Math ever, across every group the student took.

const db = require('./db.service');
const { getCurve, gradeScaled } = require('./scoring-sheet.service');
const { getTestSectionMap, examCurveKey, getExam, listExams } = require('./exam.service');
const { getStudentResultsGrouped, getResultsForTests } = require('./classmarker.service');

// Only groups whose name contains "SAT" (case-insensitive) participate in SAT
// score aggregation. Keeps non-SAT classes (e.g. ACT, subject tests, school
// quizzes) from leaking into the super-score math.
const SAT_GROUP_NAME = /sat/i;

function isSatGroupName(name) {
  return SAT_GROUP_NAME.test(String(name || ''));
}

// Determine whether a single test result belongs to RW (sections 1-2) or
// Math (sections 3-4). Source-of-truth order:
//   1. Test name starts with "Section N:" → use N.
//   2. Group name contains "math" (whole word) → Math.
//   3. Group name contains an RW keyword (en/english/rw/reading/verbal/writing) → RW.
//   4. Per-question sectionNumber, if populated.
// Returns 1|2|3|4 or null if the section can't be determined.
function deriveTestSection(testName, groupName, questions) {
  const m = String(testName || '').match(/^\s*section\s*(\d+)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 4) return n;
  }
  const gn = String(groupName || '');
  if (/\bmath\b/i.test(gn)) return 3;
  if (/\b(en|english|rw|reading|verbal|writing|vocab)\b/i.test(gn)) return 1;
  for (const q of (questions || [])) {
    const sec = Number(q.sectionNumber);
    if (sec >= 1 && sec <= 4) return sec;
  }
  return null;
}

// Raw correct count for a record. Prefer counting correct questions when
// per-question detail is present; otherwise fall back to r.score
// (ClassMarker's points_scored = raw correct for DSAT, where every question
// is worth 1 point).
function rawCorrect(record) {
  const questions = record.questions || [];
  return questions.length > 0
    ? questions.filter((q) => q.correct).length
    : Number(record.score) || 0;
}

function gradeRecordsByGroup(records) {
  const examMap = getTestSectionMap();
  const buckets = {};

  // Tests assigned to an admin-defined exam bucket per EXAM, not per group —
  // groups now hold more than one exam so group-level summing would mix raw
  // scores from different exams. Retakes keep only the latest attempt.
  const latestExamAttempts = new Map(); // testId → latest record

  for (const r of records) {
    const testId = String(r.test?.testId ?? r.test_id ?? '');
    if (testId && examMap.has(testId)) {
      // Per-exam hidden students: their attempts on the exam's tests are
      // ignored entirely (not even legacy-bucketed — the exam owns the test).
      const uid = String(r.student?.userId ?? r.user_id ?? '');
      if (examMap.get(testId).hidden?.has(uid)) continue;
      const prev = latestExamAttempts.get(testId);
      if (!prev || (r.timeFinished || 0) > (prev.timeFinished || 0)) {
        latestExamAttempts.set(testId, r);
      }
      continue; // never double count into the legacy group bucket
    }

    // Legacy path: one group = one exam, tests named "Section N: …".
    const gid = r.group?.groupId ?? r.group_id ?? null;
    const gname = r.group?.groupName ?? r.group_name ?? null;
    if (!gid || !isSatGroupName(gname)) continue;
    if (!buckets[gid]) {
      buckets[gid] = {
        groupId: String(gid),
        groupName: gname,
        rwRaw: 0,
        mathRaw: 0,
        latestFinished: 0,
      };
    }
    const bucket = buckets[gid];
    if (r.timeFinished && r.timeFinished > bucket.latestFinished) {
      bucket.latestFinished = r.timeFinished;
    }

    const testName = r.test?.testName ?? r.testName ?? r.test_name ?? null;
    const section = deriveTestSection(testName, gname, r.questions || []);
    if (section == null) continue;

    const correct = rawCorrect(r);
    if (section === 1 || section === 2) bucket.rwRaw += correct;
    else if (section === 3 || section === 4) bucket.mathRaw += correct;
  }

  // Fold the deduped exam attempts into per-exam buckets. The bucket keeps the
  // groupId/groupName field names (key = exam:<id>, label = exam name) so
  // curve lookup and downstream consumers work unchanged.
  for (const [testId, r] of latestExamAttempts) {
    const { examId, examName, section } = examMap.get(testId);
    const key = examCurveKey(examId);
    if (!buckets[key]) {
      buckets[key] = {
        groupId: key,
        groupName: examName,
        rwRaw: 0,
        mathRaw: 0,
        latestFinished: 0,
      };
    }
    const bucket = buckets[key];
    if (r.timeFinished && r.timeFinished > bucket.latestFinished) {
      bucket.latestFinished = r.timeFinished;
    }
    const correct = rawCorrect(r);
    if (section === 1 || section === 2) bucket.rwRaw += correct;
    else if (section === 3 || section === 4) bucket.mathRaw += correct;
  }

  return Object.values(buckets);
}

function applyCurves(bucket) {
  const mathCurve = getCurve(bucket.groupId, 'math');
  const rwCurve = getCurve(bucket.groupId, 'rw');
  const mathScaled = mathCurve ? gradeScaled(mathCurve, bucket.mathRaw) : null;
  const rwScaled = rwCurve ? gradeScaled(rwCurve, bucket.rwRaw) : null;
  const total = mathScaled != null && rwScaled != null ? mathScaled + rwScaled : null;
  return { ...bucket, mathScaled, rwScaled, total };
}

// Empty history cards for exams the student is rostered on but has no
// graded score for yet — upcoming/placeholder exams appear on the report
// with their scheduled date and dashes, so families see what's coming.
function rosterPlaceholders(student, gradedKeys) {
  const sid = String(student?.id || '');
  if (!sid || sid.startsWith('sheets:')) return [];
  const placeholders = [];
  for (const exam of listExams()) {
    const key = examCurveKey(exam.examId);
    if (gradedKeys.has(key)) continue;
    if (!(exam.studentIds || []).includes(sid)) continue;
    if ((exam.hiddenStudentIds || []).includes(sid)) continue;
    placeholders.push({
      groupId: key,
      groupName: exam.name,
      total: null,
      english: null,
      math: null,
      date: exam.date || null,
      timeFinished: exam.date ? Math.floor(new Date(exam.date).getTime() / 1000) : null,
    });
  }
  return placeholders;
}

async function getSatScoresForStudent(student) {
  const empty = {
    latestTestLabel: null,
    latestTestScore: null,
    latestEnglishScore: null,
    latestMathScore: null,
    superScore: null,
    source: null,
    allScores: rosterPlaceholders(student, new Set()),
  };
  if (!student) return { ...empty, allScores: [] };

  // Pull every webhook record for this student (wide date window — the SQL
  // filter is timestamp-bounded but we want all-time for super-score purposes).
  const records = await db.findMatchingRecords(
    student,
    '1970-01-01',
    '2999-12-31',
    null
  ) || [];

  // Attempts that never produced a webhook (group link without webhooks
  // enabled, or taken before webhooks were configured) still exist in the
  // ClassMarker API cache. For exam-mapped tests the raw score is enough to
  // grade, so fill the gaps with pseudo-records (points_scored = raw correct
  // for DSAT, where every question is worth 1 point). Tests with ANY webhook
  // record stay webhook-only to avoid double counting.
  const examMap = getTestSectionMap();
  if (examMap.size > 0 && student.id && !String(student.id).startsWith('sheets:')) {
    const covered = new Set();
    for (const r of records) {
      const tid = String(r.test?.testId ?? r.test_id ?? '');
      if (tid && examMap.has(tid)) covered.add(tid);
    }
    try {
      const apiGroups = await getStudentResultsGrouped(String(student.id), '1970-01-01', '2999-12-31', null);
      for (const g of apiGroups) {
        for (const r of g.results) {
          const tid = String(r.testId ?? '');
          if (!tid || !examMap.has(tid) || covered.has(tid)) continue;
          if (examMap.get(tid).hidden?.has(String(student.id))) continue;
          records.push({
            test: { testId: tid, testName: r.testName },
            group: { groupId: g.groupId, groupName: g.groupName },
            timeFinished: r.timeFinished,
            score: r.score,
            questions: [],
          });
        }
      }
    } catch (e) {
      console.warn('[sat] API-cache fallback unavailable:', e.message);
    }
  }

  if (records.length === 0) return empty;

  const buckets = gradeRecordsByGroup(records).map(applyCurves);
  if (buckets.length === 0) return empty;

  // Latest = most recently finished group with AT LEAST ONE section graded.
  // Each card falls back independently to the most recent exam that HAS that
  // score — a missing math section shows the previous math score instead of
  // an em dash.
  const anyGraded = buckets.filter((b) => b.mathScaled != null || b.rwScaled != null);
  anyGraded.sort((a, b) => b.latestFinished - a.latestFinished);
  const latest = anyGraded[0] || null;
  const latestWith = (key) => anyGraded.find((b) => b[key] != null) || null;
  const latestRw = latestWith('rwScaled');
  const latestMath = latestWith('mathScaled');
  const latestTotal = latestWith('total');

  // Super score = best RW ever + best Math ever (independent groups OK).
  const bestRw = buckets.reduce((m, b) => Math.max(m, b.rwScaled || 0), 0);
  const bestMath = buckets.reduce((m, b) => Math.max(m, b.mathScaled || 0), 0);
  const superScore = bestRw > 0 && bestMath > 0 ? bestRw + bestMath : null;

  // Full per-attempt history, OLDEST FIRST (reads left → right in the UI and
  // PDF). Attempt-derived cards need at least one graded section — otherwise
  // an empty SAT group would render a ghost card — but rostered exams the
  // student hasn't been scored on yet ARE shown as deliberate placeholders.
  const allScores = anyGraded
    .slice()
    .map((b) => ({
      groupId: b.groupId,
      groupName: b.groupName,
      total: b.total,
      english: b.rwScaled,
      math: b.mathScaled,
      date: b.latestFinished
        ? new Date(b.latestFinished * 1000).toISOString().split('T')[0]
        : null,
      timeFinished: b.latestFinished || null,
    }));
  allScores.push(...rosterPlaceholders(student, new Set(allScores.map((s) => s.groupId))));
  // Dated placeholders sort into position; undated ones go last (upcoming).
  allScores.sort((a, b) => (a.timeFinished ?? Infinity) - (b.timeFinished ?? Infinity));

  return {
    latestTestLabel: latest?.groupName ?? null,
    latestTestScore: latestTotal?.total ?? null,
    latestEnglishScore: latestRw?.rwScaled ?? null,
    latestMathScore: latestMath?.mathScaled ?? null,
    superScore,
    source: latest || superScore ? 'curve' : null,
    allScores,
  };
}

// Scoreboard for one exam: every (non-hidden) student who took any of its
// tests, with raw + scaled section scores and total, ranked by total.
// Webhook attempts win per (student, test); attempts that never fired a
// webhook fall back to the cached API results.
async function getExamScoreboard(examId) {
  const exam = getExam(examId);
  if (!exam) return null;
  const hidden = new Set(exam.hiddenStudentIds || []);
  const sectionOfTest = new Map(); // testId → 1|2|3|4
  for (const key of ['1', '2', '3', '4']) {
    const s = exam.sections?.[key];
    if (s?.testId != null) sectionOfTest.set(String(s.testId), Number(key));
  }

  // uid → { name, tests: Map(testId → { correct, timeFinished, webhook }) }
  const perStudent = new Map();
  const entryFor = (uid, name) => {
    if (!perStudent.has(uid)) perStudent.set(uid, { name, tests: new Map() });
    return perStudent.get(uid);
  };

  if (sectionOfTest.size > 0) {
    for (const r of await db.getAllRecords()) {
      const tid = String(r.test?.testId ?? r.test_id ?? '');
      if (!sectionOfTest.has(tid)) continue;
      const uid = String(r.student?.userId ?? r.user_id ?? '');
      if (!uid || hidden.has(uid)) continue;
      const entry = entryFor(uid, r.student?.name || r.name || `User ${uid}`);
      const prev = entry.tests.get(tid);
      if (!prev || (r.timeFinished || 0) > prev.timeFinished) {
        entry.tests.set(tid, { correct: rawCorrect(r), timeFinished: r.timeFinished || 0, webhook: true });
      }
    }
    try {
      for (const a of await getResultsForTests(new Set(sectionOfTest.keys()))) {
        if (hidden.has(a.userId)) continue;
        const entry = entryFor(a.userId, a.name);
        const prev = entry.tests.get(a.testId);
        // Webhook data always wins; among API attempts keep the latest.
        if (prev?.webhook) continue;
        if (!prev || a.timeFinished > prev.timeFinished) {
          entry.tests.set(a.testId, { correct: a.correct, timeFinished: a.timeFinished, webhook: false });
        }
      }
    } catch (e) {
      console.warn('[sat] Scoreboard API fallback unavailable:', e.message);
    }
  }

  const rwCurve = getCurve(examCurveKey(examId), 'rw');
  const mathCurve = getCurve(examCurveKey(examId), 'math');

  const rows = Array.from(perStudent.entries()).map(([uid, entry]) => {
    let rwRaw = null;
    let mathRaw = null;
    let latestFinished = 0;
    for (const [tid, attempt] of entry.tests) {
      const section = sectionOfTest.get(tid);
      if (section <= 2) rwRaw = (rwRaw || 0) + attempt.correct;
      else mathRaw = (mathRaw || 0) + attempt.correct;
      if (attempt.timeFinished > latestFinished) latestFinished = attempt.timeFinished;
    }
    const rwScaled = rwRaw != null && rwCurve ? gradeScaled(rwCurve, rwRaw) : null;
    const mathScaled = mathRaw != null && mathCurve ? gradeScaled(mathCurve, mathRaw) : null;
    const total = rwScaled != null && mathScaled != null ? rwScaled + mathScaled : null;
    return {
      studentId: uid,
      name: entry.name,
      rwRaw,
      mathRaw,
      rwScaled,
      mathScaled,
      total,
      testsCompleted: entry.tests.size,
      date: latestFinished ? new Date(latestFinished * 1000).toISOString().split('T')[0] : null,
    };
  })
    // A single completed section isn't a comparable result — keep the student
    // off the board until they've done at least two (unless the exam itself
    // only has one test assigned).
    .filter((row) => sectionOfTest.size <= 1 || row.testsCompleted >= 2);

  // Rank: full totals first (desc), then partials by whatever is scaled,
  // then raw-only rows by combined raw.
  rows.sort((a, b) =>
    (b.total ?? -1) - (a.total ?? -1) ||
    ((b.rwScaled ?? 0) + (b.mathScaled ?? 0)) - ((a.rwScaled ?? 0) + (a.mathScaled ?? 0)) ||
    ((b.rwRaw ?? 0) + (b.mathRaw ?? 0)) - ((a.rwRaw ?? 0) + (a.mathRaw ?? 0))
  );

  return {
    examId: exam.examId,
    name: exam.name,
    date: exam.date || null,
    hasRwCurve: Boolean(rwCurve),
    hasMathCurve: Boolean(mathCurve),
    rows,
  };
}

module.exports = {
  getSatScoresForStudent,
  getExamScoreboard,
  isSatGroupName,
  deriveTestSection,
};
