const crypto = require('crypto');
const db = require('./db.service');
const { getCategoryName, fetchCategoryMap, mergeWebhookResult } = require('./classmarker.service');
const { deriveTestSection, isSatGroupName } = require('./sat.service');
const { getTestSectionMap, getExam } = require('./exam.service');


// Pre-fetch category map on startup
fetchCategoryMap().catch(() => { });

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildRecordKey(payload) {
  if (payload.payload_type === 'single_user_test_results_link') {
    return `link:${payload.result?.link_result_id || 'unknown'}`;
  }
  const userId = payload.result?.user_id || 'unknown';
  const testId = payload.test?.test_id || 'unknown';
  const groupId = payload.group?.group_id || 'unknown';
  const timeStarted = payload.result?.time_started || 'unknown';
  return `group:${userId}:${testId}:${groupId}:${timeStarted}`;
}

function normalizePayload(payload) {
  const result = payload.result || {};
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const categoryResults = Array.isArray(payload.category_results) ? payload.category_results : [];

  return {
    key: buildRecordKey(payload),
    payloadType: payload.payload_type || null,
    payloadStatus: payload.payload_status || null,
    student: {
      userId: result.user_id != null ? String(result.user_id) : null,
      first: result.first || null,
      last: result.last || null,
      name: `${result.first || ''} ${result.last || ''}`.trim() || result.email || null,
      email: result.email || null,
      normalizedName: normalizeName(`${result.first || ''} ${result.last || ''}`.trim() || result.email || ''),
      normalizedEmail: normalizeEmail(result.email || ''),
    },
    test: { testId: payload.test?.test_id != null ? String(payload.test.test_id) : null, testName: payload.test?.test_name || null },
    group: payload.group ? { groupId: payload.group.group_id != null ? String(payload.group.group_id) : null, groupName: payload.group.group_name || null } : null,
    link: payload.link ? { linkId: payload.link.link_id != null ? String(payload.link.link_id) : null, linkName: payload.link.link_name || null } : null,
    percentage: result.percentage ?? null,
    score: result.points_scored ?? null,
    maxScore: result.points_available ?? null,
    passed: result.passed ?? null,
    duration: result.duration || null,
    timeStarted: result.time_started ?? null,
    timeFinished: result.time_finished ?? null,
    date: result.time_finished ? new Date(result.time_finished * 1000).toISOString().split('T')[0] : null,
    questions: questions.map((q, i) => ({
      questionId: q.question_id != null ? String(q.question_id) : `${i}`,
      questionType: q.question_type || null,
      categoryId: q.category_id != null ? String(q.category_id) : null,
      categoryName: q.category_name || q.category || getCategoryName(q.category_id) || null,
      sectionNumber: q.section_number ?? null,
      questionNumber: q.question_number ?? null,
      correct: q.result === 'correct' || q.result === 'partial_correct',
      result: q.result || null,
      pointsScored: q.points_scored ?? null,
      pointsAvailable: q.points_available ?? null,
    })),
    categoryResults: categoryResults.map((c) => {
      const scored = Number(c.points_scored ?? c.correct ?? 0);
      const available = Number(c.points_available ?? c.total ?? 0);
      return {
        categoryId: c.category_id != null ? String(c.category_id) : null,
        name: c.name || c.category_name || 'Unknown',
        correct: scored,
        total: available,
        percentage: c.percentage != null ? Number(c.percentage) : (available > 0 ? Math.round((scored / available) * 1000) / 10 : 0),
      };
    }),
    raw: payload,
    receivedAt: new Date().toISOString(),
  };
}

function verifySignature(rawBodyBuffer, headerSignature) {
  const secret = process.env.CLASSMARKER_WEBHOOK_SECRET;
  if (!secret) return { ok: true, skipped: true };
  if (!headerSignature) return { ok: false, reason: 'Missing X-Classmarker-Hmac-Sha256 header' };

  const expected = crypto.createHmac('sha256', secret).update(rawBodyBuffer).digest('base64');
  const provided = String(headerSignature).trim();
  const matches = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

  return matches ? { ok: true, skipped: false } : { ok: false, reason: 'Invalid webhook signature' };
}

