// routes/exams.routes.js
// CRUD for admin-defined SAT exams plus the test picker feed.
// Curves for an exam are uploaded through the existing /api/scoring-sheets
// routes using groupId = `exam:<examId>`.
const express = require('express');
const exams = require('../services/exam.service');
const { listCurves, deleteCurve } = require('../services/scoring-sheet.service');
const { getKnownTests } = require('../services/classmarker.service');
const db = require('../services/db.service');

const router = express.Router();
router.use(express.json());

// GET /api/exams — all exams with their curve upload status merged in.
router.get('/', (req, res, next) => {
  try {
    const curves = listCurves();
    const data = exams.listExams().map((exam) => ({
      ...exam,
      curveKey: exams.examCurveKey(exam.examId),
      sheets: curves[exams.examCurveKey(exam.examId)] || {},
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/exams/available-tests
// Distinct tests for the picker UI, merged from BOTH stores: the webhook
// store (fresh, per-question detail) and the cached ClassMarker results
// (covers tests whose attempts predate webhook capture). Marks tests already
// assigned to an exam so the UI can disable them.
router.get('/available-tests', async (req, res, next) => {
  try {
    const records = await db.getAllRecords();
    const assigned = exams.getTestSectionMap();
    const tests = new Map(); // testId → summary
    for (const r of records) {
      const testId = r.test?.testId ?? r.test_id;
      if (testId == null) continue;
      const id = String(testId);
      if (!tests.has(id)) {
        tests.set(id, {
          testId: id,
          testName: r.test?.testName ?? r.test_name ?? `Test #${id}`,
          groupId: r.group?.groupId ?? r.group_id ?? null,
          groupName: r.group?.groupName ?? r.group_name ?? null,
          attempts: 0,
          lastReceivedAt: '',
        });
      }
      const t = tests.get(id);
      t.attempts++;
      const received = r.receivedAt || r.received_at || '';
      if (received > t.lastReceivedAt) t.lastReceivedAt = received;
    }

    // Older tests with no webhook records only exist in the API cache.
    try {
      for (const t of await getKnownTests()) {
        if (tests.has(t.testId)) continue;
        tests.set(t.testId, {
          testId: t.testId,
          testName: t.testName,
          groupId: t.groupId,
          groupName: t.groupName,
          attempts: t.attempts,
          lastReceivedAt: t.lastFinished
            ? new Date(t.lastFinished * 1000).toISOString()
            : '',
        });
      }
    } catch (e) {
      // ClassMarker API unavailable — picker still works from webhook data.
      console.warn('[exams] Could not merge API-cache tests:', e.message);
    }

    const data = Array.from(tests.values())
      .map((t) => ({
        ...t,
        assignedTo: assigned.get(t.testId)?.examName || null,
        assignedToExamId: assigned.get(t.testId)?.examId || null,
      }))
      .sort((a, b) =>
        String(a.groupName || '').localeCompare(String(b.groupName || '')) ||
        String(a.testName).localeCompare(String(b.testName))
      );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/exams — body: { name, sections: { "1": { testId, testName } | null, ... } }
router.post('/', (req, res, next) => {
  try {
    const { name, sections } = req.body || {};
    res.json({ success: true, data: exams.createExam({ name, sections }) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/exams/:examId — rename and/or re-map sections.
router.put('/:examId', (req, res, next) => {
  try {
    const { name, sections } = req.body || {};
    res.json({ success: true, data: exams.updateExam(req.params.examId, { name, sections }) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/exams/:examId — removes the exam and its uploaded curves.
router.delete('/:examId', (req, res, next) => {
  try {
    const { examId } = req.params;
    const removed = exams.deleteExam(examId);
    if (!removed) return res.status(404).json({ success: false, error: 'Exam not found' });
    for (const section of ['rw', 'math']) {
      try { deleteCurve(exams.examCurveKey(examId), section); } catch (_) { /* no curve uploaded */ }
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
