const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { letterGrade } = require('./stats.service');

const TEMPLATE_PATH = path.join(__dirname, '../templates/report.template.html');

// Cap the number of per-question rows shown in any single PDF block so the
// "Latest Test Performance" panel doesn't push to a second page. Overflow is
// summarised as "and N more (X correct)" — full per-question detail is still
// available in the live web report.
const MAX_QUESTIONS_PER_BLOCK = 10;

const YES_CELL = '<span style="color:#15803d;font-weight:700;">Yes</span>';
const NO_CELL = '<span style="color:#b91c1c;font-weight:700;">No</span>';

function renderTemplate(replacements) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value ?? '');
  }
  return html;
}

function scoreColor(pct) {
  if (pct >= 80) return '#15803d';
  if (pct >= 60) return '#1a56db';
  return '#b91c1c';
}
function scoreBg(pct) {
  if (pct >= 80) return '#dcfce7';
  if (pct >= 60) return '#dbeafe';
  return '#fee2e2';
}

// ── Latest Test Performance ───────────────────────────────────
function buildSectionTable(sectionNum, questions) {
  const isEN = sectionNum <= 2;
  const headerBg = isEN ? '#f0fdf4' : '#eff6ff';
  const headerColor = isEN ? '#15803d' : '#1a56db';
  const correct = questions.filter((q) => q.correct).length;
  const pct = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;

  const shown = questions.slice(0, MAX_QUESTIONS_PER_BLOCK);
  const hidden = questions.slice(MAX_QUESTIONS_PER_BLOCK);

  const rows = shown.map((q, i) => `
    <tr>
      <td>${sectionNum} - ${q.question_number ?? i + 1}</td>
      <td>${q.category_name || '—'}</td>
      <td style="text-align:center;">${q.correct ? YES_CELL : NO_CELL}</td>
    </tr>`).join('');

  let overflowRow = '';
  if (hidden.length > 0) {
    const hiddenCorrect = hidden.filter((q) => q.correct).length;
    overflowRow = `
      <tr>
        <td colspan="3" style="text-align:center;color:#6b7280;font-style:italic;font-size:0.66rem;padding:6px 8px;">
          …and ${hidden.length} more question${hidden.length === 1 ? '' : 's'} (${hiddenCorrect} correct)
        </td>
      </tr>`;
  }

  return `
    <div style="margin-bottom:8px;">
      <div class="q-section-header" style="background:${headerBg};">
        <span class="q-section-label" style="color:${headerColor};">${isEN ? 'EN' : 'MA'} — Section ${sectionNum}</span>
        <span class="q-section-stat">${correct}/${questions.length} (${pct}%)</span>
      </div>
      <table class="q-table">
        <thead><tr><th>Section - Q</th><th>Question Category</th><th style="text-align:center;">Correct?</th></tr></thead>
        <tbody>${rows}${overflowRow}</tbody>
      </table>
    </div>`;
}

