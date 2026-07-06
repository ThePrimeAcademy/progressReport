// routes/students.routes.js
const express = require('express');
const { getAllStudents, getStudentById, clearCache, fetchCategoryMap, getCategoryName } = require('../services/classmarker.service');
const db = require('../services/db.service');

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

/**
 * GET /api/students/debug/categories?email=...&days=180
 * Diagnose category renames: for a student, list each unique (categoryId, storedName)
 * found in their webhook records and the current name resolved from ClassMarker.
 * Returns null `currentName` ⇒ the stored categoryId no longer exists in ClassMarker.
 */
router.get('/debug/categories', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const days = Math.min(Number(req.query.days || 180), 730);
    if (!email) return res.status(400).json({ error: 'email query param required' });

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    await fetchCategoryMap();
    const records = await db.findMatchingRecords({ id: '', email, name: '' }, startDate, endDate, null);

    const seen = new Map(); // key = `${categoryId}|${stored}` → entry
    let questionsTotal = 0;
    let questionsWithoutId = 0;

    for (const r of records) {
      for (const q of (r.questions || [])) {
        questionsTotal++;
        if (!q.categoryId) questionsWithoutId++;
        const key = `${q.categoryId || 'null'}|${q.categoryName || ''}`;
        if (!seen.has(key)) {
          seen.set(key, {
            categoryId: q.categoryId || null,
            storedName: q.categoryName || null,
            currentName: q.categoryId ? getCategoryName(q.categoryId) : null,
            count: 0,
          });
        }
        seen.get(key).count++;
      }
    }

    res.json({
      email,
      recordCount: records.length,
      questionsTotal,
      questionsWithoutId,
      categoryEntries: Array.from(seen.values()).sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/students/active
 * Returns the ids of every student, unconditionally. The startDate/endDate/
 * dayOfWeek query params are still accepted but intentionally ignored:
 * filtering to "has a finished test in the range" hid any student with no
 * results in the selected window (e.g. joined late or missed a week), making
 * them unselectable in the report picker. The picker must always list
 * everyone, so no date filtering happens here anymore.
 *
 * Note: this MUST be declared before /:id/contacts so it isn't matched as
 * a student id called "active".
 */
router.get('/active', async (req, res, next) => {
  try {
    const all = await getAllStudents();
    res.json({ success: true, data: all.map((s) => s.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/contacts
 * Returns every saved student_contacts row as a
 *   { studentId: { studentEmail, parentEmail } }
 * map. Used by the bulk-send picker to show who already has recipients on
 * file. Note: this MUST be declared before /:id/contacts so it isn't matched
 * as a student id called "contacts".
 */
router.get('/contacts', async (req, res, next) => {
  try {
    const all = await db.getAllContacts();
    res.json({ success: true, data: all });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/:id/contacts
 * Returns saved student + parent email contacts for a student.
 * If no contacts have been saved yet, pre-fills student_email from ClassMarker.
 */
router.get('/:id/contacts', async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const saved = await db.getContacts(studentId);

    if (saved) {
      return res.json({ success: true, data: saved });
    }

    let studentEmail = '';
    try {
      const student = await getStudentById(studentId);
      studentEmail = student?.email || '';
    } catch (_) {
      // sheets-only or missing student — leave blank
    }

    res.json({ success: true, data: { studentEmail, parentEmail: '' } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/students/:id/contacts
 * body: { studentEmail, parentEmail }
 * Upserts contacts for the student.
 */
router.put('/:id/contacts', express.json(), async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const { studentEmail = '', parentEmail = '' } = req.body || {};

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (studentEmail && !emailRx.test(studentEmail)) {
      return res.status(400).json({ error: 'studentEmail is not a valid email address' });
    }
    if (parentEmail && !emailRx.test(parentEmail)) {
      return res.status(400).json({ error: 'parentEmail is not a valid email address' });
    }

    const saved = await db.setContacts(studentId, { studentEmail, parentEmail });
    res.json({ success: true, data: saved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;