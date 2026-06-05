// services/classmarker.service.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_KEY = process.env.CLASSMARKER_API_KEY;
const API_SECRET = process.env.CLASSMARKER_API_SECRET;
const BASE_URL = 'https://api.classmarker.com/v1';

const CACHE_FILE = path.join(__dirname, '../../cache.json');
const CACHE_TTL = 55 * 60 * 1000;

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Date.now() - data.cacheTime < CACHE_TTL) {
        console.log('Loaded cache from file.');
        return data;
      }
    }
  } catch (e) {
    console.log('Cache file unreadable, will re-fetch.');
  }
  return null;
}

function saveCache(data) {
  try {
    // Keep the original cacheTime when present — webhook merges re-save the
    // cache but must not push back the 55-min API reconcile window.
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ cacheTime: Date.now(), ...data }));
    console.log('Cache saved to file.');
  } catch (e) {
    console.error('Failed to save cache:', e.message);
  }
}

let memCache = loadCache();

// Bumped whenever the cached results change (API refresh or webhook merge).
// Consumers (e.g. the report preview dedupe key) include it so derived caches
// invalidate as soon as new results exist.
let dataVersion = 0;
function getDataVersion() {
  return dataVersion;
}

// Category ID → name lookup map, shared with webhook.service
let categoryMap = {};
const CATEGORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let categoryFetchedAt = 0;

