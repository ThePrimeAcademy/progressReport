// services/exam.service.js
// Admin-defined SAT exams. An exam maps up to four ClassMarker tests onto
// DSAT sections (1-2 = Reading & Writing, 3-4 = Math), decoupling SAT scoring
// from the old "one group = one exam with tests named 'Section N:'" rule —
// groups now hold more than one exam and test names no longer follow that
// naming convention.
//
// Storage: DATA_DIR/exams.json —
//   [{ examId, name, date: "YYYY-MM-DD" | null, programId: "<id>" | null,
//      sections: { "1": { testId, testName } | null, ... "4" },
//      studentIds: ["<user_id>", ...], hiddenStudentIds: ["<user_id>", ...],
//      createdAt, updatedAt }]
//
// programId: optional link to a program (see program.service). When set, the
// program owns the roster — the exam's score is gated by program enrollment,
// not by exam.studentIds — and all of the program's exams auto-appear for
// enrolled students. An exam with no programId is "ungrouped" and behaves as
// it always has (rostered individually via studentIds, visible to any taker).
//
// date / studentIds: planning fields — exams can be created in advance as
// placeholders (no tests assigned yet) with a scheduled date and the roster
// of students who will take it. Tests get attached later via update.
// hiddenStudentIds: per-exam exclusions — these students' attempts on the
// exam's tests are ignored everywhere the exam is scored (SAT score cards,
// history, weekly category performance).
//
// Scoring curves for an exam live in scoring-sheet.service under the key
// `exam:<examId>` (sections 'rw' | 'math'), reusing the same storage and
// upload pipeline as the legacy per-group curves.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');

const SECTION_KEYS = ['1', '2', '3', '4'];

let exams = null; // lazy-loaded, kept in memory between writes

// Bumped on every exam mutation so derived caches (e.g. the report preview
// dedupe key) invalidate when definitions change.
let version = 0;
function getExamsVersion() {
  return version;
}

function load() {
  if (exams) return exams;
  try {
    if (fs.existsSync(EXAMS_FILE)) {
      exams = JSON.parse(fs.readFileSync(EXAMS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[exams] Could not read exams.json:', e.message);
  }
  if (!Array.isArray(exams)) exams = [];
  return exams;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EXAMS_FILE, JSON.stringify(exams, null, 2));
  version++;
}

function listExams() {
  return load().slice();
}

function getExam(examId) {
  return load().find((e) => e.examId === String(examId)) || null;
}

function normalizeSections(sections) {
  const out = {};
  for (const key of SECTION_KEYS) {
    const s = sections?.[key];
    out[key] = s && s.testId != null
      ? { testId: String(s.testId), testName: s.testName || null }
      : null;
  }
  return out;
}

function normalizeHidden(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
}

function normalizeProgramId(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

function normalizeDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 });
  }
  return s;
}

function validateExam(name, sections, ignoreExamId) {
  if (!name || !String(name).trim()) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  // Zero assigned sections is allowed — exams can be created in advance as
  // placeholders and have their tests attached once they exist in ClassMarker.
  const assigned = SECTION_KEYS.map((k) => sections[k]).filter(Boolean);
  const ids = assigned.map((s) => s.testId);
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('The same test cannot fill two sections'), { status: 400 });
  }
  // A test may belong to only one exam — otherwise its raw score would count
  // toward two different scaled scores.
  for (const exam of load()) {
    if (exam.examId === ignoreExamId) continue;
    for (const key of SECTION_KEYS) {
      const s = exam.sections?.[key];
      if (s && ids.includes(s.testId)) {
        throw Object.assign(
          new Error(`Test "${s.testName || s.testId}" is already used by exam "${exam.name}"`),
          { status: 400 }
        );
      }
    }
  }
}

