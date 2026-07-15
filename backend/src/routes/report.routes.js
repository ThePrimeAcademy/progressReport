// routes/report.routes.js
const express = require('express');
const { getDataVersion } = require('../services/classmarker.service');
const { getCurvesVersion } = require('../services/scoring-sheet.service');
const { getExamsVersion } = require('../services/exam.service');
const { getProgramsVersion } = require('../services/program.service');
const { generateReportPDF } = require('../services/pdf.service');
const { isConfigured: isEmailConfigured, verifyConnection: verifyEmailConnection, sendCustomEmail } = require('../services/email.service');
const {
  buildReportFilename,
  gatherReportData,
  buildAndSendReport,
} = require('../services/report-delivery.service');
const db = require('../services/db.service');
const crypto = require('crypto');

const router = express.Router();

// ── Async send + job tracking for /api/report/email ────────────────────────
// Railway's edge closes idle HTTP connections at ~30s but PDF render + SMTP
// send commonly takes 30-45s. If the route blocked on the full pipeline, the
// browser saw "network error" mid-flight even though the email had already
// been queued (or even delivered) by Zoho.
//
// New shape: POST returns immediately with a jobId. The actual work runs in
// the background. The frontend polls GET /email/job/:jobId every 2s for the
// terminal status. No long-lived HTTP connection = no edge timeout.
//
// Jobs are persisted in SQLite (DATA_DIR) so a redeploy can't make the poll
// 404 with "Job not found". The same jobId derives from a sha256 of inputs,
// so identical POSTs within 5 min rejoin an in-flight or successful send
// instead of duplicating work. Failed jobs are retriable immediately.

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

async function startOrReuseJob(key, doWork) {
  const existing = await db.getEmailJob(key);
  // Rejoin in-flight or recently-successful sends. Failed jobs are NOT reused
  // so the user can hit Send again without waiting for TTL expiry.
  if (existing && (existing.status === 'pending' || existing.status === 'sent')) {
    return { jobId: key, status: existing.status, deduplicated: true };
  }

  const startedAt = Date.now();
  await db.upsertEmailJob(key, { status: 'pending', startedAt, finishedAt: null, result: null, error: null });

  // Fire and forget — no await, no res.send blocking on this.
  (async () => {
    try {
      const result = await doWork();
      await db.upsertEmailJob(key, {
        status: 'sent',
        startedAt,
        finishedAt: Date.now(),
        result,
        error: null,
      });
    } catch (err) {
      console.error(`[email job ${key}] FAILED:`, err.message);
      await db.upsertEmailJob(key, {
        status: 'failed',
        startedAt,
        finishedAt: Date.now(),
        error: err.message,
      });
    } finally {
      db.pruneEmailJobs().catch(() => {});
    }
  })();
  return { jobId: key, status: 'pending' };
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
  const version = `v${getDataVersion()}.${getExamsVersion()}.${getCurvesVersion()}.${getProgramsVersion()}`;
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

// POST /api/report/preview — kicks off the data gather in the background and
// returns immediately with a jobId. Frontend polls the GET endpoint below.
router.post('/preview', validate, async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, dayOfWeek } = req.body;
    const key = previewKey({ studentId, startDate, endDate, dayOfWeek });
    const start = startOrReusePreview(key, async () => {
      const data = await gatherReportData({ studentId, startDate, endDate, dayOfWeek });
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
      const data = await gatherReportData({ studentId, startDate, endDate, dayOfWeek });
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

    const start = await startOrReuseJob(key, async () => {
      const sendResult = await buildAndSendReport({
        studentId, startDate, endDate, dayOfWeek,
        recipients, studentEmail, parentEmail, subject, homework,
      });
      console.log(`[email job ${key}] sent in total ${Date.now() - t0}ms id=${sendResult.id || '?'}`);
      return sendResult;
    });

    res.json({ success: true, data: start });
  } catch (err) {
    console.error(`[email] queue FAILED after ${Date.now() - t0}ms:`, err.message);
    next(err);
  }
});

