// routes/program.routes.js
// CRUD for SAT programs — cohorts that group exams and own the student roster
// for every exam inside them. The exam ↔ program link lives on the exam
// (PUT /api/exams/:id { programId }); this router manages the program records
// and their rosters.
const express = require('express');
const programs = require('../services/program.service');
const exams = require('../services/exam.service');
const { getProgramSummary } = require('../services/program-summary.service');
const { generateProgramSummaryPDF } = require('../services/pdf.service');

const router = express.Router();
router.use(express.json());

// Filename-safe program name, e.g. "GA Summer SAT 2026" -> "GASummerSAT2026".
function summaryFilename(name) {
  const cleaned = String(name || 'Program')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim()
    .split(/\s+/)
    .join('');
  return `${cleaned || 'Program'}Summary`;
}

// GET /api/programs/:programId/summary.pdf — one-page cohort report (headline
// improvement stats, average-score progression, per-student improvement table).
router.get('/:programId/summary.pdf', async (req, res, next) => {
  try {
    const summary = await getProgramSummary(req.params.programId);
    if (!summary) return res.status(404).json({ success: false, error: 'Program not found' });
    const pdf = await generateProgramSummaryPDF(summary);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${summaryFilename(summary.programName)}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// GET /api/programs — every program with the count + ids of its member exams
// so the UI can render each program with its exams nested underneath.
router.get('/', (req, res, next) => {
  try {
    const examList = exams.listExams();
    const data = programs.listPrograms().map((program) => {
      const members = examList.filter((e) => e.programId === program.programId);
      return {
        ...program,
        examIds: members.map((e) => e.examId),
        examCount: members.length,
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/programs — body: { name, studentIds? }.
router.post('/', (req, res, next) => {
  try {
    const { name, studentIds } = req.body || {};
    res.json({ success: true, data: programs.createProgram({ name, studentIds }) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/programs/:programId — rename, set the enrolled roster, and/or
// archive/unarchive. Archiving hides the program's exams from student SAT
// reports while keeping all scoring data intact.
router.put('/:programId', (req, res, next) => {
  try {
    const { name, studentIds, archived } = req.body || {};
    res.json({ success: true, data: programs.updateProgram(req.params.programId, { name, studentIds, archived }) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/programs/:programId — only when empty. Exams must belong to a
// program, so a program with exams can't be deleted out from under them: move
// or delete its exams first.
router.delete('/:programId', (req, res, next) => {
  try {
    const members = exams.listExams().filter((e) => e.programId === req.params.programId);
    if (members.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Move or delete this program's ${members.length} exam${members.length === 1 ? '' : 's'} first.`,
      });
    }
    const removed = programs.deleteProgram(req.params.programId);
    if (!removed) return res.status(404).json({ success: false, error: 'Program not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
