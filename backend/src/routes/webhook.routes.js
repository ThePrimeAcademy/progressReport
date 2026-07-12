const express = require('express');
const {
  getWebhookStoreSummary,
  upsertWebhookPayload,
  verifySignature,
} = require('../services/webhook.service');
const db = require('../services/db.service');

const router = express.Router();

// ── Status ────────────────────────────────────────────────────
router.get('/classmarker/status', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getWebhookStoreSummary() });
  } catch (e) { next(e); }
});

// ── Debug ─────────────────────────────────────────────────────
router.get('/classmarker/debug', async (req, res, next) => {
  try {
    const total = await db.getTotalResults();
    const records = await db.getAllRecords();
    const latest = records[records.length - 1];
    res.json({
      totalResults: total,
      latestKey: latest?.record_key || latest?.key,
      latestStudent: latest?.student,
      questionsCount: latest?.questions?.length ?? 0,
      categoriesCount: latest?.categoryResults?.length ?? 0,
      sampleQuestion: latest?.questions?.[0] ?? null,
      sampleCategory: latest?.categoryResults?.[0] ?? null,
    });
  } catch (e) { next(e); }
});

// ── Storage info ──────────────────────────────────────────────
// GET /api/webhooks/classmarker/storage-info
// Reports where the SQLite file lives so we can verify a persistent
// volume is actually mounted on Railway.
router.get('/classmarker/storage-info', async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const dbPath = path.join(dataDir, 'progressreport.db');
    let stat = null;
    try {
      const s = fs.statSync(dbPath);
      stat = { sizeBytes: s.size, mtime: s.mtime.toISOString(), birthtime: s.birthtime.toISOString() };
    } catch (_) {}
    res.json({
      dataDir,
      dbPath,
      exists: !!stat,
      ...stat,
      totalRecords: await db.getTotalResults(),
      latestUpdatedAt: await db.getLatestUpdatedAt(),
      env: { NODE_ENV: process.env.NODE_ENV || null, RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || null },
    });
  } catch (e) { next(e); }
});

// ── Records query ─────────────────────────────────────────────
// GET /api/webhooks/classmarker/records?testName=...&email=...&userId=...
// Returns a lightweight listing of records matching the filters so we can
// inspect questions/category presence per record.
router.get('/classmarker/records', async (req, res, next) => {
  try {
    const { testName, email, userId, name } = req.query;
    const records = await db.getAllRecords();
    const norm = (s) => String(s || '').toLowerCase();
    const filtered = records.filter((r) => {
      if (testName && !norm(r.test?.testName).includes(norm(testName))) return false;
      if (email && norm(r.email) !== norm(email)) return false;
      if (userId && String(r.user_id || '') !== String(userId)) return false;
      if (name && !norm(r.name).includes(norm(name))) return false;
      return true;
    });
    res.json({
      count: filtered.length,
      records: filtered.map((r) => ({
        recordKey: r.record_key,
        testName: r.test?.testName,
        student: r.name,
        email: r.email,
        date: r.date,
        timeFinished: r.timeFinished,
        receivedAt: r.received_at,
        questionsCount: r.questions?.length || 0,
        categoriesCount: r.categoryResults?.length || 0,
        percentage: r.percentage,
      })),
    });
  } catch (e) { next(e); }
});

router.get('/classmarker/backfill-categories', async (req, res, next) => {
  try {
    const { fetchCategoryMap } = require('../services/classmarker.service');
    const catMap = await fetchCategoryMap();

    // Get all records via the existing db service
    const records = await db.getAllRecords();

    let updated = 0;
    for (const record of records) {
      const hasNullCategories = (record.questions || []).some((q) => !q.categoryName && q.categoryId);
      if (!hasNullCategories) continue;

      const newQuestions = (record.questions || []).map((q) => ({
        ...q,
        categoryName: q.categoryName || catMap[String(q.categoryId)] || null,
      }));

      await db.updateQuestions(record.id, newQuestions);
      updated++;
    }

    res.json({ success: true, recordsUpdated: updated, categoriesLoaded: Object.keys(catMap).length });
  } catch (e) {
    next(e);
  }
});

