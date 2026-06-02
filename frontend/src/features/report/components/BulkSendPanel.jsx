// features/report/components/BulkSendPanel.jsx
import React, { useMemo, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import DateRangePicker from './DateRangePicker.jsx';
import DayPicker from './DayPicker.jsx';
import { emailReport, fetchEmailJobStatus } from '../api/reportApi.js';

const MAX_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90;

const STATUS_LABEL = {
  pending: '⏳ Queued',
  sending: '📨 Sending…',
  sent: '✓ Sent',
  deduped: '✓ Already sent',
  skipped: '⊘ No contacts',
  failed: '✗ Failed',
};

const STATUS_COLOR = {
  pending: '#6b7280',
  sending: '#1a56db',
  sent: '#15803d',
  deduped: '#15803d',
  skipped: '#b45309',
  failed: '#b91c1c',
};

const s = {
  card: {
    background: 'var(--bg)',
    borderRadius: 16,
    boxShadow: 'var(--shadow-lg)',
    border: '1.5px solid var(--border)',
    overflow: 'hidden',
    marginTop: 28,
  },
  head: {
    padding: '18px 24px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  title: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  body: { padding: 24, display: 'flex', flexDirection: 'column', gap: 18 },
  divider: { height: 1, background: 'var(--border)' },
  label: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  selectActions: { display: 'flex', gap: 12, fontSize: '0.72rem' },
  selectAction: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontWeight: 600,
    padding: '2px 4px',
  },
  list: {
    maxHeight: 280,
    overflowY: 'auto',
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    background: '#fafbff',
  },
  rowWrap: {
    borderBottom: '1px solid var(--border)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    fontSize: '0.88rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  emailRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    padding: '0 14px 10px 38px',
    background: '#fafbff',
  },
  emailField: { display: 'flex', flexDirection: 'column', gap: 3 },
  emailLabel: {
    fontSize: '0.62rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
  },
  emailInput: {
    padding: '6px 10px',
    border: '1.5px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.82rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  checkbox: { accentColor: 'var(--accent)' },
  studentName: { flex: 1 },
  contactPill: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 99,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  contactsBoth: { background: '#dcfce7', color: '#15803d' },
  contactsPartial: { background: '#dbeafe', color: '#1a56db' },
  contactsNone: { background: '#fef3c7', color: '#92400e' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 14px',
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.95rem',
    outline: 'none',
  },
  statusTable: {
    border: '1.5px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  statusRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 130px',
    alignItems: 'center',
    gap: 12,
    padding: '8px 14px',
    borderBottom: '1px solid var(--border)',
    fontSize: '0.85rem',
  },
  statusName: { color: 'var(--ink)' },
  statusBadge: { fontWeight: 600, fontSize: '0.78rem', textAlign: 'right' },
  errLine: { gridColumn: '1 / -1', color: '#b91c1c', fontSize: '0.74rem', marginTop: 2 },
  emptyHint: {
    padding: '12px 14px',
    fontSize: '0.82rem',
    color: 'var(--muted)',
    fontStyle: 'italic',
  },
};

async function pollJobUntilTerminal(jobId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 800 : POLL_INTERVAL_MS));
    const job = await fetchEmailJobStatus(jobId);
    if (job?.status === 'sent' || job?.status === 'failed') return job;
  }
  throw new Error('Job did not complete in time.');
}

