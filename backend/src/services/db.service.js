// services/db.service.js
// SQLite store using sql.js (pure JS, no native compilation needed).
// Persists to disk at DATA_DIR/progressreport.db
// On Railway: mount a volume at /data and set DATA_DIR=/data

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'progressreport.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const initSqlJs = require('sql.js');

let _db = null;
let _dirty = false;

// Flush to disk every 5 seconds if dirty
setInterval(() => {
    if (_dirty && _db) {
        try {
            fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
            _dirty = false;
        } catch (e) {
            console.error('[db] Failed to flush:', e.message);
        }
    }
}, 5000);

// Also flush on exit
process.on('exit', () => {
    if (_dirty && _db) {
        try { fs.writeFileSync(DB_PATH, Buffer.from(_db.export())); } catch (_) { }
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
};