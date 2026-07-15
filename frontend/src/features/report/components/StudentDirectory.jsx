// features/report/components/StudentDirectory.jsx
// Main-page student directory. Toggle between ClassMarker groups and
// Programs, pick one, and every student under it lists out. Clicking a
// student expands two actions:
//   • View Report — jumps to Single Student mode with them preselected and
//     auto-previews (using the date range picked here).
//   • Email Report — sends the PDF to their saved student + parent emails,
//     through the exact same /report/email pipeline as Single Student mode.
import React, { useState, useEffect, useMemo } from 'react';
import {
  fetchStudentGroups,
  fetchPrograms,
  emailReport,
  fetchEmailJobStatus,
} from '../api/reportApi.js';
import DateRangePicker from './DateRangePicker.jsx';

const s = {
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  cardHead: { padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cardDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  cardTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  cardBody: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 18 },
  sourceGroup: { display: 'inline-flex', background: '#f4f6fb', border: '1px solid var(--border)', borderRadius: 999, padding: 3, gap: 2, marginLeft: 'auto' },
  sourcePill: { fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.03em', border: 'none', background: 'transparent', color: 'var(--muted)', padding: '5px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  sourcePillActive: { background: 'var(--accent)', color: '#fff' },
  select: { width: '100%', padding: '10px 14px', fontSize: '0.9rem', border: '1.5px solid var(--border)', borderRadius: 10, background: '#fff', color: 'var(--ink)', fontFamily: 'var(--font-sans)' },
  search: { width: '100%', padding: '9px 14px', fontSize: '0.88rem', border: '1.5px solid var(--border)', borderRadius: 10, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' },
  list: { border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 16px', cursor: 'pointer', userSelect: 'none', borderTop: '1px solid var(--border)', background: '#fff' },
  rowName: { fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)' },
  rowMeta: { fontSize: '0.74rem', color: 'var(--muted)' },
  pill: { fontSize: '0.68rem', fontWeight: 600, borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' },
  pillOk: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  pillWarn: { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  actions: { padding: '14px 16px', background: '#fafbff', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 },
  actionBtns: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btn: { fontSize: '0.8rem', fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  btnGhost: { fontSize: '0.8rem', fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  emailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  label: { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '8px 12px', fontSize: '0.85rem', border: '1.5px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' },
  ok: { padding: '9px 13px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, color: '#15803d', fontSize: '0.82rem', fontWeight: 500 },
  err: { padding: '9px 13px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.82rem' },
  hint: { fontSize: '0.78rem', color: 'var(--muted)' },
};

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Send one report email and poll to completion — same job pattern as the
// single-student hook.
async function sendAndPoll(payload) {
  const start = await emailReport(payload);
  const jobId = start?.jobId;
  if (!jobId) throw new Error('Server did not return a job id.');
  let job = null;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
    job = await fetchEmailJobStatus(jobId);
    if (job?.status === 'sent' || job?.status === 'failed') break;
  }
  if (!job || job.status === 'pending') {
    throw new Error('Send is taking longer than expected. Check your inbox before retrying.');
  }
  if (job.status === 'failed') throw new Error(job.error || 'Send failed.');
  return { deduplicated: Boolean(start?.deduplicated), to: job.result?.to || [] };
}

function EmailAction({ student, saved, startDate, endDate, dayOfWeek, configured, onSent }) {
  const [studentEmail, setStudentEmail] = useState(saved?.studentEmail || student.email || '');
  const [parentEmail, setParentEmail] = useState(saved?.parentEmail || '');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const datesOk = startDate && endDate && new Date(startDate) <= new Date(endDate);
  const anyRecipient = studentEmail.trim() || parentEmail.trim();
  const recipientsOk =
    (!studentEmail.trim() || emailRx.test(studentEmail.trim())) &&
    (!parentEmail.trim() || emailRx.test(parentEmail.trim())) &&
    anyRecipient;

  async function handleSend() {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await sendAndPoll({
        studentId: student.id,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek && dayOfWeek.length ? dayOfWeek : undefined,
        studentEmail: studentEmail.trim(),
        parentEmail: parentEmail.trim(),
        subject: subject || undefined,
      });
      const to = result.to.length ? result.to.join(', ') : '';
      setSuccess(result.deduplicated
        ? (to ? `Already sent to ${to} recently — no duplicate sent.` : 'Already sent recently — no duplicate sent.')
        : (to ? `Sent to ${to}` : 'Email sent.'));
      onSent?.(student.id, { studentEmail: studentEmail.trim(), parentEmail: parentEmail.trim() });
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Send failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={s.emailGrid}>
        <div>
          <label style={s.label}>Student Email</label>
          <input style={s.input} value={studentEmail} placeholder="student@email.com" onChange={(e) => { setStudentEmail(e.target.value); setSuccess(null); }} />
        </div>
        <div>
          <label style={s.label}>Parent Email</label>
          <input style={s.input} value={parentEmail} placeholder="parent@email.com" onChange={(e) => { setParentEmail(e.target.value); setSuccess(null); }} />
        </div>
      </div>
      <div>
        <label style={s.label}>Subject (optional)</label>
        <input style={s.input} value={subject} placeholder={`${student.name} — Progress Report`} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div style={s.actionBtns}>
        <button
          type="button"
          style={{ ...s.btn, opacity: (!configured || !datesOk || !recipientsOk || loading) ? 0.55 : 1 }}
          disabled={!configured || !datesOk || !recipientsOk || loading}
          onClick={handleSend}
        >
          {loading ? 'Sending…' : '✉ Send to Student & Parent'}
        </button>
        {!configured && <span style={s.hint}>Email isn't configured on the server.</span>}
        {configured && !datesOk && <span style={s.hint}>Pick a date range above first.</span>}
        {configured && datesOk && !anyRecipient && <span style={s.hint}>Enter at least one email.</span>}
      </div>
      {success && <div style={s.ok}>✓ {success}</div>}
      {error && <div style={s.err}>⚠ {error}</div>}
    </div>
  );
}

export default function StudentDirectory({
  students,
  allContacts,
  onContactsPersisted,
  emailConfigured,
  startDate, endDate, onStartDate, onEndDate,
  dayOfWeek,
  onViewReport,
}) {
  const [source, setSource] = useState('groups'); // 'groups' | 'programs'
  const [groups, setGroups] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchStudentGroups().catch(() => []),
      fetchPrograms().catch(() => []),
    ])
      .then(([g, p]) => {
        if (cancelled) return;
        setGroups(g);
        setPrograms(p);
        // Preselect the first group so the main page shows students right away.
        if (g.length > 0) setSelectedId(`g:${g[0].groupId}`);
        else if (p.length > 0) { setSource('programs'); setSelectedId(`p:${p[0].programId}`); }
      })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load groups'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => new Map((students || []).map((st) => [String(st.id), st])), [students]);

  const options = source === 'groups'
    ? groups.map((g) => ({ value: `g:${g.groupId}`, label: `${g.groupName} (${g.students.length})` }))
    : programs.map((p) => ({ value: `p:${p.programId}`, label: `${p.name} (${(p.studentIds || []).length})` }));

  const roster = useMemo(() => {
    if (!selectedId) return [];
    if (selectedId.startsWith('g:')) {
      const g = groups.find((x) => `g:${x.groupId}` === selectedId);
      return g ? g.students : [];
    }
    const p = programs.find((x) => `p:${x.programId}` === selectedId);
    if (!p) return [];
    return (p.studentIds || [])
      .map((id) => byId.get(String(id)) || { id: String(id), name: `User ${id}`, email: null })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedId, groups, programs, byId]);

  const filtered = roster.filter(
    (st) => !search || st.name.toLowerCase().includes(search.toLowerCase())
  );

  function switchSource(next) {
    setSource(next);
    setExpandedId(null);
    setSearch('');
    const first = next === 'groups' ? groups[0] : programs[0];
    setSelectedId(first ? (next === 'groups' ? `g:${first.groupId}` : `p:${first.programId}`) : '');
  }

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardDot} />
        <span style={s.cardTitle}>Students</span>
        <div role="tablist" aria-label="Roster source" style={s.sourceGroup}>
          <button type="button" role="tab" aria-selected={source === 'groups'}
            onClick={() => switchSource('groups')}
            style={{ ...s.sourcePill, ...(source === 'groups' ? s.sourcePillActive : {}) }}>
            Groups
          </button>
          <button type="button" role="tab" aria-selected={source === 'programs'}
            onClick={() => switchSource('programs')}
            style={{ ...s.sourcePill, ...(source === 'programs' ? s.sourcePillActive : {}) }}>
            Programs
          </button>
        </div>
      </div>

      <div style={s.cardBody}>
        <div>
          <label style={s.label}>{source === 'groups' ? 'ClassMarker Group' : 'Program'}</label>
          <select
            style={s.select}
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setExpandedId(null); }}
            disabled={loading}
          >
            {options.length === 0 && <option value="">{loading ? 'Loading…' : 'None found'}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={onStartDate}
          onEndChange={onEndDate}
        />
        <span style={{ ...s.hint, marginTop: -10 }}>
          The date range is used for View Report and emailed reports.
        </span>

        {roster.length > 8 && (
          <input
            style={s.search}
            value={search}
            placeholder="Search students…"
            onChange={(e) => setSearch(e.target.value)}
          />
        )}

        {error && <div style={s.err}>⚠ {error}</div>}

        <div style={s.list}>
          {loading && <div style={{ padding: '14px 16px', ...s.hint }}>Loading students…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '14px 16px', ...s.hint }}>
              {roster.length === 0 ? 'No students in this selection.' : 'No students match your search.'}
            </div>
          )}
          {filtered.map((st, i) => {
            const saved = allContacts?.[st.id];
            const hasContacts = Boolean(saved?.studentEmail || saved?.parentEmail);
            const expanded = expandedId === st.id;
            return (
              <div key={st.id}>
                <div
                  style={{ ...s.row, ...(i === 0 ? { borderTop: 'none' } : {}), ...(expanded ? { background: 'var(--accent-dim)' } : {}) }}
                  onClick={() => setExpandedId(expanded ? null : st.id)}
                >
                  <div>
                    <div style={s.rowName}>{st.name}</div>
                    {st.email && <div style={s.rowMeta}>{st.email}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...s.pill, ...(hasContacts ? s.pillOk : s.pillWarn) }}>
                      {hasContacts ? 'Contacts saved' : 'No contacts'}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{expanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expanded && (
                  <div style={s.actions}>
                    <div style={s.actionBtns}>
                      <button type="button" style={s.btnGhost} onClick={() => onViewReport?.(st.id)}>
                        📄 View Report
                      </button>
                    </div>
                    <EmailAction
                      student={st}
                      saved={saved}
                      startDate={startDate}
                      endDate={endDate}
                      dayOfWeek={dayOfWeek}
                      configured={emailConfigured}
                      onSent={onContactsPersisted}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
