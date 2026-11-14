// services/classmarker.service.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const API_KEY = process.env.CLASSMARKER_API_KEY;
const API_SECRET = process.env.CLASSMARKER_API_SECRET;
const BASE_URL = 'https://api.classmarker.com/v1';

// ClassMarker allows only 30 API requests per HOUR, so every request counts:
//   - the cache persists on the DATA_DIR volume and survives redeploys
//   - a stale cache refreshes INCREMENTALLY (finishedAfter newest cached
//     result — normally a single request) instead of re-pulling 85 days
//   - concurrent callers share one in-flight fetch
//   - readers never wait on a refresh: a stale cache is served while the
//     refresh runs in the background (only a cold start with nothing cached
//     waits), so page loads cost no requests at all
//   - a failed refresh serves the stale cache and backs off instead of
//     leaving the app dataless and hammering the API
//   - a manual Refresh soon after the last sync is answered from the cache:
//     webhooks already deliver new results within seconds
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
// Gzipped since 2026-08: the plain-JSON cache had grown to 66MB on a 500MB
// volume shared with the SQLite store (whose flush needs 1x-DB-size headroom).
// Gzip keeps it under ~10MB. Reads still accept the old plain-JSON names.
const CACHE_GZ_FILE = path.join(DATA_DIR, 'classmarker-cache.json.gz');
const CACHE_FILE = path.join(DATA_DIR, 'classmarker-cache.json');
const LEGACY_CACHE_FILE = path.join(__dirname, '../../cache.json');
const CACHE_TTL = 55 * 60 * 1000;
const FETCH_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 85;
const INCREMENTAL_OVERLAP_SECONDS = 24 * 3600;
// Max result pages fetched per refresh run, out of ClassMarker's 30 req/hour —
// the rest is headroom for the category fetch and manual probes. A run that
// exhausts the budget is NOT done: the persisted cursors resume the walk on
// the next refresh, so a full 85-day backfill completes over several hourly
// windows instead of silently dropping whatever lies past one run's reach.
const PER_RUN_PAGE_BUDGET = 25;

