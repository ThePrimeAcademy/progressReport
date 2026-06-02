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
  if (/\b(en|english|rw|reading|verbal|writing)\b/i.test(gn)) return 1;
  for (const q of (questions || [])) {
    const sec = Number(q.sectionNumber);
    if (sec >= 1 && sec <= 4) return sec;
  }
  return null;
}

function gradeRecordsByGroup(records) {
  const buckets = {};
  for (const r of records) {
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
    const questions = r.questions || [];
    const section = deriveTestSection(testName, gname, questions);
    if (section == null) continue;

    // Prefer counting correct questions when per-question detail is present;
    // otherwise fall back to r.score (ClassMarker's points_scored = raw correct
    // for DSAT, where every question is worth 1 point).
    const correct = questions.length > 0
      ? questions.filter((q) => q.correct).length
      : Number(r.score) || 0;

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

async function getSatScoresForStudent(student) {
  const empty = {
    latestTestLabel: null,
    latestTestScore: null,
    latestEnglishScore: null,
    latestMathScore: null,
    superScore: null,
    source: null,
    allScores: [],
  };
  if (!student) return empty;

  // Pull every webhook record for this student (wide date window — the SQL
  // filter is timestamp-bounded but we want all-time for super-score purposes).
  const records = await db.findMatchingRecords(
    student,
    '1970-01-01',
    '2999-12-31',
    null
  );
  if (!records || records.length === 0) return empty;

  const buckets = gradeRecordsByGroup(records).map(applyCurves);
  if (buckets.length === 0) return empty;

  // Latest = most recently finished group with AT LEAST ONE section graded.
  // Math/RW cards populate independently as soon as their respective curve
  // is uploaded; the total score still requires both curves to be present.
  const anyGraded = buckets.filter((b) => b.mathScaled != null || b.rwScaled != null);
  const latest = anyGraded.sort((a, b) => b.latestFinished - a.latestFinished)[0] || null;

  // Super score = best RW ever + best Math ever (independent groups OK).
  const bestRw = buckets.reduce((m, b) => Math.max(m, b.rwScaled || 0), 0);
  const bestMath = buckets.reduce((m, b) => Math.max(m, b.mathScaled || 0), 0);
  const superScore = bestRw > 0 && bestMath > 0 ? bestRw + bestMath : null;

  // Full per-attempt history, newest first. Only include buckets that have at
  // least one section graded — otherwise an empty SAT group would render a
  // ghost card with all dashes.
  const allScores = anyGraded
    .slice()
    .sort((a, b) => b.latestFinished - a.latestFinished)
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

  return {
    latestTestLabel: latest?.groupName ?? null,
    latestTestScore: latest?.total ?? null,
    latestEnglishScore: latest?.rwScaled ?? null,
    latestMathScore: latest?.mathScaled ?? null,
    superScore,
    source: latest || superScore ? 'curve' : null,
    allScores,
  };
}

module.exports = {
  getSatScoresForStudent,
  isSatGroupName,
  deriveTestSection,
};
