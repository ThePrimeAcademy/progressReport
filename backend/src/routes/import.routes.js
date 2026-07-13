// routes/import.routes.js
// TEMPORARY one-off importer: converts a ClassMarker "Test scores & selected
// answers" CSV export into webhook_results records, for sittings whose
// webhooks were lost (e.g. the Jul 10 2026 Week 3 tests, taken while the
// webhook parse bug was live).
//
// The per-question CATEGORY mapping is NOT in the CSV — it is recovered from
// existing webhook records for the same test (any attempt that arrived after
// the webhook fix, e.g. the Jul 12 takers). So at least ONE post-fix webhook
// attempt per test must already be in the store. Records are keyed the same
// way webhook records are, and re-running the import is idempotent (upsert).
//
// Mount in server.js (remove after use!):
//   app.use('/api/import', require('./routes/import.routes'));
//
// Usage (dry run first — writes nothing, returns a summary):
//   curl -X POST "https://<host>/api/import/classmarker-csv?dryRun=1" \
//        -H "Content-Type: text/csv" \
//        --data-binary @"VA Summer SAT Week 3 English Test Results (2).csv"
// Then for real:
//   curl -X POST "https://<host>/api/import/classmarker-csv" \
//        -H "Content-Type: text/csv" \
//        --data-binary @"VA Summer SAT Week 3 English Test Results (2).csv"
//
// Optional query params:
//   testId=NNN   force the ClassMarker test id if name matching is ambiguous
//   tzOffset=-4  hours from UTC for the CSV's dates (default -4 = EDT)
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../services/db.service');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');

router.use(express.text({ type: () => true, limit: '25mb' }));

// ── CSV parsing (handles quoted fields with embedded commas/newlines) ──────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
// Loose name key for test-name matching ("m1 &amp; m2" vs "m1 & m2" etc.)
function testNameKey(value) {
  return normalizeName(decodeEntities(value));
}

// "Fri 10th Jul 2026 9:18am" → unix seconds. tzOffsetHours = hours the CSV's
// clock is AHEAD of UTC (EDT = -4).
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseCmDate(s, tzOffsetHours) {
  const m = String(s || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})\w*\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  const [, day, mon, year, hh, mm, ap] = m;
  let hour = Number(hh) % 12;
  if (/pm/i.test(ap)) hour += 12;
  const month = MONTHS[mon.toLowerCase()];
  if (month == null) return null;
  const utcMs = Date.UTC(Number(year), month, Number(day), hour - tzOffsetHours, Number(mm));
  return Math.floor(utcMs / 1000);
}

// ── Lookups built from what the server already knows ────────────────────────
function loadApiCache() {
  try {
    const file = path.join(DATA_DIR, 'classmarker-cache.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(data.results)) return data;
    }
  } catch (_) { /* cache optional */ }
  return { results: [], groupMap: {}, testMap: {} };
}

// email → userId and normalized name → userId, from the webhook store + the
// ClassMarker API cache. Name matches only count when the name is unique.
function buildIdentityMaps(records, cache) {
  const byEmail = new Map();
  const byName = new Map(); // name → userId | 'AMBIGUOUS'
  const claim = (map, key, uid) => {
    if (!key || !uid) return;
    const prev = map.get(key);
    if (prev && prev !== uid) map.set(key, 'AMBIGUOUS');
    else map.set(key, uid);
  };
  for (const r of records) {
    const uid = r.student && r.student.userId ? String(r.student.userId) : null;
    if (!uid) continue;
    claim(byEmail, normalizeEmail(r.student.email), uid);
    claim(byName, r.student.normalizedName, uid);
  }
  for (const r of cache.results) {
    if (r.user_id == null) continue;
    const uid = String(r.user_id);
    claim(byEmail, normalizeEmail(r.email), uid);
    claim(byName, normalizeName(`${r.first || ''} ${r.last || ''}`), uid);
  }
  return { byEmail, byName };
}

