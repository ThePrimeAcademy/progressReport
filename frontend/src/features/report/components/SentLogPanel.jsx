// features/report/components/SentLogPanel.jsx
// "Sent Log" mode — permanent, searchable history of every email the server
// sent (or failed to send): report emails and Email-tab custom messages,
// immediate and scheduled alike. Read-only; rows are written by the backend
// at send time (db.logSentEmail).
import React, { useState, useEffect, useCallback } from 'react';
import { fetchSentLog } from '../api/reportApi.js';

const PAGE_SIZE = 100;

const s = {
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  cardHead: { padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  cardDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  cardTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' },
  cardBody: { padding: '24px', display: 'flex', flexDirection: 'column', gap: 14 },
  hint: { fontSize: '0.78rem', color: 'var(--muted)' },
  search: { flex: 1, minWidth: 200, padding: '9px 14px', fontSize: '0.88rem', border: '1.5px solid var(--border)', borderRadius: 10, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' },
  btnGhost: { fontSize: '0.78rem', fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' },
  table: { border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  row: { display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1.3fr 0.7fr 0.6fr 0.9fr', gap: 10, padding: '9px 14px', fontSize: '0.78rem', borderTop: '1px solid var(--border)', alignItems: 'center' },
  headRow: { fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', background: '#fafbff', borderTop: 'none' },
  badge: { fontSize: '0.64rem', fontWeight: 600, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', justifySelf: 'start' },
  sent: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  failed: { background: '#fff1f2', color: '#b91c1c', border: '1px solid #fca5a5' },
  err: { padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.85rem' },
  errLine: { gridColumn: '1 / -1', fontSize: '0.7rem', color: '#b91c1c' },
};

const KIND_LABEL = { report: 'Report', custom: 'Custom' };
const SOURCE_LABEL = { immediate: 'Immediate', scheduled: 'Scheduled' };

function fmtWhen(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString();
}

export default function SentLogPanel() {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (searchTerm, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSentLog({
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
        search: searchTerm,
      });
      setEntries(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load the sent log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(applied, page); }, [load, applied, page]);

  // Debounce typing → applied search, resetting to the first page.
  useEffect(() => {
    const t = setTimeout(() => { setApplied(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardDot} />
        <span style={s.cardTitle}>Sent Log</span>
        <span style={{ ...s.hint, marginLeft: 'auto' }}>
          Every email this server has sent — reports and custom messages, immediate and scheduled
        </span>
      </div>
      <div style={s.cardBody}>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={s.search}
            value={search}
            placeholder="Search by student, recipient, or subject…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" style={s.btnGhost} onClick={() => load(applied, page)}>
            ↻ Refresh
          </button>
        </div>

        {error && <div style={s.err}>⚠ {error}</div>}

        <div style={s.table}>
          <div style={{ ...s.row, ...s.headRow }}>
            <span>Student</span>
            <span>Recipients</span>
            <span>Subject</span>
            <span>Type</span>
            <span>Status</span>
            <span>When</span>
          </div>
          {loading && (
            <div style={{ padding: '14px', ...s.hint }}>Loading…</div>
          )}
          {!loading && entries.length === 0 && (
            <div style={{ padding: '14px', ...s.hint }}>
              {applied ? 'No sent emails match your search.' : 'Nothing here yet — emails appear as they are sent.'}
            </div>
          )}
          {!loading && entries.map((e) => (
            <div key={e.id} style={s.row}>
              <span style={{ fontWeight: 600 }} title={e.attachments ? `Attachments: ${e.attachments}` : 'No attachments'}>
                {e.student_name || e.student_id || '—'}
              </span>
              <span style={{ wordBreak: 'break-word' }}>{e.recipients || '—'}</span>
              <span style={{ wordBreak: 'break-word' }}>{e.subject || '—'}</span>
              <span>{KIND_LABEL[e.kind] || e.kind} · {SOURCE_LABEL[e.source] || e.source}</span>
              <span style={{ ...s.badge, ...(e.status === 'sent' ? s.sent : s.failed) }}>
                {e.status === 'sent' ? '✓ Sent' : '✗ Failed'}
              </span>
              <span>{fmtWhen(e.sent_at)}</span>
              {e.status === 'failed' && e.error && <span style={s.errLine}>⚠ {e.error}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            style={{ ...s.btnGhost, opacity: page === 0 ? 0.5 : 1 }}
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
          >
            ← Newer
          </button>
          <button
            type="button"
            style={{ ...s.btnGhost, opacity: entries.length < PAGE_SIZE ? 0.5 : 1 }}
            disabled={entries.length < PAGE_SIZE || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Older →
          </button>
          <span style={s.hint}>
            Page {page + 1}{applied ? ` — filtered by "${applied}"` : ''} · hover a student for attachment names
          </span>
        </div>

      </div>
    </div>
  );
}
