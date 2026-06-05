// services/scoring-sheet.service.js
// Persists and retrieves DSAT scoring curves uploaded per (groupId, section).
//
// Storage layout:
//   backend/data/scoring-sheets/<groupId>__<section>.json
//
// Section is one of: 'math' | 'rw'.
// Curve record schema:
//   { groupId, section, uploadedAt, originalFilename, curve: [{ raw, lower, upper }, ...] }
//
// Grading uses the UPPER bound of the curve at the student's raw correct count.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(__dirname, '../scripts/parse_scoring_sheet.py');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const SHEETS_DIR = path.join(DATA_DIR, 'scoring-sheets');

const VALID_SECTIONS = new Set(['math', 'rw']);
const VALID_BOUNDS = new Set(['upper', 'lower']);

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

async function parseXlsxBuffer(buffer) {
  const tmpPath = path.join(os.tmpdir(), `scoring-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync('python3', [SCRIPT_PATH, tmpPath]);
    const parsed = JSON.parse(stdout);
    if (!parsed.curve || !Array.isArray(parsed.curve) || parsed.curve.length === 0) {
      throw new Error('Parsed curve was empty');
    }
    return parsed.curve;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
  }
}

async function saveCurveFromBase64(groupId, section, base64Data, originalFilename, bound = 'upper') {
  if (!groupId) throw Object.assign(new Error('groupId is required'), { status: 400 });
  if (!VALID_SECTIONS.has(section)) {
    throw Object.assign(new Error(`section must be one of: ${[...VALID_SECTIONS].join(', ')}`), { status: 400 });
  }
  if (!VALID_BOUNDS.has(bound)) {
    throw Object.assign(new Error(`bound must be one of: ${[...VALID_BOUNDS].join(', ')}`), { status: 400 });
  }
  if (!base64Data || typeof base64Data !== 'string') {
    throw Object.assign(new Error('file (base64) is required'), { status: 400 });
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) throw Object.assign(new Error('Decoded file was empty'), { status: 400 });

  const curve = await parseXlsxBuffer(buffer);

  // Preserve the existing bound if the user previously chose 'lower' for this
  // (group, section) and is now re-uploading without specifying it again.
  const existing = getCurve(groupId, section);
  const finalBound = bound || existing?.bound || 'upper';

  ensureDir();
  const record = {
    groupId: String(groupId),
    section,
    bound: finalBound,
    uploadedAt: new Date().toISOString(),
    originalFilename: originalFilename || null,
    curve,
  };
  fs.writeFileSync(curvePath(groupId, section), JSON.stringify(record, null, 2));
  version++;
  return record;
}

function setBound(groupId, section, bound) {
  if (!VALID_SECTIONS.has(section)) {
    throw Object.assign(new Error(`section must be one of: ${[...VALID_SECTIONS].join(', ')}`), { status: 400 });
  }
  if (!VALID_BOUNDS.has(bound)) {
    throw Object.assign(new Error(`bound must be one of: ${[...VALID_BOUNDS].join(', ')}`), { status: 400 });
  }
  const record = getCurve(groupId, section);
  if (!record) {
    throw Object.assign(new Error('No curve found for this group/section'), { status: 404 });
  }
  record.bound = bound;
  fs.writeFileSync(curvePath(groupId, section), JSON.stringify(record, null, 2));
  version++;
  return record;
}

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

function listCurves() {
  ensureDir();
  const out = {};
  for (const entry of fs.readdirSync(SHEETS_DIR)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(SHEETS_DIR, entry), 'utf-8'));
      if (!record.groupId || !record.section) continue;
      if (!out[record.groupId]) out[record.groupId] = {};
      out[record.groupId][record.section] = {
        uploadedAt: record.uploadedAt,
        originalFilename: record.originalFilename,
        bound: record.bound || 'upper',
        points: record.curve.length,
        rawMin: record.curve[0]?.raw ?? null,
        rawMax: record.curve[record.curve.length - 1]?.raw ?? null,
      };
    } catch (_) { /* skip broken files */ }
  }
  return out;
}

function deleteCurve(groupId, section) {
  if (!VALID_SECTIONS.has(section)) {
    throw Object.assign(new Error(`section must be one of: ${[...VALID_SECTIONS].join(', ')}`), { status: 400 });
  }
  const p = curvePath(groupId, section);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  version++;
  return true;
}

// Returns the UPPER scaled score for the given raw-correct count.
// Clamps to the curve's bounds; returns null if no curve is loaded.
function gradeUpper(curveRecord, rawCorrect) {
  if (!curveRecord || !curveRecord.curve || curveRecord.curve.length === 0) return null;
  const points = curveRecord.curve;
  const raw = Math.max(0, Math.round(Number(rawCorrect) || 0));
  const min = points[0].raw;
  const max = points[points.length - 1].raw;
  const clamped = Math.max(min, Math.min(max, raw));
  const hit = points.find((p) => p.raw === clamped);
  return hit ? hit.upper : null;
}

// Returns the scaled score honoring the record's `bound` setting ('upper'|'lower').
// Falls back to 'upper' when bound is missing (older records).
function gradeScaled(curveRecord, rawCorrect) {
  if (!curveRecord || !curveRecord.curve || curveRecord.curve.length === 0) return null;
  const points = curveRecord.curve;
  const raw = Math.max(0, Math.round(Number(rawCorrect) || 0));
  const min = points[0].raw;
  const max = points[points.length - 1].raw;
  const clamped = Math.max(min, Math.min(max, raw));
  const hit = points.find((p) => p.raw === clamped);
  if (!hit) return null;
  return curveRecord.bound === 'lower' ? hit.lower : hit.upper;
}

module.exports = {
  saveCurveFromBase64,
  setBound,
  getCurve,
  listCurves,
  deleteCurve,
  gradeUpper,
  gradeScaled,
  getCurvesVersion,
  VALID_SECTIONS,
  VALID_BOUNDS,
};
