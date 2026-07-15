// features/report/components/ComposeEmailPanel.jsx
// "Email" mode — write your own message and send it to selected students'
// saved contacts (student + parent). By design this does NOT send the
// progress report: the PDF only rides along when "Attach progress report"
// is explicitly checked. Exists so the bulk email pipeline can be exercised
// without mailing out reports.
import React, { useState, useMemo } from 'react';
import { sendCustomEmail, fetchCustomEmailJobStatus } from '../api/reportApi.js';

const s = {
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  cardHead: { padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  cardDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  cardTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  cardBody: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 18 },
  label: { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, display: 'block' },
  input: { width: '100%', padding: '10px 14px', fontSize: '0.9rem', border: '1.5px solid var(--border)', borderRadius: 10, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' },
  textarea: { width: '100%', minHeight: 160, padding: '12px 14px', fontSize: '0.9rem', lineHeight: 1.6, border: '1.5px solid var(--border)', borderRadius: 10, fontFamily: 'var(--font-sans)', resize: 'vertical', boxSizing: 'border-box' },
  search: { width: '100%', padding: '9px 14px', fontSize: '0.88rem', border: '1.5px solid var(--border)', borderRadius: 10, fontFamily: 'var(--font-sans)', boxSizing: 'border-box', marginBottom: 8 },
  pickList: { border: '1.5px solid var(--border)', borderRadius: 12, maxHeight: 260, overflowY: 'auto' },
  pickRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none', fontSize: '0.88rem' },
  pill: { fontSize: '0.66rem', fontWeight: 600, borderRadius: 20, padding: '2px 8px', marginLeft: 'auto', whiteSpace: 'nowrap' },
  pillOk: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  pillWarn: { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: '#fafbff', border: '1.5px solid var(--border)', borderRadius: 10, cursor: 'pointer', userSelect: 'none' },
  btn: { fontSize: '0.9rem', fontWeight: 600, padding: '12px 22px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  btnGhost: { fontSize: '0.78rem', fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  hint: { fontSize: '0.78rem', color: 'var(--muted)' },
  ok: { padding: '10px 14px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, color: '#15803d', fontSize: '0.85rem', fontWeight: 500 },
  err: { padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' },
  resultRow: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 12px', fontSize: '0.8rem', borderTop: '1px solid var(--border)' },
};

export default function ComposeEmailPanel({
  students,
  allContacts,
  emailConfigured,
  startDate,
  endDate,
  dayOfWeek,
  onContactsPersisted, // kept for parity; custom sends don't alter contacts
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeReport, setIncludeReport] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // [{studentId, status, to, error}]

  const contactsFor = (id) => allContacts?.[id] || {};
  const hasRecipient = (st) => {
    const c = contactsFor(st.id);
    return Boolean(c.studentEmail || c.parentEmail || st.email);
  };

  const filtered = useMemo(
    () => (students || []).filter((st) => !search || st.name.toLowerCase().includes(search.toLowerCase())),
    [students, search]
  );

  const byId = useMemo(() => new Map((students || []).map((st) => [String(st.id), st])), [students]);

  const toggle = (id) => {
    setResults(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllWithContacts = () => {
    setResults(null);
    setSelected(new Set((students || []).filter(hasRecipient).map((st) => st.id)));
  };

  const datesOk = !includeReport || (startDate && endDate && new Date(startDate) <= new Date(endDate));
  const canSend = emailConfigured && selected.size > 0 && message.trim() && datesOk && !sending;

  async function handleSend() {
    setError(null);
    setResults(null);
    setSending(true);
    try {
      const items = Array.from(selected).map((id) => {
        const st = byId.get(String(id));
        const c = contactsFor(id);
        // Fall back to the ClassMarker email when no contacts are saved, so a
        // test send still has somewhere to go.
        if (!c.studentEmail && !c.parentEmail && st?.email) {
          return { studentId: id, studentEmail: st.email, parentEmail: '' };
        }
        return { studentId: id };
      });

      const start = await sendCustomEmail({
        items,
        subject: subject || undefined,
        message,
        includeReport,
        ...(includeReport ? { startDate, endDate, dayOfWeek: dayOfWeek && dayOfWeek.length ? dayOfWeek : undefined } : {}),
      });
      const jobId = start?.jobId;
      if (!jobId) throw new Error('Server did not return a job id.');

      // Attaching reports means a PDF render per student — budget generously.
      const maxAttempts = includeReport ? 300 : 120;
      let job = null;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
        job = await fetchCustomEmailJobStatus(jobId);
        if (job?.status === 'done' || job?.status === 'failed') break;
      }
      if (!job || job.status === 'pending') {
        throw new Error('Send is taking longer than expected — check inboxes before retrying.');
      }
      setResults(job.items || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  const sentCount = results ? results.filter((r) => r.status === 'sent').length : 0;
  const failCount = results ? results.filter((r) => r.status === 'failed').length : 0;

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardDot} />
        <span style={s.cardTitle}>Compose Email</span>
        <span style={{ ...s.hint, marginLeft: 'auto' }}>
          Sends your message to each student's saved student + parent emails
        </span>
      </div>
      <div style={s.cardBody}>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...s.label, marginBottom: 0 }}>
              Recipients — {selected.size} student{selected.size === 1 ? '' : 's'} selected
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={s.btnGhost} onClick={selectAllWithContacts}>Select all with contacts</button>
              <button type="button" style={s.btnGhost} onClick={() => { setSelected(new Set()); setResults(null); }}>Clear</button>
            </div>
          </div>
          <input
            style={s.search}
            value={search}
            placeholder="Search students…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={s.pickList}>
            {filtered.length === 0 && (
              <div style={{ padding: '12px 14px', ...s.hint }}>No students match.</div>
            )}
            {filtered.map((st, i) => {
              const c = contactsFor(st.id);
              const saved = Boolean(c.studentEmail || c.parentEmail);
              const fallback = !saved && Boolean(st.email);
              return (
                <label key={st.id} style={{ ...s.pickRow, ...(i === 0 ? { borderTop: 'none' } : {}) }}>
                  <input
                    type="checkbox"
                    checked={selected.has(st.id)}
                    onChange={() => toggle(st.id)}
                  />
                  <span>{st.name}</span>
                  <span style={{ ...s.pill, ...(saved ? s.pillOk : (fallback ? s.pillWarn : s.pillWarn)) }}>
                    {saved ? 'Contacts saved' : fallback ? 'ClassMarker email only' : 'No email on file'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label style={s.label}>Subject</label>
          <input
            style={s.input}
            value={subject}
            placeholder="Prime Academy"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label style={s.label}>Message</label>
          <textarea
            style={s.textarea}
            value={message}
            placeholder="Write the message students and parents will see…"
            onChange={(e) => { setMessage(e.target.value); setResults(null); }}
          />
        </div>

        <label style={s.checkboxRow}>
          <input
            type="checkbox"
            checked={includeReport}
            onChange={(e) => setIncludeReport(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>Attach progress report PDF</span>
            <br />
            <span style={s.hint}>
              Off by default — your message sends alone. When checked, each student's report
              for {startDate || '…'} → {endDate || '…'} is generated and attached.
            </span>
          </span>
        </label>

        {includeReport && !datesOk && (
          <div style={s.err}>⚠ Set a valid date range (on the Students or Single Student tab) before attaching reports.</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={{ ...s.btn, opacity: canSend ? 1 : 0.55 }}
            disabled={!canSend}
            onClick={handleSend}
          >
            {sending
              ? 'Sending…'
              : `✉ Send${includeReport ? ' with report' : ' (no report)'} to ${selected.size} student${selected.size === 1 ? '' : 's'}`}
          </button>
          {!emailConfigured && <span style={s.hint}>Email isn't configured on the server.</span>}
          {emailConfigured && selected.size === 0 && <span style={s.hint}>Select at least one student.</span>}
          {emailConfigured && selected.size > 0 && !message.trim() && <span style={s.hint}>Write a message first.</span>}
        </div>

        {error && <div style={s.err}>⚠ {error}</div>}

        {results && (
          <div>
            <div style={sentCount > 0 && failCount === 0 ? s.ok : (sentCount === 0 ? s.err : { ...s.ok, background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' })}>
              {failCount === 0
                ? `✓ Sent to ${sentCount} student${sentCount === 1 ? '' : 's'}.`
                : `${sentCount} sent, ${failCount} failed.`}
            </div>
            <div style={{ border: '1.5px solid var(--border)', borderRadius: 10, marginTop: 8, overflow: 'hidden' }}>
              {results.map((r, i) => {
                const st = byId.get(String(r.studentId));
                return (
                  <div key={r.studentId} style={{ ...s.resultRow, ...(i === 0 ? { borderTop: 'none' } : {}) }}>
                    <span style={{ fontWeight: 600 }}>{st?.name || r.studentId}</span>
                    <span style={{ color: r.status === 'sent' ? '#15803d' : '#b91c1c' }}>
                      {r.status === 'sent'
                        ? `Sent → ${(r.to || []).join(', ')}`
                        : (r.error || 'Failed')}
                    </span>
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
