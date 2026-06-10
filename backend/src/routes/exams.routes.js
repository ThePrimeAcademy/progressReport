// routes/exams.routes.js
// CRUD for admin-defined SAT exams plus the test picker feed.
// Curves for an exam are uploaded through the existing /api/scoring-sheets
// routes using groupId = `exam:<examId>`.
const express = require('express');
const exams = require('../services/exam.service');
const { listCurves, deleteCurve } = require('../services/scoring-sheet.service');
const { getKnownTests, getTakersForTests } = require('../services/classmarker.service');
const { getExamScoreboard, getExamTakenDates } = require('../services/sat.service');
const { getProgramRoster, getProgram } = require('../services/program.service');
const db = require('../services/db.service');

const router = express.Router();
router.use(express.json());

// GET /api/exams — all exams with their curve upload status merged in.
router.get('/', async (req, res, next) => {
  try {
    const curves = listCurves();
    // Derived from attempts — the day each exam was actually taken. The UI
    // defaults the exam's date to this when none was set by hand.
    const takenDates = await getExamTakenDates();
    const data = exams.listExams().map((exam) => ({
      ...exam,
      takenDate: takenDates[exam.examId] || null,
      curveKey: exams.examCurveKey(exam.examId),
      sheets: curves[exams.examCurveKey(exam.examId)] || {},
    }));
    // Until a program's exams have been dragged into a manual order
    // (program.examOrderCustom), show them chronologically: undated
    // placeholders first (newest creations, nothing to sort by yet), then by
    // exam date / derived taken date ascending. Members are re-slotted in
    // place so other programs' positions are untouched.
    const byProgram = new Map();
    for (const e of data) {
      if (!e.programId || getProgram(e.programId)?.examOrderCustom) continue;
      if (!byProgram.has(e.programId)) byProgram.set(e.programId, []);
      byProgram.get(e.programId).push(e);
    }
    const dateKey = (e) => String(e.date || e.takenDate || '');
    const slotted = new Map(); // programId → iterator over date-sorted members
    for (const [pid, members] of byProgram) {
      slotted.set(pid, members.slice().sort((a, b) => dateKey(a).localeCompare(dateKey(b))).values());
    }
    const ordered = data.map((e) => (
      e.programId && slotted.has(e.programId) ? slotted.get(e.programId).next().value : e
    ));
    res.json({ success: true, data: ordered });
  } catch (err) {
    next(err);
  }
});

