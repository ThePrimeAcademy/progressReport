// pages/ReportPage.jsx
import React, { useState } from 'react';
import { useGenerateReport } from '../features/report/hooks/useGenerateReport.js';
import StudentSelector from '../features/report/components/StudentSelector.jsx';
import DateRangePicker from '../features/report/components/DateRangePicker.jsx';
import DayPicker from '../features/report/components/DayPicker.jsx';
import ReportViewer from '../features/report/components/ReportViewer.jsx';
import BulkSendPanel from '../features/report/components/BulkSendPanel.jsx';
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
};

export default function ReportPage() {
  const {
    students, studentsLoading, studentsError, setStudents,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    downloadLoading, downloadError, downloadSuccess,
    handlePreview, handleDownload,
    scoringSheets, refreshScoringSheets,
    contacts, updateContacts, saveContacts,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              onClick={() => setBulkMode((m) => !m)}
              variant={bulkMode ? 'primary' : 'secondary'}
              size="sm"
            >
              {bulkMode ? '← Single Student' : '⇉ Bulk Send'}
            </Button>
            <span style={s.badge}>Academic Tool</span>
          </div>
        </nav>

        <header style={s.hero}>
          <span style={s.eyebrow}>Student Report Generator</span>
          <h1 style={s.title}>Student Performance<br />at a Glance</h1>
          <p style={s.sub}>Select a student, date range, and optionally filter by day to generate a detailed report.</p>
        </header>

        {bulkMode ? (
          <BulkSendPanel
            students={students}
            startDate={startDate}
            endDate={endDate}
            dayOfWeek={dayOfWeek}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            onDayOfWeek={setDayOfWeek}
          />
        ) : (<>
        <div style={s.card}>
          <div style={s.cardHead}>
            <div style={s.cardDot} />
            <span style={s.cardTitle}>Configure Report</span>
          </div>
          <div style={s.cardBody}>

            <StudentSelector
              students={students}
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
            scoringSheets={scoringSheets}
            onScoringSheetsChanged={async () => {
              await refreshScoringSheets();
              await handlePreview();
            }}
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