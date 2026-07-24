// features/report/components/ScoreboardPanel.jsx
// Ranked results for one exam — name, RW, Math, Total, newest attempt date.
// Extracted from ExamManager so the per-exam row can stay small.
import React, { useEffect, useState } from 'react';
import { fetchExamScoreboard } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function ScoreboardPanel({ exam, onError }) {
  const [board, setBoard] = useState(null); // null = loading

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
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row, i) => (
                <tr key={row.studentId} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? '#fafbff' : '#fff' }}>
                  <td style={{ ...cell, color: 'var(--muted)' }}>{medal(i + 1)}</td>
                  <td style={{ ...cell, fontWeight: 500 }}>{row.name}</td>
                  <td style={num}>{fmt(row.rwScaled, row.rwRaw)}</td>
                  <td style={num}>{fmt(row.mathScaled, row.mathRaw)}</td>
                  <td style={{ ...num, fontWeight: 700, color: row.total != null ? 'var(--accent)' : 'var(--muted)' }}>
                    {row.total ?? '—'}
                  </td>
                  <td style={{ ...num, color: 'var(--muted)', fontSize: '0.72rem' }}>{row.date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
