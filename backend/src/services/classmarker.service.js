// services/classmarker.service.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_KEY = process.env.CLASSMARKER_API_KEY;
const API_SECRET = process.env.CLASSMARKER_API_SECRET;
const BASE_URL = 'https://api.classmarker.com/v1';

// ClassMarker allows only 30 API requests per HOUR, so every request counts:
//   - the cache persists on the DATA_DIR volume and survives redeploys
//   - a stale cache refreshes INCREMENTALLY (finishedAfter newest cached
//     result — normally a single request) instead of re-pulling 85 days
//   - concurrent callers share one in-flight fetch
//   - a failed refresh serves the stale cache and backs off instead of
//     leaving the app dataless and hammering the API
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'classmarker-cache.json');
const LEGACY_CACHE_FILE = path.join(__dirname, '../../cache.json');
const CACHE_TTL = 55 * 60 * 1000;
const FETCH_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 85;
const INCREMENTAL_OVERLAP_SECONDS = 24 * 3600; 
const PAGE_CAP = 30;

function loadCache() {
  // Any age is acceptable — stale data beats no data, and the incremental
  // refresh catches up cheaply on the first fetchAllResults call.
  for (const file of [CACHE_FILE, LEGACY_CACHE_FILE]) {
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (Array.isArray(data.results)) {
          console.log(`Loaded cache from ${path.basename(file)} (${data.results.length} results).`);
          return data;
        }
      }
    } catch (e) {
      console.log(`Cache file ${path.basename(file)} unreadable, skipping.`);
    }
  }
  return null;
}

