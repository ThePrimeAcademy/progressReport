// routes/report.routes.js
const express = require('express');
const {
  getStudentById,
  getStudentResultsGrouped,
  getLatestTestResult,
  computeCategoryPerformance,
  getDataVersion,
} = require('../services/classmarker.service');
const { getSatScoresForStudent } = require('../services/sat.service');
const {
  getLatestWebhookTestResult,
  getWebhookCategoryPerformance,
  getWebhookCategoryPerformanceSplit,
} = require('../services/webhook.service');
const { computeStats } = require('../services/stats.service');
const { getCurvesVersion } = require('../services/scoring-sheet.service');
const { getExamsVersion } = require('../services/exam.service');
const { generateReportPDF } = require('../services/pdf.service');
const { sendReportEmail, isConfigured: isEmailConfigured, verifyConnection: verifyEmailConnection } = require('../services/email.service');
const db = require('../services/db.service');
const crypto = require('crypto');

const router = express.Router();

// ── Async send + job tracking for /api/report/email ────────────────────────
// Railway's edge closes idle HTTP connections at ~30s but PDF render + Gmail
// send commonly takes 30-45s. If the route blocked on the full pipeline, the
// browser saw "network error" mid-flight even though the email had already
// been queued (or even delivered) by Gmail.
//
// New shape: POST returns immediately with a jobId. The actual work runs in
// the background. The frontend polls GET /email/job/:jobId every 2s for the
// terminal status. No long-lived HTTP connection = no edge timeout.
//
// The same jobId derives from a sha256 hash of inputs, so it doubles as a
// dedupe key — identical POSTs within 5 min reuse the already-pending or
// already-completed job instead of starting a parallel send.
const JOB_TTL_MS = 5 * 60 * 1000;
const sendJobs = new Map(); // key -> { status, startedAt, finishedAt?, result?, error? }

function dedupeKey({ studentId, startDate, endDate, dayOfWeek, recipients, subject, homework }) {
  const days = Array.isArray(dayOfWeek)
    ? dayOfWeek.map(String).sort().join(',')
    : String(dayOfWeek || '');
  const normalized = [
    String(studentId || ''),
    String(startDate || ''),
    String(endDate || ''),
    days,
    (recipients || []).map((e) => e.toLowerCase()).sort().join(','),
    String(subject || ''),
    homeworkKey(homework),
  ].join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

// Admin-entered homework completion shown to parents in the PDF. Returns
// { total, completed } when usable, otherwise null (section is omitted).
function sanitizeHomework(hw) {
  if (!hw || typeof hw !== 'object') return null;
  const total = Number(hw.total);
  const completed = Number(hw.completed);
  if (!Number.isInteger(total) || !Number.isInteger(completed)) return null;
  if (total <= 0 || total > 999 || completed < 0 || completed > total) return null;
  return { total, completed };
}

function homeworkKey(homework) {
  return homework ? `hw${homework.completed}/${homework.total}` : '';
}

function readJob(key) {
  const job = sendJobs.get(key);
  if (!job) return null;
  // Pending jobs never expire (they're still running). Completed/failed jobs
  // expire after the TTL so duplicate-detection has a reasonable window.
  if (job.status !== 'pending' && job.finishedAt && Date.now() - job.finishedAt > JOB_TTL_MS) {
    sendJobs.delete(key);
    return null;
  }
  return job;
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [k, v] of sendJobs.entries()) {
    if (v.status !== 'pending' && v.finishedAt && v.finishedAt < cutoff) sendJobs.delete(k);
  }
}

function startOrReuseJob(key, doWork) {
  const existing = readJob(key);
  if (existing) {
    return { jobId: key, status: existing.status, deduplicated: true };
  }
  sendJobs.set(key, { status: 'pending', startedAt: Date.now() });
  // Fire and forget — no await, no res.send blocking on this.
  (async () => {
    try {
      const result = await doWork();
      sendJobs.set(key, {
        status: 'sent',
        startedAt: sendJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        result,
      });
    } catch (err) {
      console.error(`[email job ${key}] FAILED:`, err.message);
      sendJobs.set(key, {
        status: 'failed',
        startedAt: sendJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        error: err.message,
      });
    } finally {
      if (sendJobs.size > 200) pruneJobs();
    }
  })();
  return { jobId: key, status: 'pending' };
}

// Concatenated first+last+"Report" — e.g. "Darin Kim" -> "DarinKimReport".
// Strips diacritics/whitespace/punctuation so it's safe in Content-Disposition.
function buildReportFilename(studentName) {
  const cleaned = String(studentName || 'Student')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `${cleaned}Report`;
}

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

