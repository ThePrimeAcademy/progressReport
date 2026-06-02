// routes/report.routes.js
const express = require('express');
const {
  getStudentById,
  getStudentResultsGrouped,
  getLatestTestResult,
  computeCategoryPerformance,
} = require('../services/classmarker.service');
const { getSatScoresForStudent } = require('../services/sat.service');
const {
  getLatestWebhookTestResult,
  getWebhookCategoryPerformance,
  getWebhookCategoryPerformanceSplit,
} = require('../services/webhook.service');
const { computeStats } = require('../services/stats.service');
const { generateReportPDF } = require('../services/pdf.service');
const { sendReportEmail, isConfigured: isEmailConfigured, verifyConnection: verifyEmailConnection } = require('../services/email.service');
const db = require('../services/db.service');

const router = express.Router();

function validate(req, res, next) {
  const { studentId, startDate, endDate } = req.body;
  if (!studentId || typeof studentId !== 'string')
    return res.status(400).json({ error: 'studentId is required' });
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate and endDate are required' });
  if (new Date(startDate) > new Date(endDate))
    return res.status(400).json({ error: 'startDate must be before endDate' });
  next();
}

// Resolve student — handles both ClassMarker IDs and sheets: prefixed IDs
async function resolveStudent(studentId) {
  if (studentId.startsWith('sheets:')) {
    // Sheets-only student — build from sheets records
    const { loadRecords } = require('../services/sheets.service');
    const records = await loadRecords();
    const key = studentId.replace('sheets:', '');
    const record = records?.find((r) =>
      r.normalized_email === key || r.normalized_name === key
    );
    if (!record) throw Object.assign(new Error(`Student "${studentId}" not found`), { status: 404 });
    return { id: studentId, name: record.name, email: record.email };
  }
  return getStudentById(studentId);
}

// POST /api/report/preview
router.post('/preview', validate, async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, dayOfWeek } = req.body;

    const student = await resolveStudent(studentId);
    const [groups, apiLatestTest, satScores, webhookLatestTest, webhookCategoryPerf, webhookCategorySplit] = await Promise.all([
      studentId.startsWith("sheets:") ? Promise.resolve([]) : getStudentResultsGrouped(studentId, startDate, endDate, dayOfWeek),
      studentId.startsWith("sheets:") ? Promise.resolve(null) : getLatestTestResult(studentId, startDate, endDate, dayOfWeek),
      getSatScoresForStudent(student),
      getLatestWebhookTestResult(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformanceSplit(student, startDate, endDate, dayOfWeek),
    ]);

    const allResults = groups.flatMap((g) => g.results);
    const stats = computeStats(allResults);
    const categoryPerf = webhookCategoryPerf.length
      ? webhookCategoryPerf
      : computeCategoryPerformance(groups);
    const latestTest = webhookLatestTest || apiLatestTest;

    res.json({
      success: true,
      data: { student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, categoryPerfSplit: webhookCategorySplit },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/report — PDF
router.post('/', validate, async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, dayOfWeek } = req.body;

    const student = await resolveStudent(studentId);
    const [groups, apiLatestTest, satScores, webhookLatestTest, webhookCategoryPerf, webhookCategorySplit] = await Promise.all([
      studentId.startsWith("sheets:") ? Promise.resolve([]) : getStudentResultsGrouped(studentId, startDate, endDate, dayOfWeek),
      studentId.startsWith("sheets:") ? Promise.resolve(null) : getLatestTestResult(studentId, startDate, endDate, dayOfWeek),
      getSatScoresForStudent(student),
      getLatestWebhookTestResult(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformanceSplit(student, startDate, endDate, dayOfWeek),
    ]);

    const allResults = groups.flatMap((g) => g.results);
    const stats = computeStats(allResults);
    const categoryPerf = webhookCategoryPerf.length
      ? webhookCategoryPerf
      : computeCategoryPerformance(groups);
    const latestTest = webhookLatestTest || apiLatestTest;

    const pdfBuffer = await generateReportPDF(student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, webhookCategorySplit);

    const filename = `progress-report-${student.name.replace(/\s+/g, '-').toLowerCase()}-${startDate}-to-${endDate}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /api/report/email/status — lets the UI know if email sending is wired up
router.get('/email/status', (req, res) => {
  res.json({ success: true, data: { configured: isEmailConfigured() } });
});

// GET /api/report/email/verify — tests SMTP auth without sending anything.
// Useful for diagnosing the "Send Report" flow without waiting for a full
// PDF render. Returns the upstream nodemailer error verbatim when it fails.
router.get('/email/verify', async (req, res) => {
  try {
    const result = await verifyEmailConnection();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[email verify]', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/report/email
// body: { studentId, startDate, endDate, dayOfWeek?, studentEmail?, parentEmail? }
// Builds the PDF on the fly and emails it to whichever of student/parent emails
// are provided. Falls back to saved contacts if the request omits them.
router.post('/email', validate, async (req, res, next) => {
  const t0 = Date.now();
  try {
    const { studentId, startDate, endDate, dayOfWeek, subject } = req.body;
    let { studentEmail, parentEmail } = req.body;

    if (studentEmail === undefined && parentEmail === undefined) {
      const saved = await db.getContacts(studentId);
      studentEmail = saved?.studentEmail || '';
      parentEmail = saved?.parentEmail || '';
    }

    const recipients = [studentEmail, parentEmail]
      .map((e) => String(e || '').trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Provide at least one recipient (student or parent email).' });
    }

    console.log(`[email] start studentId=${studentId} recipients=${recipients.length} range=${startDate}..${endDate}`);
    const student = await resolveStudent(studentId);
    const [groups, apiLatestTest, satScores, webhookLatestTest, webhookCategoryPerf, webhookCategorySplit] = await Promise.all([
      studentId.startsWith("sheets:") ? Promise.resolve([]) : getStudentResultsGrouped(studentId, startDate, endDate, dayOfWeek),
      studentId.startsWith("sheets:") ? Promise.resolve(null) : getLatestTestResult(studentId, startDate, endDate, dayOfWeek),
      getSatScoresForStudent(student),
      getLatestWebhookTestResult(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek),
      getWebhookCategoryPerformanceSplit(student, startDate, endDate, dayOfWeek),
    ]);

    const allResults = groups.flatMap((g) => g.results);
    const stats = computeStats(allResults);
    const categoryPerf = webhookCategoryPerf.length
      ? webhookCategoryPerf
      : computeCategoryPerformance(groups);
    const latestTest = webhookLatestTest || apiLatestTest;

    console.log(`[email] data gathered in ${Date.now() - t0}ms, rendering PDF…`);
    const pdfBuffer = await generateReportPDF(student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, webhookCategorySplit);
    const filename = `progress-report-${student.name.replace(/\s+/g, '-').toLowerCase()}-${startDate}-to-${endDate}.pdf`;
    console.log(`[email] PDF rendered (${pdfBuffer.length} bytes) at ${Date.now() - t0}ms, sending SMTP…`);

    const result = await sendReportEmail({
      studentName: student.name,
      recipients,
      pdfBuffer,
      filename,
      startDate,
      endDate,
      subject,
    });
    console.log(`[email] sent in total ${Date.now() - t0}ms id=${result.id || '?'}`);

    await db.setContacts(studentId, {
      studentEmail: studentEmail || '',
      parentEmail: parentEmail || '',
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`[email] FAILED after ${Date.now() - t0}ms:`, err.message);
    next(err);
  }
});

module.exports = router;