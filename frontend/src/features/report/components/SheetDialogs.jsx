// features/report/components/SheetDialogs.jsx
// The two dialogs for scoring sheets:
//   SheetImportDialog - add or replace a sheet from a file or pasted cells,
//                       with a preview of what was read before anything saves
//   SheetTableDialog  - look at a stored sheet's full raw → score table
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal.jsx';
import { parseScoringSheet, saveScoringSheet, fetchScoringSheet } from '../api/reportApi.js';
import { buildCurve, defaultColumnIndex, defaultTableIndex, formatDate, sourceDetail } from '../scoring.js';
import s from './examManagerStyles.js';

const d = {
  dropZone: {
    border: '1.5px dashed var(--border)', borderRadius: 12, padding: '22px 16px', textAlign: 'center',
    background: 'var(--surface)', transition: 'border-color 150ms ease, background 150ms ease',
  },
  dropZoneActive: { borderColor: 'var(--accent)', background: 'var(--accent-dim)' },
  dropTitle: { fontSize: '0.86rem', fontWeight: 600, color: 'var(--ink)' },
  dropHint: { fontSize: '0.74rem', color: 'var(--muted)', marginTop: 4, marginBottom: 12 },
  or: { display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 96, padding: '8px 10px', borderRadius: 8,
    border: '1.5px solid var(--border)', fontSize: '0.78rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    resize: 'vertical', lineHeight: 1.5,
  },
  choiceRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  // Longhand border so the selected state can change the colour alone.
  choice: {
    appearance: 'none', borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--border)', background: '#fff', color: 'var(--ink)',
    padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, fontFamily: 'inherit',
  },
  choiceOn: { borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff' },
  summary: { fontSize: '0.8rem', color: 'var(--ink-light)' },
  warning: { padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, color: '#92400e', fontSize: '0.76rem', lineHeight: 1.45 },
  tableWrap: { border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', maxHeight: 280, overflowY: 'auto', background: 'var(--surface)' },
  tableColumns: { columnWidth: 118, columnGap: 18, columnRule: '1px solid var(--border)' },
  pair: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.78rem', padding: '2px 0', breakInside: 'avoid', fontVariantNumeric: 'tabular-nums' },
  pairRaw: { width: 22, textAlign: 'right', color: 'var(--muted)' },
  pairArrow: { color: 'var(--border)' },
  pairScore: { fontWeight: 600, color: 'var(--ink)' },
  pairDim: { color: 'var(--muted)', fontWeight: 400 },
  source: { fontSize: '0.74rem', color: 'var(--muted)' },
};

// Raw → score pairs flowing down newspaper-style columns. `rows` are
// { raw, lower, upper }; when a row is a range, both ends show and the end
// named by `bound` is emphasised.
export function ScoreTable({ rows, bound = 'upper' }) {
  return (
    <div style={d.tableWrap}>
      <div style={d.tableColumns}>
        {rows.map((row) => {
          const ranged = row.lower !== row.upper;
          return (
            <div key={row.raw} style={d.pair}>
              <span style={d.pairRaw}>{row.raw}</span>
              <span style={d.pairArrow}>→</span>
              {ranged ? (
                <span>
                  <span style={bound === 'lower' ? d.pairScore : d.pairDim}>{row.lower}</span>
                  <span style={d.pairDim}> - </span>
                  <span style={bound === 'upper' ? d.pairScore : d.pairDim}>{row.upper}</span>
                </span>
              ) : (
                <span style={d.pairScore}>{row.upper}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// target: { groupId, section }. level: the library level being filled, used
// only to preselect a matching worksheet / column. label: e.g. "English · Easy".
export function SheetImportDialog({ target, level = null, label, replacing = false, onClose, onSaved }) {
  const fileInput = useRef(null);
  const [tables, setTables] = useState(null); // null = choosing a source
  const [tableIndex, setTableIndex] = useState(0);
  const [columnIndex, setColumnIndex] = useState(0);
  const [filename, setFilename] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const table = tables?.[tableIndex] || null;
  const picked = useMemo(() => (table ? buildCurve(table, columnIndex) : null), [table, columnIndex]);

  async function read(source, name) {
    setBusy(true);
    setError(null);
    try {
      const { tables: found } = await parseScoringSheet(source);
      const index = defaultTableIndex(found, level);
      setTables(found);
      setTableIndex(index);
      setColumnIndex(defaultColumnIndex(found[index], level));
      setFilename(name);
    } catch (err) {
      setError(err.message || 'Could not read that sheet');
    } finally {
      setBusy(false);
    }
  }

  function chooseTable(index) {
    setTableIndex(index);
    setColumnIndex(defaultColumnIndex(tables[index], level));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveScoringSheet({
        groupId: target.groupId,
        section: target.section,
        curve: picked.curve,
        bound: picked.bound,
        filename,
        columnLabel: sourceDetail(tables, table, picked),
      });
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save the sheet');
      setBusy(false);
    }
  }

  const title = `${replacing ? 'Replace' : 'Add'} scoring sheet`;

  if (!table) {
    return (
      <Modal title={title} subtitle={label} busy={busy} onClose={onClose}>
        <div
          style={{ ...d.dropZone, ...(dragOver ? d.dropZoneActive : null) }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) read({ file }, file.name);
          }}
        >
          <div style={d.dropTitle}>Drop the scoring sheet here</div>
          <div style={d.dropHint}>Excel (.xlsx) or .csv. Any layout works as long as it has a raw-score column and a score column.</div>
          <button type="button" style={s.btn} disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? 'Reading…' : 'Choose file'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) read({ file }, file.name);
            }}
          />
        </div>

        <div style={d.or}><span style={d.orLine} />or<span style={d.orLine} /></div>

        <div>
          <span style={s.label}>Paste the cells</span>
          <textarea
            style={d.textarea}
            value={text}
            disabled={busy}
            placeholder={'Copy the raw and score columns in Excel or Google Sheets and paste them here.\n0\t200\n1\t210\n2\t220'}
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" style={s.btnGhost} disabled={busy || !text.trim()} onClick={() => read({ text }, null)}>
              Read pasted cells
            </button>
          </div>
        </div>

        {error && <div style={s.error}>⚠ {error}</div>}
      </Modal>
    );
  }

  const scores = picked.curve.map((p) => (picked.bound === 'lower' ? p.lower : p.upper));
  return (
    <Modal
      title={title}
      subtitle={label}
      width={640}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" style={s.btnGhost} disabled={busy} onClick={() => { setTables(null); setError(null); }}>
            Choose a different sheet
          </button>
          <button type="button" style={{ ...s.btn, opacity: busy ? 0.6 : 1 }} disabled={busy || picked.curve.length < 2} onClick={save}>
            {busy ? 'Saving…' : 'Save sheet'}
          </button>
        </>
      )}
    >
      <div style={d.source}>
        {filename ? <>Read from <strong>{filename}</strong></> : 'Read from pasted cells'}
      </div>

      {tables.length > 1 && (
        <div>
          <span style={s.label}>Worksheet</span>
          <div style={d.choiceRow}>
            {tables.map((t, i) => (
              <button
                key={`${t.sheetName}-${i}`}
                type="button"
                aria-pressed={i === tableIndex}
                style={{ ...d.choice, ...(i === tableIndex ? d.choiceOn : null) }}
                onClick={() => chooseTable(i)}
              >
                {t.sheetName || `Sheet ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {table.columns.length > 1 && (
        <div>
          <span style={s.label}>Score column to use</span>
          <div style={d.choiceRow}>
            {table.columns.map((c, i) => (
              <button
                key={`${c.label}-${i}`}
                type="button"
                aria-pressed={i === columnIndex}
                style={{ ...d.choice, ...(i === columnIndex ? d.choiceOn : null) }}
                onClick={() => setColumnIndex(i)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={s.hint}>This sheet lists {table.columns.length} scores for each raw score. Pick the one this sheet should use.</div>
        </div>
      )}

      <div style={d.summary}>
        <strong>{picked.curve.length} raw scores</strong> ({table.rawMin} to {table.rawMax}) convert to scores from{' '}
        <strong>{Math.min(...scores)}</strong> to <strong>{Math.max(...scores)}</strong>.
      </div>

      {table.warnings.map((w) => <div key={w} style={d.warning}>⚠ {w}</div>)}

      <ScoreTable rows={picked.curve} bound={picked.bound} />

      {error && <div style={s.error}>⚠ {error}</div>}
    </Modal>
  );
}

// target: { groupId, section }.
export function SheetTableDialog({ target, label, onClose }) {
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchScoringSheet(target)
      .then((data) => { if (!cancelled) setSheet(data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load the sheet'); });
    return () => { cancelled = true; };
  }, [target.groupId, target.section]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = sheet?.summary;
  const meta = summary && [
    summary.originalFilename || 'Pasted cells',
    summary.columnLabel || null,
    summary.hasRange ? `using the ${summary.bound} score` : null,
    formatDate(summary.uploadedAt) ? `added ${formatDate(summary.uploadedAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      title={label}
      subtitle={meta || undefined}
      width={640}
      onClose={onClose}
      footer={<button type="button" style={s.btnGhost} onClick={onClose}>Close</button>}
    >
      {error && <div style={s.error}>⚠ {error}</div>}
      {!sheet && !error && <div style={s.empty}>Loading…</div>}
      {sheet && (
        <>
          <div style={d.summary}>
            <strong>{summary.points} raw scores</strong> ({summary.rawMin} to {summary.rawMax}) convert to scores from{' '}
            <strong>{summary.scoreMin}</strong> to <strong>{summary.scoreMax}</strong>.
          </div>
          <ScoreTable rows={sheet.curve} bound={summary.bound} />
        </>
      )}
    </Modal>
  );
}