// questionId → { categoryId, categoryName, sectionNumber } for one test, from
// the latest stored webhook attempt that carries per-question data.
function buildCategoryMap(records, testId) {
  const latest = new Map();
  for (const r of records) {
    const tid = String((r.test && r.test.testId) || r.test_id || '');
    if (tid !== String(testId)) continue;
    const takenAt = r.timeFinished || 0;
    for (const q of r.questions || []) {
      if (q.questionId == null || (q.categoryId == null && !q.categoryName)) continue;
      const prev = latest.get(String(q.questionId));
      if (!prev || takenAt >= prev.takenAt) {
        latest.set(String(q.questionId), {
          takenAt,
          categoryId: q.categoryId != null ? String(q.categoryId) : null,
          categoryName: q.categoryName || null,
          sectionNumber: q.sectionNumber ?? null,
          questionType: q.questionType || null,
        });
      }
    }
  }
  return latest;
}

// ── The importer ────────────────────────────────────────────────────────────
router.post('/classmarker-csv', async (req, res) => {
  try {
    const dryRun = ['1', 'true', 'yes'].includes(String(req.query.dryRun || '').toLowerCase());
    const tzOffset = req.query.tzOffset != null ? Number(req.query.tzOffset) : -4;
    const csvText = typeof req.body === 'string' ? req.body : '';
    if (!csvText.trim()) return res.status(400).json({ error: 'Empty body — POST the CSV as text/csv' });

    const rows = parseCsv(csvText);

    // Preamble metadata + header row
    let csvTestName = null;
    let csvLinkName = null;
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r[0] === 'Test name:') csvTestName = r[1] || null;
      if (r[0] === 'Link name:') csvLinkName = r[1] || null;
      if (r[0] === 'First name' && r[1] === 'Last name') { headerIdx = i; break; }
    }
    if (headerIdx < 0) return res.status(400).json({ error: 'Could not find the header row ("First name","Last name",…) — is this a "Test scores & selected answers" export?' });

    const header = rows[headerIdx];
    const markerCol = header.findIndex((h, i) => h === '' && header[i + 1] && /^Q\d+$/.test(header[i + 1]));
    if (markerCol < 0) return res.status(400).json({ error: 'No question columns found — export with Question Column Title = "Actual Question ID"' });
    const questionIds = header.slice(markerCol + 1).filter((h) => /^Q\d+$/.test(h)).map((h) => h.slice(1));
    const col = (name) => header.indexOf(name);
    const cols = {
      first: col('First name'), last: col('Last name'), email: col('Email'),
      group: col('Group name'), test: col('Test name'), pct: col('Percentage'),
      score: col('Points received'), max: col('Points available'),
      duration: col('Duration'), started: col('Date started'), finished: col('Date finished'),
    };

    // Existing knowledge
    const allRecords = await db.getAllRecords();
    const cache = loadApiCache();

    // Resolve testId by name (webhook store first, then API cache), unless forced
    let testId = req.query.testId ? String(req.query.testId) : null;
    let resolvedFrom = testId ? 'query param' : null;
    if (!testId) {
      const want = testNameKey(csvTestName);
      const candidates = new Map(); // testId → testName
      for (const r of allRecords) {
        const tid = String((r.test && r.test.testId) || r.test_id || '');
        const tn = (r.test && r.test.testName) || r.test_name || '';
        if (tid && testNameKey(tn) === want) candidates.set(tid, tn);
      }
      if (candidates.size === 0) {
        for (const [tid, tn] of Object.entries(cache.testMap || {})) {
          if (testNameKey(tn) === want) candidates.set(String(tid), tn);
        }
      }
      if (candidates.size === 1) {
        testId = candidates.keys().next().value;
        resolvedFrom = 'name match';
      } else {
        return res.status(400).json({
          error: candidates.size === 0
            ? `No stored test matches name "${csvTestName}". Pass ?testId=NNN explicitly.`
            : `Multiple tests match name "${csvTestName}". Pass ?testId=NNN explicitly.`,
          candidates: Array.from(candidates, ([id, name]) => ({ testId: id, testName: name })),
        });
      }
    }

    // Category mapping from existing webhook records for this test
    const catMap = buildCategoryMap(allRecords, testId);
    const qidsWithCategory = questionIds.filter((qid) => catMap.has(qid));
    if (qidsWithCategory.length === 0) {
      return res.status(400).json({
        error: `No stored webhook attempt for test ${testId} carries per-question categories — need at least one post-fix attempt (e.g. the Jul 12 takers) in the store first.`,
      });
    }

    // Group id: prefer an existing webhook record for this test, else cache groupMap by name
    let groupId = null;
    let groupName = null;
    for (const r of allRecords) {
      const tid = String((r.test && r.test.testId) || r.test_id || '');
      if (tid === testId && r.group && r.group.groupId) {
        groupId = String(r.group.groupId);
        groupName = r.group.groupName || null;
        break;
      }
    }
    if (!groupId) {
      for (const [gid, gname] of Object.entries(cache.groupMap || {})) {
        if (testNameKey(gname) === testNameKey(csvLinkName)) { groupId = String(gid); groupName = gname; break; }
      }
    }

    const identity = buildIdentityMaps(allRecords, cache);

    // Existing attempts for dedupe: `${userId}|${testId}|${timeFinished}` and
    // email-based fallback. Records we imported earlier are recognised by key
    // and simply updated (idempotent re-runs).
    const existingByAttempt = new Map(); // attemptKey → record_key
    for (const r of allRecords) {
      const tid = String((r.test && r.test.testId) || r.test_id || '');
      if (tid !== testId) continue;
      const uid = (r.student && r.student.userId) || r.user_id || '';
      const em = normalizeEmail((r.student && r.student.email) || r.email);
      if (uid) existingByAttempt.set(`u:${uid}|${r.timeFinished}`, r.key || r.record_key);
      if (em) existingByAttempt.set(`e:${em}|${r.timeFinished}`, r.key || r.record_key);
    }

    const now = new Date().toISOString();
    const summary = {
      dryRun,
      testName: csvTestName,
      testId,
      testIdResolvedFrom: resolvedFrom,
      groupId,
      groupName: groupName || csvLinkName,
      questionColumnsInCsv: questionIds.length,
      questionsWithKnownCategory: qidsWithCategory.length,
      questionsMissingCategory: questionIds.filter((q) => !catMap.has(q)).map((q) => `Q${q}`),
      rowsInCsv: 0,
      skippedNoAttempt: 0,
      imported: 0,
      updatedExistingImport: 0,
      skippedWebhookDuplicate: 0,
      userIdMatched: 0,
      userIdUnmatched: [],
      sample: null,
    };

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (r[markerCol] !== 'Points scored:') continue; // question dump / blank lines
      summary.rowsInCsv++;

      const first = r[cols.first] || '';
      const last = r[cols.last] || '';
      const email = r[cols.email] || null;
      const name = `${first} ${last}`.trim() || email || null;
      const nEmail = normalizeEmail(email);
      const nName = normalizeName(name);

      let userId = identity.byEmail.get(nEmail);
      if (!userId || userId === 'AMBIGUOUS') {
        const byName = identity.byName.get(nName);
        userId = byName && byName !== 'AMBIGUOUS' ? byName : null;
      }
      if (userId) summary.userIdMatched++;
      else summary.userIdUnmatched.push(name || email || `row ${i}`);

      const timeStarted = parseCmDate(r[cols.started], tzOffset);
      const timeFinished = parseCmDate(r[cols.finished], tzOffset);
      // Enrolled students who never sat the test export as rows with no
      // finish date — not attempts, skip them.
      if (!timeFinished) { summary.skippedNoAttempt++; continue; }
      const score = Number(r[cols.score]);
      const maxScore = Number(r[cols.max]);
      const percentage = parseFloat(String(r[cols.pct] || '').replace('%', ''));

      // Skip attempts the webhook store already has (post-fix webhooks). Our
      // own previously-imported records are matched by record key below and
      // updated instead.
      const dupKey = userId ? `u:${userId}|${timeFinished}` : `e:${nEmail}|${timeFinished}`;
      const recordKey = userId
        ? `group:${userId}:${testId}:${groupId || 'unknown'}:${timeStarted || 'unknown'}`
        : `import:${nEmail || nName}:${testId}:${timeStarted || 'unknown'}`;
      const existingKey = existingByAttempt.get(dupKey);
      if (existingKey && existingKey !== recordKey) {
        summary.skippedWebhookDuplicate++;
        continue;
      }
      if (existingKey === recordKey) summary.updatedExistingImport++;
      else summary.imported++;

      // Per-question results
      const questions = [];
      const catTotals = new Map(); // categoryId|name → { categoryId, name, correct, total }
      for (let qi = 0; qi < questionIds.length; qi++) {
        const qid = questionIds[qi];
        const rawVal = r[markerCol + 1 + qi];
        const pts = Number(rawVal);
        const answered = rawVal != null && rawVal !== '' && rawVal !== 'No answer';
        const correct = answered && !Number.isNaN(pts) && pts > 0;
        const cat = catMap.get(qid) || {};
        questions.push({
          questionId: qid,
          questionType: cat.questionType || null,
          categoryId: cat.categoryId || null,
          categoryName: cat.categoryName || null,
          sectionNumber: cat.sectionNumber ?? null,
          questionNumber: qi + 1,
          correct,
          result: correct ? 'correct' : (answered ? 'incorrect' : 'unanswered'),
          pointsScored: answered && !Number.isNaN(pts) ? pts : 0,
          pointsAvailable: 1,
        });
        if (cat.categoryId || cat.categoryName) {
          const ckey = cat.categoryId || cat.categoryName;
          if (!catTotals.has(ckey)) {
            catTotals.set(ckey, { categoryId: cat.categoryId || null, name: cat.categoryName || 'Unknown', correct: 0, total: 0 });
          }
          const c = catTotals.get(ckey);
          c.total += 1;
          if (correct) c.correct += 1;
        }
      }
      const categoryResults = Array.from(catTotals.values()).map((c) => ({
        ...c,
        percentage: c.total > 0 ? Math.round((c.correct / c.total) * 1000) / 10 : 0,
      }));

      const record = {
        key: recordKey,
        payloadType: 'csv_import',
        payloadStatus: 'imported',
        student: {
          userId: userId || null,
          first: first || null,
          last: last || null,
          name,
          email,
          normalizedName: nName,
          normalizedEmail: nEmail,
        },
        test: { testId, testName: csvTestName },
        group: { groupId: groupId || null, groupName: groupName || csvLinkName || null },
        link: null,
        percentage: Number.isNaN(percentage) ? null : percentage,
        score: Number.isNaN(score) ? null : score,
        maxScore: Number.isNaN(maxScore) ? null : maxScore,
        passed: null,
        duration: r[cols.duration] || null,
        timeStarted,
        timeFinished,
        date: timeFinished ? new Date(timeFinished * 1000).toISOString().split('T')[0] : null,
        questions,
        categoryResults,
        raw: { importedFrom: 'classmarker-csv', importedAt: now },
        receivedAt: now,
      };

      if (!summary.sample) {
        summary.sample = {
          key: record.key, name, email, userId: userId || null,
          score, maxScore, date: record.date,
          rawCorrectFromQuestions: questions.filter((q) => q.correct).length,
          categoryResults,
        };
      }
      if (!dryRun) await db.upsertRecord(record);
    }

    res.json(summary);
  } catch (e) {
    console.error('[import] Failed:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
