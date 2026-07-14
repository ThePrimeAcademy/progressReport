// services/db.service.js
// SQLite store using sql.js (pure JS, no native compilation needed).
// Persists to disk at DATA_DIR/progressreport.db
// On Railway: mount a volume at /data and set DATA_DIR=/data

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'progressreport.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const initSqlJs = require('sql.js');

let _db = null;
let _dirty = false;

// Atomic write: write to a temp file, then rename. rename() is atomic on the
// same filesystem, so a process kill mid-write can never leave a truncated
// half-written DB (the cause of "database disk image is malformed").
function writeDbFileSync() {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(_db.export()));
    fs.renameSync(tmp, DB_PATH);
}

// Flush to disk every 5 seconds if dirty
setInterval(() => {
    if (_dirty && _db) {
        try {
            writeDbFileSync();
            _dirty = false;
        } catch (e) {
            console.error('[db] Failed to flush:', e.message);
        }
    }
}, 5000);

// Also flush on exit
process.on('exit', () => {
    if (_dirty && _db) {
        try { writeDbFileSync(); } catch (_) { }
    }
});

async function getDb() {
    if (_db) return _db;

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        _db = new SQL.Database(fileBuffer);
    } else {
        _db = new SQL.Database();
    }

    _db.run(`
    CREATE TABLE IF NOT EXISTS webhook_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      record_key  TEXT    UNIQUE NOT NULL,
      user_id     TEXT,
      email       TEXT,
      name        TEXT,
      normalized_name  TEXT,
      normalized_email TEXT,
      test_id     TEXT,
      test_name   TEXT,
      group_id    TEXT,
      group_name  TEXT,
      percentage  REAL,
      score       REAL,
      max_score   REAL,
      passed      INTEGER,
      duration    TEXT,
      time_started   INTEGER,
      time_finished  INTEGER,
      date        TEXT,
      questions        TEXT,
      category_results TEXT,
      raw              TEXT,
      received_at      TEXT
    )
  `);

    _db.run(`
    CREATE TABLE IF NOT EXISTS student_contacts (
      student_id     TEXT PRIMARY KEY,
      student_email  TEXT,
      parent_email   TEXT,
      updated_at     TEXT
    )
  `);

    // Scheduled bulk-email batches. A batch fires server-side at send_at via
    // scheduled-email.service. day_of_week is a comma-joined list of day
    // numbers (or ''); all timestamps are ISO 8601 strings.
    _db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_batches (
      id           TEXT PRIMARY KEY,
      label        TEXT,
      subject      TEXT,
      start_date   TEXT,
      end_date     TEXT,
      day_of_week  TEXT,
      send_at      TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      finished_at  TEXT
    )
  `);

    _db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_batch_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id      TEXT NOT NULL,
      student_id    TEXT NOT NULL,
      student_name  TEXT,
      student_email TEXT,
      parent_email  TEXT,
      status        TEXT NOT NULL,
      error         TEXT,
      sent_at       TEXT
    )
  `);

    _db.run('CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON scheduled_batch_items (batch_id)');

    // On-demand email send jobs (POST /api/report/email). Stored on disk so a
    // Railway restart / second replica can't make the browser's job poll 404
    // with "Job not found" while the send is still in flight (or just finished).
    _db.run(`
    CREATE TABLE IF NOT EXISTS email_jobs (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER,
      result_json TEXT,
      error       TEXT
    )
  `);

    flush();
    return _db;
}

async function getContacts(studentId) {
    const db = await getDb();
    const result = db.exec(
        'SELECT student_email, parent_email FROM student_contacts WHERE student_id = ?',
        [String(studentId)]
    );
    if (!result.length) return null;
    const [studentEmail, parentEmail] = result[0].values[0];
    return { studentEmail: studentEmail || '', parentEmail: parentEmail || '' };
}

async function getAllContacts() {
    const db = await getDb();
    const result = db.exec('SELECT student_id, student_email, parent_email FROM student_contacts');
    if (!result.length) return {};
    const out = {};
    for (const row of result[0].values) {
        const [studentId, studentEmail, parentEmail] = row;
        out[String(studentId)] = {
            studentEmail: studentEmail || '',
            parentEmail: parentEmail || '',
        };
    }
    return out;
}

async function setContacts(studentId, { studentEmail, parentEmail }) {
    const db = await getDb();
    db.run(
        `INSERT INTO student_contacts (student_id, student_email, parent_email, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(student_id) DO UPDATE SET
           student_email = excluded.student_email,
           parent_email  = excluded.parent_email,
           updated_at    = excluded.updated_at`,
        [
            String(studentId),
            studentEmail || null,
            parentEmail || null,
            new Date().toISOString(),
        ]
    );
    flush();
    return { studentEmail: studentEmail || '', parentEmail: parentEmail || '' };
}