// ── Preview job tracking ──────────────────────────────────────────────────
// Same async-job pattern as /email, applied to /preview because the data
// gather can briefly exceed Railway's edge timeout when the ClassMarker
// cache is cold (right after a redeploy/restart). POST enqueues, frontend
// polls — no long-lived HTTP request, no Railway 499.
const PREVIEW_TTL_MS = 2 * 60 * 1000;
const previewJobs = new Map();

function previewKey({ studentId, startDate, endDate, dayOfWeek }) {
  const days = Array.isArray(dayOfWeek)
    ? dayOfWeek.map(String).sort().join(',')
    : String(dayOfWeek || '');
  // Include the data/exam/curve versions so a preview generated before a
  // webhook landed, an exam was (re)defined, or a curve was uploaded doesn't
  // get served from the dedupe cache after scoring inputs changed.
  const version = `v${getDataVersion()}.${getExamsVersion()}.${getCurvesVersion()}`;
  const normalized = [String(studentId), String(startDate), String(endDate), days, version].join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function readPreviewJob(key) {
  const job = previewJobs.get(key);
  if (!job) return null;
  if (job.status !== 'pending' && job.finishedAt && Date.now() - job.finishedAt > PREVIEW_TTL_MS) {
    previewJobs.delete(key);
    return null;
  }
  return job;
}

function startOrReusePreview(key, doWork) {
  const existing = readPreviewJob(key);
  if (existing) return { jobId: key, status: existing.status };
  previewJobs.set(key, { status: 'pending', startedAt: Date.now() });
  (async () => {
    try {
      const result = await doWork();
      previewJobs.set(key, {
        status: 'ready',
        startedAt: previewJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        result,
      });
    } catch (err) {
      console.error(`[preview job ${key}] FAILED:`, err.message);
      previewJobs.set(key, {
        status: 'failed',
        startedAt: previewJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        error: err.message,
      });
    } finally {
      if (previewJobs.size > 200) {
        const cutoff = Date.now() - PREVIEW_TTL_MS;
        for (const [k, v] of previewJobs.entries()) {
          if (v.status !== 'pending' && v.finishedAt && v.finishedAt < cutoff) previewJobs.delete(k);
        }
      }
    }
  })();
  return { jobId: key, status: 'pending' };
}

async function gatherPreviewData({ studentId, startDate, endDate, dayOfWeek }) {
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

  return { student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, categoryPerfSplit: webhookCategorySplit };
}

// POST /api/report/preview — kicks off the data gather in the background and
// returns immediately with a jobId. Frontend polls the GET endpoint below.
router.post('/preview', validate, async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, dayOfWeek } = req.body;
    const key = previewKey({ studentId, startDate, endDate, dayOfWeek });
    const start = startOrReusePreview(key, async () => {
      const data = await gatherPreviewData({ studentId, startDate, endDate, dayOfWeek });
      // Pre-warm the PDF for the same inputs (fire and forget) — previewing
      // a student almost always precedes downloading their report, and the
      // download POST derives the same job key, so the click joins a render
      // that is already finished or in flight.
      startOrReusePdf(`pdf-${key}`, async () => {
        const pdfBuffer = await generateReportPDF(
          data.student, data.groups, data.stats, data.satScores,
          startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit
        );
        return { buffer: pdfBuffer, filename: `${buildReportFilename(data.student.name)}.pdf` };
      });
      return data;
    });
    res.json({ success: true, data: start });
  } catch (err) {
    next(err);
  }
});

// GET /api/report/preview/job/:jobId — poll target. Returns {status, result, error}.
router.get('/preview/job/:jobId', (req, res) => {
  const job = readPreviewJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Preview job not found (it may have expired).' });
  }
  res.json({
    success: true,
    data: {
      status: job.status,
      result: job.result,
      error: job.error,
      durationMs: (job.finishedAt || Date.now()) - job.startedAt,
    },
  });
});

// ── PDF download — async job (same pattern as /preview and /email) ────────
// The synchronous version blocked on data gather + Puppeteer render, which
// routinely exceeds Railway's ~30s edge timeout and surfaced as a "network
// error" in the browser. POST now enqueues and returns a jobId; the frontend
// polls GET /job/:jobId, then downloads GET /job/:jobId/file.
const PDF_TTL_MS = 5 * 60 * 1000;
const pdfJobs = new Map();

function readPdfJob(key) {
  const job = pdfJobs.get(key);
  if (!job) return null;
  if (job.status !== 'pending' && job.finishedAt && Date.now() - job.finishedAt > PDF_TTL_MS) {
    pdfJobs.delete(key);
    return null;
  }
  return job;
}

