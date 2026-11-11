// services/exam-curve.service.js
// Decides which scoring sheet grades an exam's Reading & Writing or Math
// section. This is the single place that rule lives - student reports,
// scoreboards, class averages and the admin UI all go through it.
//
//   1. The exam is categorised for that subject (exam.difficulty.rw = 'easy')
//      → the shared library sheet of that level. If nobody has uploaded that
//      sheet yet, the section is simply not scaled (raw scores still show);
//      it never silently falls back to some other sheet.
//   2. Not categorised → the exam's own custom sheet, if one was uploaded.
//      This is how every exam worked before the Easy / Medium / Hard library
//      existed, so older exams keep their exact scores until an admin
//      categorises them.
const { getCurve, libraryKey, summarizeCurve } = require('./scoring-sheet.service');
const { examCurveKey, SUBJECTS } = require('./exam.service');

// → { source: 'library' | 'custom' | null, level: 'easy' | ... | null, curve }
// `curve` is the stored sheet record, or null when there is nothing to grade
// with yet.
function resolveExamCurve(exam, section) {
  if (!exam) return { source: null, level: null, curve: null };
  const level = exam.difficulty?.[section] || null;
  if (level) {
    return { source: 'library', level, curve: getCurve(libraryKey(level), section) };
  }
  const curve = getCurve(examCurveKey(exam.examId), section);
  return { source: curve ? 'custom' : null, level: null, curve };
}

// The same decision for both subjects, shaped for the admin UI:
//   { rw: { source, level, ready, sheet }, math: { ... } }
// ready: a sheet exists, so this subject produces scaled scores.
// sheet: summary of the sheet in use (filename, bound, points…), or null.
function describeExamScoring(exam) {
  const out = {};
  for (const section of SUBJECTS) {
    const { source, level, curve } = resolveExamCurve(exam, section);
    out[section] = {
      source,
      level,
      ready: Boolean(curve),
      sheet: curve ? summarizeCurve(curve) : null,
    };
  }
  return out;
}

module.exports = { resolveExamCurve, describeExamScoring };
