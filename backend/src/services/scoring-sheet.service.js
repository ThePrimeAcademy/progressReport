// services/scoring-sheet.service.js
// Stores and reads DSAT scoring sheets: tables that convert a raw score (number
// of correct answers) into a scaled section score.
//
// There are two kinds of sheet, both stored the same way:
//
//   1. The shared library - three sheets per subject (Easy, Medium, Hard) for
//      Reading & Writing and for Math. An exam is categorised as Easy / Medium
//      / Hard per subject and is graded with the matching library sheet.
//      Key: `library:<level>`.
//   2. A custom sheet uploaded for one exam (key `exam:<examId>`), or for one
//      legacy ClassMarker group (key = the group id). Used when an exam has no
//      difficulty set for that subject.
//
// Storage layout:
//   DATA_DIR/scoring-sheets/<key>__<section>.json
//
// Section is one of: 'math' | 'rw'.
// Record schema:
//   { groupId, section, bound, uploadedAt, originalFilename, columnLabel?,
//     copiedFrom?, curve: [{ raw, lower, upper }, ...] }
//
// A sheet may give a score RANGE per raw score (lower/upper). `bound` picks
// which end is used. A sheet with one score per raw score stores it in both.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { detectScoreTable, detectScoreTables, gridFromText, RAW_MAX } = require('./sheet-parser.service');

const execFileAsync = promisify(execFile);

const GRID_SCRIPT_PATH = path.join(__dirname, '../scripts/xlsx_to_grid.py');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const SHEETS_DIR = path.join(DATA_DIR, 'scoring-sheets');

