// The student lists and record lookups behind every page: who the students
// are, which group each belongs to, and finding one student's records. They
// read only what they need from the store and are cached between writes, so
// these tests pin down both the answers and that a new record shows up.
process.env.TZ = 'UTC'; // the day-of-week filter uses local time, like the server
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/env');
const db = require('../src/services/db.service');
const cm = require('../src/services/classmarker.service');
const { getLatestWebhookTestResult } = require('../src/services/webhook.service');

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

let clock = Math.floor(Date.parse('2026-10-03T14:00:00Z') / 1000);
async function attempt({ id, name, email = `${normalize(name)}@example.com`, testId = 't1', groupId = 'g1', groupName = 'Fall SAT', finished = clock += 3600, questions = [] }) {
  await db.upsertRecord({
    key: `group:${id}:${testId}:${groupId}:${finished - 1800}`,
    student: { userId: id, email, name, normalizedName: normalize(name), normalizedEmail: email },
    test: { testId, testName: `Test ${testId}` },
    group: { groupId, groupName },
    score: questions.filter((q) => q.correct).length,
    maxScore: questions.length || 27,
    timeStarted: finished - 1800,
    timeFinished: finished,
    date: new Date(finished * 1000).toISOString().split('T')[0],
    questions,
    categoryResults: [],
    raw: { payload: 'x'.repeat(200) },
  });
  return finished;
}

test.before(async () => {
  await attempt({ id: '1', name: 'Zoe Park', groupId: 'g1', groupName: 'Fall SAT' });
  await attempt({ id: '2', name: 'Adam Lee', groupId: 'g1', groupName: 'Fall SAT' });
  await attempt({ id: '2', name: 'Adam Lee', groupId: 'g2', groupName: 'Summer SAT', testId: 't2' });
  // A record without a name keeps the placeholder until a real one appears.
  await attempt({ id: '3', name: '', email: '', groupId: 'g2', groupName: 'Summer SAT' });
});

test('lists every student once, sorted by name, with each group\'s members', async () => {
  const { students, groups } = await cm.getStudentDirectory();
  assert.deepEqual(students.map((s) => s.name), ['Adam Lee', 'User 3', 'Zoe Park']);
  assert.deepEqual(students.find((s) => s.id === '1'), { id: '1', name: 'Zoe Park', email: 'zoepark@example.com' });
  assert.deepEqual(groups, [
    { groupId: 'g1', groupName: 'Fall SAT', studentIds: ['2', '1'] },
    { groupId: 'g2', groupName: 'Summer SAT', studentIds: ['2', '3'] },
  ]);
});

test('the older student endpoints are views of the same directory', async () => {
  const { students } = await cm.getStudentDirectory();
  assert.deepEqual(await cm.getAllStudents(), students);
  const groups = await cm.getGroupsWithStudents();
  assert.deepEqual(groups[1], {
    groupId: 'g2',
    groupName: 'Summer SAT',
    students: [students.find((s) => s.id === '2'), students.find((s) => s.id === '3')],
  });
});

test('a new record shows up at once, and a real name replaces a placeholder', async () => {
  const before = await cm.getStudentDirectory();
  assert.equal(await cm.getStudentDirectory(), before, 'unchanged data is served from the cache');

  await attempt({ id: '4', name: 'Maya Chen', groupId: 'g1', groupName: 'Fall SAT' });
  await attempt({ id: '3', name: 'Ben Ortiz', groupId: 'g2', groupName: 'Summer SAT', testId: 't3' });

  const { students, groups } = await cm.getStudentDirectory();
  assert.deepEqual(students.map((s) => s.name), ['Adam Lee', 'Ben Ortiz', 'Maya Chen', 'Zoe Park']);
  assert.deepEqual(groups[0].studentIds, ['2', '4', '1']);
});