function buildLatestTestSection(latestTest) {
  if (!latestTest) return '';

  const questions = latestTest.questions || [];
  const gc = scoreColor(latestTest.percentage);
  const gcBg = scoreBg(latestTest.percentage);
  const grade = letterGrade(latestTest.percentage);

  let questionHtml = '';
  if (questions.length > 0) {
    const sectionMap = {};
    for (const q of questions) {
      const sec = q.section_number ?? 0;
      if (!sectionMap[sec]) sectionMap[sec] = [];
      sectionMap[sec].push(q);
    }
    const sectionNums = Object.keys(sectionMap).map(Number).sort((a, b) => a - b);
    const hasSections = sectionNums.some((s) => s >= 1 && s <= 4);

    if (hasSections) {
      const enSecs = sectionNums.filter((s) => s === 1 || s === 2);
      const maSecs = sectionNums.filter((s) => s === 3 || s === 4);
      const enHtml = enSecs.map((s) => buildSectionTable(s, sectionMap[s])).join('');
      const maHtml = maSecs.map((s) => buildSectionTable(s, sectionMap[s])).join('');
      questionHtml = `<div class="q-grid"><div class="q-col">${enHtml}</div><div class="q-col">${maHtml}</div></div>`;
    } else {
      // flat fallback — split into 2 columns, each capped at MAX_QUESTIONS_PER_BLOCK
      const half = Math.ceil(questions.length / 2);
      const makeCol = (col, startIdx) => {
        const shown = col.slice(0, MAX_QUESTIONS_PER_BLOCK);
        const hidden = col.slice(MAX_QUESTIONS_PER_BLOCK);
        const hiddenCorrect = hidden.filter((q) => q.correct).length;
        const overflowRow = hidden.length > 0
          ? `<tr><td colspan="3" style="text-align:center;color:#6b7280;font-style:italic;font-size:0.66rem;padding:6px 8px;">…and ${hidden.length} more question${hidden.length === 1 ? '' : 's'} (${hiddenCorrect} correct)</td></tr>`
          : '';
        return `
        <table class="q-table" style="border:1px solid var(--border);">
          <thead><tr><th>Q</th><th>Question Category</th><th style="text-align:center;">Correct?</th></tr></thead>
          <tbody>${shown.map((q, i) => `
            <tr>
              <td>Q${q.question_number ?? startIdx + i + 1}</td>
              <td>${q.category_name || '—'}</td>
              <td style="text-align:center;">${q.correct ? YES_CELL : NO_CELL}</td>
            </tr>`).join('')}${overflowRow}
          </tbody>
        </table>`;
      };
      questionHtml = `<div class="q-grid"><div>${makeCol(questions.slice(0, half), 0)}</div><div>${makeCol(questions.slice(half), half)}</div></div>`;
    }
  } else {
    questionHtml = `<p style="font-size:0.75rem;color:#6b7280;font-style:italic;padding:8px 0;">Question-level data not available. Enable "Questions / Responses / Category results" in ClassMarker webhook settings.</p>`;
  }

  return `
    <div style="margin-bottom:18px;">
      <div class="section-title">Latest Test Performance</div>
      <div class="latest-test-header">
        <div>
          <div class="latest-test-name">${latestTest.testName}</div>
          <div class="latest-test-meta">${latestTest.groupName} &nbsp;·&nbsp; ${latestTest.date} &nbsp;·&nbsp; ${latestTest.duration}</div>
        </div>
        <div class="qa-badge">
          <span>Question Analysis</span>
          <span class="pct-badge" style="color:${gc};">${latestTest.percentage}%</span>
          <span class="grade-badge grade-${grade}" style="background:${gcBg};color:${gc};">${grade}</span>
        </div>
      </div>
      ${questionHtml}
    </div>`;
}

// ── Weekly Performance ────────────────────────────────────────
// `forceColor` lets callers paint the score regardless of percentage — used so
// rows under the Weaknesses strip never look green just because the student
// happened to miss only one or two questions.
function buildCatRow(cat, i, forceColor) {
  const color = forceColor || scoreColor(cat.percentage);
  return `
    <tr>
      <td style="white-space:nowrap;">${cat.name}</td>
      <td style="font-weight:600;color:${color};">${cat.correct}/${cat.total}</td>
    </tr>`;
}

function buildSubjectBox(subject, dotColor, headerBg, strengths, weaknesses) {
  const tableFor = (cats, forceColor) => cats.length > 0
    ? `<table class="cat-table">
        <thead><tr><th>Problem Category</th><th>Score</th></tr></thead>
        <tbody>${cats.map((c, i) => buildCatRow(c, i, forceColor)).join('')}</tbody>
       </table>`
    : `<div style="padding:10px 14px;font-size:0.85rem;color:#6b7280;font-style:italic;">No data available.</div>`;

  return `
    <div class="cat-box">
      <div class="cat-box-header" style="background:${headerBg};">
        <div class="cat-box-title">
          <span class="cat-dot" style="background:${dotColor};"></span>
          ${subject}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;">
        <div style="border-right:1px solid var(--border);">
          <div class="subject-strip" style="background:#f0fdf4;color:#15803d;">
            <span>▲ Strengths</span>
          </div>
          ${tableFor(strengths, '#15803d')}
        </div>
        <div>
          <div class="subject-strip" style="background:#fef2f2;color:#b91c1c;">
            <span>▼ Weaknesses</span>
          </div>
          ${tableFor(weaknesses, '#b91c1c')}
        </div>
      </div>
    </div>`;
}

