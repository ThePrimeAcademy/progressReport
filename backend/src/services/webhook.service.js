const crypto = require('crypto');
const db = require('./db.service');
const { getCategoryName, fetchCategoryMap } = require('./classmarker.service');
const { deriveTestSection } = require('./sat.service');

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
  return record;
}

async function findMatchingRecords(student, startDate, endDate, dayOfWeek) {
  return db.findMatchingRecords(student, startDate, endDate, dayOfWeek);
}

async function getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek) {
  const records = await findMatchingRecords(student, startDate, endDate, dayOfWeek);
  const categoryMap = {};
  for (const record of records) {
    for (const category of record.categoryResults || []) {
      const name = category.name || 'Unknown';
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
  const records = await findMatchingRecords(student, startDate, endDate, dayOfWeek);
  const enMap = {};
  const maMap = {};
  let hasSectionData = false;

  // Sections 1-2 → English, 3-4 → Math. Derive once per record from the test
  // name / group name / per-question section. If the section can't be derived,
  // skip the record entirely rather than misclassifying English categories as
  // Math (which used to happen via a name-keyword fallback).
  for (const record of records) {
    const testName = record.test?.testName ?? record.test_name ?? null;
    const groupName = record.group?.groupName ?? record.group_name ?? null;
    const questions = record.questions || [];
    const recordSection = deriveTestSection(testName, groupName, questions);

    for (const q of questions) {
      const name = (q.categoryName || '').trim();
      if (!name || name === 'Unknown') continue;

      const qSec = Number(q.sectionNumber);
      const section = (qSec >= 1 && qSec <= 4) ? qSec : recordSection;
      if (!section) continue;

      hasSectionData = true;
      const map = section <= 2 ? enMap : maMap;
      if (!map[name]) map[name] = { name, correct: 0, total: 0 };
      map[name].total += 1;
      if (q.correct) map[name].correct += 1;
    }
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
    questions: (latest.questions || []).map((q) => ({
      section_number: q.sectionNumber,
      question_number: q.questionNumber,
      category_name: q.categoryName,
      correct: q.correct,
    })),
  };
}

async function getWebhookStoreSummary() {
  return {
    totalResults: await db.getTotalResults(),
    updatedAt: await db.getLatestUpdatedAt(),
  };
}

module.exports = {
  getLatestWebhookTestResult,
  getWebhookCategoryPerformance,
  getWebhookCategoryPerformanceSplit,
  getWebhookStoreSummary,
  upsertWebhookPayload,
  verifySignature,
};