// ClassMarker allows 30 API requests an hour, so the server must spend them
// carefully. These tests stand in for ClassMarker and count every request:
// page loads send none, readers never wait on a refresh, concurrent callers
// share one request, and a Refresh right after a sync sends nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/env');
process.env.CLASSMARKER_API_KEY = 'test-key';
process.env.CLASSMARKER_API_SECRET = 'test-secret';

const requests = []; // pathname of every request sent to ClassMarker
let categoriesStatus = 200;
let groupsGate = null; // when set, results requests wait for it to resolve
let nextGroupsPage = null; // served once by the next results request
let nextLinksPage = null; // served once by the next link-results request

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
global.fetch = async (url) => {
  const { pathname } = new URL(url);
  requests.push(pathname);
  if (pathname.endsWith('/categories.json')) {
    return categoriesStatus === 200
      ? reply({ parent_categories: [{ category_id: 1, category_name: 'Algebra', categories: [] }] })
      : reply({}, categoriesStatus);
  }
  if (pathname.endsWith('/groups/recent_results.json')) {
    if (groupsGate) await groupsGate.promise;
    const page = nextGroupsPage;
    nextGroupsPage = null;
    return reply(page || { status: 'no_results' });
  }
  if (pathname.endsWith('/links/recent_results.json')) {
    const page = nextLinksPage;
    nextLinksPage = null;
    return reply(page || { status: 'no_results' });
  }
  throw new Error(`unexpected ClassMarker request: ${pathname}`);
};

nextGroupsPage = {
  status: 'ok',
  results: [{
    result: {
      user_id: 11, first: 'Ada', last: 'Byron', email: 'ada@example.com', test_id: 5, group_id: 7,
      points_scored: 10, points_available: 27, time_finished: Math.floor(Date.now() / 1000) - 3600,
    },
  }],
  groups: [{ group: { group_id: 7, group_name: 'Fall SAT' } }],
  tests: [{ test: { test_id: 5, test_name: 'Diagnostic' } }],
  more_results_exist: false,
};

// An anonymous test-link attempt: no ClassMarker login, so an empty id. It
// must not turn into a student.
nextLinksPage = {
  status: 'ok',
  results: [{
    result: {
      cm_user_id: '', first: 'Anon', last: 'Taker', email: 'anon@example.com', test_id: 5, link_result_id: 77,
      points_scored: 3, points_available: 27, time_finished: Math.floor(Date.now() / 1000) - 1800,
    },
  }],
  more_results_exist: false,
};

// Loading the service starts the boot-time refresh of the (empty) cache.
const cm = require('../src/services/classmarker.service');

const count = (suffix) => requests.filter((p) => p.endsWith(suffix)).length;
const realNow = Date.now;
const later = (ms) => { Date.now = () => realNow() + ms; };
test.afterEach(() => { Date.now = realNow; });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(condition(), 'timed out waiting');
}

test('boot loads results once and categories once, even with two callers', async () => {
  // server.js and webhook.service both ask for categories on boot.
  await Promise.all([cm.fetchCategoryMap(), cm.fetchCategoryMap()]);
  const { students, groups } = await cm.getStudentDirectory();
  assert.deepEqual(students, [{ id: '11', name: 'Ada Byron', email: 'ada@example.com' }]);
  assert.deepEqual(groups, [{ groupId: '7', groupName: 'Fall SAT', studentIds: ['11'] }]);
  assert.equal(count('/categories.json'), 1);
  assert.equal(count('/groups/recent_results.json'), 1);
  assert.equal(count('/links/recent_results.json'), 1);
});

test('page loads send no requests, and the sync status says so', async () => {
  const before = requests.length;
  for (let i = 0; i < 5; i++) {
    await Promise.all([cm.getStudentDirectory(), cm.getAllStudents(), cm.getGroupsWithStudents(), cm.fetchCategoryMap()]);
  }
  assert.equal(requests.length, before);

  const sync = cm.getSyncStatus();
  assert.equal(sync.live, true);
  assert.equal(sync.requestsLastHour, requests.length);
  assert.equal(sync.hourlyLimit, 30);
  assert.ok(Date.parse(sync.syncedAt) <= Date.now());
});

test('a stale cache is served at once while a single refresh runs behind it', async () => {
  cm.invalidateCache();
  groupsGate = deferred(); // ClassMarker is slow to answer
  const groupsBefore = count('/groups/recent_results.json');
  const linksBefore = count('/links/recent_results.json');

  const readers = Promise.all([cm.getStudentDirectory(), cm.getStudentDirectory(), cm.getAllStudents()]);
  const served = await Promise.race([readers, new Promise((r) => setTimeout(() => r('waited'), 2000))]);
  assert.notEqual(served, 'waited', 'readers must not wait for ClassMarker');
  assert.equal(served[0].students[0].name, 'Ada Byron');
  assert.equal(count('/groups/recent_results.json'), groupsBefore + 1, 'one shared refresh');

  groupsGate.resolve();
  groupsGate = null;
  await until(() => count('/links/recent_results.json') === linksBefore + 1);
  assert.equal(count('/groups/recent_results.json'), groupsBefore + 1);
});

test('Refresh right after a sync answers from the cache', async () => {
  const before = requests.length;
  assert.deepEqual(await cm.refreshResults(), { refreshed: false, reason: 'recent' });
  assert.equal(requests.length, before);
});

test('Refresh a few minutes after the last sync asks ClassMarker once', async () => {
  later(6 * 60 * 1000);
  const before = requests.length;
  assert.deepEqual(await cm.refreshResults(), { refreshed: true });
  assert.equal(requests.length, before + 2); // groups + links, each caught up in one page
  assert.deepEqual(await cm.refreshResults(), { refreshed: false, reason: 'recent' });
  assert.equal(requests.length, before + 2);
});

test('a failed category fetch keeps the old names and waits out a backoff', async () => {
  categoriesStatus = 429;
  later(2 * 60 * 60 * 1000); // the category map is stale
  const before = count('/categories.json');
  assert.deepEqual(await cm.fetchCategoryMap(), { 1: 'Algebra' }, 'served without waiting');
  await until(() => count('/categories.json') === before + 1);
  await new Promise((r) => setTimeout(r, 10)); // let the failure be recorded

  for (let i = 0; i < 5; i++) assert.deepEqual(await cm.fetchCategoryMap(), { 1: 'Algebra' });
  assert.equal(count('/categories.json'), before + 1, 'no retries during the backoff');

  categoriesStatus = 200;
  later(2 * 60 * 60 * 1000 + 11 * 60 * 1000); // backoff over
  await cm.fetchCategoryMap();
  await until(() => count('/categories.json') === before + 2);
});