export default function BulkSendPanel({
  students,
  startDate, endDate, dayOfWeek,
  onStartDate, onEndDate, onDayOfWeek,
  allContacts = {},
  allContactsLoading = false,
  onContactsPersisted,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [subject, setSubject] = useState('Prime Academy Weekly Report');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});
  const [globalError, setGlobalError] = useState(null);
  // Per-row email overrides for THIS bulk batch only. Keyed by student id.
  // Effective email = edit > saved contact > ClassMarker registered email
  // (for the student field). Edits are persisted by the backend's
  // /email handler as a side effect of a successful send.
  const [rowEdits, setRowEdits] = useState({});
  const contactsLoading = allContactsLoading;

  const sortedStudents = useMemo(
    () => [...(students || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [students]
  );

  // Effective email for a student row. Priority:
  //   1. user's edit in this batch
  //   2. saved contact in DB
  //   3. (student field only) the ClassMarker-registered email
  function effectiveEmail(id, field) {
    const edit = rowEdits[id]?.[field];
    if (edit !== undefined) return edit;
    const saved = allContacts[id]?.[field] || '';
    if (saved) return saved;
    if (field === 'studentEmail') {
      const stu = sortedStudents.find((s) => s.id === id);
      return stu?.email || '';
    }
    return '';
  }

  function setEdit(id, field, value) {
    setRowEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  }

  // Returns one of: 'both' | 'studentOnly' | 'parentOnly' | 'none'
  // — based on EFFECTIVE emails (edit > saved > ClassMarker), not just saved.
  function contactsState(id) {
    const hasStudent = Boolean((effectiveEmail(id, 'studentEmail') || '').trim());
    const hasParent = Boolean((effectiveEmail(id, 'parentEmail') || '').trim());
    if (hasStudent && hasParent) return 'both';
    if (hasStudent) return 'studentOnly';
    if (hasParent) return 'parentOnly';
    return 'none';
  }
  function hasSavedContacts(id) {
    return contactsState(id) !== 'none';
  }

  const CONTACT_PILL = {
    both:        { label: 'Student + Parent',  style: s.contactsBoth },
    studentOnly: { label: 'Student only',      style: s.contactsPartial },
    parentOnly:  { label: 'Parent only',       style: s.contactsPartial },
    none:        { label: 'No contacts',       style: s.contactsNone },
  };

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelectedIds(new Set(sortedStudents.map((s) => s.id))); }
  function selectNone() { setSelectedIds(new Set()); }
  function selectWithContacts() {
    setSelectedIds(new Set(sortedStudents.filter((s) => hasSavedContacts(s.id)).map((s) => s.id)));
  }

  const totalSelected = selectedIds.size;
  const sendableCount = sortedStudents.filter((s) => selectedIds.has(s.id) && hasSavedContacts(s.id)).length;
  const missingContactsCount = totalSelected - sendableCount;
  const canSend = !running && totalSelected > 0 && Boolean(startDate) && Boolean(endDate);

  async function handleSendAll() {
    setGlobalError(null);
    setRunning(true);

    const targets = sortedStudents.filter((stu) => selectedIds.has(stu.id));
    const initial = {};
    for (const stu of targets) {
      initial[stu.id] = { status: hasSavedContacts(stu.id) ? 'pending' : 'skipped' };
    }
    setResults(initial);

    const sendable = targets.filter((stu) => hasSavedContacts(stu.id));
    let cursor = 0;
    async function worker() {
      while (cursor < sendable.length) {
        const stu = sendable[cursor++];
        setResults((prev) => ({ ...prev, [stu.id]: { status: 'sending' } }));
        try {
          const start = await emailReport({
            studentId: stu.id,
            startDate,
            endDate,
            dayOfWeek: dayOfWeek || undefined,
            subject: subject || undefined,
            studentEmail: effectiveEmail(stu.id, 'studentEmail'),
            parentEmail: effectiveEmail(stu.id, 'parentEmail'),
          });
          if (!start?.jobId) throw new Error('No jobId returned.');
          const job = await pollJobUntilTerminal(start.jobId);
          if (job.status === 'failed') {
            setResults((prev) => ({ ...prev, [stu.id]: { status: 'failed', error: job.error || 'Send failed.' } }));
          } else {
            // Successful send — the backend just persisted these recipients
            // as the student_contacts row. Mirror that into the hook-level
            // cache so the pill shows the right state without a refetch.
            if (onContactsPersisted) {
              onContactsPersisted(stu.id, {
                studentEmail: effectiveEmail(stu.id, 'studentEmail'),
                parentEmail: effectiveEmail(stu.id, 'parentEmail'),
              });
            }
            setResults((prev) => ({
              ...prev,
              [stu.id]: {
                status: start.deduplicated ? 'deduped' : 'sent',
                recipients: job.result?.to || [],
              },
            }));
          }
        } catch (err) {
          setResults((prev) => ({ ...prev, [stu.id]: { status: 'failed', error: err.message } }));
        }
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, sendable.length) }, () => worker());
    try {
      await Promise.all(workers);
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const tally = useMemo(() => {
    const t = { sent: 0, deduped: 0, failed: 0, skipped: 0, pending: 0, sending: 0 };
    for (const r of Object.values(results)) t[r.status] = (t[r.status] || 0) + 1;
    return t;
  }, [results]);

  return (
    <div style={s.card}>
      <div style={s.head}>
        <div style={s.dot} />
        <span style={s.title}>Bulk Send — Email Reports to Multiple Students</span>
      </div>
      <div style={s.body}>

        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={onStartDate}
          onEndChange={onEndDate}
        />

        <div style={s.divider} />

        <DayPicker value={dayOfWeek} onChange={onDayOfWeek} />

        <div style={s.divider} />

        <div>
          <label style={s.label} htmlFor="bulk-subject">Subject (shared across all)</label>
          <input
            id="bulk-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{ ...s.input, marginTop: 6 }}
            autoComplete="off"
          />
        </div>

        <div style={s.divider} />

        <div>
          <div style={s.listHeader}>
            <span style={s.label}>Students ({totalSelected} selected · {sendableCount} sendable)</span>
            <div style={s.selectActions}>
              <button type="button" onClick={selectAll} style={s.selectAction}>All</button>
              <button type="button" onClick={selectWithContacts} style={s.selectAction}>With contacts</button>
              <button type="button" onClick={selectNone} style={s.selectAction}>None</button>
            </div>
          </div>
          <div style={s.list}>
            {contactsLoading && <div style={s.emptyHint}>Loading saved contacts…</div>}
            {!contactsLoading && sortedStudents.length === 0 && <div style={s.emptyHint}>No students found.</div>}
            {!contactsLoading && sortedStudents.map((stu) => {
              const checked = selectedIds.has(stu.id);
              const state = contactsState(stu.id);
              const pill = CONTACT_PILL[state];
              const studentEmail = effectiveEmail(stu.id, 'studentEmail');
              const parentEmail = effectiveEmail(stu.id, 'parentEmail');
              return (
                <div key={stu.id} style={s.rowWrap}>
                  <label style={s.row}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(stu.id)}
                      style={s.checkbox}
                    />
                    <span style={s.studentName}>{stu.name}</span>
                    <span style={{ ...s.contactPill, ...pill.style }}>
                      {pill.label}
                    </span>
                  </label>
                  {checked && (
                    <div style={s.emailRow}>
                      <div style={s.emailField}>
                        <label style={s.emailLabel} htmlFor={`bulk-student-email-${stu.id}`}>Student email</label>
                        <input
                          id={`bulk-student-email-${stu.id}`}
                          type="email"
                          placeholder={stu.email || 'student@example.com'}
                          value={studentEmail}
                          onChange={(e) => setEdit(stu.id, 'studentEmail', e.target.value)}
                          style={s.emailInput}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      <div style={s.emailField}>
                        <label style={s.emailLabel} htmlFor={`bulk-parent-email-${stu.id}`}>Parent email</label>
                        <input
                          id={`bulk-parent-email-${stu.id}`}
                          type="email"
                          placeholder="parent@example.com"
                          value={parentEmail}
                          onChange={(e) => setEdit(stu.id, 'parentEmail', e.target.value)}
                          style={s.emailInput}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {missingContactsCount > 0 && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#92400e' }}>
              {missingContactsCount} selected student{missingContactsCount === 1 ? ' has' : 's have'} no recipient email and will be skipped. Fill in an email above to include them.
            </div>
          )}
        </div>

        <Button onClick={handleSendAll} disabled={!canSend} loading={running} size="lg" fullWidth>
          {running
            ? `Sending ${tally.sending + tally.sent + tally.deduped + tally.failed} / ${sendableCount}…`
            : `Send to ${sendableCount} student${sendableCount === 1 ? '' : 's'}`}
        </Button>

        {globalError && (
          <div style={{ padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' }}>
            ⚠ {globalError}
          </div>
        )}

        {Object.keys(results).length > 0 && (
          <div>
            <div style={{ ...s.label, marginBottom: 6 }}>
              Status — Sent {tally.sent + tally.deduped} · Failed {tally.failed} · Skipped {tally.skipped} · In-flight {tally.pending + tally.sending}
            </div>
            <div style={s.statusTable}>
              {sortedStudents
                .filter((stu) => results[stu.id])
                .map((stu) => {
                  const r = results[stu.id];
                  return (
                    <div key={stu.id} style={s.statusRow}>
                      <div style={s.statusName}>{stu.name}</div>
                      <div style={{ ...s.statusBadge, color: STATUS_COLOR[r.status] }}>
                        {STATUS_LABEL[r.status] || r.status}
                      </div>
                      {r.error && <div style={s.errLine}>{r.error}</div>}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