function flush() {
    _dirty = true;
}

// Force a synchronous write — used for email job status so the next poll after
// a redeploy can still see the row if the volume is shared.
function flushNow() {
    if (!_db) return;
    try {
        writeDbFileSync();
        _dirty = false;
    } catch (e) {
        console.error('[db] flushNow failed:', e.message);
        _dirty = true;
    }
}

async function upsertRecord(record) {
    const db = await getDb();
    // Preserve existing questions/category_results when the incoming payload is empty.
    // ClassMarker can resend the same attempt without the per-question breakdown;
    // a naive overwrite would wipe a previously-stored result.
    db.run(`
    INSERT INTO webhook_results (
      record_key, user_id, email, name, normalized_name, normalized_email,
      test_id, test_name, group_id, group_name,
      percentage, score, max_score, passed, duration,
      time_started, time_finished, date,
      questions, category_results, raw, received_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(record_key) DO UPDATE SET
      percentage       = excluded.percentage,
      score            = excluded.score,
      max_score        = excluded.max_score,
      passed           = excluded.passed,
      duration         = excluded.duration,
      time_finished    = excluded.time_finished,
      date             = excluded.date,
      questions        = CASE
        WHEN excluded.questions IS NULL OR excluded.questions = '[]'
        THEN webhook_results.questions
        ELSE excluded.questions
      END,
      category_results = CASE
        WHEN excluded.category_results IS NULL OR excluded.category_results = '[]'
        THEN webhook_results.category_results
        ELSE excluded.category_results
      END,
      raw              = excluded.raw,
      received_at      = excluded.received_at
  `, [
        record.key,
        record.student?.userId ?? null,
        record.student?.email ?? null,
        record.student?.name ?? null,
        record.student?.normalizedName ?? null,
        record.student?.normalizedEmail ?? null,
        record.test?.testId ?? null,
        record.test?.testName ?? null,
        record.group?.groupId ?? null,
        record.group?.groupName ?? null,
        record.percentage ?? null,
        record.score ?? null,
        record.maxScore ?? null,
        record.passed != null ? (record.passed ? 1 : 0) : null,
        record.duration ?? null,
        record.timeStarted ?? null,
        record.timeFinished ?? null,
        record.date ?? null,
        JSON.stringify(record.questions || []),
        JSON.stringify(record.categoryResults || []),
        JSON.stringify(record.raw || {}),
        record.receivedAt ?? new Date().toISOString(),
    ]);
    flush();
}

async function findMatchingRecords(student, startDate, endDate, dayOfWeek) {
    const db = await getDb();
    const startTs = Math.floor(new Date(startDate).getTime() / 1000);
    const endTs = Math.floor(new Date(endDate).getTime() / 1000) + 86399; // include the entire end day

    const result = db.exec(
        'SELECT * FROM webhook_results WHERE time_finished >= ? AND time_finished <= ?',
        [startTs, endTs]
    );

    if (!result.length) return [];

    const cols = result[0].columns;
    const rows = result[0].values.map((row) => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
    });

    const studentId = String(student.id || '');
    const studentEmail = (student.email || '').trim().toLowerCase();
    const studentName = (student.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

    const filtered = rows.filter((row) => {
        if (studentId && row.user_id && row.user_id === studentId) return true;
        if (studentEmail && row.normalized_email && row.normalized_email === studentEmail) return true;
        if (studentName && row.normalized_name && row.normalized_name === studentName) return true;
        return false;
    });

    let matched = filtered;
    if (dayOfWeek && dayOfWeek.length > 0) {
        const days = Array.isArray(dayOfWeek) ? dayOfWeek.map(Number) : [Number(dayOfWeek)];
        matched = filtered.filter((row) => days.includes(new Date(row.time_finished * 1000).getDay()));
    }

    return matched.map(parseRow);
}

function parseRow(row) {
    return {
        ...row,
        passed: row.passed === 1,
        questions: JSON.parse(row.questions || '[]'),
        categoryResults: JSON.parse(row.category_results || '[]'),
        raw: JSON.parse(row.raw || '{}'),
        student: {
            userId: row.user_id,
            email: row.email,
            name: row.name,
            normalizedName: row.normalized_name,
            normalizedEmail: row.normalized_email,
        },
        test: { testId: row.test_id, testName: row.test_name },
        group: { groupId: row.group_id, groupName: row.group_name },
        timeFinished: row.time_finished,
        timeStarted: row.time_started,
    };
}

async function getAllRecords() {
    const db = await getDb();
    const result = db.exec('SELECT * FROM webhook_results');
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map((row) => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return parseRow(obj);
    });
}