async function upsertWebhookPayload(payload) {
  const record = normalizePayload(payload);
  await db.upsertRecord(record);
  // Keep the report UI fresh: splice the new result into the cached
  // ClassMarker results so a page refresh shows it immediately instead of
  // waiting out the 55-minute API cache TTL.
  mergeWebhookResult(payload);
  return record;
}

async function findMatchingRecords(student, startDate, endDate, dayOfWeek) {
  return db.findMatchingRecords(student, startDate, endDate, dayOfWeek);
}

// Narrow to records that belong to the LATEST single SAT exam attempt.
// Admin-defined exams (exam.service) are the preferred source: a record whose
// testId is assigned to an exam belongs to that exam, full stop. Records not
// covered by any exam fall back to the legacy convention:
//   1. SAT group (matches /sat/i)
//   2. Test name starts with "Section 1-4:" (real SAT exam section, not concept practice)
//   3. Same groupId as the latest such record, within a 24h window of its timeFinished
// Whichever side holds the most recent attempt wins. Returns [] if no
// qualifying records exist.
const SAT_SECTION_TEST_RE = /^\s*section\s*[1-4]\s*:/i;
const SAT_EXAM_WINDOW_SECONDS = 24 * 3600;

function selectLatestSatExamRecords(records) {
  const examMap = getTestSectionMap();
  const recordTestId = (r) => String(r.test?.testId ?? r.test_id ?? '');
  const isHiddenFromExam = (r) =>
    examMap.get(recordTestId(r))?.hidden?.has(String(r.student?.userId ?? r.user_id ?? ''));

  const examCandidates = records.filter((r) => examMap.has(recordTestId(r)) && !isHiddenFromExam(r));
  const legacyCandidates = records.filter((r) => {
    if (examMap.has(recordTestId(r))) return false;
    const gn = r.group?.groupName ?? r.group_name ?? null;
    const tn = r.test?.testName ?? r.test_name ?? '';
    return isSatGroupName(gn) && SAT_SECTION_TEST_RE.test(String(tn));
  });
  if (examCandidates.length === 0 && legacyCandidates.length === 0) return [];

  const newest = (arr) => arr.reduce(
    (m, r) => ((r.timeFinished || 0) > (m?.timeFinished || 0) ? r : m),
    null
  );
  const newestExam = newest(examCandidates);
  const newestLegacy = newest(legacyCandidates);

  if (newestExam && (!newestLegacy || (newestExam.timeFinished || 0) >= (newestLegacy.timeFinished || 0))) {
    const latestExamId = examMap.get(recordTestId(newestExam)).examId;
    const latestTs = newestExam.timeFinished || 0;
    // Same exam, within the window — and only the latest attempt per test so
    // retakes don't double count in category aggregation.
    const perTest = new Map();
    for (const r of examCandidates) {
      const mapped = examMap.get(recordTestId(r));
      const ts = r.timeFinished || 0;
      if (mapped.examId !== latestExamId || (latestTs - ts) > SAT_EXAM_WINDOW_SECONDS || ts > latestTs) continue;
      const prev = perTest.get(recordTestId(r));
      if (!prev || ts > (prev.timeFinished || 0)) perTest.set(recordTestId(r), r);
    }
    return Array.from(perTest.values());
  }

  const candidates = legacyCandidates;
  candidates.sort((a, b) => (b.timeFinished || 0) - (a.timeFinished || 0));
  const latest = candidates[0];
  const latestGroupId = String(latest.group?.groupId ?? latest.group_id ?? '');
  const latestTs = latest.timeFinished || 0;

  return candidates.filter((r) => {
    const gid = String(r.group?.groupId ?? r.group_id ?? '');
    const ts = r.timeFinished || 0;
    return gid === latestGroupId && (latestTs - ts) <= SAT_EXAM_WINDOW_SECONDS && ts <= latestTs;
  });
}