function saveCache(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

async function fetchResultsPage(finishedAfterTimestamp) {
  const res = await fetch(
    `${BASE_URL}/groups/recent_results.json?${authParams()}&finishedAfterTimestamp=${finishedAfterTimestamp}&limit=200`
  );
  if (!res.ok) throw new Error(`ClassMarker HTTP error: ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`ClassMarker: ${data.error.error_message}`);
  return data;
}

const resultKey = (r) =>
  r.pk_id != null ? `pk:${r.pk_id}` : `${r.user_id}:${r.test_id}:${r.time_finished}`;

// Paginate from `fromTimestamp` forward, upserting into the provided
// containers. Returns the number of pages fetched.
async function paginateResults(fromTimestamp, byKey, groupMap, testMap) {
  let currentTimestamp = fromTimestamp;
  let page = 0;
  while (true) {
    page++;
    console.log(`Fetching page ${page}…`);
    const data = await fetchResultsPage(currentTimestamp);
    if (data.status === 'no_results' || !data.results) break;

    for (const g of (data.groups || [])) {
      const grp = g.group || g;
      if (grp.group_id) groupMap[String(grp.group_id)] = grp.group_name;
    }
    for (const t of (data.tests || [])) {
      const tst = t.test || t;
      if (tst.test_id) testMap[String(tst.test_id)] = tst.test_name;
    }
    for (const raw of data.results) {
      const r = raw.result || raw;
      byKey.set(resultKey(r), r);
    }

    if (!data.more_results_exist || !data.next_finished_after_timestamp) break;
    // Safety cap only — pagination walks forward in time, so stopping early
    // would silently drop the NEWEST results.
    if (page >= PAGE_CAP) {
      console.warn(`[classmarker] Page cap hit at ${page} pages — newest results may be missing`);
      break;
    }
    currentTimestamp = data.next_finished_after_timestamp;
  }
  return page;
}

let inflightFetch = null;

async function fetchAllResults() {
  if (memCache && (Date.now() - memCache.cacheTime) < CACHE_TTL) {
    return memCache;
  }
  // One fetch at a time — concurrent cold callers used to each fire their own
  // full pagination, burning through the 30 req/hour budget in one page load.
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const windowStart = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 3600;
    try {
      const byKey = new Map();
      const groupMap = { ...(memCache?.groupMap || {}) };
      const testMap = { ...(memCache?.testMap || {}) };
      let from = windowStart;

      if (memCache) {
        // Incremental: only pull results newer than the cache (small overlap
        // for clock skew / late arrivals). Usually a single request.
        for (const r of memCache.results) byKey.set(resultKey(r), r);
        const newest = memCache.results.reduce((m, r) => Math.max(m, r.time_finished || 0), 0);
        if (newest > 0) from = Math.max(newest - INCREMENTAL_OVERLAP_SECONDS, windowStart);
      }

      const pages = await paginateResults(from, byKey, groupMap, testMap);
      const results = Array.from(byKey.values())
        .filter((r) => (r.time_finished || 0) >= windowStart);
      console.log(`[classmarker] ${memCache ? 'Incremental' : 'Full'} refresh: ${pages} page(s), ${results.length} results in window`);

      memCache = { results, groupMap, testMap, cacheTime: Date.now() };
      dataVersion++;
      saveCache(memCache);
      return memCache;
    } catch (e) {
      if (memCache) {
        // Serve stale data and back off — a rate-limited refresh must never
        // leave the app dataless or retry on every request.
        console.error('[classmarker] Refresh failed — serving stale cache:', e.message);
        memCache.cacheTime = Date.now() - CACHE_TTL + FETCH_FAILURE_BACKOFF_MS;
        return memCache;
      }
      throw e;
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
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

function isPlaceholderStudentName(name, id) {
  if (!name) return true;
  return String(name) === `User ${id}` || String(name) === `User ${String(id)}`;
}

async function getAllStudents() {
  const { results } = await fetchAllResults();

  const seen = new Map();
  for (const r of results) {
    const id = String(r.user_id);
    const fullName = `${r.first || ''} ${r.last || ''}`.trim() || r.email || `User ${id}`;
    const email = r.email || null;
    const prev = seen.get(id);
    if (!prev) {
      seen.set(id, { id, name: fullName, email });
      continue;
    }
    // Prefer a real name/email when a later attempt has better metadata.
    const name = !isPlaceholderStudentName(fullName, id)
      ? fullName
      : prev.name;
    seen.set(id, { id, name, email: prev.email || email });
  }

  // Webhook store often has first/last when the recent-results API cache only
  // has a bare user_id — merge so program rosters / bulk send show real names.
  try {
    const db = require('./db.service');
    const records = await db.getAllRecords();
    for (const r of records) {
      const id = String(r.student?.userId ?? r.user_id ?? '');
      if (!id) continue;
      const webhookName = String(r.student?.name || r.name || '').trim();
      const webhookEmail = r.student?.email || r.email || null;
      const prev = seen.get(id);
      if (!prev) {
        seen.set(id, {
          id,
          name: webhookName || webhookEmail || `User ${id}`,
          email: webhookEmail,
        });
        continue;
      }
      const name = webhookName && isPlaceholderStudentName(prev.name, id)
        ? webhookName
        : prev.name;
      seen.set(id, { id, name, email: prev.email || webhookEmail });
    }
  } catch (e) {
    // DB may not be ready on a cold path — API-cache names are still usable.
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

// Soft invalidate: next fetchAllResults does an incremental API pull but
// keeps the disk/memory results as a base (and as a fallback if rate-limited).
function invalidateCache() {
  if (memCache) {
    memCache.cacheTime = 0;
    console.log('[classmarker] Cache marked stale (incremental refresh on next fetch).');
  } else {
    console.log('[classmarker] No in-memory cache to invalidate — next fetch will load disk/full.');
  }
  // Categories are cheap (1 request) and rarely change — leave their TTL alone
  // so a soft refresh doesn't always spend an extra API call.
}

// Hard wipe: deletes memory + disk. Full 85-day re-pull on next fetch. Can
// exhaust ClassMarker's 30 req/hour budget alone — avoid on every boot.
function clearCache() {
  memCache = null;
  try {
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
// `groupName` (optional) keeps only attempts made under that ClassMarker
// group — the same test can be linked to several groups, and bulk-enroll
// must not pull takers from a different cohort's link.
async function getTakersForTests(testIdSet, groupName) {
  const { results, groupMap } = await fetchAllResults();
  const takers = new Map();
  for (const r of results) {
    if (r.test_id == null || !testIdSet.has(String(r.test_id)) || r.user_id == null) continue;
    if (groupName && (groupMap[String(r.group_id)] || `Group #${r.group_id}`) !== groupName) continue;
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
// One-off gap repair: fetch results from `fromTs` forward and merge into the
// cache without dropping anything already there. Single disk save at the end.
async function backfillFromApi(fromTs, maxPages = 25) {
  const byKey = new Map();
  const groupMap = { ...(memCache?.groupMap || {}) };
  const testMap = { ...(memCache?.testMap || {}) };
  for (const r of (memCache?.results || [])) byKey.set(resultKey(r), r);
  const before = byKey.size;
  let currentTimestamp = fromTs;
  let page = 0;
  let moreRemaining = false;
  while (true) {
    page++;
    const data = await fetchResultsPage(currentTimestamp);
    if (data.status === 'no_results' || !data.results) break;
    for (const g of (data.groups || [])) {
      const grp = g.group || g;
      if (grp.group_id) groupMap[String(grp.group_id)] = grp.group_name;
    }
    for (const t of (data.tests || [])) {
      const tst = t.test || t;
      if (tst.test_id) testMap[String(tst.test_id)] = tst.test_name;
    }
    for (const raw of data.results) {
      const r = raw.result || raw;
      const k = resultKey(r);
      if (!byKey.has(k)) byKey.set(k, r);
    }
    if (!data.more_results_exist || !data.next_finished_after_timestamp) break;
    if (page >= maxPages) { moreRemaining = true; break; }
    currentTimestamp = data.next_finished_after_timestamp;
  }
  const windowStart = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 3600;
  const results = Array.from(byKey.values()).filter((r) => (r.time_finished || 0) >= windowStart);
  memCache = { results, groupMap, testMap, cacheTime: memCache?.cacheTime || Date.now() };
  dataVersion++;
  saveCache(memCache);
  return { pagesFetched: page, cachedBefore: before, cachedNow: results.length, moreRemaining, nextTimestamp: currentTimestamp };
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
  invalidateCache,
  fetchCategoryMap,
  getCategoryName,
  getKnownTests,
  getTakersForTests,
  getResultsForTests,
  mergeWebhookResult,
  getDataVersion,
  backfillFromApi
};

// Pre-warm cache on startup
fetchAllResults().catch((err) => console.error('Initial fetch failed:', err.message));
setInterval(() => {
  // Mark stale (don't discard!) so the next fetch refreshes incrementally —
  // and a failed refresh still has the old data to serve.
  if (memCache) memCache.cacheTime = 0;
  fetchAllResults().catch((err) => console.error('Refresh failed:', err.message));
}, 55 * 60 * 1000);
