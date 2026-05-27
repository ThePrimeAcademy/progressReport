// routes/scoring-sheets.routes.js
const express = require('express');
const {
  saveCurveFromBase64,
  getCurve,
  listCurves,
  deleteCurve,
} = require('../services/scoring-sheet.service');

const router = express.Router();

// Accept xlsx uploads up to ~4MB encoded as base64 (scoring sheets are tiny — the
// example is 6 KB — so the default 100kb express.json limit needs a small bump).
router.use(express.json({ limit: '4mb' }));

// GET /api/scoring-sheets — summary of all uploaded curves grouped by groupId
router.get('/', (req, res, next) => {
  try {
    res.json({ success: true, data: listCurves() });
  } catch (err) {
    next(err);
  }
});

// GET /api/scoring-sheets/:groupId/:section — full curve for a single (group, section)
router.get('/:groupId/:section', (req, res, next) => {
  try {
    const { groupId, section } = req.params;
    const record = getCurve(groupId, section);
    if (!record) return res.status(404).json({ success: false, error: 'No curve found for this group/section' });
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

// POST /api/scoring-sheets — upload a new curve.
// Body: { groupId, section: 'math' | 'rw', filename, fileBase64 }
router.post('/', async (req, res, next) => {
  try {
    const { groupId, section, filename, fileBase64 } = req.body || {};
    const record = await saveCurveFromBase64(groupId, section, fileBase64, filename);
    res.json({
      success: true,
      data: {
        groupId: record.groupId,
        section: record.section,
        uploadedAt: record.uploadedAt,
        originalFilename: record.originalFilename,
        points: record.curve.length,
        rawMin: record.curve[0]?.raw ?? null,
        rawMax: record.curve[record.curve.length - 1]?.raw ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scoring-sheets/:groupId/:section — remove a curve
router.delete('/:groupId/:section', (req, res, next) => {
  try {
    const { groupId, section } = req.params;
    const removed = deleteCurve(groupId, section);
    if (!removed) return res.status(404).json({ success: false, error: 'No curve found for this group/section' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
