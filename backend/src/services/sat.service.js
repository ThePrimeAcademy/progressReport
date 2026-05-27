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
const { getCurve, gradeUpper } = require('./scoring-sheet.service');

// Only groups whose name contains "SAT" (case-insensitive) participate in SAT
// score aggregation. Keeps non-SAT classes (e.g. ACT, subject tests, school
// quizzes) from leaking into the super-score math.
const SAT_GROUP_NAME = /sat/i;

function isSatGroupName(name) {
  return SAT_GROUP_NAME.test(String(name || ''));
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
    for (const q of (r.questions || [])) {
      if (!q.correct) continue;
      const sec = Number(q.sectionNumber);
      if (sec === 1 || sec === 2) bucket.rwRaw += 1;
      else if (sec === 3 || sec === 4) bucket.mathRaw += 1;
    }
  }
  return Object.values(buckets);
}

function applyCurves(bucket) {
  const mathCurve = getCurve(bucket.groupId, 'math');
  const rwCurve = getCurve(bucket.groupId, 'rw');
  const mathScaled = mathCurve ? gradeUpper(mathCurve, bucket.mathRaw) : null;
  const rwScaled = rwCurve ? gradeUpper(rwCurve, bucket.rwRaw) : null;
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

  // Latest = most recently finished group that has BOTH curves uploaded.
  const fullyGraded = buckets.filter((b) => b.total != null);
  const latest = fullyGraded.sort((a, b) => b.latestFinished - a.latestFinished)[0] || null;

  // Super score = best RW ever + best Math ever (independent groups OK).
  const bestRw = buckets.reduce((m, b) => Math.max(m, b.rwScaled || 0), 0);
  const bestMath = buckets.reduce((m, b) => Math.max(m, b.mathScaled || 0), 0);
  const superScore = bestRw > 0 && bestMath > 0 ? bestRw + bestMath : null;

  return {
    latestTestLabel: latest?.groupName ?? null,
    latestTestScore: latest?.total ?? null,
    latestEnglishScore: latest?.rwScaled ?? null,
    latestMathScore: latest?.mathScaled ?? null,
    superScore,
    source: latest || superScore ? 'curve' : null,
  };
}

module.exports = {
  getSatScoresForStudent,
  isSatGroupName,
};
