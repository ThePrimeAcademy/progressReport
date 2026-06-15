// features/report/components/ScheduledQueuePanel.jsx
// Live view of scheduled bulk-email batches. Polls the queue on an interval so
// in-flight batches update, supports expanding a batch to see per-student
// delivery status, and lets you cancel a batch that hasn't started yet.
import React, { useCallback, useEffect, useState } from 'react';
import { fetchEmailQueue, fetchEmailBatch, cancelScheduledBatch } from '../api/reportApi.js';

const POLL_INTERVAL_MS = 15000;

const BATCH_STATUS = {
  scheduled:             { label: 'Scheduled',           color: '#1a56db', bg: '#dbeafe' },
  running:               { label: 'Sending…',            color: '#b45309', bg: '#fef3c7' },
  completed:             { label: 'Completed',           color: '#15803d', bg: '#dcfce7' },
  completed_with_errors: { label: 'Completed · errors',  color: '#b45309', bg: '#fef3c7' },
  canceled:              { label: 'Canceled',            color: '#6b7280', bg: '#f1f5f9' },
  failed:                { label: 'Failed',              color: '#b91c1c', bg: '#fee2e2' },
};

const ITEM_STATUS = {
  pending: { label: '⏳ Queued',     color: '#6b7280' },
  sending: { label: '📨 Sending',    color: '#1a56db' },
  sent:    { label: '✓ Sent',        color: '#15803d' },
  failed:  { label: '✗ Failed',      color: '#b91c1c' },
  skipped: { label: '⊘ No contact',  color: '#b45309' },
};