// When a test is re-categorized on ClassMarker, attempts taken BEFORE the
// change keep their original category ids/names forever (webhook payloads are
// snapshots). The live category map only fixes renames of the SAME category id
// — not questions moved to different categories. So for display, take each
// question's category from the most recently *taken* attempt anywhere in the
// store (any student). Keyed per test to avoid cross-test id collisions.
function computeLatestQuestionCategories(records) {
  const latest = new Map(); // `${testId}:${questionId}` → { takenAt, categoryId, categoryName }
  for (const record of records || []) {
    const takenAt = record.timeFinished || 0;
    const testId = record.test?.testId ?? record.test_id ?? '';
    for (const q of record.questions || []) {
      if (q.questionId == null || (q.categoryId == null && !q.categoryName)) continue;
      const key = `${testId}:${q.questionId}`;
      const prev = latest.get(key);
      if (!prev || takenAt >= prev.takenAt) {
        latest.set(key, { takenAt, categoryId: q.categoryId, categoryName: q.categoryName });
      }
    }
  }
  return latest;
}

async function getLatestQuestionCategories() {
  return computeLatestQuestionCategories(await db.getAllRecords());
}

// When a student has no SAT exam on file, Weekly Performance falls back to
// their assignments inside the report's date range (concept practice,
// quizzes…). Exam-mapped tests are excluded — they're exam attempts, not
// assignments, and if any counted the SAT selection would have used them.
async function assignmentFallbackRecords(student, startDate, endDate, dayOfWeek) {
  const examMap = getTestSectionMap();
  const records = await findMatchingRecords(student, startDate, endDate, dayOfWeek);
  return records.filter((r) => !examMap.has(String(r.test?.testId ?? r.test_id ?? '')));
}

async function getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek) {
  // Like the SAT score cards, the category breakdown reflects the student's
  // LATEST SAT exam — even when it falls outside the report's date range
  // (reports usually cover the past week; exams are often older).
  const allRecords = await findMatchingRecords(student, '1970-01-01', '2999-12-31', null);
  let records = selectLatestSatExamRecords(allRecords);
  if (records.length === 0) {
    records = await assignmentFallbackRecords(student, startDate, endDate, dayOfWeek);
  }
  // Resolve names from the live ClassMarker category map so renames are
  // reflected without requiring students to retake tests.
  await fetchCategoryMap();
  const resolveName = (id, stored) => {
    const current = id ? getCategoryName(id) : null;
    return current || stored || 'Unknown';
  };
  const categoryMap = {};
  for (const record of records) {
    for (const category of record.categoryResults || []) {
      const name = resolveName(category.categoryId, category.name);
      if (!categoryMap[name]) categoryMap[name] = { name, correct: 0, total: 0 };
      categoryMap[name].correct += Number(category.correct || 0);
      categoryMap[name].total += Number(category.total || 0);
    }
  }
  return Object.values(categoryMap)
    .filter((e) => e.total > 0)
    .map((e) => ({ ...e, percentage: Math.round((e.correct / e.total) * 1000) / 10 }))
    .sort((a, b) => b.percentage - a.percentage);
}

