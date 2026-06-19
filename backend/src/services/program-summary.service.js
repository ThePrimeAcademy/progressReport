// services/program-summary.service.js
// Cohort-level summary for one program: how the whole group performed and
// improved across the program's exams. Built entirely from per-exam scoreboards
// (enrolled, non-hidden takers only), so non-takers never skew the averages.
//
// Shape returned by getProgramSummary(programId):
//   {
//     programName, studentCount, examCount, examsCompleted,
//     progression: [{ name, date, avgTotal, avgRw, avgMath, n }],  // chronological, taken only
//     students:    [{ name, firstTotal, firstExam, latestTotal, latestExam, change }],
//     headline:    { avgImprovement, improvedCount, comparedCount, latestAvg,
//                    firstName, lastName, topName, topChange },
//   }

const { getProgram } = require('./program.service');
const { listExams } = require('./exam.service');
const { getExamScoreboard } = require('./sat.service');

function mean(values) {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

async function getProgramSummary(programId) {
  const program = getProgram(programId);
  if (!program) return null;

  // Practice exams never count toward the cohort report.
  const exams = listExams().filter((e) => e.programId === String(programId) && !e.isPractice);

  // One scoreboard per exam, then order chronologically by the scoreboard's
  // resolved date (admin-set or modal attempt date); undated exams sort last.
  const boards = [];
  for (const exam of exams) {
    const sb = await getExamScoreboard(exam.examId);
    if (sb) boards.push({ exam, sb });
  }
  boards.sort((a, b) => String(a.sb.date || '9999-99-99').localeCompare(String(b.sb.date || '9999-99-99')));

  const progression = [];
  const perStudent = new Map(); // studentId -> { name, pts: [{ exam, total }] }
  for (const { exam, sb } of boards) {
    const totals = sb.rows.filter((r) => r.total != null);
    if (totals.length === 0) continue; // exam nobody has completed yet
    progression.push({
      name: exam.name,
      date: sb.date || null,
      avgTotal: mean(totals.map((r) => r.total)),
      avgRw: mean(sb.rows.filter((r) => r.rwScaled != null).map((r) => r.rwScaled)),
      avgMath: mean(sb.rows.filter((r) => r.mathScaled != null).map((r) => r.mathScaled)),
      n: totals.length,
    });
    for (const r of totals) {
      if (!perStudent.has(r.studentId)) perStudent.set(r.studentId, { name: r.name, pts: [] });
      perStudent.get(r.studentId).pts.push({ exam: exam.name, total: r.total });
    }
  }

  const students = [];
  const improvements = []; // { name, change } for students with >= 2 completed exams
  for (const { name, pts } of perStudent.values()) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const change = pts.length >= 2 ? last.total - first.total : null;
    if (change != null) improvements.push({ name, change });
    students.push({
      name,
      firstTotal: first.total,
      firstExam: first.exam,
      latestTotal: last.total,
      latestExam: last.exam,
      change,
    });
  }
  // Leaderboard order — current standing first, change column tells the growth.
  students.sort((a, b) => (b.latestTotal ?? 0) - (a.latestTotal ?? 0));

  const top = improvements.slice().sort((a, b) => b.change - a.change)[0] || null;
  const last = progression[progression.length - 1] || null;

  return {
    programName: program.name,
    studentCount: (program.studentIds || []).length,
    examCount: exams.length,
    examsCompleted: progression.length,
    progression,
    students,
    headline: {
      avgImprovement: improvements.length
        ? Math.round(improvements.reduce((a, b) => a + b.change, 0) / improvements.length)
        : null,
      improvedCount: improvements.filter((x) => x.change >= 0).length,
      comparedCount: improvements.length,
      latestAvg: last ? last.avgTotal : null,
      firstName: progression[0]?.name || null,
      lastName: last?.name || null,
      topName: top?.name || null,
      topChange: top?.change ?? null,
    },
  };
}

module.exports = { getProgramSummary };