const s = {
  card: {
    background: 'var(--bg)',
    borderRadius: 16,
    boxShadow: 'var(--shadow-lg)',
    border: '1.5px solid var(--border)',
    overflow: 'hidden',
    marginTop: 24,
  },
  head: {
    padding: '18px 24px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  title: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', flex: 1 },
  refresh: {
    background: 'none', border: 'none', color: 'var(--accent)',
    cursor: 'pointer', fontWeight: 600, fontSize: '0.74rem', padding: '2px 4px',
  },
  body: { padding: 8 },
  empty: { padding: '28px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.88rem', fontStyle: 'italic' },
  errorBox: { margin: 16, padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.82rem' },
  batch: { borderRadius: 12, border: '1px solid var(--border)', margin: 8, overflow: 'hidden' },
  batchHead: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    alignItems: 'center',
    padding: '12px 16px',
    cursor: 'pointer',
    background: 'var(--bg)',
  },
  batchLeft: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  batchTitleRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  caret: { color: 'var(--muted)', fontSize: '0.7rem', width: 12, display: 'inline-block' },
  batchLabel: { fontSize: '0.92rem', fontWeight: 600, color: 'var(--ink)' },
  badge: {
    fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em',
    textTransform: 'uppercase', borderRadius: 99, padding: '3px 10px',
  },
  meta: { fontSize: '0.76rem', color: 'var(--muted)' },
  counts: { fontSize: '0.76rem', color: 'var(--muted)', marginTop: 2 },
  batchRight: { display: 'flex', alignItems: 'center', gap: 10 },
  cancelBtn: {
    background: 'transparent', border: '1.5px solid #fca5a5', color: '#b91c1c',
    borderRadius: 8, padding: '6px 12px', fontSize: '0.76rem', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
  },
  items: { borderTop: '1px solid var(--border)', background: '#fafbff', padding: '6px 0' },
  item: {
    display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
    padding: '6px 18px', fontSize: '0.83rem',
  },
  itemName: { color: 'var(--ink)' },
  itemErr: { gridColumn: '1 / -1', color: '#b91c1c', fontSize: '0.72rem', marginTop: 1 },
  itemBadge: { fontWeight: 600, fontSize: '0.76rem', whiteSpace: 'nowrap' },
  itemsLoading: { padding: '10px 18px', fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' },
};

function countsSummary(c) {
  if (!c) return '';
  const parts = [];
  if (c.sent) parts.push(`${c.sent} sent`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.sending) parts.push(`${c.sending} sending`);
  if (c.pending) parts.push(`${c.pending} queued`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  parts.push(`${c.total} total`);
  return parts.join(' · ');
}

export default function ScheduledQueuePanel({ refreshSignal = 0 }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});       // batchId -> { items }
  const [detailLoading, setDetailLoading] = useState(null);
  const [canceling, setCanceling] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchEmailQueue();
      setBatches(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + whenever the parent signals a new schedule was created.
  useEffect(() => { load(); }, [load, refreshSignal]);

  // Poll so scheduled/in-flight batches advance without a manual refresh.
  useEffect(() => {
    const t = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Refresh an expanded batch's items as the poll advances its status.
  useEffect(() => {
    if (!expandedId) return;
    const batch = batches.find((b) => b.id === expandedId);
    if (batch && (batch.status === 'running' || batch.status === 'scheduled')) {
      fetchEmailBatch(expandedId).then((d) => setDetails((p) => ({ ...p, [expandedId]: d }))).catch(() => {});
    }
  }, [batches, expandedId]);

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!details[id]) {
      setDetailLoading(id);
      try {
        const d = await fetchEmailBatch(id);
        setDetails((p) => ({ ...p, [id]: d }));
      } catch {
        // Leave undefined; the row simply won't expand its items.
      } finally {
        setDetailLoading(null);
      }
    }
  }

  async function handleCancel(id, e) {
    e.stopPropagation();
    setCanceling((prev) => new Set(prev).add(id));
    try {
      await cancelScheduledBatch(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to cancel.');
    } finally {
      setCanceling((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div style={s.card}>
      <div style={s.head}>
        <div style={s.dot} />
        <span style={s.title}>Scheduled Queue</span>
        <button type="button" style={s.refresh} onClick={load}>Refresh</button>
      </div>

      <div style={s.body}>
        {error && <div style={s.errorBox}>⚠ {error}</div>}
        {loading && batches.length === 0 && <div style={s.empty}>Loading…</div>}
        {!loading && batches.length === 0 && !error && (
          <div style={s.empty}>No scheduled sends yet. Pick a date &amp; time above to schedule one.</div>
        )}

        {batches.map((b) => {
          const status = BATCH_STATUS[b.status] || { label: b.status, color: 'var(--ink)', bg: '#f1f5f9' };
          const isOpen = expandedId === b.id;
          const detail = details[b.id];
          const cancelable = b.status === 'scheduled';
          return (
            <div key={b.id} style={s.batch}>
              <div style={s.batchHead} onClick={() => toggleExpand(b.id)}>
                <div style={s.batchLeft}>
                  <div style={s.batchTitleRow}>
                    <span style={s.caret}>{isOpen ? '▾' : '▸'}</span>
                    <span style={s.batchLabel}>{b.label || 'Untitled batch'}</span>
                    <span style={{ ...s.badge, color: status.color, background: status.bg }}>{status.label}</span>
                  </div>
                  <span style={s.meta}>
                    {new Date(b.send_at).toLocaleString()} · {b.start_date} → {b.end_date}
                  </span>
                  <span style={s.counts}>{countsSummary(b.counts)}</span>
                </div>
                <div style={s.batchRight}>
                  {cancelable && (
                    <button
                      type="button"
                      style={s.cancelBtn}
                      onClick={(e) => handleCancel(b.id, e)}
                      disabled={canceling.has(b.id)}
                    >
                      {canceling.has(b.id) ? 'Canceling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div style={s.items}>
                  {detailLoading === b.id && !detail && <div style={s.itemsLoading}>Loading recipients…</div>}
                  {detail?.items?.map((it) => {
                    const st = ITEM_STATUS[it.status] || { label: it.status, color: 'var(--ink)' };
                    return (
                      <div key={it.id} style={s.item}>
                        <span style={s.itemName}>{it.student_name || it.student_id}</span>
                        <span style={{ ...s.itemBadge, color: st.color }}>{st.label}</span>
                        {it.error && <span style={s.itemErr}>{it.error}</span>}
                      </div>
                    );
                  })}
                  {detail?.items?.length === 0 && <div style={s.itemsLoading}>No recipients in this batch.</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
