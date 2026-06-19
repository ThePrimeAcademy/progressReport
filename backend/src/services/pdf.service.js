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
    // A null total means the student didn't complete the test — show it as "Not
    // taken" rather than a fabricated score.
    const taken = s.total != null;
    const accent = taken ? '#1a56db' : '#6b7280';
    return `
      <div style="flex:1 1 0;min-width:0;background:#fafbff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
        <div style="font-size:0.7rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(s.groupName || 'SAT')}
        </div>
        <div style="font-size:1.4rem;font-weight:700;color:${accent};line-height:1;">${taken ? s.total : '—'}</div>
        ${taken
          ? `<div style="font-size:0.7rem;color:var(--muted);margin-top:5px;white-space:nowrap;">RW ${s.english ?? '—'} &middot; M ${s.math ?? '—'}</div>`
          : `<div style="font-size:0.66rem;color:var(--muted);margin-top:5px;white-space:nowrap;font-style:italic;">Not taken</div>`}
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

// ── Program summary (group report) ────────────────────────────
// A one-page "how did the group do" report: headline improvement stats, the
// average-score progression across the program's exams, and a per-student
// first→latest improvement table. Driven by a summary object from
// program-summary.service so the rendering stays data-source agnostic.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return date || '—';
  return `${SHORT_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}
function programProgressionCards(progression) {
  return progression.map((e, i) => {
    const prev = i > 0 ? progression[i - 1] : null;
    const delta = prev && e.avgTotal != null && prev.avgTotal != null ? e.avgTotal - prev.avgTotal : null;
    const deltaHtml = delta == null ? ''
      : `<span style="display:inline-block;margin-left:9px;font-size:0.74rem;font-weight:700;color:${delta >= 0 ? '#15803d' : '#b91c1c'};background:${delta >= 0 ? '#dcfce7' : '#fee2e2'};padding:2px 9px;border-radius:6px;">${delta >= 0 ? '+' : ''}${delta}</span>`;
    return `
      <div style="flex:1 1 0;min-width:0;background:#fafbff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;">
        <div style="font-size:0.76rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.name)}</div>
        <div style="display:flex;align-items:baseline;"><span style="font-size:1.85rem;font-weight:700;color:#1a56db;line-height:1;">${e.avgTotal ?? '—'}</span>${deltaHtml}</div>
        <div style="font-size:0.8rem;color:var(--muted);margin-top:8px;white-space:nowrap;">RW ${e.avgRw ?? '—'} &middot; M ${e.avgMath ?? '—'}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:4px;white-space:nowrap;">${e.n} student${e.n === 1 ? '' : 's'} &middot; ${escapeHtml(e.date || '')}</div>
      </div>`;
  }).join('');
}

