// features/report/components/ExamScoring.jsx
// Shown inside an expanded exam: which scoring sheet grades each subject, and
// the controls for a custom sheet when the subject is set to Custom.
//
// The choice itself (Easy / Medium / Hard / Custom) is made with the pickers
// on the exam row; this panel explains the result and manages the custom file.
import React, { useState } from 'react';
import { deleteScoringSheet, setScoringSheetBound } from '../api/reportApi.js';
import { LEVEL_LABEL, LEVEL_COLOR, SUBJECTS } from '../scoring.js';
import { SheetImportDialog, SheetTableDialog } from './SheetDialogs.jsx';
import s from './examManagerStyles.js';

const x = {
  wrapper: { padding: '10px 16px 12px', borderTop: '1px dashed var(--border)', background: '#fafbff', display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '0.78rem', minHeight: 28 },
  subject: { ...s.sectionLabel, display: 'inline-block', marginBottom: 0, width: 56 },
  chip: { fontSize: '0.68rem', fontWeight: 700, borderRadius: 999, padding: '2px 9px', borderWidth: 1, borderStyle: 'solid', whiteSpace: 'nowrap' },
  chipCustom: { color: 'var(--ink-light)', background: '#eef1f7', borderColor: 'var(--border)' },
  chipMissing: { color: '#b45309', background: '#fffbeb', borderColor: '#fcd34d' },
  detail: { color: 'var(--ink-light)', overflowWrap: 'anywhere' },
  muted: { color: 'var(--muted)' },
  actions: { display: 'inline-flex', flexWrap: 'wrap', gap: 6, marginLeft: 'auto', alignItems: 'center' },
  boundToggle: { display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' },
  boundBtn: { appearance: 'none', border: 'none', background: '#fff', color: 'var(--muted)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.66rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'inherit' },
  boundBtnOn: { background: 'var(--accent)', color: '#fff' },
  link: { appearance: 'none', border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, padding: 0, textDecoration: 'underline', fontFamily: 'inherit' },
};

function SubjectRow({ exam, subject, onChanged, onOpenSheets, onError }) {
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState(null); // { groupId, section }
  const scoring = exam.scoring?.[subject.key] || {};
  const level = exam.difficulty?.[subject.key] || null;
  const sheet = scoring.sheet;
  const customTarget = { groupId: exam.curveKey, section: subject.key };

  async function run(action, failure) {
    setBusy(true);
    onError?.(null);
    try {
      await action();
      await onChanged?.();
    } catch (err) {
      onError?.(err.message || failure);
    } finally {
      setBusy(false);
    }
  }

  function removeCustom() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove the custom ${subject.label} sheet from "${exam.name}"? Its ${subject.label} scores will show as raw scores until a sheet is chosen.`)) return;
    run(() => deleteScoringSheet(customTarget), 'Could not remove the sheet');
  }

  let body;
  if (level) {
    const color = LEVEL_COLOR[level];
    body = scoring.ready ? (
      <>
        <span style={{ ...x.chip, color: color.fg, background: color.bg, borderColor: color.border }}>{LEVEL_LABEL[level]} sheet</span>
        <span style={x.detail}>{sheet.originalFilename || 'Pasted cells'}</span>
        <span style={x.actions}>
          <button type="button" style={s.btnGhost} onClick={() => setViewing({ groupId: sheet.groupId, section: subject.key })}>View</button>
        </span>
      </>
    ) : (
      <>
        <span style={{ ...x.chip, ...x.chipMissing }}>⚠ {LEVEL_LABEL[level]} sheet not added yet</span>
        <span style={x.muted}>Students see raw scores only.</span>
        <span style={x.actions}>
          <button type="button" style={x.link} onClick={onOpenSheets}>Add it on the Scoring Sheets tab</button>
        </span>
      </>
    );
  } else if (sheet) {
    body = (
      <>
        <span style={{ ...x.chip, ...x.chipCustom }}>Custom sheet</span>
        <span style={x.detail}>{sheet.originalFilename || 'Pasted cells'}</span>
        <span style={x.actions}>
          {sheet.hasRange && (
            <span style={x.boundToggle} role="group" aria-label="Which end of the score range to use">
              {['lower', 'upper'].map((bound) => (
                <button
                  key={bound}
                  type="button"
                  aria-pressed={sheet.bound === bound}
                  disabled={busy}
                  style={{ ...x.boundBtn, ...(sheet.bound === bound ? x.boundBtnOn : null) }}
                  title={`Use the ${bound} end of the score range`}
                  onClick={() => {
                    if (sheet.bound !== bound) run(() => setScoringSheetBound({ ...customTarget, bound }), 'Could not update the sheet');
                  }}
                >
                  {bound}
                </button>
              ))}
            </span>
          )}
          <button type="button" style={s.btnGhost} disabled={busy} onClick={() => setViewing(customTarget)}>View</button>
          <button type="button" style={s.btnGhost} disabled={busy} onClick={() => setImporting(true)}>Replace</button>
          <button type="button" style={s.btnDanger} disabled={busy} onClick={removeCustom}>Remove</button>
        </span>
      </>
    );
  } else {
    body = (
      <>
        <span style={{ ...x.chip, ...x.chipMissing }}>No sheet chosen</span>
        <span style={x.muted}>Pick Easy, Medium or Hard above, or upload a sheet just for this exam.</span>
        <span style={x.actions}>
          <button type="button" style={s.btnGhost} disabled={busy} onClick={() => setImporting(true)}>Upload custom sheet</button>
        </span>
      </>
    );
  }

  return (
    <div style={x.row}>
      <span style={x.subject}>{subject.label}</span>
      {body}
      {importing && (
        <SheetImportDialog
          target={customTarget}
          label={`${exam.name} · ${subject.label} · custom sheet`}
          replacing={Boolean(sheet) && !level}
          onClose={() => setImporting(false)}
          onSaved={async () => { setImporting(false); await onChanged?.(); }}
        />
      )}
      {viewing && (
        <SheetTableDialog
          target={viewing}
          label={`${subject.label} · ${level ? `${LEVEL_LABEL[level]} sheet` : `custom sheet for ${exam.name}`}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

export default function ExamScoring({ exam, onChanged, onOpenSheets, onError }) {
  return (
    <div style={x.wrapper} onClick={(e) => e.stopPropagation()}>
      {SUBJECTS.map((subject) => (
        <SubjectRow
          key={subject.key}
          exam={exam}
          subject={subject}
          onChanged={onChanged}
          onOpenSheets={onOpenSheets}
          onError={onError}
        />
      ))}
    </div>
  );
}
