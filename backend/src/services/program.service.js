// services/program.service.js
// Programs group SAT exams into a cohort (e.g. a summer program "GA SAT 2026")
// and own the student roster for every exam inside them. Enrolling a student in
// a program makes all of that program's exams appear in their SAT report —
// taken exams show their score, not-yet-taken ones show as upcoming
// placeholders — while students not in the program never see those exams.
//
// Storage: DATA_DIR/programs.json —
//   [{ programId, name, studentIds: ["<user_id>", ...],
//      examOrderCustom: boolean, createdAt, updatedAt }]
//
// examOrderCustom: set the first time an admin drags the program's exams into
// a manual order. Until then the exam list endpoint shows them by date.
//
// The exam ↔ program link lives on the exam (exam.programId), so a program
// carries no exam list of its own — see exam.service. An exam without a
// programId stays "ungrouped" and behaves as it always has (visible to anyone
// who took it, rostered individually via exam.studentIds).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const PROGRAMS_FILE = path.join(DATA_DIR, 'programs.json');

let programs = null; // lazy-loaded, kept in memory between writes

// Bumped on every mutation so derived caches (e.g. report preview dedupe keys)
// invalidate when program rosters change.
let version = 0;
function getProgramsVersion() {
  return version;
}

function load() {
  if (programs) return programs;
  try {
    if (fs.existsSync(PROGRAMS_FILE)) {
      programs = JSON.parse(fs.readFileSync(PROGRAMS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[programs] Could not read programs.json:', e.message);
  }
  if (!Array.isArray(programs)) programs = [];
  return programs;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROGRAMS_FILE, JSON.stringify(programs, null, 2));
  version++;
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
}

function listPrograms() {
  return load().slice();
}

function getProgram(programId) {
  if (programId == null) return null;
  return load().find((p) => p.programId === String(programId)) || null;
}

// Roster of a program as a Set of user ids — the SAT score gate. Returns an
// empty set for unknown programs so callers can treat "no program" as
// "nobody enrolled" without a null check.
function getProgramRoster(programId) {
  return new Set(getProgram(programId)?.studentIds || []);
}

function createProgram({ name, studentIds }) {
  if (!name || !String(name).trim()) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const now = new Date().toISOString();
  const program = {
    programId: crypto.randomUUID(),
    name: String(name).trim(),
    studentIds: normalizeIds(studentIds),
    createdAt: now,
    updatedAt: now,
  };
  load().push(program);
  save();
  return program;
}

function updateProgram(programId, { name, studentIds, archived }) {
  const all = load();
  const idx = all.findIndex((p) => p.programId === String(programId));
  if (idx < 0) throw Object.assign(new Error('Program not found'), { status: 404 });
  if (name != null && !String(name).trim()) {
    throw Object.assign(new Error('name cannot be empty'), { status: 400 });
  }
  const now = new Date().toISOString();
  // Archiving an "over" program hides every exam inside it from student SAT
  // reports without deleting any data — flip it back on to bring them back.
  const nextArchived = archived != null ? Boolean(archived) : Boolean(all[idx].archived);
  all[idx] = {
    ...all[idx],
    name: name != null ? String(name).trim() : all[idx].name,
    studentIds: studentIds != null ? normalizeIds(studentIds) : (all[idx].studentIds || []),
    archived: nextArchived,
    archivedAt: nextArchived ? (all[idx].archivedAt || now) : null,
    updatedAt: now,
  };
  save();
  return all[idx];
}

// Whether a program is archived ("over") — its exams are suppressed from
// student SAT reports. Unknown programs are treated as not archived.
function isProgramArchived(programId) {
  return Boolean(getProgram(programId)?.archived);
}

// The (non-archived) program a student is enrolled in, or null. Used to scope a
// student's weekly class-average comparison to their own cohort. First match
// wins if somehow enrolled in several.
function getProgramForStudent(studentId) {
  const sid = String(studentId);
  return load().find((p) => !p.archived && (p.studentIds || []).includes(sid)) || null;
}

// Remember that this program's exams were manually ordered — from then on the
// stored array order wins over the default date sort. Called by
// exam.service.reorderExams; unknown ids are ignored.
function markExamOrderCustom(programId) {
  const all = load();
  const idx = all.findIndex((p) => p.programId === String(programId));
  if (idx < 0 || all[idx].examOrderCustom) return;
  all[idx] = { ...all[idx], examOrderCustom: true, updatedAt: new Date().toISOString() };
  save();
}

function deleteProgram(programId) {
  const all = load();
  const idx = all.findIndex((p) => p.programId === String(programId));
  if (idx < 0) return false;
  all.splice(idx, 1);
  save();
  return true;
}

module.exports = {
  listPrograms,
  getProgram,
  getProgramRoster,
  getProgramForStudent,
  createProgram,
  updateProgram,
  isProgramArchived,
  markExamOrderCustom,
  deleteProgram,
  getProgramsVersion,
};