// ── Backfill categories ───────────────────────────────────────
router.post('/classmarker/backfill-categories', async (req, res, next) => {
  try {
    const { fetchCategoryMap } = require('../services/classmarker.service');
    const catMap = await fetchCategoryMap();
    const initSqlJs = require('sql.js');
    const path = require('path');
    const fs = require('fs');
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const DB_PATH = path.join(DATA_DIR, 'progressreport.db');

    const SQL = await initSqlJs();
    const dbConn = new SQL.Database(fs.readFileSync(DB_PATH));

    const rows = dbConn.exec('SELECT id, questions FROM webhook_results').flatMap((r) =>
      r.values.map((v) => ({ id: v[0], questions: JSON.parse(v[1] || '[]') }))
    );

    let updated = 0;
    for (const row of rows) {
      const newQuestions = row.questions.map((q) => ({
        ...q,
        categoryName: q.categoryName || catMap[String(q.categoryId)] || null,
      }));
      dbConn.run('UPDATE webhook_results SET questions = ? WHERE id = ?', [
        JSON.stringify(newQuestions), row.id,
      ]);
      updated++;
    }

    fs.writeFileSync(DB_PATH, Buffer.from(dbConn.export()));
    res.json({ success: true, recordsUpdated: updated, categoriesLoaded: Object.keys(catMap).length });
  } catch (e) {
    next(e);
  }
});

// ── Export for cmReview ───────────────────────────────────────
// GET /api/webhooks/classmarker/export?since=<ISO receivedAt>&limit=200&offset=0
// Token-protected full export of stored webhook results, with per-question
// detail (question text, options, correct answer, student response) merged
// in from the raw ClassMarker payload. Consumed by the cmReview tool.
router.get('/classmarker/export', async (req, res, next) => {
  try {
    const crypto = require('crypto');
    const token = process.env.EXPORT_TOKEN;
    if (!token) return res.status(503).json({ error: 'EXPORT_TOKEN not configured on server' });

    const provided = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-export-token') || '';
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(token));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid export token' });
    }

    const since = req.query.since ? String(req.query.since) : null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let records = await db.getAllRecords();
    if (since) records = records.filter((r) => (r.received_at || '') > since);
    records.sort((x, y) => String(x.received_at || '').localeCompare(String(y.received_at || '')));

    const total = records.length;
    const page = records.slice(offset, offset + limit);

    const exportRecords = page.map((r) => {
      const rawQuestions = Array.isArray(r.raw?.questions) ? r.raw.questions : [];
      const questions = (r.questions || []).map((q, i) => {
        const raw = rawQuestions.find((rq) => String(rq.question_id) === String(q.questionId)) || rawQuestions[i] || {};
        return {
          ...q,
          question: raw.question ?? null,
          options: raw.options ?? null,
          correctOption: raw.correct_option ?? null,
          userResponse: raw.user_response ?? null,
          feedback: raw.feedback ?? null,
        };
      });
      return {
        recordKey: r.record_key,
        userId: r.user_id,
        email: r.email,
        name: r.name,
        testId: r.test_id,
        testName: r.test_name,
        groupId: r.group_id,
        groupName: r.group_name,
        percentage: r.percentage,
        score: r.score,
        maxScore: r.max_score,
        passed: r.passed,
        duration: r.duration,
        timeStarted: r.time_started,
        timeFinished: r.time_finished,
        date: r.date,
        receivedAt: r.received_at,
        questions,
      };
    });

    res.json({ total, offset, limit, count: exportRecords.length, records: exportRecords });
  } catch (e) { next(e); }
});

// ── Receive webhook (must be last — uses raw body parser) ─────
router.post(
  '/classmarker',
  express.raw({
    type: (req) => (req.headers['content-type'] || '').includes('application/json'),
  }),
  async (req, res, next) => {
    try {
      console.log('[webhook] Received POST | body length:', req.body?.length);

      const verification = verifySignature(req.body, req.get('X-Classmarker-Hmac-Sha256'));
      console.log('[webhook] Signature:', verification);

      if (!verification.ok) {
        console.warn('[webhook] Signature failed:', verification.reason);
        return res.status(401).json({ error: verification.reason });
      }

      const payload = JSON.parse(req.body.toString('utf-8'));
      console.log('[webhook] type:', payload.payload_type, '| status:', payload.payload_status);

      if (payload.payload_status === 'verify') {
        console.log('[webhook] Verification ping — 204');
        return res.status(204).send();
      }

      const record = await upsertWebhookPayload(payload);
      console.log('[webhook] Stored:', record.key, '| questions:', record.questions?.length, '| categories:', record.categoryResults?.length);
      res.status(204).send();

    } catch (error) {
      console.error('[webhook] Error:', error.message);
      next(error);
    }
  }
);

module.exports = router;
