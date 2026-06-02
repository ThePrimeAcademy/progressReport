// features/report/components/EmailReportPanel.jsx
import React from 'react';
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
  hint: { fontSize: '0.72rem', color: 'var(--muted)' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
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
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  subject: {
    fontSize: '0.72rem',
    color: 'var(--muted)',
    fontStyle: 'italic',
  },
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
  contacts,
  onChange,
  onSave,
  onSend,
  configured,
  loading,
  error,
  success,
}) {
  const subject = `Prime Academy Report Card: ${studentName || '{Student Name}'}`;
  const hasRecipient = Boolean(
    (contacts?.studentEmail && contacts.studentEmail.trim()) ||
    (contacts?.parentEmail && contacts.parentEmail.trim())
  );

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <div style={s.title}>Email this report</div>
          <div style={s.hint}>Subject: <span style={s.subject}>{subject}</span></div>
        </div>
      </div>

      <div style={s.grid}>
        <div style={s.field}>
          <label style={s.label} htmlFor="student-email">Student email</label>
          <input
            id="student-email"
            type="email"
            placeholder="student@example.com"
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

      <div style={s.actions}>
        <Button onClick={onSave} variant="ghost" size="sm">Save contacts</Button>
        <Button
          onClick={onSend}
          loading={loading}
          disabled={!configured || !hasRecipient}
          size="md"
        >
          Send Report
        </Button>
      </div>

      {!configured && (
        <div style={s.warn}>
          Email sending isn't configured. Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> in <code>backend/.env</code> to enable.
        </div>
      )}
      {error && <div style={s.error}>{error}</div>}
      {success && <div style={s.ok}>{success}</div>}
    </div>
  );
}