// GET /api/report/email/job/:jobId — frontend polls this every 2s after POST
router.get('/email/job/:jobId', async (req, res) => {
  try {
    const job = await db.getEmailJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found (server may have restarted — try Send again).',
      });
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
  } catch (err) {
    console.error('[email job status]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Custom (non-report) email ───────────────────────────────────────────────
// Admin-written message to selected students/parents. The progress report is
// NOT attached unless includeReport is explicitly true — this exists so bulk
// sending can be exercised without mailing out reports.
//
// POST /api/report/email/custom
//   body: { items: [{ studentId, studentEmail?, parentEmail? }],
//           subject?, message, includeReport?, startDate?, endDate?, dayOfWeek? }
// Returns { jobId } immediately; work runs in the background (same edge-
// timeout reasoning as /email). Poll GET /email/custom/job/:jobId.
const customJobs = new Map();
const CUSTOM_JOB_TTL_MS = 10 * 60 * 1000;

router.post('/email/custom', async (req, res) => {
  try {
    const { subject, message, includeReport, startDate, endDate, dayOfWeek } = req.body || {};
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!String(message || '').trim()) {
      return res.status(400).json({ error: 'A message body is required.' });
    }
    if (items.length === 0) {
      return res.status(400).json({ error: 'Select at least one student.' });
    }
    if (includeReport) {
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required when attaching the report.' });
      }
      if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'startDate must be before endDate.' });
      }
    }

    const jobId = crypto.randomUUID();
    const job = {
      status: 'pending',
      startedAt: Date.now(),
      finishedAt: null,
      items: items.map((it) => ({
        studentId: String(it.studentId || ''),
        status: 'pending',
        to: [],
        error: null,
      })),
    };
    customJobs.set(jobId, job);

    // Evict stale jobs so the map can't grow unbounded.
    for (const [k, v] of customJobs.entries()) {
      if (v.finishedAt && Date.now() - v.finishedAt > CUSTOM_JOB_TTL_MS) customJobs.delete(k);
    }

    (async () => {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const jobItem = job.items[i];
        jobItem.status = 'sending';
        try {
          let { studentEmail, parentEmail } = it;
          if (studentEmail === undefined && parentEmail === undefined) {
            const saved = await db.getContacts(String(it.studentId));
            studentEmail = saved?.studentEmail || '';
            parentEmail = saved?.parentEmail || '';
          }
          const recipients = [studentEmail, parentEmail]
            .map((e) => String(e || '').trim())
            .filter(Boolean);
          if (recipients.length === 0) {
            throw new Error('No recipient email on file (student or parent).');
          }

          const attachments = [];
          if (includeReport) {
            const data = await gatherReportData({
              studentId: String(it.studentId), startDate, endDate, dayOfWeek,
            });
            const pdfBuffer = await generateReportPDF(
              data.student, data.groups, data.stats, data.satScores,
              startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit
            );
            attachments.push({
              filename: `${buildReportFilename(data.student.name)}.pdf`,
              content: pdfBuffer,
            });
          }

          const result = await sendCustomEmail({ recipients, subject, message, attachments });
          jobItem.status = 'sent';
          jobItem.to = result.to || recipients;
        } catch (err) {
          console.error(`[email/custom ${jobId}] item ${it.studentId} FAILED:`, err.message);
          jobItem.status = 'failed';
          jobItem.error = err.message;
        }
      }
      job.status = job.items.every((x) => x.status === 'failed') ? 'failed' : 'done';
      job.finishedAt = Date.now();
    })();

    res.json({ success: true, data: { jobId, status: 'pending' } });
  } catch (err) {
    console.error('[email/custom] queue FAILED:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/report/email/custom/job/:jobId — poll target for custom sends.
router.get('/email/custom/job/:jobId', (req, res) => {
  const job = customJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found (it may have expired or the server restarted).' });
  }
  res.json({
    success: true,
    data: {
      status: job.status,
      items: job.items,
      durationMs: (job.finishedAt || Date.now()) - job.startedAt,
    },
  });
});

// ── Scheduled bulk send ─────────────────────────────────────────────────────
// A scheduled batch persists in SQLite and is delivered server-side by
// scheduled-email.service at send_at (so the browser need not stay open). The
// report date range is frozen at schedule time, matching the bulk panel.

function validateSchedule(req, res, next) {
  const { startDate, endDate, sendAt, items } = req.body;
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate and endDate are required' });
  if (new Date(startDate) > new Date(endDate))
    return res.status(400).json({ error: 'startDate must be before endDate' });
  const when = new Date(sendAt);
  if (!sendAt || Number.isNaN(when.getTime()))
    return res.status(400).json({ error: 'A valid sendAt time is required' });
  // 60s grace so a "send in a moment" schedule isn't rejected by clock skew.
  if (when.getTime() < Date.now() - 60 * 1000)
    return res.status(400).json({ error: 'sendAt must be in the future' });
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'At least one recipient item is required' });
  next();
}

// POST /api/report/email/schedule
// body: { label?, subject?, startDate, endDate, dayOfWeek?, sendAt, items: [{ studentId, studentName?, studentEmail?, parentEmail? }] }
router.post('/email/schedule', validateSchedule, async (req, res, next) => {
  try {
    const { label, subject, startDate, endDate, dayOfWeek, sendAt } = req.body;
    // Keep only rows that actually have a recipient — a scheduled send with no
    // address would just become a 'skipped' item, so drop it up front.
    const items = req.body.items
      .filter((it) => it && it.studentId)
      .map((it) => ({
        studentId: String(it.studentId),
        studentName: it.studentName || '',
        studentEmail: String(it.studentEmail || '').trim(),
        parentEmail: String(it.parentEmail || '').trim(),
      }))
      .filter((it) => it.studentEmail || it.parentEmail);

    if (items.length === 0) {
      return res.status(400).json({ error: 'No selected students have a recipient email.' });
    }

    const id = await db.createScheduledBatch({ label, subject, startDate, endDate, dayOfWeek, sendAt, items });
    console.log(`[schedule] batch ${id} — ${items.length} recipient(s) for ${sendAt}`);
    res.json({ success: true, data: { id, scheduledCount: items.length, sendAt } });
  } catch (err) {
    next(err);
  }
});

// GET /api/report/email/queue — all batches (newest first) with status counts.
router.get('/email/queue', async (req, res, next) => {
  try {
    const batches = await db.listScheduledBatches();
    res.json({ success: true, data: batches });
  } catch (err) {
    next(err);
  }
});

// GET /api/report/email/queue/:id — one batch with its per-student items.
router.get('/email/queue/:id', async (req, res, next) => {
  try {
    const batch = await db.getScheduledBatch(req.params.id);
    if (!batch) return res.status(404).json({ success: false, error: 'Scheduled batch not found.' });
    res.json({ success: true, data: batch });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/report/email/queue/:id — cancel a not-yet-started batch.
router.delete('/email/queue/:id', async (req, res, next) => {
  try {
    const result = await db.cancelScheduledBatch(req.params.id);
    if (!result.ok) {
      const code = result.reason === 'not_found' ? 404 : 409;
      const msg = result.reason === 'not_found'
        ? 'Scheduled batch not found.'
        : `This batch can't be canceled (status: ${result.status}).`;
      return res.status(code).json({ success: false, error: msg });
    }
    res.json({ success: true, data: { canceled: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;