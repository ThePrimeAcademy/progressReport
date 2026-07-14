require('dotenv').config();
// Do NOT clearCache() on boot — that deletes the on-disk ClassMarker results
// cache and forces a full 85-day paginated re-pull (up to 30 API pages). With
// ClassMarker's 30 req/hour limit, a single Railway redeploy can exhaust the
// budget. Cache is loaded from DATA_DIR and refreshed incrementally (~1 req
// every 55 min). Use the UI "Refresh" button only when you need a hard wipe.
const cm = require('./services/classmarker.service');
cm.fetchCategoryMap().catch((err) => console.error('Category fetch failed:', err));

const express = require('express');
const cors = require('cors');


const studentRoutes = require('./routes/students.routes');
const reportRoutes = require('./routes/report.routes');
const webhookRoutes = require('./routes/webhook.routes');
const scoringSheetsRoutes = require('./routes/scoring-sheets.routes');
const examsRoutes = require('./routes/exams.routes');
const programsRoutes = require('./routes/program.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware

// AFTER
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
}));

// 1. Webhooks load FIRST so they can access the raw unparsed body
app.use('/api/webhooks', webhookRoutes);

// 2. Global parsers load AFTER for standard app traffic
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push(`${Object.keys(middleware.route.methods).join(',').toUpperCase()} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push(`${Object.keys(handler.route.methods).join(',').toUpperCase()} ${handler.route.path}`);
        }
      });
    }
  });
  res.json(routes);
});

// Routes
app.use('/api/students', studentRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/scoring-sheets', scoringSheetsRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/programs', programsRoutes);
// TEMPORARY: replay ClassMarker cache into the webhook DB. Remove after use.
app.post('/api/admin/backfill-from-cache', async (req, res) => {
  if (!process.env.EXPORT_TOKEN || req.query.token !== process.env.EXPORT_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const db = require('./services/db.service');
    const { normalizePayload } = require('./services/webhook.service');
    const cachePath = path.join(process.env.DATA_DIR || 'data', 'classmarker-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    let done = 0, skipped = 0;
    for (const r of cache.results || []) {
      if (r.user_id == null || r.test_id == null || r.time_finished == null) { skipped++; continue; }
      const payload = {
        payload_type: 'group_user_test_results',
        payload_status: 'backfilled_from_cache',
        result: {
          user_id: r.user_id, first: r.first || '', last: r.last || '', email: r.email || null,
          percentage: r.percentage ?? null, points_scored: r.points_scored ?? null,
          points_available: r.points_available ?? null, passed: r.passed ?? null,
          duration: r.duration || null,
          time_started: r.time_started ?? r.time_finished,
          time_finished: r.time_finished,
        },
        test: { test_id: r.test_id, test_name: cache.testMap?.[String(r.test_id)] || null },
        group: { group_id: r.group_id, group_name: cache.groupMap?.[String(r.group_id)] || null },
        questions: Array.isArray(r.questions) ? r.questions : [],
        category_results: Array.isArray(r.category_results)
          ? r.category_results.map((c) => ({
              category_id: c.category_id ?? null,
              name: c.category_name || c.name || null,
              points_scored: c.correct ?? c.points_scored ?? 0,
              points_available: c.total ?? c.points_available ?? 0,
            }))
          : [],
      };
      await db.upsertRecord(normalizePayload(payload));
      done++;
    }
    res.json({ ok: true, upserted: done, skipped });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`ProgressReport backend running on http://localhost:${PORT}`);
  // Begin polling for due scheduled bulk-email batches.
  require('./services/scheduled-email.service').startScheduler();
});
