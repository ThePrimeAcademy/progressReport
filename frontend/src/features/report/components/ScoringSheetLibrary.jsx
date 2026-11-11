// features/report/components/ScoringSheetLibrary.jsx
// The Scoring Sheets tab: three shared sheets per subject (Easy, Medium, Hard)
// that every exam picks from. Each slot can be filled from a file, from pasted
// cells, or by copying a sheet that is already stored somewhere else (another
// level, or a custom sheet uploaded to an exam in the past).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSheetLibrary,
  fetchExams,
  copyScoringSheet,
  deleteScoringSheet,
  setScoringSheetBound,
} from '../api/reportApi.js';
import { LEVELS, LEVEL_LABEL, LEVEL_COLOR, SUBJECTS, formatDate } from '../scoring.js';
import { SheetImportDialog, SheetTableDialog } from './SheetDialogs.jsx';
import s from './examManagerStyles.js';

const c = {
  intro: { fontSize: '0.84rem', color: 'var(--ink-light)', lineHeight: 1.6 },
  subjectCard: { ...s.card, marginTop: 0 },
  subjectHead: { padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  slots: { padding: '20px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 },
  slot: { borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 190 },
  slotEmpty: { borderStyle: 'dashed', background: 'var(--surface)' },
  slotTop: { display: 'flex', alignItems: 'center', gap: 8 },
  levelChip: { fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', borderRadius: 999, padding: '3px 10px', borderWidth: 1, borderStyle: 'solid' },
  used: { fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  filename: { fontSize: '0.84rem', fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere', lineHeight: 1.35 },
  meta: { fontSize: '0.74rem', color: 'var(--muted)', lineHeight: 1.5 },
  samples: { fontSize: '0.74rem', color: 'var(--ink-light)', fontVariantNumeric: 'tabular-nums' },
  emptyText: { fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5, flex: 1 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto', alignItems: 'center' },
  boundToggle: { display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' },
  boundBtn: { appearance: 'none', border: 'none', background: '#fff', color: 'var(--muted)', padding: '4px 9px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'inherit' },
  boundBtnOn: { background: 'var(--accent)', color: '#fff' },
  // minWidth 0 lets it share the row with the button instead of growing to
  // fit its longest option and wrapping underneath.
  copySelect: { ...s.moveSelect, maxWidth: '100%', minWidth: 0, flex: '1 1 120px', padding: '5px 22px 5px 8px' },
};

// Sheets that could be copied into a slot of this subject: the other library
// levels, then every distinct custom sheet uploaded to an exam (many exams
// often share one file, so identical sheets collapse into a single entry).
function copySources(section, level, library, exams) {
  const sources = [];
  for (const other of LEVELS) {
    if (other === level || !library.sheets[section][other]) continue;
    sources.push({ key: library.keys[other], label: `${LEVEL_LABEL[other]} sheet` });
  }
  const custom = new Map();
  for (const exam of exams) {
    const sheet = exam.sheets?.[section];
    if (!sheet) continue;
    // Lower/Upper only distinguishes two uses of a sheet that has a range.
    const id = sheet.hasRange ? `${sheet.hash}:${sheet.bound}` : sheet.hash;
    const entry = custom.get(id) || { key: exam.curveKey, sheet, count: 0 };
    entry.count += 1;
    custom.set(id, entry);
  }
  for (const { key, sheet, count } of custom.values()) {
    const name = sheet.originalFilename || 'Custom sheet';
    const bound = sheet.hasRange ? ` (${sheet.bound})` : '';
    sources.push({ key, label: `${name}${bound} - ${count} exam${count === 1 ? '' : 's'}` });
  }
  return sources;
}

function Slot({ section, level, subject, library, exams, onImport, onView, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const sheet = library.sheets[section][level];
  const usedBy = library.usage[section][level];
  const key = library.keys[level];
  const color = LEVEL_COLOR[level];
  const sources = useMemo(
    () => (sheet ? [] : copySources(section, level, library, exams)),
    [sheet, section, level, library, exams]
  );

  async function run(action, failure) {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(err.message || failure);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    const inUse = usedBy.length
      ? ` ${usedBy.length} exam${usedBy.length === 1 ? ' uses' : 's use'} it and will show raw scores only until a new sheet is added.`
      : '';
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove the ${LEVEL_LABEL[level]} ${subject.label} sheet?${inUse}`)) return;
    run(() => deleteScoringSheet({ groupId: key, section }), 'Could not remove the sheet');
  }

  const groupLabel = `${subject.label} ${LEVEL_LABEL[level]} scoring sheet`;
  const chip = (
    <span style={{ ...c.levelChip, color: color.fg, background: color.bg, borderColor: color.border }}>
      {LEVEL_LABEL[level]}
    </span>
  );

  if (!sheet) {
    return (
      <div role="group" aria-label={groupLabel} style={{ ...c.slot, ...c.slotEmpty }}>
        <div style={c.slotTop}>
          {chip}
          {usedBy.length > 0 && (
            <span style={{ ...c.used, color: '#b45309', fontWeight: 600 }} title={usedBy.map((e) => `${e.programName ? `${e.programName}: ` : ''}${e.name}`).join('\n')}>
              ⚠ {usedBy.length} exam{usedBy.length === 1 ? '' : 's'} waiting
            </span>
          )}
        </div>
        <div style={c.emptyText}>
          No sheet yet.{usedBy.length > 0 ? ' Exams set to this level show raw scores only until one is added.' : ''}
        </div>
        <div style={c.actions}>
          <button type="button" style={s.btn} disabled={busy} onClick={() => onImport({ section, level })}>
            Add sheet
          </button>
          {sources.length > 0 && (
            <select
              style={c.copySelect}
              value=""
              disabled={busy}
              aria-label={`Copy an existing sheet into ${LEVEL_LABEL[level]} ${subject.label}`}
              onChange={(e) => {
                const fromGroupId = e.target.value;
                if (fromGroupId) run(() => copyScoringSheet({ fromGroupId, toGroupId: key, section }), 'Could not copy the sheet');
              }}
            >
              <option value="">Copy existing…</option>
              {sources.map((src) => <option key={src.key} value={src.key}>{src.label}</option>)}
            </select>
          )}
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label={groupLabel} style={c.slot}>
      <div style={c.slotTop}>
        {chip}
        <span style={c.used} title={usedBy.map((e) => `${e.programName ? `${e.programName}: ` : ''}${e.name}`).join('\n') || undefined}>
          {usedBy.length === 0 ? 'Not used yet' : `Used by ${usedBy.length} exam${usedBy.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div>
        <div style={c.filename}>{sheet.originalFilename || 'Pasted cells'}</div>
        <div style={c.meta}>
          {sheet.points} raw scores ({sheet.rawMin} to {sheet.rawMax})
          {sheet.columnLabel ? ` · ${sheet.columnLabel}` : ''}
          {formatDate(sheet.uploadedAt) ? ` · added ${formatDate(sheet.uploadedAt)}` : ''}
        </div>
      </div>
      {(sheet.samples || []).length > 0 && (
        <div style={c.samples}>
          {sheet.samples.map((p) => `${p.raw} correct → ${p.score}`).join('   ·   ')}
        </div>
      )}
      {sheet.hasRange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={c.meta}>Score range, use the</span>
          <span style={c.boundToggle} role="group" aria-label="Which end of the score range to use">
            {['lower', 'upper'].map((bound) => (
              <button
                key={bound}
                type="button"
                aria-pressed={sheet.bound === bound}
                disabled={busy}
                style={{ ...c.boundBtn, ...(sheet.bound === bound ? c.boundBtnOn : null) }}
                onClick={() => {
                  if (sheet.bound !== bound) run(() => setScoringSheetBound({ groupId: key, section, bound }), 'Could not update the sheet');
                }}
              >
                {bound}
              </button>
            ))}
          </span>
        </div>
      )}
      <div style={c.actions}>
        <button type="button" style={s.btnGhost} disabled={busy} onClick={() => onView({ section, level })}>View</button>
        <button type="button" style={s.btnGhost} disabled={busy} onClick={() => onImport({ section, level, replacing: true })}>Replace</button>
        <button type="button" style={s.btnDanger} disabled={busy} onClick={remove}>Remove</button>
      </div>
    </div>
  );
}

export default function ScoringSheetLibrary({ onChanged }) {
  const [library, setLibrary] = useState(null);
  const [exams, setExams] = useState([]);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(null); // { section, level, replacing }
  const [viewing, setViewing] = useState(null); // { section, level }

  const load = useCallback(async () => {
    try {
      const [lib, examList] = await Promise.all([fetchSheetLibrary(), fetchExams().catch(() => [])]);
      setLibrary(lib);
      setExams(examList);
    } catch (err) {
      setError(err.message || 'Could not load the scoring sheets');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reload = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const slotLabel = (slot) => `${SUBJECTS.find((x) => x.key === slot.section).label} · ${LEVEL_LABEL[slot.level]}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && <div style={s.error}>⚠ {error}</div>}
      {!library && !error && <div style={s.empty}>Loading scoring sheets…</div>}

      {library && SUBJECTS.map((subject) => {
        const filled = LEVELS.filter((level) => library.sheets[subject.key][level]).length;
        return (
          <section key={subject.key} style={c.subjectCard} aria-label={`${subject.long} scoring sheets`}>
            <div style={c.subjectHead}>
              <div style={s.dot} />
              <span style={s.title}>{subject.long}</span>
              <span style={s.count}>{filled} of {LEVELS.length} sheets added</span>
            </div>
            <div style={c.slots}>
              {LEVELS.map((level) => (
                <Slot
                  key={level}
                  section={subject.key}
                  level={level}
                  subject={subject}
                  library={library}
                  exams={exams}
                  onImport={setImporting}
                  onView={setViewing}
                  onChanged={reload}
                  onError={setError}
                />
              ))}
            </div>
          </section>
        );
      })}

      {importing && (
        <SheetImportDialog
          target={{ groupId: library.keys[importing.level], section: importing.section }}
          level={importing.level}
          label={slotLabel(importing)}
          replacing={Boolean(importing.replacing)}
          onClose={() => setImporting(null)}
          onSaved={async () => { setImporting(null); await reload(); }}
        />
      )}
      {viewing && (
        <SheetTableDialog
          target={{ groupId: library.keys[viewing.level], section: viewing.section }}
          label={`${slotLabel(viewing)} scoring sheet`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
