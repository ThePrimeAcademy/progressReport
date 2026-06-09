// routes/program.routes.js
// CRUD for SAT programs — cohorts that group exams and own the student roster
// for every exam inside them. The exam ↔ program link lives on the exam
// (PUT /api/exams/:id { programId }); this router manages the program records
// and their rosters.
const express = require('express');
const programs = require('../services/program.service');
const exams = require('../services/exam.service');

const router = express.Router();
router.use(express.json());

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

// PUT /api/programs/:programId — rename and/or set the enrolled roster.
router.put('/:programId', (req, res, next) => {
  try {
    const { name, studentIds } = req.body || {};
    res.json({ success: true, data: programs.updateProgram(req.params.programId, { name, studentIds }) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/programs/:programId — removes the program and detaches its exams
// (they survive as ungrouped, not orphaned). Returns how many were detached.
router.delete('/:programId', (req, res, next) => {
  try {
    const removed = programs.deleteProgram(req.params.programId);
    if (!removed) return res.status(404).json({ success: false, error: 'Program not found' });
    const detached = exams.clearProgram(req.params.programId);
    res.json({ success: true, detached });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
