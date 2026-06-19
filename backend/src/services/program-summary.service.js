// services/program-summary.service.js
// Group-level summary for one program: how the whole group performed and
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
  // studentId -> { name, totals:[{exam,total}], bestRw, bestMath } — totals feed
  // the "initial" score and ordering; bestRw/bestMath build the superscore.
  const perStudent = new Map();
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
    for (const r of sb.rows) {
      if (!perStudent.has(r.studentId)) perStudent.set(r.studentId, { name: r.name, totals: [], bestRw: null, bestMath: null });
      const ps = perStudent.get(r.studentId);
      if (r.rwScaled != null && (ps.bestRw == null || r.rwScaled > ps.bestRw)) ps.bestRw = r.rwScaled;
      if (r.mathScaled != null && (ps.bestMath == null || r.mathScaled > ps.bestMath)) ps.bestMath = r.mathScaled;
      if (r.total != null) ps.totals.push({ exam: exam.name, total: r.total });
    }
  }

  // Improvement = each student's superscore (best RW ever + best Math ever)
  // minus their initial (first completed exam). Only students with >= 2
  // completed exams are compared, so a lone diagnostic isn't counted.
  const students = [];
  const improvements = [];
  for (const { name, totals, bestRw, bestMath } of perStudent.values()) {
    const first = totals[0] || null;
    const superscore = bestRw != null && bestMath != null ? bestRw + bestMath : null;
    const change = totals.length >= 2 && superscore != null && first != null ? superscore - first.total : null;
    if (change != null) improvements.push(change);
    students.push({
      name,
      firstTotal: first?.total ?? null,
      firstExam: first?.exam ?? null,
      superscore,
      latestTotal: totals[totals.length - 1]?.total ?? null,
      change,
    });
  }
  students.sort((a, b) => (b.superscore ?? 0) - (a.superscore ?? 0));

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
        ? Math.round(improvements.reduce((a, b) => a + b, 0) / improvements.length)
        : null,
      improvedCount: improvements.filter((x) => x > 0).length,
      comparedCount: improvements.length,
      latestAvg: last ? last.avgTotal : null,
      firstName: progression[0]?.name || null,
      lastName: last?.name || null,
      firstDate: progression[0]?.date || null,
      lastDate: last?.date || null,
    },
  };
}

module.exports = { getProgramSummary };