test('getStudentById hands out a copy, so callers cannot corrupt the shared list', async () => {
  const student = await cm.getStudentById('1');
  student.name = 'Changed';
  assert.equal((await cm.getStudentById('1')).name, 'Zoe Park');
  await assert.rejects(cm.getStudentById('nope'), { status: 404 });
});

test('record summaries carry identity fields only, and follow writes', async () => {
  const rows = await db.getRecordSummaries();
  const row = rows.find((r) => r.user_id === '1');
  assert.equal(row.student.name, 'Zoe Park');
  assert.equal(row.test.testId, 't1');
  assert.equal(row.group.groupName, 'Fall SAT');
  assert.equal(typeof row.timeFinished, 'number');
  assert.equal(row.questions, undefined);
  assert.equal(row.raw, undefined);

  const count = rows.length;
  await attempt({ id: '5', name: 'Lena Ruiz' });
  assert.equal((await db.getRecordSummaries()).length, count + 1);
});

test('findMatchingRecords matches a student by id, email or name - never by a blank one', async () => {
  const from = '2026-01-01';
  const to = '2026-12-31';
  const byId = await db.findMatchingRecords({ id: '2' }, from, to);
  assert.deepEqual(byId.map((r) => r.test.testId), ['t1', 't2']);
  assert.ok(byId[0].questions instanceof Array, 'records come back fully parsed');

  assert.equal((await db.findMatchingRecords({ email: ' ZoePark@Example.com ' }, from, to)).length, 1);
  assert.equal((await db.findMatchingRecords({ name: 'zoe park' }, from, to)).length, 1);
  // Student 3's first record has no email: a student without one must not match it.
  assert.equal((await db.findMatchingRecords({ id: 'x', email: '', name: '' }, from, to)).length, 0);
  assert.equal((await db.findMatchingRecords({}, from, to)).length, 0);
});

test('findMatchingRecords keeps the date range and day-of-week filter', async () => {
  const saturday = Math.floor(Date.parse('2026-11-07T15:00:00Z') / 1000);
  await attempt({ id: '6', name: 'Omar Haddad', finished: saturday });
  await attempt({ id: '6', name: 'Omar Haddad', testId: 't2', finished: saturday + 86400 }); // Sunday
  const student = { id: '6' };
  assert.equal((await db.findMatchingRecords(student, '2026-11-07', '2026-11-08')).length, 2);
  assert.equal((await db.findMatchingRecords(student, '2026-11-08', '2026-11-08')).length, 1);
  assert.equal((await db.findMatchingRecords(student, '2026-11-01', '2026-11-30', ['6'])).length, 1);
  assert.equal((await db.findMatchingRecords(student, '2026-11-01', '2026-11-30', ['1', '2'])).length, 0);
});

test('getRecordsForTests returns full records for just those tests', async () => {
  const rows = await db.getRecordsForTests(new Set(['t2']));
  assert.deepEqual(rows.map((r) => r.user_id).sort(), ['2', '6']);
  assert.ok(rows.every((r) => r.test.testId === 't2' && Array.isArray(r.questions)));
  assert.deepEqual(await db.getRecordsForTests([]), []);
});

test('a report shows each question\'s newest category, as soon as a newer attempt arrives', async () => {
  const q = (categoryId, categoryName) => [{ questionId: 'q1', categoryId, categoryName, correct: true }];
  const ivy = { id: '7', name: 'Ivy Moss' };
  const categoryOnIvysReport = async () =>
    (await getLatestWebhookTestResult(ivy, '2026-01-01', '2026-12-31')).questions[0].category_name;

  await attempt({ ...ivy, testId: 'cat-test', questions: q('c1', 'Algebra') });
  assert.equal(await categoryOnIvysReport(), 'Algebra');

  // The question was re-categorized on ClassMarker; the next attempt says so,
  // and Ivy's older attempt is reported under the new category from now on.
  await attempt({ id: '8', name: 'Noor Aziz', testId: 'cat-test', questions: q('c2', 'Linear functions') });
  assert.equal(await categoryOnIvysReport(), 'Linear functions');
});
