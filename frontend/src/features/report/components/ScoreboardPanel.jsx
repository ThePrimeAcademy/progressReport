// features/report/components/ScoreboardPanel.jsx
// Ranked results for one exam — name, RW, Math, Total, newest attempt date —
// plus admin editing of RAW scores. Scaled scores are never edited directly:
// they regenerate from the curve after every raw edit. Overridden scores show
// a ✎ badge; hover reveals the imported original and the edit reason.
import React, { useEffect, useState } from 'react';
import {
  fetchExamScoreboard,
  updateRawScore,
  revertRawScore,
  createRawScoreOverride,
} from '../api/reportApi.js';
import s from './examManagerStyles.js';

const SECTION_LABEL = { 1: 'RW', 2: 'RW (2)', 3: 'Math', 4: 'Math (2)' };

function overrideTitle(tests, isMath) {
  const edited = (tests || []).filter(
    (t) => t.manualOverride && (isMath ? t.section > 2 : t.section <= 2)
  );
  if (!edited.length) return null;
  return edited
    .map((t) => `Manually edited — original: ${t.originalRaw ?? '—'}${t.overrideReason ? ` (${t.overrideReason})` : ''}`)
    .join('\n');
}

function EditModal({ row, onClose, onSaved, onError }) {
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries((row.tests || []).map((t) => [t.testId, String(t.correct ?? '')]))
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const changed = (row.tests || []).filter(
    (t) => drafts[t.testId] !== '' && Number(drafts[t.testId]) !== Number(t.correct)
  );

  const save = async () => {
    if (!changed.length) return onClose();
    if (!reason.trim()) return onError?.('A reason is required for every manual score edit.');
    for (const t of changed) {
      const n = Number(drafts[t.testId]);
      if (!Number.isInteger(n) || n < 0 || (t.maxScore != null && n > t.maxScore)) {
        return onError?.(`${t.testName}: score must be a whole number between 0 and ${t.maxScore ?? '?'}.`);
      }
    }
    setBusy(true);
    try {
      for (const t of changed) {
        const payload = { score: Number(drafts[t.testId]), reason: reason.trim() };
        if (t.recordId != null) await updateRawScore(t.recordId, payload);
        else await createRawScoreOverride({ studentId: row.studentId, testId: t.testId, ...payload });
      }
      await onSaved();
    } catch (err) {
      onError?.(err.message || 'Failed to save score edit');
    } finally {
      setBusy(false);
    }
  };

  const revert = async (t) => {
    if (t.recordId == null) return;
    setBusy(true);
    try {
      await revertRawScore(t.recordId);
      await onSaved();
    } catch (err) {
      onError?.(err.message || 'Failed to revert score');
    } finally {
      setBusy(false);
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  };
  const card = {
    background: '#fff', borderRadius: 12, padding: '18px 20px', width: 'min(440px, 100%)',
    boxShadow: '0 12px 40px rgba(15,23,42,0.25)',
  };
  const label = { fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' };
  const input = { width: 72, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.85rem', textAlign: 'right' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 2 }}>Edit raw scores</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 12 }}>
          {row.name} — scaled scores recalculate from the curve automatically.
        </div>

        {(row.tests || []).map((t) => (
          <div key={t.testId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {SECTION_LABEL[t.section] || `Section ${t.section}`}
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {t.testName}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                {t.manualOverride
                  ? <>edited — imported value: {t.originalRaw ?? '—'}{' '}
                      <button type="button" disabled={busy} onClick={() => revert(t)}
                        style={{ border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.7rem', padding: 0, textDecoration: 'underline' }}>
                        revert
                      </button>
                    </>
                  : `imported${t.recordId == null ? ' (API only)' : ''}`}
                {t.maxScore != null ? ` · max ${t.maxScore}` : ''}
              </div>
            </div>
            <input
              type="number" min={0} max={t.maxScore ?? undefined} style={input} disabled={busy}
              value={drafts[t.testId]}
              onChange={(e) => setDrafts((d) => ({ ...d, [t.testId]: e.target.value }))}
            />
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <div style={label}>Reason (required)</div>
          <textarea
            rows={2} disabled={busy} value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Question 12 mis-keyed on ClassMarker; regraded by hand"
            style={{ width: '100%', marginTop: 4, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" style={s.btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...s.btn, opacity: busy || !changed.length ? 0.6 : 1 }} disabled={busy || !changed.length} onClick={save}>
            {busy ? 'Saving…' : 'Save edits'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScoreboardPanel({ exam, onError }) {
  const [board, setBoard] = useState(null); // null = loading
  const [editing, setEditing] = useState(null); // scoreboard row being edited

  const load = React.useCallback(() => fetchExamScoreboard(exam.examId)
    .then(setBoard)
    .catch((err) => { setBoard({ rows: [] }); onError?.(err.message || 'Failed to load scoreboard'); }), [exam.examId, onError]);

  useEffect(() => {
    let cancelled = false;
    fetchExamScoreboard(exam.examId)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((err) => { if (!cancelled) { setBoard({ rows: [] }); onError?.(err.message || 'Failed to load scoreboard'); } });
    return () => { cancelled = true; };
  }, [exam.examId, onError]);

  const cell = { padding: '6px 12px', fontSize: '0.8rem' };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const header = { ...cell, fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', textAlign: 'left', background: '#f1f5ff' };
  const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);
  const fmt = (scaled, raw) => (scaled != null ? scaled : raw != null ? `${raw} raw` : '—');
  const badge = { color: 'var(--accent)', fontSize: '0.7rem', marginLeft: 3, cursor: 'help' };

  const scoreCell = (row, isMath) => {
    const title = overrideTitle(row.tests, isMath);
    return (
      <span title={title || undefined}>
        {fmt(isMath ? row.mathScaled : row.rwScaled, isMath ? row.mathRaw : row.rwRaw)}
        {title && <span style={badge}>✎</span>}
      </span>
    );
  };

  return (
    <div style={s.hiddenPanel}>
      <div style={s.hiddenTitle}>
        Scoreboard{board?.date ? ` · ${board.date}` : ''}
        {board && !(board.hasRwCurve && board.hasMathCurve) && (
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {' '}— upload {!board.hasRwCurve && !board.hasMathCurve ? 'the RW and Math sheets' : !board.hasRwCurve ? 'the RW sheet' : 'the Math sheet'} for scaled scores
          </span>
        )}
      </div>
      {board === null ? (
        <div style={s.empty}>Loading scoreboard…</div>
      ) : board.rows.length === 0 ? (
        <div style={s.empty}>No results yet for this exam's tests.</div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...header, width: 40 }}>#</th>
                <th style={header}>Student</th>
                <th style={{ ...header, textAlign: 'right' }}>RW</th>
                <th style={{ ...header, textAlign: 'right' }}>Math</th>
                <th style={{ ...header, textAlign: 'right' }}>Total</th>
                <th style={{ ...header, textAlign: 'right' }}>Date</th>
                <th style={{ ...header, width: 36 }} aria-label="Edit" />
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row, i) => (
                <tr key={row.studentId} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? '#fafbff' : '#fff' }}>
                  <td style={{ ...cell, color: 'var(--muted)' }}>{medal(i + 1)}</td>
                  <td style={{ ...cell, fontWeight: 500 }}>{row.name}</td>
                  <td style={num}>{scoreCell(row, false)}</td>
                  <td style={num}>{scoreCell(row, true)}</td>
                  <td style={{ ...num, fontWeight: 700, color: row.total != null ? 'var(--accent)' : 'var(--muted)' }}>
                    {row.total ?? '—'}
                  </td>
                  <td style={{ ...num, color: 'var(--muted)', fontSize: '0.72rem' }}>{row.date || '—'}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <button
                      type="button"
                      title="Edit raw score"
                      onClick={() => setEditing(row)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem', padding: 2 }}
                    >
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditModal
          row={editing}
          onClose={() => setEditing(null)}
          onError={onError}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}