async function getWebhookCategoryPerformanceSplit(student, startDate, endDate, dayOfWeek) {
  // Wide window for the same reason as getWebhookCategoryPerformance: the
  // weekly report should always show the latest SAT exam's breakdown. With
  // no SAT exam on file, fall back to the report window's assignments.
  const allRecords = await findMatchingRecords(student, '1970-01-01', '2999-12-31', null);
  let records = selectLatestSatExamRecords(allRecords);
  if (records.length === 0) {
    records = await assignmentFallbackRecords(student, startDate, endDate, dayOfWeek);
  }
  // Resolve names from the live ClassMarker category map so renames are
  // reflected without requiring students to retake tests.
  await fetchCategoryMap();
  // Re-categorizations: prefer the category from the latest attempt of each
  // question (any student) over this student's possibly-stale snapshot.
  const latestCats = await getLatestQuestionCategories();
  const resolveName = (id, stored) => {
    const current = id ? getCategoryName(id) : null;
    return (current || stored || '').trim();
  };
  const enMap = {};
  const maMap = {};
  let hasSectionData = false;

  // Sections 1-2 → English, 3-4 → Math. An admin-defined exam assignment is
  // authoritative for its tests; otherwise derive once per record from the
  // test name / group name / per-question section. If the section can't be
  // determined, skip the record entirely rather than misclassifying English
  // categories as Math (which used to happen via a name-keyword fallback).
  const examMap = getTestSectionMap();
  for (const record of records) {
    const testName = record.test?.testName ?? record.test_name ?? null;
    const groupName = record.group?.groupName ?? record.group_name ?? null;
    const testId = record.test?.testId ?? record.test_id ?? '';
    const questions = record.questions || [];
    const examSection = examMap.get(String(testId))?.section ?? null;
    const recordSection = examSection ?? deriveTestSection(testName, groupName, questions);

    for (const q of questions) {
      const cur = latestCats.get(`${testId}:${q.questionId}`);
      const name = resolveName(cur?.categoryId ?? q.categoryId, cur?.categoryName ?? q.categoryName);
      if (!name || name === 'Unknown') continue;

const qSec = Number(q.sectionNumber);
      const section = examSection ?? ((qSec >= 1 && qSec <= 4) ? qSec : recordSection);
      if (!section) continue;

      hasSectionData = true;
      
      // DYNAMIC SECTION CHECK
      const mappedExamId = examMap.get(String(testId))?.examId;
      const examObj = mappedExamId ? getExam(mappedExamId) : null;
      const isTwoSection = examObj && !examObj.sections?.['3'] && !examObj.sections?.['4'];
      
      const isRw = isTwoSection ? (section === 1) : (section <= 2);
      const map = isRw ? enMap : maMap;
      
      if (!map[name]) map[name] = { name, correct: 0, total: 0 };
      map[name].total += 1;
      if (q.correct) map[name].correct += 1;}
  }

  const toArray = (map) =>
    Object.values(map)
      .filter((e) => e.total > 0)
      .map((e) => ({ ...e, percentage: Math.round((e.correct / e.total) * 1000) / 10 }))
      .sort((a, b) => b.percentage - a.percentage);

  return { english: toArray(enMap), math: toArray(maMap), hasSectionData };
}

async function getLatestWebhookTestResult(student, startDate, endDate, dayOfWeek) {
  const records = (await findMatchingRecords(student, startDate, endDate, dayOfWeek))
    .filter((r) => (r.questions || []).length > 0 || (r.categoryResults || []).length > 0)
    .sort((a, b) => b.timeFinished - a.timeFinished);

  const latest = records[0];
  if (!latest) return null;

  // Show current categories even if this student's attempt predates a
  // re-categorization — see computeLatestQuestionCategories.
  await fetchCategoryMap();
  const latestCats = await getLatestQuestionCategories();
  const testId = latest.test?.testId ?? latest.test_id ?? '';

  return {
    testName: latest.test?.testName || `Test #${latest.test?.testId}`,
    groupName: latest.group?.groupName || latest.link?.linkName || 'Webhook Result',
    score: latest.score,
    maxScore: latest.maxScore,
    percentage: latest.percentage,
    passed: latest.passed,
    duration: latest.duration,
    date: latest.date,
    categoryResults: latest.categoryResults,
    questions: (latest.questions || []).map((q) => {
      const cur = latestCats.get(`${testId}:${q.questionId}`);
      const categoryId = cur?.categoryId ?? q.categoryId;
      const categoryName = (categoryId ? getCategoryName(categoryId) : null)
        || cur?.categoryName || q.categoryName;
      return {
        section_number: q.sectionNumber,
        question_number: q.questionNumber,
        category_name: categoryName,
        correct: q.correct,
      };
    }),
  };
}

async function getWebhookStoreSummary() {
  return {
    totalResults: await db.getTotalResults(),
    updatedAt: await db.getLatestUpdatedAt(),
  };
}

module.exports = {
  computeLatestQuestionCategories,
  getLatestWebhookTestResult,
  getWebhookCategoryPerformance,
  getWebhookCategoryPerformanceSplit,
  getWebhookStoreSummary,
  upsertWebhookPayload,
  verifySignature,
};
