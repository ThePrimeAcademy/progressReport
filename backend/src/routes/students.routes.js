// routes/students.routes.js
const express = require('express');
const { getAllStudents, clearCache, fetchCategoryMap } = require('../services/classmarker.service');

const router = express.Router();

/**
 * GET /api/students
 * Returns the full list of students (id + name).
 */
router.get('/', async (req, res, next) => {
  try {
    const students = await getAllStudents();
    res.json({ success: true, data: students });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/students/refresh
 * Clears the cache and re-fetches fresh data from ClassMarker.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    clearCache();
    const [students, categoryMap] = await Promise.all([getAllStudents(), fetchCategoryMap()]);
    const categoriesLoaded = Object.keys(categoryMap || {}).length;
    res.json({
      success: true,
      message: `Cache refreshed — ${students.length} students, ${categoriesLoaded} categories loaded`,
      categoriesLoaded,
      data: students,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/sheets-debug?email=student@email.com
 * Check what Google Sheets returns for a student
 */
router.get('/sheets-debug', async (req, res, next) => {
  try {
    const { getSatScoresFromSheets, loadRecords } = require('../services/sheets.service');
    const records = await loadRecords();
    const email = req.query.email || '';
    const student = email ? { email, name: '' } : null;
    const scores = student ? await getSatScoresFromSheets(student) : null;
    res.json({
      sheetsConfigured: !!(process.env.GOOGLE_SHEETS_SPREADSHEET_ID && process.env.GOOGLE_SHEETS_API_KEY),
      totalRecords: records ? records.length : 0,
      sampleRecord: records?.[0] || null,
      scoresForEmail: scores,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

module.exports = router;