async function updateQuestions(id, questions) {
    const db = await getDb();
    db.run('UPDATE webhook_results SET questions = ? WHERE id = ?', [
        JSON.stringify(questions), id,
    ]);
    flush();
}

async function getTotalResults() {
    const db = await getDb();
    const result = db.exec('SELECT COUNT(*) as count FROM webhook_results');
    return result[0]?.values[0][0] ?? 0;
}

async function getLatestUpdatedAt() {
    const db = await getDb();
    const result = db.exec('SELECT MAX(received_at) as latest FROM webhook_results');
    return result[0]?.values[0][0] ?? null;
}

// ── Scheduled bulk-email batches ───────────────────────────────────────────

// sql.js exec() returns [{ columns, values }] (or []); map it to plain objects.
function rowsToObjects(result) {
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map((row) => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
    });
}

const EMPTY_COUNTS = { total: 0, pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };

// items: [{ studentId, studentName, studentEmail, parentEmail }]. Returns the
// generated batch id. dayOfWeek may be an array, a scalar, or empty.
async function createScheduledBatch({ label, subject, startDate, endDate, dayOfWeek, sendAt, items }) {
    const db = await getDb();
    const id = crypto.randomBytes(9).toString('hex');
    const now = new Date().toISOString();
    const dow = Array.isArray(dayOfWeek)
        ? dayOfWeek.map(String).join(',')
        : (dayOfWeek != null && dayOfWeek !== '' ? String(dayOfWeek) : '');

    db.run(
        `INSERT INTO scheduled_batches
           (id, label, subject, start_date, end_date, day_of_week, send_at, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, label || '', subject || '', startDate, endDate, dow, sendAt, 'scheduled', now]
    );

    for (const it of items) {
        db.run(
            `INSERT INTO scheduled_batch_items
               (batch_id, student_id, student_name, student_email, parent_email, status)
             VALUES (?,?,?,?,?,?)`,
            [id, String(it.studentId), it.studentName || '', it.studentEmail || '', it.parentEmail || '', 'pending']
        );
    }

    flush();
    return id;
}

// All batches, newest send_at first, each annotated with per-status counts.
async function listScheduledBatches() {
    const db = await getDb();
    const batches = rowsToObjects(db.exec('SELECT * FROM scheduled_batches ORDER BY send_at DESC'));
    if (!batches.length) return [];

    const items = rowsToObjects(db.exec('SELECT batch_id, status FROM scheduled_batch_items'));
    const counts = {};
    for (const it of items) {
        const c = counts[it.batch_id] || (counts[it.batch_id] = { ...EMPTY_COUNTS });
        c.total += 1;
        c[it.status] = (c[it.status] || 0) + 1;
    }

    return batches.map((b) => ({ ...b, counts: counts[b.id] || { ...EMPTY_COUNTS } }));
}

async function getScheduledBatch(id) {
    const db = await getDb();
    const batches = rowsToObjects(db.exec('SELECT * FROM scheduled_batches WHERE id = ?', [String(id)]));
    if (!batches.length) return null;
    const items = rowsToObjects(db.exec(
        'SELECT * FROM scheduled_batch_items WHERE batch_id = ? ORDER BY id', [String(id)]
    ));
    return { ...batches[0], items };
}

// Batches whose send time has arrived and are still waiting to run.
async function getDueBatches(nowIso) {
    const db = await getDb();
    return rowsToObjects(db.exec(
        "SELECT * FROM scheduled_batches WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at ASC",
        [nowIso]
    ));
}

async function getBatchItems(batchId) {
    const db = await getDb();
    return rowsToObjects(db.exec(
        'SELECT * FROM scheduled_batch_items WHERE batch_id = ? ORDER BY id', [String(batchId)]
    ));
}

async function markBatchStatus(id, status, { startedAt, finishedAt } = {}) {
    const db = await getDb();
    db.run(
        `UPDATE scheduled_batches SET status = ?,
           started_at  = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at)
         WHERE id = ?`,
        [status, startedAt || null, finishedAt || null, String(id)]
    );
    flush();
}

async function markItemStatus(itemId, status, { error, sentAt } = {}) {
    const db = await getDb();
    db.run(
        `UPDATE scheduled_batch_items SET status = ?, error = ?, sent_at = COALESCE(?, sent_at)
         WHERE id = ?`,
        [status, error || null, sentAt || null, itemId]
    );
    flush();
}

// Only a not-yet-started batch can be canceled. Returns { ok, reason?, status? }.
async function cancelScheduledBatch(id) {
    const db = await getDb();
    const rows = rowsToObjects(db.exec('SELECT status FROM scheduled_batches WHERE id = ?', [String(id)]));
    if (!rows.length) return { ok: false, reason: 'not_found' };
    if (rows[0].status !== 'scheduled') return { ok: false, reason: 'not_cancelable', status: rows[0].status };
    db.run(
        "UPDATE scheduled_batches SET status = 'canceled', finished_at = ? WHERE id = ?",
        [new Date().toISOString(), String(id)]
    );
    flush();
    return { ok: true };
}

// After a restart, resume any batch caught mid-run: re-arm 'running' batches
// and reset 'sending' items so the next tick re-processes whatever hadn't
// reached a terminal state. Already-'sent' items are left untouched.
async function recoverInterruptedBatches() {
    const db = await getDb();
    db.run("UPDATE scheduled_batch_items SET status = 'pending' WHERE status = 'sending'");
    db.run("UPDATE scheduled_batches SET status = 'scheduled', started_at = NULL WHERE status = 'running'");
    // Email jobs that were mid-flight die with the process — mark them failed
    // so the UI doesn't poll forever and a retry can start a new job.
    db.run(
        `UPDATE email_jobs SET status = 'failed', finished_at = ?, error = ?
         WHERE status = 'pending'`,
        [
            Date.now(),
            'Server restarted while this send was in progress. Please try again.',
        ]
    );
    flushNow();
}

// ── On-demand email jobs ───────────────────────────────────────────────────
const EMAIL_JOB_TTL_MS = 5 * 60 * 1000;
const EMAIL_JOB_STALE_PENDING_MS = 10 * 60 * 1000;

async function upsertEmailJob(id, { status, startedAt, finishedAt, result, error }) {
    const db = await getDb();
    const existing = rowsToObjects(db.exec('SELECT * FROM email_jobs WHERE id = ?', [String(id)]));
    const prev = existing[0] || null;
    const started = startedAt != null ? startedAt : (prev ? Number(prev.started_at) : Date.now());
    const finished = finishedAt != null ? finishedAt : (prev?.finished_at != null ? Number(prev.finished_at) : null);
    const resultJson = result !== undefined
        ? JSON.stringify(result)
        : (prev?.result_json || null);
    const err = error !== undefined ? error : (prev?.error || null);

    db.run(
        `INSERT INTO email_jobs (id, status, started_at, finished_at, result_json, error)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           result_json = excluded.result_json,
           error = excluded.error`,
        [String(id), status, started, finished, resultJson, err]
    );
    flushNow();
}

async function getEmailJob(id) {
    const db = await getDb();
    const rows = rowsToObjects(db.exec('SELECT * FROM email_jobs WHERE id = ?', [String(id)]));
    if (!rows.length) return null;
    const row = rows[0];
    let status = row.status;
    let finishedAt = row.finished_at != null ? Number(row.finished_at) : null;
    let error = row.error || null;
    const startedAt = Number(row.started_at);

    // Abandoned mid-flight (process died before we could mark failed).
    if (status === 'pending' && Date.now() - startedAt > EMAIL_JOB_STALE_PENDING_MS) {
        status = 'failed';
        finishedAt = Date.now();
        error = error || 'Send timed out on the server. Please try again.';
        db.run(
            `UPDATE email_jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?`,
            [status, finishedAt, error, String(id)]
        );
        flushNow();
    }

    // Completed jobs expire so dedupe doesn't pin forever.
    if (status !== 'pending' && finishedAt && Date.now() - finishedAt > EMAIL_JOB_TTL_MS) {
        db.run('DELETE FROM email_jobs WHERE id = ?', [String(id)]);
        flushNow();
        return null;
    }

    let result = null;
    if (row.result_json) {
        try { result = JSON.parse(row.result_json); } catch (_) { result = null; }
    }

    return {
        status,
        startedAt,
        finishedAt: finishedAt || undefined,
        result: result || undefined,
        error: error || undefined,
    };
}

async function pruneEmailJobs() {
    const db = await getDb();
    const cutoff = Date.now() - EMAIL_JOB_TTL_MS;
    db.run(
        `DELETE FROM email_jobs WHERE status != 'pending' AND finished_at IS NOT NULL AND finished_at < ?`,
        [cutoff]
    );
    flush();
}

module.exports = {
    upsertRecord,
    findMatchingRecords,
    getAllRecords,
    updateQuestions,
    getTotalResults,
    getLatestUpdatedAt,
    getContacts,
    setContacts,
    getAllContacts,
    createScheduledBatch,
    listScheduledBatches,
    getScheduledBatch,
    getDueBatches,
    getBatchItems,
    markBatchStatus,
    markItemStatus,
    cancelScheduledBatch,
    recoverInterruptedBatches,
    upsertEmailJob,
    getEmailJob,
    pruneEmailJobs,
};