function loadCache() {
  // Any age is acceptable — stale data beats no data, and the incremental
  // refresh catches up cheaply on the first fetchAllResults call.
  for (const file of [CACHE_GZ_FILE, CACHE_FILE, LEGACY_CACHE_FILE]) {
    try {
      if (fs.existsSync(file)) {
        let buf = fs.readFileSync(file);
        // Sniff the gzip magic bytes rather than trusting the extension.
        if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        const data = JSON.parse(buf.toString('utf-8'));
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
    // Gzip level 1: webhook merges save on every result, so favor speed —
    // still ~5x smaller than plain JSON. tmp+rename so a crash mid-write
    // can't leave a truncated cache (which would cost a full 85-day re-pull).
    const json = JSON.stringify({ cacheTime: Date.now(), ...data });
    const tmp = CACHE_GZ_FILE + '.tmp';
    fs.writeFileSync(tmp, zlib.gzipSync(json, { level: 1 }));
    fs.renameSync(tmp, CACHE_GZ_FILE);
    // Reclaim the pre-gzip plain-JSON copy once a gzipped one exists.
    fs.rmSync(CACHE_FILE, { force: true });
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

// Read-only view of the current in-memory cache for consumers that only need
// "what the server already knows" (e.g. import matching) - saves them from
// re-reading and re-parsing the cache file on every request.
function getCacheSnapshot() {
  if (memCache && Array.isArray(memCache.results)) return memCache;
  return { results: [], groupMap: {}, testMap: {} };
}

// Category ID → name lookup map, shared with webhook.service
let categoryMap = {};
const CATEGORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let categoryFetchedAt = 0;
let categoryFailedAt = 0;
let categoryInflight = null;

// Without credentials there is nothing to fetch with - a request would go out
// signed with "undefined" and fail. That is the normal state of a local
// development copy: it runs entirely from the webhook store and whatever
// cache is on disk. Production always has both variables set.
const API_CONFIGURED = Boolean(API_KEY && API_SECRET);
if (!API_CONFIGURED) {
  console.warn('[classmarker] CLASSMARKER_API_KEY / CLASSMARKER_API_SECRET not set - running offline from stored data only.');
}

// Every request sent to ClassMarker in the last hour, oldest first, so the
// app can show how much of the hourly budget is in use.
const HOURLY_REQUEST_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;
const requestLog = [];
function noteApiRequest() {
  requestLog.push(Date.now());
}
function requestsLastHour() {
  const cutoff = Date.now() - HOUR_MS;
  while (requestLog.length > 0 && requestLog[0] <= cutoff) requestLog.shift();
  return requestLog.length;
}

// Category names change rarely, so callers are served the map they already
// have while a stale one refreshes in the background, concurrent callers share
// one request (boot used to send two), and a failed fetch waits out a backoff
// instead of being retried by every webhook and report in the meantime. Only
// an empty map (first use, or after a hard reset) is waited for.
function fetchCategoryMap() {
  if (!API_CONFIGURED) return Promise.resolve(categoryMap);
  const now = Date.now();
  const have = Object.keys(categoryMap).length > 0;
  if (have && now - categoryFetchedAt < CATEGORY_CACHE_TTL) return Promise.resolve(categoryMap);
  if (!categoryInflight && now - categoryFailedAt >= FETCH_FAILURE_BACKOFF_MS) {
    categoryInflight = loadCategoryMap().finally(() => { categoryInflight = null; });
  }
  if (have || !categoryInflight) return Promise.resolve(categoryMap);
  return categoryInflight;
}

async function loadCategoryMap() {
  try {
    const url = `${BASE_URL}/categories.json?${authParams()}`;
    console.log("[categories] Fetching categories...");
    noteApiRequest();
    const res = await fetch(url);
    console.log("[categories] Status:", res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.error?.error_message || 'ClassMarker error');
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
    categoryFailedAt = Date.now();
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

async function fetchResultsPage(finishedAfterTimestamp, kind = 'groups') {
  noteApiRequest();
  const res = await fetch(
    `${BASE_URL}/${kind}/recent_results.json?${authParams()}&finishedAfterTimestamp=${finishedAfterTimestamp}&limit=200`
  );
  if (!res.ok) throw new Error(`ClassMarker HTTP error: ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`ClassMarker: ${data.error.error_message}`);
  return data;
}

const isRateLimitError = (e) => /rate limit/i.test(e?.message || '');

const resultKey = (r) => {
  if (r.pk_id != null) return `pk:${r.pk_id}`;
  if (r.link_result_id != null) return `lnk:${r.link_result_id}`;
  return `${r.user_id}:${r.test_id}:${r.time_finished}`;
};

// Identity a webhook-merged row shares with its API twin (webhook rows have no
// pk_id, so resultKey alone would let the same attempt into the cache twice).
const attemptKey = (r) =>
  r.user_id != null && r.test_id != null ? `${r.user_id}:${r.test_id}:${r.time_finished}` : null;

let inflightFetch = null;
let lastRefreshFailedAt = 0;

// The cached results. A stale cache is returned straight away while a refresh
// runs in the background - nobody waits on ClassMarker, and a slow or
// rate-limited API can't stall a page load. Only a cold start with nothing
// cached (or `waitForFresh`, for an explicit refresh) waits for the fetch.
async function fetchAllResults({ waitForFresh = false } = {}) {
  if (!API_CONFIGURED) {
    if (!memCache) memCache = { results: [], groupMap: {}, testMap: {}, cacheTime: Date.now() };
    return memCache;
  }
  if (memCache && (Date.now() - memCache.cacheTime) < CACHE_TTL) {
    return memCache;
  }
  const refresh = refreshFromApi();
  if (memCache && !waitForFresh) {
    refresh.catch(() => { /* logged by refreshFromApi; the cache keeps serving */ });
    return memCache;
  }
  return refresh;
}

function refreshFromApi() {
  // One fetch at a time — concurrent cold callers used to each fire their own
  // full pagination, burning through the 30 req/hour budget in one page load.
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const nowSec = () => Math.floor(Date.now() / 1000);
    const windowStart = nowSec() - WINDOW_DAYS * 24 * 3600;
    const cache = memCache || { results: [], groupMap: {}, testMap: {}, cacheTime: 0 };

    // Index existing rows by API key AND by attempt identity, so an API row
    // replaces its earlier webhook-merged twin instead of duplicating it.
    const byKey = new Map();
    const byAttempt = new Map(); // attemptKey → resultKey currently holding it
    const addRow = (r) => {
      const a = attemptKey(r);
      if (a != null && byAttempt.has(a)) {
        const prev = byKey.get(byAttempt.get(a));
        // API rows carry no per-question or category detail — keep the
        // webhook-merged twin's when it replaces one, or category-driven
        // consumers (weekly performance, latest test) would lose data.
        if (prev) {
          if (r.category_results == null && prev.category_results != null) r.category_results = prev.category_results;
          if (r.questions == null && prev.questions != null) r.questions = prev.questions;
        }
        byKey.delete(byAttempt.get(a));
      }
      byKey.set(resultKey(r), r);
      if (a != null) byAttempt.set(a, resultKey(r));
    };
    for (const r of cache.results) addRow(r);

    // Fetch frontiers, persisted in the cache file: everything finishing
    // before a cursor has been pulled from that endpoint. A legacy cache
    // without cursors re-walks the whole window — the upsert above makes that
    // safe, and it is exactly what heals a hole left by the old code.
    // Cursors deliberately ignore result timestamps: webhook merges push the
    // newest RESULT to "now" while the API walk may still be weeks behind,
    // which is how the old newest-derived incremental skipped whole weeks.
    let cursors = {
      groups: Math.max(Number(cache.groupsCursor) || windowStart, windowStart),
      links: Math.max(Number(cache.linksCursor) || windowStart, windowStart),
    };

    let budget = PER_RUN_PAGE_BUDGET;
    let rateLimited = false;

    const persist = () => {
      cache.results = Array.from(byKey.values())
        .filter((r) => (r.time_finished || 0) >= windowStart);
      cache.groupsCursor = cursors.groups;
      cache.linksCursor = cursors.links;
      memCache = cache;
      dataVersion++;
      saveCache(cache);
    };

    // Walk one endpoint forward from its cursor until caught up, the budget
    // runs out, or the API rate-limits us. Progress persists after EVERY page
    // so nothing is lost to a mid-walk failure or restart.
    const walk = async (kind) => {
      let ts = Math.max(windowStart, cursors[kind] - INCREMENTAL_OVERLAP_SECONDS);
      let pages = 0;
      while (budget > 0) {
        budget--;
        let data;
        try {
          data = await fetchResultsPage(ts, kind);
        } catch (e) {
          if (isRateLimitError(e)) {
            rateLimited = true;
            console.warn(`[classmarker] Rate limited during ${kind} walk — resuming next refresh from ${new Date(cursors[kind] * 1000).toISOString()}`);
            return pages;
          }
          throw e;
        }
        pages++;
        if (data.status === 'no_results' || !Array.isArray(data.results) || data.results.length === 0) {
          cursors[kind] = Math.max(cursors[kind], nowSec());
          persist();
          return pages;
        }
        for (const g of (data.groups || [])) {
          const grp = g.group || g;
          if (grp.group_id) cache.groupMap[String(grp.group_id)] = grp.group_name;
        }
        for (const t of (data.tests || [])) {
          const tst = t.test || t;
          if (tst.test_id) cache.testMap[String(tst.test_id)] = tst.test_name;
        }
        let newestOnPage = 0;
        for (const raw of data.results) {
          const r = raw.result || raw;
          // Link results carry cm_user_id — normalize so downstream consumers
          // (students, scoreboards) see one field. Null stays null (anonymous).
          if (r.user_id == null && r.cm_user_id != null) r.user_id = r.cm_user_id;
          newestOnPage = Math.max(newestOnPage, r.time_finished || 0);
          addRow(r);
        }
        const next = Number(data.next_finished_after_timestamp);
        if (!data.more_results_exist || !next) {
          cursors[kind] = Math.max(cursors[kind], newestOnPage, ts);
          persist();
          return pages;
        }
        if (next <= ts) {
          // A non-advancing cursor would refetch this page forever.
          console.warn(`[classmarker] ${kind} pagination cursor did not advance (${next} <= ${ts}) — stopping this walk`);
          cursors[kind] = Math.max(cursors[kind], newestOnPage, ts);
          persist();
          return pages;
        }
        ts = next;
        cursors[kind] = Math.max(cursors[kind], ts);
        persist();
      }
      return pages;
    };

    try {
      const groupPages = await walk('groups');
      const linkPages = rateLimited ? 0 : await walk('links');

      const caughtUp = !rateLimited && budget > 0;
      const fmt = (s) => new Date(s * 1000).toISOString().slice(0, 16);
      console.log(
        `[classmarker] Refresh: ${groupPages} group page(s) + ${linkPages} link page(s), ` +
        `${cache.results.length} results in window, cursors groups=${fmt(cursors.groups)} links=${fmt(cursors.links)}` +
        (caughtUp ? '' : rateLimited ? ' — RATE LIMITED, resuming next refresh' : ' — budget exhausted, resuming next refresh')
      );

      // Full TTL either way: the page budget is sized to the hourly quota, so
      // retrying sooner could not fetch more anyway.
      cache.cacheTime = Date.now();
      if (rateLimited) lastRefreshFailedAt = Date.now();
      else cache.syncedAt = Date.now();
      persist();
      return cache;
    } catch (e) {
      lastRefreshFailedAt = Date.now();
      if (cache.results.length > 0) {
        // Serve what we have and back off — a failed refresh must never leave
        // the app dataless or retry on every request. Cursor progress from
        // already-persisted pages is kept.
        console.error('[classmarker] Refresh failed — serving cached results:', e.message);
        cache.cacheTime = Date.now() - CACHE_TTL + FETCH_FAILURE_BACKOFF_MS;
        persist();
        return cache;
      }
      throw e;
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

// A person pressing Refresh. Every reconcile costs at least two of the 30
// hourly requests, and new results already arrive through webhooks within
// seconds, so a refresh shortly after the last sync (or while ClassMarker is
// backing us off) is answered from the cache instead. Otherwise it waits for
// the fetch, so the caller gets current data.
// → { refreshed: boolean, reason?: 'offline' | 'recent' | 'backoff' }
const MANUAL_REFRESH_MIN_GAP_MS = 5 * 60 * 1000;
async function refreshResults() {
  if (!API_CONFIGURED) return { refreshed: false, reason: 'offline' };
  const now = Date.now();
  if (memCache && now - (memCache.syncedAt || 0) < MANUAL_REFRESH_MIN_GAP_MS) {
    return { refreshed: false, reason: 'recent' };
  }
  if (memCache && now - lastRefreshFailedAt < FETCH_FAILURE_BACKOFF_MS) {
    return { refreshed: false, reason: 'backoff' };
  }
  const syncedBefore = memCache?.syncedAt || 0;
  if (memCache) memCache.cacheTime = 0;
  await fetchAllResults({ waitForFresh: true });
  // A failed or rate-limited fetch still resolves (with the cached results).
  return (memCache?.syncedAt || 0) > syncedBefore
    ? { refreshed: true }
    : { refreshed: false, reason: 'backoff' };
}

// How current the results are and how much of the hourly request budget is
// in use - shown next to the student list.
function getSyncStatus() {
  return {
    live: API_CONFIGURED,
    syncedAt: memCache?.syncedAt ? new Date(memCache.syncedAt).toISOString() : null,
    requestsLastHour: requestsLastHour(),
    hourlyLimit: HOURLY_REQUEST_LIMIT,
  };
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

// Every student, and which of them belong to each ClassMarker group, built in
// one pass over BOTH stores: the API results cache, and the webhook records -
// which often carry the real name when the API row only has a bare user_id,
// and cover students whose only activity predates the API window. A student
// "belongs" to a group if they have at least one result under it.
//
// Reads only the records' identity columns, and is memoized until either
// store changes: it used to parse every record's questions and raw payload,
// several times per page load (~1s each in production). The result is shared,
// so treat it as read-only.
//   → { students: [{ id, name, email }], groups: [{ groupId, groupName, studentIds }] }
let directoryMemo = null; // { key, value }

async function getStudentDirectory() {
  const db = require('./db.service');
  // Loads the cache on first use, and starts a background refresh when it is
  // stale - without waiting for it.
  await fetchAllResults();
  let records = null;
  try {
    records = await db.getRecordSummaries();
  } catch (e) {
    // DB may not be ready on a cold path - API-cache data is still usable.
  }
  // Everything below is synchronous, so the versions read here describe
  // exactly the data the directory is built from.
  const key = `${dataVersion}:${db.getRecordsVersion()}`;
  if (records && directoryMemo && directoryMemo.key === key) return directoryMemo.value;
  const { results, groupMap } = memCache || { results: [], groupMap: {} };

  const students = new Map(); // id → { id, name, email }
  for (const r of results) {
    // Anonymous link-based attempts have no user — they can't become students.
    if (r.user_id == null) continue;
    const id = String(r.user_id);
    const fullName = `${r.first || ''} ${r.last || ''}`.trim() || r.email || `User ${id}`;
    const email = r.email || null;
    const prev = students.get(id);
    if (!prev) {
      students.set(id, { id, name: fullName, email });
      continue;
    }
    // Prefer a real name/email when a later attempt has better metadata.
    const name = !isPlaceholderStudentName(fullName, id) ? fullName : prev.name;
    students.set(id, { id, name, email: prev.email || email });
  }
  for (const r of records || []) {
    const id = String(r.student?.userId ?? r.user_id ?? '');
    if (!id) continue;
    const webhookName = String(r.student?.name || r.name || '').trim();
    const webhookEmail = r.student?.email || r.email || null;
    const prev = students.get(id);
    if (!prev) {
      students.set(id, { id, name: webhookName || webhookEmail || `User ${id}`, email: webhookEmail });
      continue;
    }
    const name = webhookName && isPlaceholderStudentName(prev.name, id) ? webhookName : prev.name;
    students.set(id, { id, name, email: prev.email || webhookEmail });
  }

  const groups = new Map(); // gid → { groupId, groupName, studentIds: Set }
  const add = (gid, gname, sid) => {
    if (!gid || !sid) return;
    let g = groups.get(gid);
    if (!g) {
      g = { groupId: gid, groupName: gname || `Group #${gid}`, studentIds: new Set() };
      groups.set(gid, g);
    }
    if (gname && g.groupName.startsWith('Group #')) g.groupName = gname;
    g.studentIds.add(sid);
  };
  for (const r of results) {
    add(String(r.group_id ?? ''), groupMap[String(r.group_id)] || null, String(r.user_id ?? ''));
  }
  for (const r of records || []) {
    add(
      String(r.group?.groupId ?? r.group_id ?? ''),
      r.group?.groupName ?? r.group_name ?? null,
      String(r.student?.userId ?? r.user_id ?? '')
    );
  }

  const nameOf = (id) => students.get(id)?.name || `User ${id}`;
  const value = {
    students: Array.from(students.values()).sort((a, b) => a.name.localeCompare(b.name)),
    groups: Array.from(groups.values())
      .map((g) => ({
        groupId: g.groupId,
        groupName: g.groupName,
        studentIds: Array.from(g.studentIds).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName)),
  };
  // A directory built without the webhook store is incomplete - rebuild it
  // on the next call rather than serving it until the data changes.
  if (records) directoryMemo = { key, value };
  return value;
}

async function getAllStudents() {
  return (await getStudentDirectory()).students;
}

// ClassMarker groups with their students as full objects - the original
// shape of GET /students/groups, kept for clients that still use it.
async function getGroupsWithStudents() {
  const { students, groups } = await getStudentDirectory();
  const byId = new Map(students.map((s) => [s.id, s]));
  return groups.map((g) => ({
    groupId: g.groupId,
    groupName: g.groupName,
    students: g.studentIds.map((id) => byId.get(id) || { id, name: `User ${id}`, email: null }),
  }));
}

async function getStudentById(studentId) {
  const students = await getAllStudents();
  const student = students.find((s) => s.id === studentId);
  if (!student) {
    const err = new Error(`Student "${studentId}" not found`);
    err.status = 404;
    throw err;
  }
  // A copy: the directory is shared by every request.
  return { ...student };
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

  // Overlay admin raw-score overrides. The API is normally the source of
  // truth for this cache, so an edit stored in the webhook DB would otherwise
  // be reverted here on every refresh — patch at read time instead, matched
  // by the attempt's identity (test + finish time).
  try {
    const db = require('./db.service');
    const overrides = await db.getOverridesForUser(String(studentId));
    if (overrides.length) {
      const byKey = new Map(overrides.map((o) => [`${o.test_id}:${o.time_finished}`, o]));
      for (const g of Object.values(grouped)) {
        for (const r of g.results) {
          const o = byKey.get(`${r.testId}:${r.timeFinished}`);
          if (!o) continue;
          r.score = o.score;
          r.percentage = r.maxScore > 0 ? Math.round((o.score / r.maxScore) * 1000) / 10 : r.percentage;
          r.manualOverride = true;
          r.originalRaw = o.originalRaw;
        }
      }
    }
  } catch (e) {
    // Webhook store unavailable — serve cache values unmodified.
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
  dataVersion++; // results derived from the dropped cache are stale now
  try {
    fs.rmSync(CACHE_GZ_FILE, { force: true });
    fs.rmSync(CACHE_FILE, { force: true });
  } catch (e) {
    console.warn('Could not delete cache file:', e.message);
  }
  // Also flush the in-memory category map so renamed categories show up on
  // the next fetch instead of waiting for the 1h TTL.
  categoryMap = {};
  categoryFetchedAt = 0;
  categoryFailedAt = 0;
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
      maxScore: r.points_available != null ? Number(r.points_available) : null,
      timeFinished: r.time_finished || 0,
    }));
}

// Newest cached API attempt for one (student, test) pair — the raw cache row.
// Used to materialize a manual raw-score override when the attempt never
// produced a webhook record.
async function findCachedAttempt(userId, testId) {
  const { results, groupMap, testMap } = await fetchAllResults();
  let latest = null;
  for (const r of results) {
    if (String(r.user_id) !== String(userId) || String(r.test_id) !== String(testId)) continue;
    if (!latest || (r.time_finished || 0) > (latest.time_finished || 0)) latest = r;
  }
  if (!latest) return null;
  return {
    row: latest,
    groupName: groupMap[String(latest.group_id)] || null,
    testName: testMap[String(latest.test_id)] || null,
  };
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
  getGroupsWithStudents,
  getStudentDirectory,
  refreshResults,
  getSyncStatus,
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
  findCachedAttempt,
  mergeWebhookResult,
  getDataVersion,
  getCacheSnapshot,
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
