// features/report/components/ScoringSheetUpload.jsx
//
// Inline scoring-sheet uploader rendered inside SAT group headers.
// One control per (group, section) — Math + Reading & Writing.
// Uploads an .xlsx scoring curve, then notifies the parent to refresh.

import React, { useRef, useState } from 'react';
import { uploadScoringSheet, deleteScoringSheet } from '../api/reportApi.js';

const styles = {
  wrapper: {
    display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
    padding: '10px 14px', borderTop: '1px dashed var(--border)',
    background: '#fafbff', fontSize: '0.78rem',
  },
  label: { fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.7rem' },
  slot: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, border: '1.5px solid var(--border)', background: '#fff' },
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
    color: 'var(--ink)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.72rem', fontWeight: 500,
  },
  btnDanger: {
    appearance: 'none', border: '1px solid #fca5a5', background: '#fff',
    color: '#b91c1c', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: '0.7rem', fontWeight: 500,
  },
  status: { fontSize: '0.72rem' },
  error: { color: '#b91c1c' },
  ok: { color: '#15803d' },
};

const SECTION_LABELS = {
  math: 'Math',
  rw: 'Reading & Writing',
};

function SectionSlot({ groupId, section, existing, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
          <button type="button" style={styles.btnGhost} disabled={busy} onClick={() => inputRef.current?.click()}>
            Replace
          </button>
          <button type="button" style={styles.btnDanger} disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        </>
      ) : (
        <button type="button" style={styles.btn} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload .xlsx'}
        </button>
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

export default function ScoringSheetUpload({ groupId, sheets, onChanged }) {
  return (
    <div style={styles.wrapper} onClick={(e) => e.stopPropagation()}>
      <span style={styles.label}>Scoring Sheets:</span>
      <SectionSlot groupId={groupId} section="rw" existing={sheets?.rw} onChanged={onChanged} />
      <SectionSlot groupId={groupId} section="math" existing={sheets?.math} onChanged={onChanged} />
    </div>
  );
}
