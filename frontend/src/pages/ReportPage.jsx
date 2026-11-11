// pages/ReportPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGenerateReport } from '../features/report/hooks/useGenerateReport.js';
import StudentSelector from '../features/report/components/StudentSelector.jsx';
import DateRangePicker from '../features/report/components/DateRangePicker.jsx';
import DayPicker from '../features/report/components/DayPicker.jsx';
import ReportViewer from '../features/report/components/ReportViewer.jsx';
import BulkSendPanel from '../features/report/components/BulkSendPanel.jsx';
import ScheduledQueuePanel from '../features/report/components/ScheduledQueuePanel.jsx';
import ExamManager from '../features/report/components/ExamManager.jsx';
import ScoringSheetLibrary from '../features/report/components/ScoringSheetLibrary.jsx';
import StudentDirectory from '../features/report/components/StudentDirectory.jsx';
import ComposeEmailPanel from '../features/report/components/ComposeEmailPanel.jsx';
import SentLogPanel from '../features/report/components/SentLogPanel.jsx';
import Button from '../components/ui/Button.jsx';
import ErrorBoundary from '../components/ui/ErrorBoundary.jsx';

const s = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(145deg, #f0f4ff 0%, #f7f9ff 60%, #eef2fb 100%)',
    padding: '40px 20px 80px',
  },
  inner: { maxWidth: 1000, margin: '0 auto' },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px 20px', marginBottom: 36 },
  brand: { fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: 'var(--accent)', letterSpacing: '-0.3px' },
  badge: { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px' },
  modeGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 22,
    padding: 3,
    gap: 2,
  },
  // Thin rule between the three groups of tabs (reports · setup · email).
  modeDivider: { width: 1, height: 16, background: 'var(--border)', margin: '0 5px' },
  modePill: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    border: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    padding: '6px 13px',
    borderRadius: 999,
    cursor: 'pointer',
    transition: 'all 0.18s var(--ease)',
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'nowrap',
  },
  modePillActive: {
    background: 'var(--accent)',
    color: '#fff',
  },
  hero: { textAlign: 'center', marginBottom: 32 },
  title: { fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', lineHeight: 1.2, color: 'var(--ink)', marginBottom: 10 },
  sub: { fontSize: '0.92rem', color: 'var(--muted)', maxWidth: 560, margin: '0 auto', lineHeight: 1.65 },
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  cardHead: { padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  cardDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  cardTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  cardBody: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 },
  divider: { height: '1px', background: 'var(--border)' },
  error: { padding: '12px 16px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' },
};

// The tabs, in three groups: looking at reports, setting up what feeds them,
// and emailing them out. `id` doubles as the URL hash, so a refresh or a
// bookmark lands on the same tab.
const TAB_GROUPS = [
  [
    { id: 'directory', label: 'Students', title: 'Student Performance', sub: 'Pick a group to list its students, then view or email any student’s report.' },
    { id: 'single', label: 'Single Student', title: 'Student Report', sub: 'Select a student, date range, and optionally filter by day to generate a detailed report.' },
  ],
  [
    { id: 'programs', label: 'Programs', title: 'Programs & Exams', sub: 'Group exams into programs, enroll students, and choose the scoring sheet each exam uses.' },
    { id: 'sheets', label: 'Scoring Sheets', title: 'Scoring Sheets', sub: 'Three sheets per subject: Easy, Medium and Hard. Each exam uses one English sheet and one Math sheet.' },
  ],
  [
    { id: 'bulk', label: 'Bulk Send', title: 'Send Reports', sub: 'Email progress reports to many students at once, now or on a schedule.' },
    { id: 'email', label: 'Email', title: 'Email Families', sub: 'Write a message to selected students and parents, with or without their report attached.' },
    { id: 'log', label: 'Sent Log', title: 'Sent Emails', sub: 'Every email this system has sent, newest first.' },
  ],
];
const TABS = TAB_GROUPS.flat();

