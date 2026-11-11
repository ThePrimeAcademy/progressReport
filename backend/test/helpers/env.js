// Test environment: every test file gets its own empty data directory and no
// ClassMarker credentials, so nothing touches real data or the network.
// Require this BEFORE any service - they read DATA_DIR when first loaded.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progressreport-test-'));
process.env.DATA_DIR = dataDir;
delete process.env.CLASSMARKER_API_KEY;
delete process.env.CLASSMARKER_API_SECRET;

process.on('exit', () => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
});

// Build a real .xlsx from { sheets: [{ name, rows }] } and return it base64
// encoded, the way the browser uploads it.
function makeXlsxBase64(spec) {
  const out = path.join(dataDir, `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  execFileSync('python3', [path.join(__dirname, 'make_xlsx.py'), out], { input: JSON.stringify(spec) });
  const base64 = fs.readFileSync(out).toString('base64');
  fs.rmSync(out, { force: true });
  return base64;
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf-8'));
}

module.exports = { dataDir, makeXlsxBase64, fixture };