function buildWeeklySection(categoryPerfSplit, categoryPerf) {
  let enCats = [];
  let maCats = [];

  if (categoryPerfSplit && (categoryPerfSplit.english?.length || categoryPerfSplit.math?.length)) {
    enCats = categoryPerfSplit.english || [];
    maCats = categoryPerfSplit.math || [];
  } else if (categoryPerf && categoryPerf.length > 0) {
    const isEN = (n) => /word|context|grammar|purpose|rhetoric|synthesis|reading|quotation|claim|transition|structure|function/i.test(n);
    enCats = categoryPerf.filter((c) => isEN(c.name));
    maCats = categoryPerf.filter((c) => !isEN(c.name));
  }

  if (!enCats.length && !maCats.length) return '';

  const TOP = 3;
  // Tiebreak by total question count (desc) so a 4/4 outranks a 2/2 and a 0/4 outranks a 0/1.
  const topN = (cats) => [...cats].sort((a, b) => b.percentage - a.percentage || b.total - a.total).slice(0, TOP);
  // Weaknesses must actually be weaknesses — exclude perfect-score categories
  // even if that means fewer than 3 entries.
  const botN = (cats) => [...cats]
    .filter((c) => c.percentage < 100)
    .sort((a, b) => a.percentage - b.percentage || b.total - a.total)
    .slice(0, TOP);

  return `
    <div style="margin-bottom:10px;">
      <div class="section-title">Weekly Performance</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${buildSubjectBox('English', '#1a56db', '#eff6ff', topN(enCats), botN(enCats))}
        ${buildSubjectBox('Math', '#1a56db', '#eff6ff', topN(maCats), botN(maCats))}
      </div>
    </div>`;
}

// ── Test rows ─────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One card per SAT exam attempt, newest first — mirrors the web preview's
// SatScoreHistory strip rendered under the four headline score cards.
function buildSatHistorySection(allScores) {
  if (!allScores || allScores.length === 0) return '';
  const cards = allScores.map((s) => {
    const accent = s.total != null ? '#1a56db' : '#6b7280';
    return `
      <div style="flex:1 1 0;min-width:0;background:#fafbff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
        <div style="font-size:0.7rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(s.groupName || 'SAT')}
        </div>
        <div style="font-size:1.4rem;font-weight:700;color:${accent};line-height:1;">${s.total ?? '—'}</div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:5px;white-space:nowrap;">RW ${s.english ?? '—'} &middot; M ${s.math ?? '—'}</div>
        ${s.date ? `<div style="font-size:0.66rem;color:var(--muted);margin-top:2px;white-space:nowrap;">${escapeHtml(s.date)}</div>` : ''}
      </div>`;
  }).join('');
  // Single row — cards shrink to fit however many exams there are.
  return `<div style="display:flex;gap:8px;flex-wrap:nowrap;margin:0 0 12px;">${cards}</div>`;
}

// ── Homework completion ───────────────────────────────────────
// Admin-entered completed/total counts. Parent-facing bar: ≥80% green,
// 60–79% orange, below 60% red.
function homeworkColor(pct) {
  if (pct >= 80) return { bar: '#15803d', bg: '#dcfce7' };
  if (pct >= 60) return { bar: '#ea580c', bg: '#ffedd5' };
  return { bar: '#b91c1c', bg: '#fee2e2' };
}

