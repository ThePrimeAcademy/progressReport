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
// TEMPORARY: import student/parent contacts from JSON. Remove after use.
app.post('/api/admin/import-contacts', async (req, res) => {
  if (!process.env.EXPORT_TOKEN || req.query.token !== process.env.EXPORT_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    const db = require('./services/db.service');
    const entries = (req.body && req.body.entries) || [];
    const students = await cm.getAllStudents();
    const nameKey = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
    const byName = new Map();
    const byEmail = new Map();
    for (const s of students) {
      if (s.name) byName.set(nameKey(s.name), String(s.id));
      if (s.email) byEmail.set(String(s.email).toLowerCase(), String(s.id));
    }
    let saved = 0;
    const unmatched = [];
    for (const e of entries) {
      const sid = byName.get(nameKey(e.name))
        || byEmail.get(String(e.studentEmail || '').toLowerCase());
      if (!sid) { unmatched.push(e.name); continue; }
      await db.setContacts(sid, { studentEmail: e.studentEmail || '', parentEmail: e.parentEmail || '' });
      saved++;
    }
    res.json({ ok: true, saved, unmatchedCount: unmatched.length, unmatched });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