// GET /api/exams/available-tests
// Distinct tests for the picker UI, merged from BOTH stores: the webhook
// store (fresh, per-question detail) and the cached ClassMarker results
// (covers tests whose attempts predate webhook capture or whose group links
// never had webhooks enabled). A test linked to several groups carries ALL
// of them so the group filter matches any. Marks tests already assigned to
// an exam so the UI can disable them.
router.get('/available-tests', async (req, res, next) => {
  try {
    const records = await db.getAllRecords();
    const assigned = exams.getTestSectionMap();
    const tests = new Map(); // testId → summary (groups: Map gid → {groupId, groupName, lastSeen})

    const entryFor = (id, testName) => {
      if (!tests.has(id)) {
        tests.set(id, { testId: id, testName, attempts: 0, lastReceivedAt: '', groups: new Map() });
      }
      return tests.get(id);
    };
    const addGroup = (t, groupId, groupName, seen) => {
      if (groupId == null) return;
      const gid = String(groupId);
      const g = t.groups.get(gid) || { groupId: gid, groupName: groupName || null, lastSeen: '' };
      // Groups get renamed in ClassMarker and webhook payloads are snapshots —
      // keep the name from the most recent sighting so the current name wins.
      if (seen >= g.lastSeen) {
        g.lastSeen = seen;
        if (groupName) g.groupName = groupName;
      } else if (groupName && !g.groupName) {
        g.groupName = groupName;
      }
      t.groups.set(gid, g);
    };

    for (const r of records) {
      const testId = r.test?.testId ?? r.test_id;
      if (testId == null) continue;
      const t = entryFor(String(testId), r.test?.testName ?? r.test_name ?? `Test #${testId}`);
      t.attempts++;
      const received = r.receivedAt || r.received_at || '';
      if (received > t.lastReceivedAt) t.lastReceivedAt = received;
      addGroup(t, r.group?.groupId ?? r.group_id, r.group?.groupName ?? r.group_name, received);
    }

    // Merge the ClassMarker API cache: tests (and group links) with no
    // webhook records only exist there. Its group map also carries each
    // group's CURRENT name — authoritative over stale webhook snapshots.
    const currentGroupNames = new Map(); // groupId → live name
    try {
      for (const known of await getKnownTests()) {
        const t = entryFor(known.testId, known.testName);
        t.attempts = Math.max(t.attempts, known.attempts);
        const finished = known.lastFinished ? new Date(known.lastFinished * 1000).toISOString() : '';
        if (finished > t.lastReceivedAt) t.lastReceivedAt = finished;
        for (const g of known.groups) {
          addGroup(t, g.groupId, g.groupName, g.lastFinished ? new Date(g.lastFinished * 1000).toISOString() : '');
          if (g.groupName) currentGroupNames.set(String(g.groupId), g.groupName);
        }
      }
    } catch (e) {
      // ClassMarker API unavailable — picker still works from webhook data.
      console.warn('[exams] Could not merge API-cache tests:', e.message);
    }

    const data = Array.from(tests.values())
      .map((t) => {
        const groups = Array.from(t.groups.values())
          .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
          .map(({ groupId, groupName }) => ({
            groupId,
            groupName: currentGroupNames.get(groupId) || groupName,
          }));
        return {
          testId: t.testId,
          testName: t.testName,
          attempts: t.attempts,
          lastReceivedAt: t.lastReceivedAt,
          groups,
          // Primary group (most recent attempt) — kept for display fallback.
          groupId: groups[0]?.groupId ?? null,
          groupName: groups[0]?.groupName ?? null,
          assignedTo: assigned.get(t.testId)?.examName || null,
          assignedToExamId: assigned.get(t.testId)?.examId || null,
        };
      })
      .sort((a, b) =>
        String(a.groupName || '').localeCompare(String(b.groupName || '')) ||
        String(a.testName).localeCompare(String(b.testName))
      );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/exams/:examId/takers
// Every student with at least one attempt on any of the exam's tests
// (webhook store + API cache), as { id, name } pairs. Feeds the per-exam
// hidden-students picker in the UI.
router.get('/:examId/takers', async (req, res, next) => {
  try {
    const exam = exams.getExam(req.params.examId);
    if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

    const testIds = new Set(
      Object.values(exam.sections || {}).filter(Boolean).map((s) => String(s.testId))
    );
    // Only enrolled students belong to the exam, so the hidden-students picker
    // lists only them — non-enrolled takers are already excluded everywhere.
    // ?all=1 skips that filter: the program roster's "pull takers" bulk-enroll
    // needs the takers who are by definition not enrolled yet.
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    const enrolled = !includeAll && exam.programId ? getProgramRoster(exam.programId) : null;
    const isEnrolled = (id) => enrolled === null || enrolled.has(id);
    const takers = new Map(); // id → name

    for (const r of await db.getAllRecords()) {
      const tid = String(r.test?.testId ?? r.test_id ?? '');
      if (!testIds.has(tid)) continue;
      const uid = r.student?.userId ?? r.user_id;
      if (uid == null) continue;
      const id = String(uid);
      if (!isEnrolled(id)) continue;
      if (!takers.has(id)) {
        takers.set(id, r.student?.name || r.name || r.student?.email || r.email || `User ${id}`);
      }
    }
    try {
      for (const [id, name] of await getTakersForTests(testIds)) {
        if (isEnrolled(id) && !takers.has(id)) takers.set(id, name);
      }
    } catch (e) {
      console.warn('[exams] API-cache takers unavailable:', e.message);
    }

    const data = Array.from(takers.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/exams/:examId/duplicate — new placeholder exam carrying over the
// source's name ("(copy)" suffix) and student roster. Sections stay empty (a
// test belongs to one exam) and the date/hidden list reset.
router.post('/:examId/duplicate', (req, res, next) => {
  try {
    res.json({ success: true, data: exams.duplicateExam(req.params.examId) });
  } catch (err) {
    next(err);
  }
});

// GET /api/exams/:examId/scoreboard
// Ranked results for one exam: every non-hidden student who took its tests,
// with raw + scaled section scores and total.
router.get('/:examId/scoreboard', async (req, res, next) => {
  try {
    const board = await getExamScoreboard(req.params.examId);
    if (!board) return res.status(404).json({ success: false, error: 'Exam not found' });
    res.json({ success: true, data: board });
  } catch (err) {
    next(err);
  }
});

// POST /api/exams/reorder — body: { programId, orderedIds: [examId, ...] }.
// Sets the display order of exams within a program (drag-to-reorder).
router.post('/reorder', (req, res, next) => {
  try {
    const { programId, orderedIds } = req.body || {};
    if (!programId) {
      return res.status(400).json({ success: false, error: 'programId is required' });
    }
    res.json({ success: true, data: exams.reorderExams(programId, orderedIds) });
  } catch (err) {
    next(err);
  }
});

// POST /api/exams — body: { name, date?, sections: { "1": { testId, testName } | null, ... },
// studentIds?, hiddenStudentIds? }. Sections may all be empty — placeholder
// exams get created in advance and have tests attached later.
router.post('/', (req, res, next) => {
  try {
    const { name, date, programId, sections, studentIds, hiddenStudentIds, isPractice } = req.body || {};
    res.json({ success: true, data: exams.createExam({ name, date, programId, sections, studentIds, hiddenStudentIds, isPractice }) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/exams/:examId — rename, re-date, re-map sections, set student
// rosters and/or flip the practice flag.
router.put('/:examId', (req, res, next) => {
  try {
    const { name, date, programId, sections, studentIds, hiddenStudentIds, isPractice } = req.body || {};
    res.json({ success: true, data: exams.updateExam(req.params.examId, { name, date, programId, sections, studentIds, hiddenStudentIds, isPractice }) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/exams/:examId — removes the exam and its uploaded curves.
router.delete('/:examId', (req, res, next) => {
  try {
    const { examId } = req.params;
    const removed = exams.deleteExam(examId);
    if (!removed) return res.status(404).json({ success: false, error: 'Exam not found' });
    for (const section of ['rw', 'math']) {
      try { deleteCurve(exams.examCurveKey(examId), section); } catch (_) { /* no curve uploaded */ }
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