const VALID_SECTIONS = new Set(['math', 'rw']);
const VALID_BOUNDS = new Set(['upper', 'lower']);
// Difficulty levels of the shared library, easiest first.
const LEVELS = ['easy', 'medium', 'hard'];
const LIBRARY_PREFIX = 'library:';
// A scaled score outside this is a typo, whatever the test.
const MAX_SCALED = 1600;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Bumped on every curve mutation so derived caches (e.g. the report preview
// dedupe key) invalidate as soon as scoring changes.
let version = 0;
function getCurvesVersion() {
  return version;
}

function ensureDir() {
  if (!fs.existsSync(SHEETS_DIR)) fs.mkdirSync(SHEETS_DIR, { recursive: true });
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function curvePath(groupId, section) {
  return path.join(SHEETS_DIR, `${safeId(groupId)}__${safeId(section)}.json`);
}

function assertSection(section) {
  if (!VALID_SECTIONS.has(section)) {
    throw fail(`section must be one of: ${[...VALID_SECTIONS].join(', ')}`);
  }
}

function assertBound(bound) {
  if (!VALID_BOUNDS.has(bound)) {
    throw fail(`bound must be one of: ${[...VALID_BOUNDS].join(', ')}`);
  }
}

// ── Library keys ──────────────────────────────────────────────

function isLevel(value) {
  return LEVELS.includes(value);
}

function libraryKey(level) {
  if (!isLevel(level)) throw fail(`level must be one of: ${LEVELS.join(', ')}`);
  return `${LIBRARY_PREFIX}${level}`;
}

// ── Reading an uploaded file ──────────────────────────────────

async function xlsxToSheets(buffer) {
  const tmpPath = path.join(os.tmpdir(), `scoring-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync('python3', [GRID_SCRIPT_PATH, tmpPath], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20000,
    });
    return JSON.parse(stdout).sheets || [];
  } catch (err) {
    console.error('[scoring-sheet] Could not read workbook:', err.stderr || err.message);
    throw fail('Could not read this file as an Excel workbook. Save it as .xlsx and try again, or paste the cells instead.');
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  }
}

// Reads an uploaded file or pasted text and returns every score table found.
//   { tables: [{ sheetName, columns: [{ label }], rows: [{ raw, values }],
//                rawMin, rawMax, warnings }] }
// One table per worksheet that contains one; pasted text and CSV yield one.
async function parseSheet({ fileBase64, text }) {
  if (typeof text === 'string' && text.trim()) {
    return { tables: [{ sheetName: null, ...detectScoreTable(gridFromText(text)) }] };
  }
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    throw fail('Upload a file or paste the sheet contents.');
  }
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length === 0) throw fail('The uploaded file is empty.');

  // .xlsx is a zip archive ("PK"). The legacy binary .xls format is not.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return { tables: detectScoreTables(await xlsxToSheets(buffer)) };
  }
  if (buffer.subarray(0, 1024).includes(0)) {
    throw fail('This file type is not supported. Use an .xlsx or .csv file (old .xls files need to be re-saved as .xlsx), or paste the cells instead.');
  }
  return { tables: [{ sheetName: null, ...detectScoreTable(gridFromText(buffer.toString('utf-8'))) }] };
}

// ── Saving ────────────────────────────────────────────────────

// Validates points supplied by the client (already picked out of a parsed
// table) and returns them sorted by raw score.
function normalizeCurve(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw fail('A scoring sheet needs at least two raw → score rows.');
  }
  if (points.length > RAW_MAX + 1) throw fail('This scoring sheet has too many rows.');
  const seen = new Set();
  const out = points.map((p) => {
    const raw = Number(p?.raw);
    const lower = Number(p?.lower);
    const upper = Number(p?.upper);
    if (!Number.isInteger(raw) || raw < 0 || raw > RAW_MAX) {
      throw fail(`Raw scores must be whole numbers between 0 and ${RAW_MAX}.`);
    }
    for (const v of [lower, upper]) {
      if (!Number.isInteger(v) || v < 0 || v > MAX_SCALED) {
        throw fail(`Scaled scores must be whole numbers between 0 and ${MAX_SCALED} (check raw score ${raw}).`);
      }
    }
    if (seen.has(raw)) throw fail(`Raw score ${raw} is listed twice.`);
    seen.add(raw);
    return { raw, lower: Math.min(lower, upper), upper: Math.max(lower, upper) };
  });
  return out.sort((a, b) => a.raw - b.raw);
}

function writeRecord(record) {
  ensureDir();
  fs.writeFileSync(curvePath(record.groupId, record.section), JSON.stringify(record, null, 2));
  version++;
  return record;
}

// Save explicit points. `bound` defaults to whatever the sheet being replaced
// used, so re-uploading a corrected file keeps the Lower/Upper choice.
function saveCurve(groupId, section, { curve, bound, originalFilename, columnLabel }) {
  if (!groupId) throw fail('groupId is required');
  assertSection(section);
  const finalBound = bound || getCurve(groupId, section)?.bound || 'upper';
  assertBound(finalBound);
  return writeRecord({
    groupId: String(groupId),
    section,
    bound: finalBound,
    uploadedAt: new Date().toISOString(),
    originalFilename: originalFilename ? String(originalFilename).slice(0, 200) : null,
    columnLabel: columnLabel ? String(columnLabel).slice(0, 60) : null,
    curve: normalizeCurve(curve),
  });
}

// Upload a file and save it in one step, without a preview. Only works when
// the file leaves nothing to choose: one worksheet with either a single score
// column or a Lower/Upper pair.
async function saveCurveFromBase64(groupId, section, base64Data, originalFilename, bound) {
  if (!groupId) throw fail('groupId is required');
  assertSection(section);
  const { tables } = await parseSheet({ fileBase64: base64Data });
  if (tables.length > 1) {
    throw fail(`This workbook has ${tables.length} sheets with score tables (${tables.map((t) => t.sheetName).join(', ')}). Choose one in the upload preview.`);
  }
  const table = tables[0];
  if (table.columns.length > 2) {
    throw fail(`This sheet has ${table.columns.length} score columns (${table.columns.map((c) => c.label).join(', ')}). Choose one in the upload preview.`);
  }
  const [lowerIndex, upperIndex] = table.columns.length === 2 ? [0, 1] : [0, 0];
  const curve = table.rows
    .filter((row) => row.values[lowerIndex] != null && row.values[upperIndex] != null)
    .map((row) => ({ raw: row.raw, lower: row.values[lowerIndex], upper: row.values[upperIndex] }));
  return saveCurve(groupId, section, { curve, bound, originalFilename });
}

function setBound(groupId, section, bound) {
  assertSection(section);
  assertBound(bound);
  const record = getCurve(groupId, section);
  if (!record) throw fail('No scoring sheet found for this group/section', 404);
  return writeRecord({ ...record, bound });
}

// Reuse an already-stored sheet under another key without re-uploading the
// file - copies the points and bound, and records where it came from.
function copyCurve(fromGroupId, toGroupId, section) {
  assertSection(section);
  if (!toGroupId) throw fail('toGroupId is required');
  if (String(fromGroupId) === String(toGroupId)) {
    throw fail('Source and target are the same sheet');
  }
  const source = getCurve(fromGroupId, section);
  if (!source) throw fail('No scoring sheet found on the source for this section', 404);
  return writeRecord({
    groupId: String(toGroupId),
    section,
    bound: source.bound || 'upper',
    uploadedAt: new Date().toISOString(),
    originalFilename: source.originalFilename || null,
    columnLabel: source.columnLabel || null,
    copiedFrom: { groupId: String(fromGroupId), section },
    curve: source.curve,
  });
}

function deleteCurve(groupId, section) {
  assertSection(section);
  const p = curvePath(groupId, section);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  version++;
  return true;
}

// ── Reading ───────────────────────────────────────────────────

function getCurve(groupId, section) {
  if (!groupId || !VALID_SECTIONS.has(section)) return null;
  const p = curvePath(groupId, section);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.error('[scoring-sheet] Failed to parse stored curve', p, err.message);
    return null;
  }
}

// Everything the UI needs to describe a sheet without sending all its points.
// `hash` is the same for any two sheets with identical points, so the UI can
// tell that several exams are really using one sheet.
function summarizeCurve(record) {
  const points = record.curve || [];
  const bound = record.bound || 'upper';
  const scores = points.map((p) => (bound === 'lower' ? p.lower : p.upper));
  return {
    groupId: record.groupId,
    section: record.section,
    bound,
    uploadedAt: record.uploadedAt || null,
    originalFilename: record.originalFilename || null,
    columnLabel: record.columnLabel || null,
    copiedFrom: record.copiedFrom || null,
    points: points.length,
    rawMin: points[0]?.raw ?? null,
    rawMax: points[points.length - 1]?.raw ?? null,
    scoreMin: scores.length ? Math.min(...scores) : null,
    scoreMax: scores.length ? Math.max(...scores) : null,
    // Only a sheet with a real range has a meaningful Lower/Upper choice.
    hasRange: points.some((p) => p.lower !== p.upper),
    // The score at half and three quarters of the questions right: two
    // reference points for comparing one sheet against another at a glance.
    samples: points.length
      ? [0.5, 0.75].map((share) => {
        const raw = Math.round(points[points.length - 1].raw * share);
        return { raw, score: gradeScaled(record, raw) };
      })
      : [],
    hash: crypto.createHash('sha1').update(JSON.stringify(points)).digest('hex').slice(0, 12),
  };
}

// { [groupId]: { [section]: summary } } for every stored sheet.
function listCurves() {
  ensureDir();
  const out = {};
  for (const entry of fs.readdirSync(SHEETS_DIR)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(SHEETS_DIR, entry), 'utf-8'));
      if (!record.groupId || !record.section || !Array.isArray(record.curve)) continue;
      if (!out[record.groupId]) out[record.groupId] = {};
      out[record.groupId][record.section] = summarizeCurve(record);
    } catch (_) { /* skip broken files */ }
  }
  return out;
}

// The shared library as { rw: { easy, medium, hard }, math: { ... } }, each
// slot a summary or null when nothing has been uploaded to it yet.
function listLibrary() {
  const out = {};
  for (const section of VALID_SECTIONS) {
    out[section] = {};
    for (const level of LEVELS) {
      const record = getCurve(libraryKey(level), section);
      out[section][level] = record ? summarizeCurve(record) : null;
    }
  }
  return out;
}

// ── Grading ───────────────────────────────────────────────────

// Scaled score for a raw correct count, honoring the sheet's `bound`
// ('upper' unless set). A raw score beyond the ends of the sheet is clamped to
// the nearest end; a raw score the sheet skips uses the next lower listed one
// (the next higher if there is none). Returns null only when there is no
// sheet.
function gradeScaled(curveRecord, rawCorrect) {
  const points = curveRecord?.curve;
  if (!Array.isArray(points) || points.length === 0) return null;
  const raw = Math.max(0, Math.round(Number(rawCorrect) || 0));
  let below = null;
  let above = null;
  for (const p of points) {
    if (p.raw === raw) { below = p; above = null; break; }
    if (p.raw < raw && (!below || p.raw > below.raw)) below = p;
    if (p.raw > raw && (!above || p.raw < above.raw)) above = p;
  }
  const hit = below || above;
  return curveRecord.bound === 'lower' ? hit.lower : hit.upper;
}

module.exports = {
  parseSheet,
  saveCurve,
  saveCurveFromBase64,
  setBound,
  copyCurve,
  getCurve,
  listCurves,
  listLibrary,
  summarizeCurve,
  deleteCurve,
  gradeScaled,
  getCurvesVersion,
  libraryKey,
  isLevel,
  LEVELS,
  VALID_SECTIONS,
  VALID_BOUNDS,
};
