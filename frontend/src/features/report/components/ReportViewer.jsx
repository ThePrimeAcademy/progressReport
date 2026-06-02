// features/report/components/ReportViewer.jsx
import React, { useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import ScoringSheetUpload from './ScoringSheetUpload.jsx';
import EmailReportPanel from './EmailReportPanel.jsx';

const SAT_GROUP_NAME = /sat/i;
function isSatGroupName(name) {
  return SAT_GROUP_NAME.test(String(name || ''));
}

// ── Helpers ──────────────────────────────────────────────────
function letterGrade(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}
function gradeColor(pct) {
  if (pct >= 80) return { bg: '#dcfce7', color: '#15803d' };
  if (pct >= 60) return { bg: '#dbeafe', color: '#1a56db' };
  return { bg: '#fee2e2', color: '#b91c1c' };
}
function ScoreBar({ pct }) {
  const c = pct >= 80 ? '#15803d' : pct >= 60 ? '#1a56db' : '#b91c1c';
  return (
    <div style={{ background: '#e5e7eb', borderRadius: 99, height: 6, width: '100%', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, background: c, height: '100%', borderRadius: 99 }} />
    </div>
  );
}
function SectionTitle({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--ink)',
      marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid var(--accent-dim)',
    }}>
      {children}
    </div>
  );
}
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1.5px solid var(--border)',
      borderRadius: 12, padding: '20px 24px', boxShadow: 'var(--shadow)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── SAT Score placeholder cards ───────────────────────────────