// Average-total trend across the program's exams — a simple line chart that
// fills the page and shows the group's climb at a glance.
function buildProgressionChart(progression) {
  const pts = (progression || []).filter((e) => e.avgTotal != null);
  if (pts.length < 2) return '';
  const W = 720; const H = 360; const padL = 30; const padR = 30; const padT = 34; const padB = 44;
  const vals = pts.map((p) => p.avgTotal);
  const span = (Math.max(...vals) - Math.min(...vals)) || 1;
  // Very tight, asymmetric padding so the line nearly fills the (tall) plot —
  // the climb reads as steep. A little extra headroom up top leaves room for
  // the value label above the highest point.
  const lo = Math.min(...vals) - Math.max(6, Math.round(span * 0.03));
  const hi = Math.max(...vals) + Math.max(26, Math.round(span * 0.11));
  const x = (i) => padL + (i * (W - padL - padR)) / (pts.length - 1);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.avgTotal).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
  const grid = [0.25, 0.5, 0.75].map((f) => {
    const gy = (padT + f * (H - padT - padB)).toFixed(1);
    return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#eef1f8" stroke-width="1"/>`;
  }).join('');
  // Anchor the first/last labels inward so long exam names don't clip the edges.
  const anchorFor = (i) => (i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle');
  const minVal = Math.min(...vals);
  const dots = pts.map((p, i) => {
    const cx = x(i).toFixed(1);
    const anchor = anchorFor(i);
    // The lowest point sits where the steep line rises through it — lift its
    // value label clear of the line.
    const labelDy = p.avgTotal === minVal ? 24 : 14;
    return `
    <circle cx="${cx}" cy="${y(p.avgTotal).toFixed(1)}" r="5" fill="#1a56db"/>
    <text x="${cx}" y="${(y(p.avgTotal) - labelDy).toFixed(1)}" text-anchor="${anchor}" font-size="17" font-weight="700" fill="#1a56db">${p.avgTotal}</text>
    <text x="${cx}" y="${(H - padB + 24).toFixed(1)}" text-anchor="${anchor}" font-size="13" fill="#6b7280">${escapeHtml(p.name)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
    ${grid}
    <path d="${area}" fill="#eef2ff"/>
    <path d="${line}" fill="none" stroke="#1a56db" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}

async function generateProgramSummaryPDF(summary) {
  const h = summary.headline || {};
  // Labels and subs wrap (rather than clip) so the narrow four-up cards never
  // overflow the page; the value stays on one line.
  const stat = (label, value, sub, color, valueSize = '2.05rem') => `
    <div style="flex:1 1 0;min-width:0;border:1px solid var(--border);border-radius:14px;padding:13px 14px;background:#fff;">
      <div style="font-size:0.66rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);line-height:1.25;min-height:2.3em;">${label}</div>
      <div style="font-size:${valueSize};font-weight:700;color:${color};line-height:1.02;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;">${value}</div>
      <div style="font-size:0.72rem;color:var(--muted);margin-top:7px;line-height:1.3;">${sub}</div>
    </div>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    :root{--ink:#0f1623;--accent:#1a56db;--muted:#6b7280;--border:#dde3f0;}
    html{font-size:14px;} body{font-family:'DM Sans',Arial,sans-serif;color:var(--ink);background:#fff;padding:22px 28px;line-height:1.5;}
    .brand{font-family:'DM Serif Display',Georgia,serif;font-size:1.85rem;color:var(--accent);letter-spacing:-0.5px;}
    .section-title{font-family:'DM Serif Display',Georgia,serif;font-size:1.3rem;color:var(--ink);margin:18px 0 11px;padding-bottom:5px;border-bottom:2px solid #e8f0fe;}
  </style></head><body>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid var(--accent);padding-bottom:9px;margin-bottom:14px;">
      <div><div class="brand">Program Summary</div><div style="font-size:0.86rem;color:var(--muted);margin-top:3px;">How the group is performing</div></div>
      <div style="text-align:right;font-size:0.8rem;color:var(--muted);">${escapeHtml(summary.generatedDate || '')}</div>
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:1.65rem;">${escapeHtml(summary.programName || 'Program')}</div>
      <div style="font-size:0.86rem;color:var(--muted);margin-top:3px;">${summary.studentCount} students enrolled &middot; ${summary.examsCompleted} of ${summary.examCount} exams completed</div>
    </div>
    <div style="display:flex;gap:11px;">
      ${stat('Avg Improvement', `${h.avgImprovement == null ? '—' : (h.avgImprovement >= 0 ? '+' : '') + h.avgImprovement}`, `${escapeHtml(h.firstName || 'Initial')} &rarr; Superscore`, h.avgImprovement != null && h.avgImprovement < 0 ? '#b91c1c' : '#15803d')}
      ${stat('Students Improved', `${h.improvedCount ?? 0}/${h.comparedCount ?? 0}`, h.comparedCount ? `${Math.round((h.improvedCount / h.comparedCount) * 100)}% of the group` : '—', '#1a56db')}
      ${stat('Group Average Now', `${h.latestAvg ?? '—'}`, `on ${escapeHtml(h.lastName || '')}`, '#1a56db')}
      ${stat('Date Range', h.firstDate && h.lastDate ? `${fmtShort(h.firstDate)}&nbsp;&ndash;&nbsp;${fmtShort(h.lastDate)}` : '—', h.lastDate ? String(h.lastDate).slice(0, 4) : `${summary.examsCompleted} exam${summary.examsCompleted === 1 ? '' : 's'}`, '#475569', '0.95rem')}
    </div>
    <div class="section-title">Group progression</div>
    <div style="display:flex;gap:12px;flex-wrap:nowrap;">${programProgressionCards(summary.progression || [])}</div>
    <div class="section-title">Average score trend</div>
    <div style="border:1px solid var(--border);border-radius:14px;padding:14px 16px;background:#fff;">${buildProgressionChart(summary.progression || [])}</div>
  </body></html>`;

  try {
    return await renderPdf(html);
  } catch (err) {
    console.warn('[pdf] Program summary render failed, relaunching browser:', err.message);
    browserPromise = null;
    return renderPdf(html);
  }
}

module.exports = { generateReportPDF, generateProgramSummaryPDF };