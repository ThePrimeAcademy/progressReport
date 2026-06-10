// features/report/components/ScoringSheetUpload.jsx
//
// Inline scoring-sheet uploader rendered inside SAT group headers.
// One control per (group, section) — Math + Reading & Writing.
// Uploads an .xlsx scoring curve, then notifies the parent to refresh.

import React, { useRef, useState } from 'react';
import { uploadScoringSheet, deleteScoringSheet, setScoringSheetBound, copyScoringSheet } from '../api/reportApi.js';

const styles = {
  // Compact enough that the label + both uploaded section pills (pts, bound
  // toggle, Replace/Remove) stay on ONE line at the exam row's width; wrap
  // remains as the fallback for narrow screens.
  wrapper: {
    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    padding: '10px 14px', borderTop: '1px dashed var(--border)',
    background: '#fafbff', fontSize: '0.78rem',
  },
  label: { fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.7rem' },
  slot: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, border: '1.5px solid var(--border)', background: '#fff', whiteSpace: 'nowrap' },
  slotUploaded: { borderColor: '#86efac', background: '#f0fdf4', color: '#15803d' },
  slotMissing: { color: 'var(--muted)' },
  pill: { fontWeight: 600, fontSize: '0.72rem' },
  btn: {
    appearance: 'none', border: '1px solid var(--accent)', background: 'var(--accent)',
    color: '#fff', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.03em',
  },
  btnGhost: {
    appearance: 'none', border: '1px solid var(--border)', background: '#fff',
    color: 'var(--ink)', padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: 500,
  },
  btnDanger: {
    appearance: 'none', border: '1px solid #fca5a5', background: '#fff',
    color: '#b91c1c', padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.7rem', fontWeight: 500,
  },
  boundToggle: {
    display: 'inline-flex', borderRadius: 6, overflow: 'hidden',
    border: '1px solid var(--border)', marginLeft: 2,
  },
  boundBtn: {
    appearance: 'none', border: 'none', background: '#fff', color: 'var(--muted)',
    padding: '3px 6px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600,
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  boundBtnActive: { background: 'var(--accent)', color: '#fff' },
  copySelect: {
    appearance: 'auto', border: '1px solid var(--border)', background: '#fff',
    color: 'var(--ink)', padding: '3px 6px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: 500, fontFamily: 'inherit', maxWidth: 130,
  },
  status: { fontSize: '0.72rem' },
  error: { color: '#b91c1c' },
  ok: { color: '#15803d' },
};

const SECTION_LABELS = {
  math: 'Math',
  rw: 'RW',
};

function SectionSlot({ groupId, section, existing, sources = [], onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Other exams that already have a curve uploaded for THIS section.
  const sectionSources = sources.filter((src) => src.sheets?.[section]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadScoringSheet({ groupId, section, file });
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await deleteScoringSheet({ groupId, section });
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(e) {
    const fromGroupId = e.target.value;
    e.target.value = '';
    if (!fromGroupId) return;
    setBusy(true);
    setError(null);
    try {
      await copyScoringSheet({ fromGroupId, toGroupId: groupId, section });
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Copy failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleBound(nextBound) {
    if (nextBound === (existing?.bound || 'upper')) return;
    setBusy(true);
    setError(null);
    try {
      await setScoringSheetBound({ groupId, section, bound: nextBound });
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update bound');
    } finally {
      setBusy(false);
    }
  }

  const uploaded = Boolean(existing);

  function stop(e) { e.stopPropagation(); }

  return (
    <span
      style={{ ...styles.slot, ...(uploaded ? styles.slotUploaded : styles.slotMissing) }}
      onClick={stop}
    >
      <span style={styles.pill}>{SECTION_LABELS[section]}</span>
      {uploaded ? (
        <>
          <span style={styles.ok}>{existing.points} pts</span>
          <span style={styles.boundToggle} role="group" aria-label="Score bound">
            <button
              type="button"
              style={{ ...styles.boundBtn, ...((existing.bound || 'upper') === 'lower' ? styles.boundBtnActive : {}) }}
              disabled={busy}
              onClick={() => handleBound('lower')}
              title="Use the lower end of the scaled range"
            >
              Lower
            </button>
            <button
              type="button"
              style={{ ...styles.boundBtn, ...((existing.bound || 'upper') === 'upper' ? styles.boundBtnActive : {}) }}
              disabled={busy}
              onClick={() => handleBound('upper')}
              title="Use the upper end of the scaled range"
            >
              Upper
            </button>
          </span>
          <button type="button" style={styles.btnGhost} disabled={busy} onClick={() => inputRef.current?.click()}>
            Replace
          </button>
          <button type="button" style={styles.btnDanger} disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        </>
      ) : (
        <>
          <button type="button" style={styles.btn} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Working…' : 'Upload .xlsx'}
          </button>
          {sectionSources.length > 0 && (
            <select
              style={styles.copySelect}
              value=""
              disabled={busy}
              onChange={handleCopy}
              title="Reuse a scoring sheet already uploaded to another test"
            >
              <option value="">Copy from…</option>
              {sectionSources.map((src) => (
                <option key={src.curveKey} value={src.curveKey}>{src.name}</option>
              ))}
            </select>
          )}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {error && <span style={{ ...styles.status, ...styles.error }}>⚠ {error}</span>}
    </span>
  );
}

// `sources` — other exams whose already-uploaded curves can be reused here:
// [{ curveKey, name, sheets: { math?, rw? } }]
export default function ScoringSheetUpload({ groupId, sheets, sources = [], onChanged }) {
  return (
    <div style={styles.wrapper} onClick={(e) => e.stopPropagation()}>
      <span style={styles.label} title="Scoring sheets — the .xlsx curve for each section">Sheets:</span>
      <SectionSlot groupId={groupId} section="rw" existing={sheets?.rw} sources={sources} onChanged={onChanged} />
      <SectionSlot groupId={groupId} section="math" existing={sheets?.math} sources={sources} onChanged={onChanged} />
    </div>
  );
}
