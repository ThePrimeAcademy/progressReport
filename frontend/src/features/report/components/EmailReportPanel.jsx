// features/report/components/EmailReportPanel.jsx
import React, { useEffect, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';

const s = {
  wrap: {
    marginTop: 16,
    padding: '16px 18px',
    background: '#fafbff',
    border: '1.5px solid var(--border)',
    borderRadius: 10,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  title: { fontSize: '0.85rem', fontWeight: 700, color: 'var(--ink)' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fullField: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: 10,
    marginBottom: 12,
  },
  label: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  input: {
    padding: '9px 12px',
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  resetBtn: {
    fontSize: '0.68rem',
    fontWeight: 600,
    color: 'var(--accent)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 4px',
    textTransform: 'none',
    letterSpacing: 'normal',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  saved: { fontSize: '0.78rem', color: '#15803d', fontWeight: 500 },
  warn: {
    marginTop: 10,
    padding: '8px 12px',
    background: '#fffbeb',
    border: '1.5px solid #fcd34d',
    borderRadius: 8,
    color: '#92400e',
    fontSize: '0.8rem',
  },
  error: {
    marginTop: 10,
    padding: '8px 12px',
    background: '#fff1f2',
    border: '1.5px solid #fca5a5',
    borderRadius: 8,
    color: '#b91c1c',
    fontSize: '0.8rem',
  },
  ok: {
    marginTop: 10,
    padding: '8px 12px',
    background: '#f0fdf4',
    border: '1.5px solid #86efac',
    borderRadius: 8,
    color: '#15803d',
    fontSize: '0.8rem',
    fontWeight: 500,
  },
};

export default function EmailReportPanel({
  studentName,
  registeredStudentEmail,
  contacts,
  onChange,
  onSave,
  onSend,
  configured,
  loading,
  error,
  success,
  subject,
  onSubjectChange,
}) {
  const defaultSubject = 'Prime Academy Weekly Report';
  const effectiveSubject = subject != null && subject !== '' ? subject : defaultSubject;

  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(() => setSaveState('idle'), 1800);
    return () => clearTimeout(t);
  }, [saveState]);

  const hasRecipient = Boolean(
    (contacts?.studentEmail && contacts.studentEmail.trim()) ||
    (contacts?.parentEmail && contacts.parentEmail.trim())
  );

  const studentEmailDiffers = Boolean(
    registeredStudentEmail &&
    contacts?.studentEmail &&
    contacts.studentEmail.trim().toLowerCase() !== String(registeredStudentEmail).trim().toLowerCase()
  );

  function handleResetStudentEmail() {
    if (!registeredStudentEmail) return;
    onChange({ studentEmail: registeredStudentEmail });
  }

  async function handleSave() {
    if (!onSave) return;
    setSaveState('saving');
    try {
      await onSave();
      setSaveState('saved');
    } catch (_) {
      setSaveState('idle');
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.title}>Email this report</div>
      </div>

      <div style={s.grid}>
        <div style={s.field}>
          <div style={s.labelRow}>
            <label style={s.label} htmlFor="student-email">Student email</label>
            {studentEmailDiffers && (
              <button
                type="button"
                onClick={handleResetStudentEmail}
                style={s.resetBtn}
                title={`Reset to ${registeredStudentEmail}`}
              >
                ↺ Reset to registered
              </button>
            )}
          </div>
          <input
            id="student-email"
            type="email"
            placeholder={registeredStudentEmail || 'student@example.com'}
            value={contacts?.studentEmail || ''}
            onChange={(e) => onChange({ studentEmail: e.target.value })}
            style={s.input}
            autoComplete="off"
          />
        </div>
        <div style={s.field}>
          <label style={s.label} htmlFor="parent-email">Parent email</label>
          <input
            id="parent-email"
            type="email"
            placeholder="parent@example.com"
            value={contacts?.parentEmail || ''}
            onChange={(e) => onChange({ parentEmail: e.target.value })}
            style={s.input}
            autoComplete="off"
          />
        </div>
      </div>

      <div style={s.fullField}>
        <label style={s.label} htmlFor="email-subject">Subject</label>
        <input
          id="email-subject"
          type="text"
          value={effectiveSubject}
          onChange={(e) => onSubjectChange && onSubjectChange(e.target.value)}
          style={s.input}
          autoComplete="off"
        />
      </div>

      <div style={s.actions}>
        <Button
          onClick={handleSave}
          variant="secondary"
          size="sm"
          loading={saveState === 'saving'}
        >
          Save contacts
        </Button>
        {saveState === 'saved' && <span style={s.saved}>✓ Saved</span>}
        <Button
          onClick={onSend}
          loading={loading}
          disabled={!configured || !hasRecipient || loading}
          size="md"
        >
          {loading ? 'Sending…' : 'Send Report'}
        </Button>
      </div>

      {!configured && (
        <div style={s.warn}>
          Email sending isn't configured. Set <code>ZOHO_USER</code> and <code>ZOHO_APP_PASSWORD</code> on the backend (see <code>backend/.env.example</code>).
        </div>
      )}
      {error && <div style={s.error}>{error}</div>}
      {success && <div style={s.ok}>{success}</div>}
    </div>
  );
}