function buildHomeworkSection(homework) {
  if (!homework || !homework.total) return '';
  const pct = Math.round((homework.completed / homework.total) * 100);
  const c = homeworkColor(pct);
  return `
    <div style="margin:0 0 12px;">
      <div class="section-title">HW Completion</div>
      <div style="background:#fafbff;border:1px solid var(--border);border-radius:10px;padding:9px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:0.8rem;color:var(--muted);font-weight:600;">
            Completed <strong style="color:${c.bar};">${homework.completed}</strong> of ${homework.total} assignment${homework.total === 1 ? '' : 's'}
          </span>
          <span style="background:${c.bg};color:${c.bar};font-weight:700;font-size:0.78rem;padding:3px 10px;border-radius:6px;">${pct}%</span>
        </div>
        <div class="score-bar-track" style="display:block;width:100%;">
          <div class="score-bar-fill" style="width:${Math.min(pct, 100)}%;background:${c.bar};"></div>
        </div>
      </div>
    </div>`;
}

function buildTestRows(groups) {
  const allTests = groups.flatMap((g) => g.results);
  allTests.sort((a, b) => new Date(a.date) - new Date(b.date));

  return allTests.map((r, i) => {
    const grade = letterGrade(r.percentage);
    const color = scoreColor(r.percentage);
    return `
      <tr>
        <td class="num-cell">${i + 1}</td>
        <td style="font-weight:500;">${r.testName}</td>
        <td style="color:#6b7280;white-space:nowrap;">${r.date}</td>
        <td><span style="font-weight:600;color:${color};">${r.score}/${r.maxScore}</span></td>
        <td style="font-weight:600;color:${color};">${r.percentage}%</td>
        <td><span class="grade-badge grade-${grade}">${grade}</span></td>
        <td><div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round(r.percentage)}%;background:${color};"></div></div></td>
      </tr>`;
  }).join('');
}

// ── Main export ───────────────────────────────────────────────
async function generateReportPDF(student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, categoryPerfSplit, homework) {
  const now = new Date();
  const grade = letterGrade(stats.averageScore);
  const reportId = `PR-${Date.now().toString(36).toUpperCase()}`;
  const initials = student.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const totalTests = groups.reduce((s, g) => s + g.results.length, 0);
  const lowestColor = stats.lowestScore >= 60 ? '#1a56db' : '#b91c1c';

  const replacements = {
    studentName: student.name,
    studentId: student.id,
    initials,
    generatedDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    startDate: new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    endDate: new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    reportId,
    year: now.getFullYear(),
    totalTests,
    totalGroups: groups.length,
    satLatestTestScore: satScores?.latestTestScore ?? '—',
    satLatestEnglishScore: satScores?.latestEnglishScore ?? '—',
    satLatestMathScore: satScores?.latestMathScore ?? '—',
    satSuperScore: satScores?.superScore ?? '—',
    satHistorySection: buildSatHistorySection(satScores?.allScores),
    homeworkSection: buildHomeworkSection(homework),
    // latestTestSection: buildLatestTestSection(latestTest), // hidden from PDF — restore this line (and delete the '' line below) to bring back "Latest Test Performance"
    latestTestSection: '',
    weeklySection: buildWeeklySection(categoryPerfSplit, categoryPerf),
  };

  const html = renderTemplate(replacements);
  try {
    return await renderPdf(html);
  } catch (err) {
    // The shared browser may have died between renders (OOM kill, crash) —
    // relaunch once and retry before giving up.
    console.warn('[pdf] Render failed, relaunching browser:', err.message);
    browserPromise = null;
    return renderPdf(html);
  }
}

// ── Shared Chromium instance ──────────────────────────────────
// Launching Chromium per render took several seconds on Railway and is the
// dominant cost of a PDF job (bulk email even launched several browsers in
// parallel). Keep one instance alive and give each render its own page.
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      const alive = typeof existing.isConnected === 'function' ? existing.isConnected() : existing.connected;
      if (alive) return existing;
    } catch (_) { /* fall through and relaunch */ }
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browserPromise;
}

async function renderPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Don't wait for full network-idle — the template @imports Google Fonts and
    // a slow/flaky CDN response was causing first-request 500s. Load the DOM,
    // then wait up to 5s for fonts; fall back to the CSS fallback stack if not.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close().catch(() => { /* browser may already be gone */ });
  }
}

module.exports = { generateReportPDF };