function createExam({ name, date, programId, sections, studentIds, hiddenStudentIds }) {
  const normalized = normalizeSections(sections);
  validateExam(name, normalized, null);
  const now = new Date().toISOString();
  const exam = {
    examId: crypto.randomUUID(),
    name: String(name).trim(),
    date: normalizeDate(date),
    programId: normalizeProgramId(programId),
    sections: normalized,
    studentIds: normalizeHidden(studentIds),
    hiddenStudentIds: normalizeHidden(hiddenStudentIds),
    createdAt: now,
    updatedAt: now,
  };
  load().push(exam);
  save();
  return exam;
}

function updateExam(examId, { name, date, programId, sections, studentIds, hiddenStudentIds }) {
  const all = load();
  const idx = all.findIndex((e) => e.examId === String(examId));
  if (idx < 0) throw Object.assign(new Error('Exam not found'), { status: 404 });
  const next = {
    ...all[idx],
    name: name != null ? String(name).trim() : all[idx].name,
    date: date !== undefined ? normalizeDate(date) : (all[idx].date || null),
    // programId === undefined → leave as-is; null/'' → clear; string → set.
    programId: programId !== undefined
      ? normalizeProgramId(programId)
      : (all[idx].programId || null),
    sections: sections != null ? normalizeSections(sections) : all[idx].sections,
    studentIds: studentIds != null
      ? normalizeHidden(studentIds)
      : (all[idx].studentIds || []),
    hiddenStudentIds: hiddenStudentIds != null
      ? normalizeHidden(hiddenStudentIds)
      : (all[idx].hiddenStudentIds || []),
    updatedAt: new Date().toISOString(),
  };
  validateExam(next.name, next.sections, next.examId);
  all[idx] = next;
  save();
  return next;
}

// Copy an exam's planning data (name + student roster) into a new
// placeholder. Sections can't be copied — a test may belong to only one
// exam — and the date/hidden list are specific to the original sitting.
function duplicateExam(examId) {
  const source = getExam(examId);
  if (!source) throw Object.assign(new Error('Exam not found'), { status: 404 });
  return createExam({
    name: `${source.name} (copy)`,
    date: null,
    programId: source.programId || null,
    sections: {},
    studentIds: source.studentIds || [],
    hiddenStudentIds: [],
  });
}

// Detach every exam from a program — called when that program is deleted so
// its exams survive as ungrouped rather than pointing at a missing program.
// Returns the count of exams that were detached.
function clearProgram(programId) {
  const all = load();
  const pid = String(programId);
  let changed = 0;
  for (const exam of all) {
    if (exam.programId === pid) {
      exam.programId = null;
      exam.updatedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed) save();
  return changed;
}

function deleteExam(examId) {
  const all = load();
  const idx = all.findIndex((e) => e.examId === String(examId));
  if (idx < 0) return false;
  all.splice(idx, 1);
  save();
  return true;
}

// testId → { examId, examName, section: 1|2|3|4, hidden: Set<userId> } across
// all defined exams. Consumed by sat.service (score bucketing) and
// webhook.service (latest-exam selection + English/Math split). `hidden`
// carries the exam's excluded student ids so consumers can skip their
// attempts without re-reading the exam list.
function getTestSectionMap() {
  const map = new Map();
  for (const exam of load()) {
    const hidden = new Set(exam.hiddenStudentIds || []);
    for (const key of SECTION_KEYS) {
      const s = exam.sections?.[key];
      if (s?.testId != null) {
        map.set(String(s.testId), {
          examId: exam.examId,
          examName: exam.name,
          section: Number(key),
          hidden,
        });
      }
    }
  }
  return map;
}

// Curve storage key for an exam — passed wherever scoring-sheet.service
// expects its `groupId` parameter.
function examCurveKey(examId) {
  return `exam:${examId}`;
}

module.exports = {
  listExams,
  getExam,
  createExam,
  updateExam,
  duplicateExam,
  deleteExam,
  clearProgram,
  getTestSectionMap,
  examCurveKey,
  getExamsVersion,
  SECTION_KEYS,
};
