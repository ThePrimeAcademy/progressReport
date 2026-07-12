// features/report/components/BulkSendPanel.jsx
import React, { useEffect, useMemo, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import DateRangePicker from './DateRangePicker.jsx';
import DayPicker from './DayPicker.jsx';
import {
  emailReport,
  fetchEmailJobStatus,
  saveStudentContacts,
  fetchPrograms,
  fetchStudents,
  scheduleBulkEmail,
} from '../api/reportApi.js';

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
  scheduleBox: {
    border: '1.5px dashed var(--border)',
    borderRadius: 12,
    padding: '14px 16px',
    background: '#fafbff',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  scheduleHead: { display: 'flex', alignItems: 'center', gap: 8 },
  scheduleOptional: {
    fontSize: '0.6rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 99,
    padding: '2px 8px',
  },
  scheduleRow: { display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' },
  scheduleInput: {
    flex: 1,
    minWidth: 200,
    padding: '10px 14px',
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.92rem',
    outline: 'none',
    colorScheme: 'light',
  },
  scheduleHint: { fontSize: '0.74rem', color: 'var(--muted)', lineHeight: 1.5, margin: 0 },
  scheduleErr: { fontSize: '0.8rem', color: '#b91c1c', fontWeight: 500 },
  scheduleOk: { fontSize: '0.8rem', color: '#15803d', fontWeight: 500 },
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time (no timezone suffix).
function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  onScheduled,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [subject, setSubject] = useState('Prime Academy Weekly Report');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});
  const [globalError, setGlobalError] = useState(null);
  // Per-row email overrides keyed by student id. Effective email =
  // edit > saved contact > ClassMarker registered email (student field).
  // Edits auto-save to student_contacts on blur (and via the Save-all
  // button) so typed emails survive switching pages/modes — previously they
  // only persisted as a side effect of a successful send.
  const [rowEdits, setRowEdits] = useState({});
  // id → 'saving' | 'saved' | 'error:<message>'
  const [saveStates, setSaveStates] = useState({});
  const contactsLoading = allContactsLoading;

  // Schedule-for-later: a datetime-local string ('' = send now). Submitting
  // persists a server-side batch instead of sending from the browser.
  const [sendAt, setSendAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState(null); // { type: 'success'|'error', text }

  // Program scoping: '' = all active students (the date-filtered list passed
  // in), otherwise a programId — the list then becomes that program's enrolled
  // roster, all pre-selected so you send to the whole cohort and uncheck to
  // omit anyone. Programs + the full student roster (id/name/email) are loaded
  // here so a rostered student shows even if they weren't active this week.
  const [scope, setScope] = useState('');
  const [programs, setPrograms] = useState([]);
  const [fullRoster, setFullRoster] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPrograms().catch(() => []), fetchStudents().catch(() => [])])
      .then(([programList, roster]) => {
        if (cancelled) return;
        setPrograms(programList || []);
        setFullRoster(roster || []);
      });
    return () => { cancelled = true; };
  }, []);

  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const activeProgram = useMemo(
    () => programs.find((p) => p.programId === scope) || null,
    [programs, scope]
  );

  // ClassMarker sometimes returns bare user_ids with no first/last/email —
  // those surface as "User 123". Prefer any richer name we already have.
  function isPlaceholderName(name, id) {
    if (!name) return true;
    return String(name) === `User ${id}` || String(name) === `User ${String(id)}`;
  }

  // Merge full ClassMarker roster + the active-students list. Always key by
  // String(id) so program enrollment (which may have been stored as numbers)
  // still resolves to real names.
  const rosterById = useMemo(() => {
    const map = new Map();
    const add = (st) => {
      if (!st || st.id == null) return;
      const id = String(st.id);
      const incoming = {
        id,
        name: st.name || `User ${id}`,
        email: st.email || '',
      };
      const prev = map.get(id);
      if (!prev) {
        map.set(id, incoming);
        return;
      }
      const name = !isPlaceholderName(incoming.name, id)
        ? incoming.name
        : !isPlaceholderName(prev.name, id)
          ? prev.name
          : (incoming.name || prev.name);
      map.set(id, {
        id,
        name,
        email: incoming.email || prev.email || '',
      });
    };
    for (const st of fullRoster || []) add(st);
    for (const st of students || []) add(st);
    return map;
  }, [fullRoster, students]);

  // Students shown in the list. For a program scope, map each enrolled id to
  // its roster entry (falling back to a bare row so nobody is silently
  // dropped); otherwise use the active-students list as before.
  const sortedStudents = useMemo(() => {
    const base = activeProgram
      ? (activeProgram.studentIds || []).map((rawId) => {
          const id = String(rawId);
          return rosterById.get(id) || { id, name: `User ${id}`, email: '' };
        })
      : (students || []).map((st) => {
          const id = String(st.id);
          return rosterById.get(id) || { id, name: st.name || `User ${id}`, email: st.email || '' };
        });
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [activeProgram, rosterById, students]);

  // Switching to a program pre-selects its whole roster (omit by unchecking);
  // switching back to "all students" clears the selection.
  useEffect(() => {
    if (activeProgram) {
      setSelectedIds(new Set((activeProgram.studentIds || []).map(String)));
    } else {
      setSelectedIds(new Set());
    }
  }, [activeProgram]);

  // Effective email for a student row. Priority:
  //   1. user's edit in this batch
  //   2. saved contact in DB
  //   3. (student field only) the ClassMarker-registered email
  function effectiveEmail(rawId, field) {
    const id = String(rawId);
    const edit = rowEdits[id]?.[field];
    if (edit !== undefined) return edit;
    const saved = allContacts[id]?.[field] || allContacts[rawId]?.[field] || '';
    if (saved) return saved;
    if (field === 'studentEmail') {
      const stu = sortedStudents.find((s) => String(s.id) === id);
      return stu?.email || '';
    }
    return '';
  }

  function setEdit(rawId, field, value) {
    const id = String(rawId);
    setRowEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
    // New keystrokes invalidate any previous saved/error indicator.
    setSaveStates((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // Persist one row's contacts. No-ops when nothing was typed or the values
  // already match the saved contact; skips (with an inline error) when an
  // email is malformed so a half-typed address never overwrites a good one.
  async function persistRow(rawId) {
    const id = String(rawId);
    if (!rowEdits[id]) return;
    const studentEmail = (effectiveEmail(id, 'studentEmail') || '').trim();
    const parentEmail = (effectiveEmail(id, 'parentEmail') || '').trim();
    const saved = allContacts[id] || allContacts[rawId] || {};
    if ((saved.studentEmail || '') === studentEmail && (saved.parentEmail || '') === parentEmail) return;
    if ((studentEmail && !EMAIL_RX.test(studentEmail)) || (parentEmail && !EMAIL_RX.test(parentEmail))) {
      setSaveStates((prev) => ({ ...prev, [id]: 'error:Invalid email — not saved yet' }));
      return;
    }
    setSaveStates((prev) => ({ ...prev, [id]: 'saving' }));
    try {
      await saveStudentContacts(id, { studentEmail, parentEmail });
      onContactsPersisted?.(id, { studentEmail, parentEmail });
      // The saved contact now carries the values — drop the local edit.
      setRowEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSaveStates((prev) => ({ ...prev, [id]: 'saved' }));
    } catch (err) {
      setSaveStates((prev) => ({ ...prev, [id]: `error:${err.message || 'Save failed'}` }));
    }
  }

  const dirtyCount = Object.keys(rowEdits).length;
  async function saveAllDirty() {
    await Promise.all(Object.keys(rowEdits).map((id) => persistRow(id)));
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

  function toggle(rawId) {
    const id = String(rawId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelectedIds(new Set(sortedStudents.map((s) => String(s.id)))); }
  function selectNone() { setSelectedIds(new Set()); }
  function selectWithContacts() {
    setSelectedIds(new Set(sortedStudents.filter((s) => hasSavedContacts(s.id)).map((s) => String(s.id))));
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

  // Persist a server-side batch that fires at `sendAt`. Recipients are frozen
  // now (the report date range is also frozen), so the browser need not stay
  // open. Only selected students with a recipient email are included.
  async function handleSchedule() {
    setScheduleMsg(null);
    if (!sendAt) {
      setScheduleMsg({ type: 'error', text: 'Pick a date and time to schedule.' });
      return;
    }
    const when = new Date(sendAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
      setScheduleMsg({ type: 'error', text: 'Schedule time must be in the future.' });
      return;
    }
    const targets = sortedStudents.filter((stu) => selectedIds.has(stu.id) && hasSavedContacts(stu.id));
    if (targets.length === 0) {
      setScheduleMsg({ type: 'error', text: 'No selected students have a recipient email.' });
      return;
    }

    setScheduling(true);
    try {
      // Flush any unsaved typed emails so the snapshot uses the latest values.
      await saveAllDirty();
      const items = targets.map((stu) => ({
        studentId: stu.id,
        studentName: stu.name,
        studentEmail: effectiveEmail(stu.id, 'studentEmail'),
        parentEmail: effectiveEmail(stu.id, 'parentEmail'),
      }));
      const res = await scheduleBulkEmail({
        label: activeProgram ? activeProgram.name : 'All active students',
        subject: subject || undefined,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
        sendAt: when.toISOString(),
        items,
      });
      setScheduleMsg({
        type: 'success',
        text: `Scheduled ${res.scheduledCount} report${res.scheduledCount === 1 ? '' : 's'} for ${when.toLocaleString()}.`,
      });
      setSendAt('');
      onScheduled?.();
    } catch (err) {
      setScheduleMsg({ type: 'error', text: err.response?.data?.error || err.message || 'Failed to schedule.' });
    } finally {
      setScheduling(false);
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
          <label style={s.label} htmlFor="bulk-scope">Send to</label>
          <select
            id="bulk-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            style={{ ...s.input, marginTop: 6 }}
          >
            <option value="">All active students</option>
            {programs.map((p) => (
              <option key={p.programId} value={p.programId}>
                {p.name} — {(p.studentIds || []).length} enrolled
              </option>
            ))}
          </select>
          {activeProgram && (
            <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--muted)' }}>
              Showing the {activeProgram.name} roster — everyone’s pre-selected; uncheck to omit before sending.
            </div>
          )}
        </div>

        <div style={s.divider} />

        <div>
          <div style={s.listHeader}>
            <span style={s.label}>Students ({totalSelected} selected · {sendableCount} sendable)</span>
            <div style={s.selectActions}>
              {dirtyCount > 0 && (
                <button type="button" onClick={saveAllDirty} style={{ ...s.selectAction, color: '#15803d' }}>
                  Save contacts ({dirtyCount})
                </button>
              )}
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
                          onBlur={() => persistRow(stu.id)}
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
                          onBlur={() => persistRow(stu.id)}
                          style={s.emailInput}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                      {saveStates[stu.id] && (
                        <div style={{
                          gridColumn: '1 / -1',
                          fontSize: '0.68rem',
                          color: saveStates[stu.id].startsWith('error:') ? '#b91c1c' : '#15803d',
                        }}>
                          {saveStates[stu.id] === 'saving' && 'Saving…'}
                          {saveStates[stu.id] === 'saved' && '✓ Contacts saved'}
                          {saveStates[stu.id].startsWith('error:') && `⚠ ${saveStates[stu.id].slice(6)}`}
                        </div>
                      )}
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

        <div style={s.scheduleBox}>
          <div style={s.scheduleHead}>
            <span style={s.label}>Or schedule for later</span>
            <span style={s.scheduleOptional}>optional</span>
          </div>
          <div style={s.scheduleRow}>
            <input
              type="datetime-local"
              value={sendAt}
              min={toDatetimeLocalValue(new Date())}
              onChange={(e) => { setSendAt(e.target.value); setScheduleMsg(null); }}
              style={s.scheduleInput}
              aria-label="Schedule send date and time"
            />
            <Button
              onClick={handleSchedule}
              disabled={running || scheduling || !sendAt || sendableCount === 0}
              loading={scheduling}
              variant="secondary"
              size="md"
            >
              Schedule {sendableCount > 0 ? `${sendableCount}` : ''}
            </Button>
          </div>
          <p style={s.scheduleHint}>
            Fires automatically at the chosen time — you can close this page. Track or cancel it in the queue below.
          </p>
          {scheduleMsg && (
            <div style={scheduleMsg.type === 'error' ? s.scheduleErr : s.scheduleOk}>
              {scheduleMsg.type === 'error' ? '⚠ ' : '✓ '}{scheduleMsg.text}
            </div>
          )}
        </div>

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
