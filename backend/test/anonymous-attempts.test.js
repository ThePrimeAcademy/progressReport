// ClassMarker sends an empty user id for anonymous test-link attempts (no
// ClassMarker login). Such attempts must never become a student: kept as '',
// they all collapsed into one bogus student carrying one taker's name and
// another's email.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dataDir } = require('./helpers/env');

const now = Math.floor(Date.now() / 1000);
const attempt = (fields) => ({ test_id: 7, points_scored: 10, points_available: 27, time_finished: now - 3600, ...fields });

// A cache file saved before the fix, so its anonymous rows still carry ''.
fs.writeFileSync(path.join(dataDir, 'classmarker-cache.json.gz'), zlib.gzipSync(JSON.stringify({
  cacheTime: Date.now(),
  groupMap: { 3: 'Fall SAT' },
  testMap: { 7: 'Diagnostic' },
  results: [
    attempt({ user_id: 101, group_id: 3, first: 'Ada', last: 'Byron', email: 'ada@example.com' }),
    attempt({ user_id: '', cm_user_id: '', first: 'Anon', last: 'One', email: 'anon1@example.com', time_finished: now - 1800 }),
    attempt({ user_id: '', cm_user_id: '', first: 'Anon', last: 'Two', email: 'anon2@example.com', time_finished: now - 900 }),
    // A link attempt by a logged-in ClassMarker user is a real student.
    attempt({ cm_user_id: 202, first: 'Lin', last: 'Park', email: 'lin@example.com' }),
  ],
})));

const cm = require('../src/services/classmarker.service');

test('anonymous link attempts never become a student', async () => {
  const { students, groups } = await cm.getStudentDirectory();
  assert.deepEqual(students.map((s) => [s.id, s.name]), [['101', 'Ada Byron'], ['202', 'Lin Park']]);
  assert.deepEqual(groups, [{ groupId: '3', groupName: 'Fall SAT', studentIds: ['101'] }]);
});