function SATScores({ satScores }) {
  const scores = [
    { label: 'Latest Test Score', value: satScores?.latestTestScore ?? '—', color: '#1a56db' },
    { label: 'Latest English Score', value: satScores?.latestEnglishScore ?? '—', color: '#15803d' },
    { label: 'Latest Math Score', value: satScores?.latestMathScore ?? '—', color: '#b45309' },
    { label: 'Super Score', value: satScores?.superScore ?? '—', color: '#7c3aed' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      {scores.map((s) => (
        <div key={s.label} style={{
          background: 'var(--bg)', border: '1.5px solid var(--border)',
          borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            {s.label}
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>
            {s.value}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 4 }}>
            {satScores?.source === 'excel' || satScores?.source === 'sheets' ? 'From SAT workbook' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── SAT score history (one card per SAT attempt, newest first) ───
function SatScoreHistory({ allScores }) {
  if (!allScores || allScores.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
      {allScores.map((s) => {
        const accent = s.total != null ? '#1a56db' : '#6b7280';
        return (
          <div
            key={s.groupId}
            style={{
              flex: 1,
              minWidth: 150,
              background: '#fafbff',
              border: '1.5px solid var(--border)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            <div
              style={{
                fontSize: '0.7rem',
                color: 'var(--muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                marginBottom: 6,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={s.groupName}
            >
              {s.groupName || 'SAT'}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: accent, lineHeight: 1 }}>
              {s.total ?? '—'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 6 }}>
              RW {s.english ?? '—'} · M {s.math ?? '—'}
            </div>
            {s.date && (
              <div style={{ fontSize: '0.66rem', color: 'var(--muted)', marginTop: 2 }}>
                {s.date}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Overall stats ─────────────────────────────────────────────
function OverallStats({ stats, totalTests, totalGroups }) {
  const cards = [
    { label: 'Average Score', value: `${stats.averageScore}%`, sub: 'overall', accent: 'var(--accent)' },
    { label: 'Highest Score', value: `${stats.highestScore}%`, sub: 'personal best', accent: '#15803d' },
    { label: 'Lowest Score', value: `${stats.lowestScore}%`, sub: 'needs attention', accent: stats.lowestScore < 60 ? '#b91c1c' : '#1a56db' },
    { label: 'Tests Taken', value: totalTests, sub: `${totalGroups} group${totalGroups !== 1 ? 's' : ''}`, accent: 'var(--accent)' },
    {
      label: 'Trend', value: stats.trend === 'improving' ? '↑ Improving' : stats.trend === 'declining' ? '↓ Declining' : '→ Stable',
      sub: 'over period', accent: stats.trend === 'improving' ? '#15803d' : stats.trend === 'declining' ? '#b91c1c' : '#6b7280'
    },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ flex: 1, minWidth: 110, background: '#fafbff', border: '1.5px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.accent, lineHeight: 1 }}>{c.value}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Latest Test Performance ───────────────────────────────────
function SectionTable({ section, questions }) {
  const isEN = section <= 2;
  const headerBg = isEN ? '#f0fdf4' : '#eff6ff';
  const headerColor = isEN ? '#15803d' : '#1a56db';
  const correctCount = questions.filter((q) => q.correct).length;
  const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: headerBg, borderRadius: '8px 8px 0 0',
        padding: '6px 12px', borderBottom: '1.5px solid var(--border)',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: headerColor, letterSpacing: '0.04em' }}>
          {isEN ? 'EN' : 'MA'} — Section {section}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          {correctCount}/{questions.length} correct ({pct}%)
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem' }}>
        <thead>
          <tr style={{ background: '#f8faff' }}>
            <th style={thStyle}>Section - Q</th>
            <th style={thStyle}>Category</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Correct?</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? '#fff' : '#fafbff' }}>
              <td style={tdStyle}>{`${section} - ${q.question_number ?? i + 1}`}</td>
              <td style={tdStyle}>{q.category_name || '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {q.correct
                  ? <span style={{ color: '#15803d', fontWeight: 700, fontSize: '1rem' }}>Yes</span>
                  : <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: '1rem' }}>No</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LatestTestSection({ latestTest }) {
  if (!latestTest) return (
    <Card style={{ marginBottom: 24 }}>
      <SectionTitle>Latest Test Performance</SectionTitle>
      <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No test found in selected range.</div>
    </Card>
  );

  const gc = gradeColor(latestTest.percentage);

  return (
    <Card style={{ marginBottom: 24 }}>
      <SectionTitle>Latest Test Performance</SectionTitle>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{latestTest.testName}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
            {latestTest.groupName} &nbsp;·&nbsp; {latestTest.date} &nbsp;·&nbsp; {latestTest.duration}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: gc.color }}>{latestTest.percentage}%</span>
          <span style={{ background: gc.bg, color: gc.color, fontWeight: 700, fontSize: '0.8rem', padding: '3px 10px', borderRadius: 6 }}>
            {letterGrade(latestTest.percentage)}
          </span>
        </div>
      </div>
    </Card>
  );
}

const thStyle = { padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: '0.68rem', color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' };
const tdStyle = { padding: '6px 10px', color: 'var(--ink)' };

// ── Weekly Performance — category strengths/weaknesses ────────
function CategoryBox({ title, categories, accent, bg }) {
  if (!categories || categories.length === 0) return (
    <div style={{ flex: 1, minWidth: 280, border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', background: bg, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{title}</span>
        </div>
      </div>
      <div style={{ padding: '16px', color: 'var(--muted)', fontSize: '0.82rem' }}>No category data available.</div>
    </div>
  );

  const avg = Math.round(categories.reduce((s, c) => s + c.percentage, 0) / categories.length);
  const gc = gradeColor(avg);

  return (
    <div style={{ flex: 1, minWidth: 280, border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', background: bg, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{title}</span>
        </div>
        <span style={{ background: gc.bg, color: gc.color, fontWeight: 700, fontSize: '0.75rem', padding: '3px 10px', borderRadius: 5 }}>
          Avg {avg}% · {letterGrade(avg)}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#f8faff' }}>
            <th style={thStyle}>Problem Category</th>
            <th style={thStyle}>Score</th>
            <th style={thStyle}>%</th>
            <th style={thStyle}>Performance</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => {
            const cc = gradeColor(c.percentage);
            return (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? '#fff' : '#fafbff' }}>
                <td style={tdStyle}>{c.name}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: cc.color }}>{c.correct}/{c.total}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: cc.color }}>{c.percentage}%</td>
                <td style={{ ...tdStyle, minWidth: 100 }}><ScoreBar pct={c.percentage} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeeklyPerformance({ categoryPerf, categoryPerfSplit }) {
  // Prefer subject-split data (from webhook questions); fall back to flat list with keyword heuristic
  const hasSplit = categoryPerfSplit && (
    (categoryPerfSplit.english && categoryPerfSplit.english.length > 0) ||
    (categoryPerfSplit.math && categoryPerfSplit.math.length > 0)
  );

  let enCategories = [];
  let maCategories = [];

  if (hasSplit) {
    enCategories = categoryPerfSplit.english || [];
    maCategories = categoryPerfSplit.math || [];
  } else if (categoryPerf && categoryPerf.length > 0) {
    // keyword fallback
    const isEnglish = (name) =>
      /word|context|grammar|purpose|rhetoric|synthesis|reading|quotation|claim|transition|structure|function/i.test(name);
    enCategories = categoryPerf.filter((c) => isEnglish(c.name));
    maCategories = categoryPerf.filter((c) => !isEnglish(c.name));
  }

  const enSorted = [...enCategories].sort((a, b) => b.percentage - a.percentage);
  const maSorted = [...maCategories].sort((a, b) => b.percentage - a.percentage);

  const TOP = 3;
  const enStrengths = enSorted.slice(0, TOP);
  const enWeaknesses = [...enCategories].sort((a, b) => a.percentage - b.percentage).slice(0, TOP);
  const maStrengths = maSorted.slice(0, TOP);
  const maWeaknesses = [...maCategories].sort((a, b) => a.percentage - b.percentage).slice(0, TOP);

  const hasData = enCategories.length > 0 || maCategories.length > 0;

  if (!hasData) return (
    <Card style={{ marginBottom: 24 }}>
      <SectionTitle>Weekly Performance</SectionTitle>
      <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
        No category data available. Make sure "Questions / Responses / Category results" is enabled in your ClassMarker webhook settings.
      </div>
    </Card>
  );

  return (
    <Card style={{ marginBottom: 24 }}>
      <SectionTitle>Weekly Performance</SectionTitle>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <CategoryBox title="English — Strengths" categories={enStrengths} accent="#15803d" bg="#f0fdf4" />
        <CategoryBox title="Math — Strengths" categories={maStrengths} accent="#1a56db" bg="#eff6ff" />
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <CategoryBox title="English — Weaknesses" categories={enWeaknesses} accent="#b91c1c" bg="#fff1f2" />
        <CategoryBox title="Math — Weaknesses" categories={maWeaknesses} accent="#b45309" bg="#fffbeb" />
      </div>
    </Card>
  );
}

// ── Group section (existing tests view) ──────────────────────
function GroupSection({ group, sheets, onChanged }) {
  const [open, setOpen] = useState(true);
  const avg = group.results.length
    ? Math.round(group.results.reduce((s, r) => s + r.percentage, 0) / group.results.length * 10) / 10
    : 0;
  const gc = gradeColor(avg);
  const showUpload = isSatGroupName(group.groupName);

  return (
    <div style={{ border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', background: open ? 'var(--accent-dim)' : '#fafbff',
          cursor: 'pointer', userSelect: 'none',
          borderBottom: open ? '1.5px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{group.groupName}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 9px' }}>
            {group.results.length} test{group.results.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: gc.bg, color: gc.color, fontWeight: 700, fontSize: '0.78rem', padding: '3px 10px', borderRadius: 5 }}>
            Avg {avg}% · {letterGrade(avg)}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: '0.82rem', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
        </div>
      </div>

      {open && showUpload && (
        <ScoringSheetUpload groupId={group.groupId} sheets={sheets} onChanged={onChanged} />
      )}

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: '#f1f5ff' }}>
                {['Test Name', 'Date', 'Score', '%', 'Grade', 'Performance', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.results.map((r, i) => {
                const gc2 = gradeColor(r.percentage);
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? '#fff' : '#fafbff' }}>
                    <td style={{ padding: '9px 14px', fontWeight: 500 }}>{r.testName}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.date}</td>
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600, color: gc2.color }}>{r.score}</span>
                      <span style={{ color: 'var(--muted)' }}>/{r.maxScore}</span>
                    </td>
                    <td style={{ padding: '9px 14px', fontWeight: 600, color: gc2.color }}>{r.percentage}%</td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ background: gc2.bg, color: gc2.color, fontWeight: 700, fontSize: '0.75rem', padding: '3px 8px', borderRadius: 5 }}>
                        {letterGrade(r.percentage)}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', minWidth: 110 }}><ScoreBar pct={r.percentage} /></td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: r.passed ? '#dcfce7' : '#fee2e2', color: r.passed ? '#15803d' : '#b91c1c' }}>
                        {r.passed ? '✓ Passed' : '✗ Failed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ReportViewer ─────────────────────────────────────────
export default function ReportViewer({
  data, onDownload, downloadLoading, downloadError, downloadSuccess,
  scoringSheets, onScoringSheetsChanged,
  contacts, onContactsChange, onSaveContacts, onSendEmail,
  emailConfigured, emailLoading, emailError, emailSuccess,
  emailSubject, onEmailSubjectChange,
}) {
  const { student, groups, stats, satScores, startDate, endDate, latestTest, categoryPerf, categoryPerfSplit } = data;
  const totalTests = groups.reduce((s, g) => s + g.results.length, 0);
  const totalGroups = groups.length;

  return (
    <div style={{ marginTop: 28, animation: 'fadeIn 0.4s ease' }}>

      {/* Student header + download */}
      <div style={{
        background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 14,
        padding: '20px 24px', marginBottom: 20, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 50, height: 50, borderRadius: '50%', background: 'var(--accent)',
              color: '#fff', fontFamily: 'var(--font-serif)', fontSize: '1.2rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {student.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem' }}>{student.name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                {student.email} &nbsp;·&nbsp; {startDate} → {endDate} &nbsp;·&nbsp; {totalTests} test{totalTests !== 1 ? 's' : ''} across {totalGroups} group{totalGroups !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <Button onClick={onDownload} loading={downloadLoading} size="md">↓ Download PDF</Button>
        </div>

        {/* SAT score placeholders */}
        <SATScores satScores={satScores} />

        {/* Full SAT score history — replaces the old Average/Highest/Lowest/Trend strip */}
        <SatScoreHistory allScores={satScores?.allScores} />

        {downloadSuccess && (
          <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, color: '#15803d', fontSize: '0.85rem', fontWeight: 500 }}>
            ✓ PDF opened in new tab!
          </div>
        )}
        {downloadError && (
          <div style={{ padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' }}>
            ⚠ {downloadError}
          </div>
        )}

        {onSendEmail && (
          <EmailReportPanel
            studentName={student.name}
            contacts={contacts}
            onChange={onContactsChange}
            onSave={onSaveContacts}
            onSend={onSendEmail}
            configured={emailConfigured}
            loading={emailLoading}
            error={emailError}
            success={emailSuccess}
            subject={emailSubject}
            onSubjectChange={onEmailSubjectChange}
          />
        )}
      </div>

      {/* Latest test performance */}
      <LatestTestSection latestTest={latestTest} />

      {/* Weekly performance — categories */}
      <WeeklyPerformance categoryPerf={categoryPerf} categoryPerfSplit={categoryPerfSplit} />

      {/* All tests grouped by class */}
      <div style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 14, padding: '20px 24px', boxShadow: 'var(--shadow)' }}>
        <SectionTitle>All Tests by Group</SectionTitle>
        {groups.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>No results found in selected range.</div>
        ) : (
          groups.map((g) => (
            <GroupSection
              key={g.groupId}
              group={g}
              sheets={scoringSheets?.[g.groupId]}
              onChanged={onScoringSheetsChanged}
            />
          ))
        )}
      </div>

    </div>
  );
}