async function fetchCategoryMap() {
  if (Object.keys(categoryMap).length > 0 && Date.now() - categoryFetchedAt < CATEGORY_CACHE_TTL) {
    return categoryMap;
  }
  try {
    const url = `${BASE_URL}/categories.json?${authParams()}`;
    console.log("[categories] Fetching categories...");
    const res = await fetch(url);
    console.log("[categories] Status:", res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("[categories] Raw:", JSON.stringify(data).slice(0, 300));
    const newMap = {};
    const addCat = (c) => {
      if (c && c.category_id != null && c.category_name) {
        newMap[String(c.category_id)] = c.category_name;
      }
    };
    // Walk every shape ClassMarker may return:
    //   - { parent_categories: [{ category_id, category_name, categories: [...] }] }
    //   - { categories: [...] }                       (flat)
    //   - { data: { parent_categories: [...] } }      (envelope)
    //   - { data: { categories: [...] } }
    const parentCats = data.parent_categories || data.data?.parent_categories || [];
    for (const parent of parentCats) {
      addCat(parent); // include the parent category itself
      for (const cat of (parent.categories || [])) addCat(cat);
    }
    const flatCats = data.categories || data.data?.categories || [];
    for (const cat of flatCats) addCat(cat);

    categoryMap = newMap;
    categoryFetchedAt = Date.now();
    console.log(`[categories] Loaded ${Object.keys(categoryMap).length} categories`);
  } catch (e) {
    console.error("[categories] Failed:", e.message);
  }
  return categoryMap;
}

function getCategoryName(categoryId) {
  return categoryMap[String(categoryId)] || null;
}




function authParams() {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha256')
    .update(API_KEY + API_SECRET + timestamp)
    .digest('hex');
  return `api_key=${API_KEY}&signature=${signature}&timestamp=${timestamp}`;
}

async function fetchAllResults() {
  if (memCache && (Date.now() - memCache.cacheTime) < CACHE_TTL) {
    console.log('Using cached results.');
    return memCache;
  }

  const finishedAfterTimestamp = Math.floor(Date.now() / 1000) - (85 * 24 * 60 * 60);

  let allResults = [];
  const groupMap = {};
  const testMap = {};
  let currentTimestamp = finishedAfterTimestamp;
  let page = 0;

  while (true) {
    page++;
    console.log(`Fetching page ${page}…`);

    const res = await fetch(
      `${BASE_URL}/groups/recent_results.json?${authParams()}&finishedAfterTimestamp=${currentTimestamp}&limit=200`
    );
    if (!res.ok) throw new Error(`ClassMarker HTTP error: ${res.status}`);
    const data = await res.json();

    if (data.status === 'error') throw new Error(`ClassMarker: ${data.error.error_message}`);
    if (data.status === 'no_results' || !data.results) break;

    // Log first result in full on first page to see all available fields
    if (page === 1 && data.results.length > 0) {
      console.log('SAMPLE RESULT FIELDS:', JSON.stringify(data.results[0], null, 2));
    }

    for (const g of (data.groups || [])) {
      const grp = g.group || g;
      if (grp.group_id) groupMap[String(grp.group_id)] = grp.group_name;
    }
    for (const t of (data.tests || [])) {
      const tst = t.test || t;
      if (tst.test_id) testMap[String(tst.test_id)] = tst.test_name;
    }

    allResults = allResults.concat(data.results.map((r) => r.result || r));

    if (!data.more_results_exist || !data.next_finished_after_timestamp) break;
    // Safety cap only. Pagination walks forward in time from 85 days ago, so
    // stopping early silently drops the NEWEST results once the account has
    // more than pageLimit×200 results in the window (the old cap of 3 pages /
    // 600 results did exactly that once the summer program ramped up).
    if (page >= 30) {
      console.warn(`[classmarker] Page cap hit at ${page} pages — newest results may be missing`);
      break;
    }

    currentTimestamp = data.next_finished_after_timestamp;
  }

  console.log(`Fetched ${allResults.length} results | ${Object.keys(groupMap).length} groups | ${Object.keys(testMap).length} tests`);

  memCache = { results: allResults, groupMap, testMap, cacheTime: Date.now() };
  dataVersion++;
  saveCache(memCache);

  return memCache;
}

// Splice a just-received webhook result into the cached ClassMarker results so
// the UI reflects new attempts immediately instead of waiting out the 55-min
// cache TTL (webhooks arrive seconds after a test finishes). The next interval
// refresh still reconciles against the API as the source of truth.
function mergeWebhookResult(payload) {
  const result = payload?.result;
  const testId = payload?.test?.test_id;
  const groupId = payload?.group?.group_id;
  // No cache yet (cold start, initial fetch in flight) or a link-type payload
  // without group context — skip; the API fetch will pick the result up.
  if (!memCache || !result || result.user_id == null || testId == null || groupId == null) {
    return false;
  }

  const row = {
    user_id: result.user_id,
    first: result.first || '',
    last: result.last || '',
    email: result.email || null,
    test_id: testId,
    group_id: groupId,
    points_scored: result.points_scored ?? null,
    points_available: result.points_available ?? null,
    percentage: result.percentage ?? null,
    passed: result.passed ?? null,
    duration: result.duration || null,
    time_started: result.time_started ?? null,
    time_finished: result.time_finished ?? null,
    category_results: Array.isArray(payload.category_results)
      ? payload.category_results.map((c) => ({
          category_id: c.category_id ?? null,
          category_name: c.category_name || c.name || null,
          correct: Number(c.points_scored ?? c.correct ?? 0),
          total: Number(c.points_available ?? c.total ?? 0),
        }))
      : null,
    questions: Array.isArray(payload.questions) ? payload.questions : null,
  };

  const rowKey = (r) => `${r.user_id}:${r.test_id}:${r.group_id}:${r.time_finished}`;
  const idx = memCache.results.findIndex((r) => rowKey(r) === rowKey(row));
  if (idx >= 0) memCache.results[idx] = row;
  else memCache.results.push(row);

  if (payload.group?.group_name) memCache.groupMap[String(groupId)] = payload.group.group_name;
  if (payload.test?.test_name) memCache.testMap[String(testId)] = payload.test.test_name;

  dataVersion++;
  saveCache(memCache);
  console.log(`[webhook→cache] Merged result for user ${row.user_id} (${memCache.results.length} cached results)`);
  return true;
}

async function getAllStudents() {
  const { results } = await fetchAllResults();

  const seen = new Map();
  for (const r of results) {
    const id = String(r.user_id);
    if (!seen.has(id)) {
      const fullName = `${r.first || ''} ${r.last || ''}`.trim() || r.email || `User ${id}`;
      seen.set(id, { id, name: fullName, email: r.email });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function getStudentById(studentId) {
  const students = await getAllStudents();
  const student = students.find((s) => s.id === studentId);
  if (!student) {
    const err = new Error(`Student "${studentId}" not found`);
    err.status = 404;
    throw err;
  }
  return student;
}

// Helper — apply day-of-week filter if provided (0=Sun,1=Mon,...,5=Fri,6=Sat)
function filterByDay(results, dayOfWeek) {
  // dayOfWeek is now an array of day strings e.g. ['1','5']
  // empty array or undefined means no filter
  if (!dayOfWeek || dayOfWeek.length === 0) return results;
  const days = Array.isArray(dayOfWeek) ? dayOfWeek.map(Number) : [Number(dayOfWeek)];
  return results.filter((r) => days.includes(new Date(r.time_finished * 1000).getDay()));
}

async function getStudentResults(studentId, startDate, endDate, dayOfWeek) {
  const { results, groupMap, testMap } = await fetchAllResults();

  const startTs = Math.floor(new Date(startDate).getTime() / 1000);
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399; // include the entire end day

  let filtered = results.filter((r) =>
    String(r.user_id) === studentId &&
    r.time_finished >= startTs &&
    r.time_finished <= endTs
  );

  filtered = filterByDay(filtered, dayOfWeek);

  return filtered.map((r) => ({
    testName: testMap[String(r.test_id)] || `Test #${r.test_id}`,
    groupName: groupMap[String(r.group_id)] || `Group #${r.group_id}`,
    groupId: String(r.group_id),
    score: r.points_scored,
    maxScore: r.points_available,
    percentage: r.percentage,
    passed: r.passed,
    duration: r.duration,
    date: new Date(r.time_finished * 1000).toISOString().split('T')[0],
    timeFinished: r.time_finished,
    categoryResults: r.category_results || null,
    questions: r.questions || null,
  }));
}

async function getStudentResultsGrouped(studentId, startDate, endDate, dayOfWeek) {
  const { results, groupMap, testMap } = await fetchAllResults();

  const startTs = Math.floor(new Date(startDate).getTime() / 1000);
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399; // include the entire end day

  let filtered = results.filter((r) =>
    String(r.user_id) === studentId &&
    r.time_finished >= startTs &&
    r.time_finished <= endTs
  );

  filtered = filterByDay(filtered, dayOfWeek);

  // Sort by time so "latest" is deterministic
  filtered.sort((a, b) => a.time_finished - b.time_finished);

  const grouped = {};
  for (const r of filtered) {
    const gid = String(r.group_id);
    const groupName = groupMap[gid] || `Group #${gid}`;
    const testName = testMap[String(r.test_id)] || `Test #${r.test_id}`;

    if (!grouped[gid]) grouped[gid] = { groupId: gid, groupName, results: [] };

    grouped[gid].results.push({
      testName,
      testId: String(r.test_id),
      score: r.points_scored,
      maxScore: r.points_available,
      percentage: r.percentage,
      passed: r.passed,
      duration: r.duration,
      date: new Date(r.time_finished * 1000).toISOString().split('T')[0],
      timeFinished: r.time_finished,
      categoryResults: r.category_results || null,
      questions: r.questions || null,
    });
  }

  for (const g of Object.values(grouped)) {
    g.results.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return Object.values(grouped).sort((a, b) => a.groupName.localeCompare(b.groupName));
}

// Returns the most recent test result with full question/category data
async function getLatestTestResult(studentId, startDate, endDate, dayOfWeek) {
  const { results, groupMap, testMap } = await fetchAllResults();

  const startTs = Math.floor(new Date(startDate).getTime() / 1000);
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399; // include the entire end day

  let filtered = results.filter((r) =>
    String(r.user_id) === studentId &&
    r.time_finished >= startTs &&
    r.time_finished <= endTs
  );

  filtered = filterByDay(filtered, dayOfWeek);

  if (filtered.length === 0) return null;

  // Most recent
  const latest = filtered.reduce((a, b) => a.time_finished > b.time_finished ? a : b);

  console.log('Latest test raw:', JSON.stringify(latest, null, 2));

  return {
    testName: testMap[String(latest.test_id)] || `Test #${latest.test_id}`,
    groupName: groupMap[String(latest.group_id)] || `Group #${latest.group_id}`,
    score: latest.points_scored,
    maxScore: latest.points_available,
    percentage: latest.percentage,
    passed: latest.passed,
    duration: latest.duration,
    date: new Date(latest.time_finished * 1000).toISOString().split('T')[0],
    categoryResults: latest.category_results || null,
    questions: latest.questions || null,
  };
}

// Returns category performance aggregated across all results in range
function computeCategoryPerformance(groups) {
  const catMap = {}; // categoryName -> { correct, total, subject }

  for (const g of groups) {
    for (const r of g.results) {
      if (!r.categoryResults) continue;
      for (const cat of r.categoryResults) {
        const name = cat.category_name || cat.name || 'Unknown';
        if (!catMap[name]) catMap[name] = { name, correct: 0, total: 0 };
        catMap[name].correct += cat.correct || 0;
        catMap[name].total += cat.total || 0;
      }
    }
  }

  return Object.values(catMap)
    .filter((c) => c.total > 0)
    .map((c) => ({ ...c, percentage: Math.round((c.correct / c.total) * 100) }))
    .sort((a, b) => b.percentage - a.percentage);
}

function clearCache() {
  memCache = null;
  try {
    const fs = require('fs');
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch (e) {
    console.warn('Could not delete cache file:', e.message);
  }
  // Also flush the in-memory category map so renamed categories show up on
  // the next fetch instead of waiting for the 1h TTL.
  categoryMap = {};
  categoryFetchedAt = 0;
  console.log('Cache cleared (results + category map).');
}

// Distinct tests from the cached ClassMarker results. Complements the webhook
// store in the exam-builder picker: tests whose attempts all predate webhook
// capture (or whose webhooks were never configured) only exist here. A test
// can be linked to several groups, so each entry carries ALL groups it was
// attempted under.
async function getKnownTests() {
  const { results, groupMap, testMap } = await fetchAllResults();
  const tests = new Map();
  for (const r of results) {
    if (r.test_id == null) continue;
    const id = String(r.test_id);
    if (!tests.has(id)) {
      tests.set(id, {
        testId: id,
        testName: testMap[id] || `Test #${id}`,
        attempts: 0,
        lastFinished: 0,
        groups: new Map(), // groupId → { groupId, groupName, lastFinished }
      });
    }
    const t = tests.get(id);
    t.attempts++;
    if ((r.time_finished || 0) > t.lastFinished) t.lastFinished = r.time_finished || 0;
    if (r.group_id != null) {
      const gid = String(r.group_id);
      const g = t.groups.get(gid) || { groupId: gid, groupName: groupMap[gid] || null, lastFinished: 0 };
      if ((r.time_finished || 0) > g.lastFinished) g.lastFinished = r.time_finished || 0;
      t.groups.set(gid, g);
    }
  }
  return Array.from(tests.values()).map((t) => ({ ...t, groups: Array.from(t.groups.values()) }));
}

// Per-attempt rows from the cached API results for the given testIds —
// used to fill scoreboard gaps where attempts never produced a webhook.
async function getResultsForTests(testIdSet) {
  const { results } = await fetchAllResults();
  return results
    .filter((r) => r.test_id != null && testIdSet.has(String(r.test_id)) && r.user_id != null)
    .map((r) => ({
      userId: String(r.user_id),
      name: `${r.first || ''} ${r.last || ''}`.trim() || r.email || `User ${r.user_id}`,
      testId: String(r.test_id),
      correct: Number(r.points_scored) || 0,
      timeFinished: r.time_finished || 0,
    }));
}

// Map of user_id (string) → display name for everyone with at least one
// cached API result on any of the given testIds. Complements the webhook
// store for exam-taker lookups.
async function getTakersForTests(testIdSet) {
  const { results } = await fetchAllResults();
  const takers = new Map();
  for (const r of results) {
    if (r.test_id == null || !testIdSet.has(String(r.test_id)) || r.user_id == null) continue;
    const id = String(r.user_id);
    if (!takers.has(id)) {
      takers.set(id, `${r.first || ''} ${r.last || ''}`.trim() || r.email || `User ${id}`);
    }
  }
  return takers;
}

// Set of ClassMarker user_ids that have at least one finished test inside
// the given date range (+ optional day-of-week filter). Reads from the
// already-cached fetchAllResults, so this is purely an in-memory scan and
// never hits the ClassMarker API.
async function getActiveStudentIds(startDate, endDate, dayOfWeek) {
  const { results } = await fetchAllResults();
  const startTs = Math.floor(new Date(startDate).getTime() / 1000);
  const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399;
  let days = null;
  if (dayOfWeek != null) {
    const arr = Array.isArray(dayOfWeek) ? dayOfWeek : [dayOfWeek];
    const nums = arr.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length > 0) days = nums;
  }
  const active = new Set();
  for (const r of results) {
    if (!r.time_finished || r.time_finished < startTs || r.time_finished > endTs) continue;
    if (days && !days.includes(new Date(r.time_finished * 1000).getDay())) continue;
    active.add(String(r.user_id));
  }
  return Array.from(active);
}

module.exports = {
  getAllStudents,
  getStudentById,
  getStudentResults,
  getStudentResultsGrouped,
  getLatestTestResult,
  getActiveStudentIds,
  computeCategoryPerformance,
  clearCache,
  fetchCategoryMap,
  getCategoryName,
  getKnownTests,
  getTakersForTests,
  getResultsForTests,
  mergeWebhookResult,
  getDataVersion,
};

// Pre-warm cache on startup
fetchAllResults().catch((err) => console.error('Initial fetch failed:', err));
setInterval(() => {
  memCache = null;
  fetchAllResults().catch((err) => console.error('Refresh failed:', err));
}, 55 * 60 * 1000);