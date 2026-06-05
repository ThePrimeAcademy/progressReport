// pages/ReportPage.jsx
import React, { useState } from 'react';
import { useGenerateReport } from '../features/report/hooks/useGenerateReport.js';
import StudentSelector from '../features/report/components/StudentSelector.jsx';
import DateRangePicker from '../features/report/components/DateRangePicker.jsx';
import DayPicker from '../features/report/components/DayPicker.jsx';
import ReportViewer from '../features/report/components/ReportViewer.jsx';
import BulkSendPanel from '../features/report/components/BulkSendPanel.jsx';
import ExamManager from '../features/report/components/ExamManager.jsx';
import Button from '../components/ui/Button.jsx';

const s = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(145deg, #f0f4ff 0%, #f7f9ff 60%, #eef2fb 100%)',
    padding: '40px 20px 80px',
  },
  inner: { maxWidth: 900, margin: '0 auto' },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 44 },
  brand: { fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: 'var(--accent)', letterSpacing: '-0.3px' },
  badge: { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px' },
  modeGroup: {
    display: 'inline-flex',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  modePill: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    border: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    padding: '6px 14px',
    borderRadius: 999,
    cursor: 'pointer',
    transition: 'all 0.18s var(--ease)',
    fontFamily: 'var(--font-sans)',
  },
  modePillActive: {
    background: 'var(--accent)',
    color: '#fff',
  },
  hero: { textAlign: 'center', marginBottom: 36 },
  eyebrow: { display: 'inline-block', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 20, padding: '5px 14px', marginBottom: 14 },
  title: { fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', lineHeight: 1.2, color: 'var(--ink)', marginBottom: 12 },
  sub: { fontSize: '0.92rem', color: 'var(--muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 },
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  cardHead: { padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  cardDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  cardTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  cardBody: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 },
  divider: { height: '1px', background: 'var(--border)' },
  error: { padding: '12px 16px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' },
  excludeBar: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 12,
    padding: '10px 16px', marginBottom: 20, boxShadow: 'var(--shadow)',
  },
  excludeLabel: { fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  excludeSelect: { padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: '0.8rem', background: '#fff', fontFamily: 'inherit', minWidth: 220 },
};

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
    handlePreview, handleDownload,
    examsList, excludeExamId, setExcludeExamId,
    contacts, updateContacts, saveContacts,
    allContacts, allContactsLoading, noteContactsSaved,
    emailConfigured, emailLoading, emailError, emailSuccess,
    emailSubject, setEmailSubject,
    handleEmail,
    isValid,
  } = useGenerateReport();

  const [bulkMode, setBulkMode] = useState(false);

  return (
    <div style={s.page}>
      <div style={s.inner}>

        <nav style={s.nav}>
          <span style={s.brand}>ProgressReport</span>
          <div role="tablist" aria-label="Send mode" style={s.modeGroup}>
            <button
              type="button"
              role="tab"
              aria-selected={!bulkMode}
              onClick={() => setBulkMode(false)}
              style={{ ...s.modePill, ...(!bulkMode ? s.modePillActive : {}) }}
            >
              Single Student
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={bulkMode}
              onClick={() => setBulkMode(true)}
              style={{ ...s.modePill, ...(bulkMode ? s.modePillActive : {}) }}
            >
              Bulk Send
            </button>
          </div>
        </nav>

        <header style={s.hero}>
          <span style={s.eyebrow}>Student Report Generator</span>
          <h1 style={s.title}>Student Performance</h1>
          <p style={s.sub}>Select a student, date range, and optionally filter by day to generate a detailed report.</p>
        </header>

        {examsList.length > 0 && (
          <div style={s.excludeBar}>
            <span style={s.excludeLabel}>Hide students who took</span>
            <select
              style={s.excludeSelect}
              value={excludeExamId}
              onChange={(e) => setExcludeExamId(e.target.value)}
              aria-label="Hide students who took a specific SAT exam"
            >
              <option value="">— no exam filter —</option>
              {examsList.map((exam) => (
                <option key={exam.examId} value={exam.examId}>{exam.name}</option>
              ))}
            </select>
            {excludeExamId && (
              <button
                type="button"
                style={{ ...s.modePill, border: '1px solid var(--border)' }}
                onClick={() => setExcludeExamId('')}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {bulkMode ? (
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
          />
        ) : (<>
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

        <ExamManager
          onExamsChanged={async () => {
            // Re-run the preview so new exam scores show without reselecting.
            if (previewData) await handlePreview();
          }}
        />

        {previewData && (
          <ReportViewer
            data={previewData}
            onDownload={handleDownload}
            downloadLoading={downloadLoading}
            downloadError={downloadError}
            downloadSuccess={downloadSuccess}
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

      </div>
    </div>
  );
}