function tabFromHash() {
  const id = window.location.hash.replace(/^#/, '');
  return TABS.some((t) => t.id === id) ? id : 'directory';
}

export default function ReportPage() {
  const {
    students, studentsLoading, studentsError, setStudents,
    filteredStudents,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    downloadLoading, downloadError, downloadSuccess,
    homework, setHomework,
    handlePreview, handleDownload,
    contacts, updateContacts, saveContacts,
    allContacts, allContactsLoading, noteContactsSaved,
    emailConfigured, emailLoading, emailError, emailSuccess,
    emailSubject, setEmailSubject,
    handleEmail,
    isValid,
  } = useGenerateReport();

  // Which tab is showing - one of the TABS ids.
  const [mode, setModeState] = useState(tabFromHash);
  const setMode = useCallback((next) => {
    setModeState(next);
    if (window.location.hash.replace(/^#/, '') !== next) window.location.hash = next;
  }, []);
  useEffect(() => {
    const onHashChange = () => setModeState(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Set when programs, exams or scoring sheets change on their own tabs. The
  // report shown on the Single Student tab is then out of date, so it is
  // re-run the next time that tab is opened.
  const scoringChanged = useRef(false);
  const noteScoringChanged = useCallback(() => { scoringChanged.current = true; }, []);
  const openSheets = useCallback(() => setMode('sheets'), [setMode]);
  // Bumped after a successful schedule so the queue panel refetches immediately.
  const [queueRefresh, setQueueRefresh] = useState(0);
  // Set when the directory's "View Report" is clicked — triggers an automatic
  // preview once the selected student/date state has propagated.
  const [autoPreview, setAutoPreview] = useState(false);

  // Default the date range to the program start → today so the main page's
  // View Report / Email actions work without any setup.
  const DEFAULT_START_DATE = '2026-06-22';
  useEffect(() => {
    if (!startDate && !endDate) {
      const today = new Date();
      setEndDate(today.toISOString().slice(0, 10));
      setStartDate(DEFAULT_START_DATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoPreview && isValid) {
      setAutoPreview(false);
      handlePreview();
    }
  }, [autoPreview, isValid, handlePreview]);

  useEffect(() => {
    if (mode === 'single' && scoringChanged.current) {
      scoringChanged.current = false;
      if (previewData && isValid) handlePreview();
    }
    // Only a tab switch should trigger this, not every preview update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const bulkMode = mode === 'bulk';
  const tab = TABS.find((t) => t.id === mode) || TABS[0];

  return (
    <div style={s.page}>
      <div style={s.inner}>

        <nav style={s.nav}>
          <span style={s.brand}>ProgressReport</span>
          <div role="tablist" aria-label="Sections" style={s.modeGroup}>
            {TAB_GROUPS.map((group, i) => (
              <React.Fragment key={group[0].id}>
                {i > 0 && <span style={s.modeDivider} aria-hidden="true" />}
                {group.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === t.id}
                    onClick={() => setMode(t.id)}
                    style={{ ...s.modePill, ...(mode === t.id ? s.modePillActive : {}) }}
                  >
                    {t.label}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        </nav>

        <header style={s.hero}>
          <h1 style={s.title}>{tab.title}</h1>
          <p style={s.sub}>{tab.sub}</p>
        </header>

        <ErrorBoundary resetKey={mode}>

        {mode === 'programs' && (
          <ExamManager onExamsChanged={noteScoringChanged} onOpenSheets={openSheets} />
        )}

        {mode === 'sheets' && <ScoringSheetLibrary onChanged={noteScoringChanged} />}

        {mode === 'directory' && (
          <StudentDirectory
            students={students}
            allContacts={allContacts}
            onContactsPersisted={noteContactsSaved}
            emailConfigured={emailConfigured}
            startDate={startDate}
            endDate={endDate}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            dayOfWeek={dayOfWeek}
            onViewReport={(studentId) => {
              setSelectedStudentId(studentId);
              setMode('single');
              setAutoPreview(true);
            }}
          />
        )}

        {bulkMode && (
          <>
            <BulkSendPanel
              students={filteredStudents}
              startDate={startDate}
              endDate={endDate}
              dayOfWeek={dayOfWeek}
              onStartDate={setStartDate}
              onEndDate={setEndDate}
              onDayOfWeek={setDayOfWeek}
              allContacts={allContacts}
              allContactsLoading={allContactsLoading}
              onContactsPersisted={noteContactsSaved}
              onScheduled={() => setQueueRefresh((n) => n + 1)}
            />
            <ScheduledQueuePanel refreshSignal={queueRefresh} />
          </>
        )}

        {mode === 'log' && <SentLogPanel />}

        {mode === 'email' && (
          <ComposeEmailPanel
            students={students}
            allContacts={allContacts}
            emailConfigured={emailConfigured}
            startDate={startDate}
            endDate={endDate}
            dayOfWeek={dayOfWeek}
            onContactsPersisted={noteContactsSaved}
          />
        )}

        {mode === 'single' && (<>
        <div style={s.card}>
          <div style={s.cardHead}>
            <div style={s.cardDot} />
            <span style={s.cardTitle}>Configure Report</span>
          </div>
          <div style={s.cardBody}>

            <StudentSelector
              students={filteredStudents}
              loading={studentsLoading}
              error={studentsError}
              value={selectedStudentId}
              onChange={setSelectedStudentId}
              onStudentsRefreshed={setStudents}
            />

            <div style={s.divider} />

            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />

            <div style={s.divider} />

            <DayPicker value={dayOfWeek} onChange={setDayOfWeek} />

            <div style={s.divider} />

            <Button onClick={handlePreview} disabled={!isValid} loading={previewLoading} size="lg" fullWidth>
              {previewLoading ? 'Loading Results…' : 'View Report'}
            </Button>

            {previewError && <div style={s.error}>⚠ {previewError}</div>}

          </div>
        </div>

        {previewData && (
          <ReportViewer
            data={previewData}
            onDownload={handleDownload}
            downloadLoading={downloadLoading}
            downloadError={downloadError}
            downloadSuccess={downloadSuccess}
            homework={homework}
            onHomeworkChange={setHomework}
            contacts={contacts}
            onContactsChange={updateContacts}
            onSaveContacts={saveContacts}
            onSendEmail={handleEmail}
            emailConfigured={emailConfigured}
            emailLoading={emailLoading}
            emailError={emailError}
            emailSuccess={emailSuccess}
            emailSubject={emailSubject}
            onEmailSubjectChange={setEmailSubject}
          />
        )}
        </>)}

        </ErrorBoundary>

      </div>
    </div>
  );
}