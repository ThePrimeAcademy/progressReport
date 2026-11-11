// routes/scoring-sheets.routes.js
// Scoring sheets convert a raw score into a scaled section score. See
// services/scoring-sheet.service.js for the two kinds (the shared Easy /
// Medium / Hard library, and custom per-exam sheets) and how they are keyed.
const express = require('express');
const {
  parseSheet,
  saveCurve,
  saveCurveFromBase64,
  setBound,
  getCurve,
  listCurves,
  listLibrary,
  summarizeCurve,
  deleteCurve,
  copyCurve,
  libraryKey,
  LEVELS,
} = require('../services/scoring-sheet.service');
const { listExams } = require('../services/exam.service');
const { getProgram } = require('../services/program.service');

const router = express.Router();

// Uploads arrive base64-encoded in JSON. Scoring sheets are tiny (a few KB),
// so 4MB is generous headroom over express.json's 100kb default.
router.use(express.json({ limit: '4mb' }));

// GET /api/scoring-sheets - summary of every stored sheet, grouped by key.
router.get('/', (req, res, next) => {
  try {
    res.json({ success: true, data: listCurves() });
  } catch (err) {
    next(err);
  }
});

// GET /api/scoring-sheets/library - the shared Easy / Medium / Hard sheets for
// each subject, with the exams currently graded by each one.
//   { levels, keys: { easy: 'library:easy', ... },
//     sheets: { rw: { easy: summary|null, ... }, math: { ... } },
//     usage:  { rw: { easy: [{ examId, name, programName }], ... }, math: { ... } } }
router.get('/library', (req, res, next) => {
  try {
    const sheets = listLibrary();
    const usage = {};
    for (const section of Object.keys(sheets)) {
      usage[section] = Object.fromEntries(LEVELS.map((level) => [level, []]));
    }
    for (const exam of listExams()) {
      for (const section of Object.keys(usage)) {
        const level = exam.difficulty?.[section];
        if (!level || !usage[section][level]) continue;
        usage[section][level].push({
          examId: exam.examId,
          name: exam.name,
          programName: getProgram(exam.programId)?.name || null,
        });
      }
    }
    res.json({
      success: true,
      data: {
        levels: LEVELS,
        keys: Object.fromEntries(LEVELS.map((level) => [level, libraryKey(level)])),
        sheets,
        usage,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/scoring-sheets/parse - read an uploaded file or pasted cells and
// return the score table(s) found, WITHOUT saving anything. The UI shows the
// result as a preview and lets the admin pick the worksheet and score column.
// Body: { fileBase64 } | { text }
router.post('/parse', async (req, res, next) => {
  try {
    const { fileBase64, text } = req.body || {};
    res.json({ success: true, data: await parseSheet({ fileBase64, text }) });
  } catch (err) {
    next(err);
  }
});

// GET /api/scoring-sheets/:groupId/:section - one sheet with all its points.
router.get('/:groupId/:section', (req, res, next) => {
  try {
    const { groupId, section } = req.params;
    const record = getCurve(groupId, section);
    if (!record) return res.status(404).json({ success: false, error: 'No scoring sheet found for this group/section' });
    res.json({ success: true, data: { ...record, summary: summarizeCurve(record) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/scoring-sheets - save a sheet.
// Body: { groupId, section: 'math' | 'rw', filename?, bound?, columnLabel? } plus either
//   curve: [{ raw, lower, upper }]  - points chosen in the upload preview, or
//   fileBase64                      - a file to read and save in one step
//                                     (must have a single unambiguous table).
router.post('/', async (req, res, next) => {
  try {
    const { groupId, section, filename, fileBase64, curve, bound, columnLabel } = req.body || {};
    const record = Array.isArray(curve)
      ? saveCurve(groupId, section, { curve, bound, originalFilename: filename, columnLabel })
      : await saveCurveFromBase64(groupId, section, fileBase64, filename, bound);
    res.json({ success: true, data: summarizeCurve(record) });
  } catch (err) {
    next(err);
  }
});

// POST /api/scoring-sheets/copy - reuse a sheet already stored under another
// key. Body: { fromGroupId, toGroupId, section: 'math' | 'rw' }
router.post('/copy', (req, res, next) => {
  try {
    const { fromGroupId, toGroupId, section } = req.body || {};
    res.json({ success: true, data: summarizeCurve(copyCurve(fromGroupId, toGroupId, section)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/scoring-sheets/:groupId/:section - choose which end of a score
// range is used. Body: { bound: 'upper' | 'lower' }
router.patch('/:groupId/:section', (req, res, next) => {
  try {
    const { groupId, section } = req.params;
    const { bound } = req.body || {};
    res.json({ success: true, data: summarizeCurve(setBound(groupId, section, bound)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scoring-sheets/:groupId/:section - remove a sheet.
router.delete('/:groupId/:section', (req, res, next) => {
  try {
    const { groupId, section } = req.params;
    const removed = deleteCurve(groupId, section);
    if (!removed) return res.status(404).json({ success: false, error: 'No scoring sheet found for this group/section' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