function startOrReusePdf(key, doWork) {
  const existing = readPdfJob(key);
  if (existing) return { jobId: key, status: existing.status };
  pdfJobs.set(key, { status: 'pending', startedAt: Date.now() });
  (async () => {
    try {
      const result = await doWork();
      pdfJobs.set(key, {
        status: 'ready',
        startedAt: pdfJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        result,
      });
    } catch (err) {
      console.error(`[pdf job ${key}] FAILED:`, err.message);
      pdfJobs.set(key, {
        status: 'failed',
        startedAt: pdfJobs.get(key)?.startedAt || Date.now(),
        finishedAt: Date.now(),
        error: err.message,
      });
    } finally {
      if (pdfJobs.size > 50) {
        const cutoff = Date.now() - PDF_TTL_MS;
        for (const [k, v] of pdfJobs.entries()) {
          if (v.status !== 'pending' && v.finishedAt && v.finishedAt < cutoff) pdfJobs.delete(k);
        }
      }
    }
  })();
  return { jobId: key, status: 'pending' };
}

// POST /api/report — enqueue the PDF render, return { jobId, status }.
router.post('/', validate, (req, res, next) => {
  try {
    const { studentId, startDate, endDate, dayOfWeek } = req.body;
    const homework = sanitizeHomework(req.body.homework);
    // previewKey already mixes in the data/exam/curve versions, so a PDF job
    // never outlives a scoring change. Prefix keeps the job maps distinct.
    // Homework is admin-entered per render, so it's part of the key — without
    // it, a tweak to the counts would be served the stale pre-warmed PDF.
    const key = `pdf-${previewKey({ studentId, startDate, endDate, dayOfWeek })}${homeworkKey(homework)}`;
    const start = startOrReusePdf(key, async () => {
      const data = await gatherPreviewData({ studentId, startDate, endDate, dayOfWeek });
      const pdfBuffer = await generateReportPDF(
        data.student, data.groups, data.stats, data.satScores,
        startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit, homework
      );
      return { buffer: pdfBuffer, filename: `${buildReportFilename(data.student.name)}.pdf` };
    });
    res.json({ success: true, data: start });
  } catch (err) {
    next(err);
  }
});

// GET /api/report/job/:jobId — poll target for the PDF job.
router.get('/job/:jobId', (req, res) => {
  const job = readPdfJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'PDF job not found (it may have expired).' });
  }
  res.json({
    success: true,
    data: {
      status: job.status,
      error: job.error,
      durationMs: (job.finishedAt || Date.now()) - job.startedAt,
    },
  });
});

// GET /api/report/job/:jobId/file — the finished PDF.
router.get('/job/:jobId/file', (req, res) => {
  const job = readPdfJob(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'PDF job not found (it may have expired).' });
  if (job.status === 'pending') return res.status(409).json({ success: false, error: 'PDF still rendering.' });
  if (job.status === 'failed') return res.status(500).json({ success: false, error: job.error || 'PDF generation failed.' });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${job.result.filename}"`,
    'Content-Length': job.result.buffer.length,
  });
  res.send(job.result.buffer);
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
    const homework = sanitizeHomework(req.body.homework);
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

    const key = dedupeKey({ studentId, startDate, endDate, dayOfWeek, recipients, subject, homework });
    console.log(`[email] queued studentId=${studentId} recipients=${recipients.length} key=${key}`);

    const start = startOrReuseJob(key, async () => {
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

      console.log(`[email job ${key}] data gathered in ${Date.now() - t0}ms, rendering PDF…`);
      const pdfBuffer = await generateReportPDF(student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, webhookCategorySplit, homework);
      const filename = `${buildReportFilename(student.name)}.pdf`;
      console.log(`[email job ${key}] PDF rendered (${pdfBuffer.length} bytes) at ${Date.now() - t0}ms, sending via Gmail API…`);

      const sendResult = await sendReportEmail({
        studentName: student.name,
        recipients,
        pdfBuffer,
        filename,
        startDate,
        endDate,
        subject,
      });
      console.log(`[email job ${key}] sent in total ${Date.now() - t0}ms id=${sendResult.id || '?'}`);

      await db.setContacts(studentId, {
        studentEmail: studentEmail || '',
        parentEmail: parentEmail || '',
      });
      return sendResult;
    });

    res.json({ success: true, data: start });
  } catch (err) {
    console.error(`[email] queue FAILED after ${Date.now() - t0}ms:`, err.message);
    next(err);
  }
});

// GET /api/report/email/job/:jobId — frontend polls this every 2s after POST
router.get('/email/job/:jobId', (req, res) => {
  const job = readJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found (it may have expired after 5 minutes).' });
  }
  res.json({
    success: true,
    data: {
      status: job.status,
      result: job.result,
      error: job.error,
      durationMs: (job.finishedAt || Date.now()) - job.startedAt,
    },
  });
});

module.exports = router;