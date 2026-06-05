// services/exam.service.js
// Admin-defined SAT exams. An exam maps up to four ClassMarker tests onto
// DSAT sections (1-2 = Reading & Writing, 3-4 = Math), decoupling SAT scoring
// from the old "one group = one exam with tests named 'Section N:'" rule —
// groups now hold more than one exam and test names no longer follow that
// naming convention.
//
// Storage: DATA_DIR/exams.json —
//   [{ examId, name, sections: { "1": { testId, testName } | null, ... "4" },
//      hiddenStudentIds: ["<user_id>", ...], createdAt, updatedAt }]
//
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

function validateExam(name, sections, ignoreExamId) {
  if (!name || !String(name).trim()) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const assigned = SECTION_KEYS.map((k) => sections[k]).filter(Boolean);
  if (assigned.length === 0) {
    throw Object.assign(new Error('Assign at least one test to a section'), { status: 400 });
  }
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

function createExam({ name, sections, hiddenStudentIds }) {
  const normalized = normalizeSections(sections);
  validateExam(name, normalized, null);
  const now = new Date().toISOString();
  const exam = {
    examId: crypto.randomUUID(),
    name: String(name).trim(),
    sections: normalized,
    hiddenStudentIds: normalizeHidden(hiddenStudentIds),
    createdAt: now,
    updatedAt: now,
  };
  load().push(exam);
  save();
  return exam;
}

function updateExam(examId, { name, sections, hiddenStudentIds }) {
  const all = load();
  const idx = all.findIndex((e) => e.examId === String(examId));
  if (idx < 0) throw Object.assign(new Error('Exam not found'), { status: 404 });
  const next = {
    ...all[idx],
    name: name != null ? String(name).trim() : all[idx].name,
    sections: sections != null ? normalizeSections(sections) : all[idx].sections,
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
  deleteExam,
  getTestSectionMap,
  examCurveKey,
  getExamsVersion,
  SECTION_KEYS,
};
