// features/report/components/SheetLevelPicker.jsx
// One exam's scoring-sheet choice for one subject: Easy / Medium / Hard (the
// shared sheets) or Custom (a sheet uploaded just for this exam).
//
// value:   'easy' | 'medium' | 'hard' | null   (null = Custom)
// scoring: the exam's `scoring[subject]` from the API - { source, level, ready }
//          - tells us whether the chosen sheet actually exists yet.
import React from 'react';
import { LEVELS, LEVEL_LABEL, LEVEL_COLOR } from '../scoring.js';

const p = {
  group: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', background: '#fff' },
  // Nothing grades this subject yet: draw the eye without shouting.
  groupUnset: { borderStyle: 'dashed', borderColor: '#f59e0b' },
  btn: {
    appearance: 'none', border: 'none', borderRight: '1px solid var(--border)', background: 'transparent',
    color: 'var(--muted)', padding: '5px 9px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
    fontFamily: 'inherit', lineHeight: 1.2, whiteSpace: 'nowrap', transition: 'background 120ms ease, color 120ms ease',
  },
  btnLast: { borderRight: 'none' },
  custom: { color: 'var(--ink-light)', background: '#eef1f7' },
  warn: { marginLeft: 4, color: '#b45309' },
};

export default function SheetLevelPicker({ subjectLabel, value, scoring, disabled, onChange, onCustom }) {
  const hasCustomSheet = scoring?.source === 'custom';
  // Custom is "selected" whenever no level is, but it only grades anything
  // once a custom sheet exists.
  const unset = !value && !hasCustomSheet;
  const missing = Boolean(value) && !scoring?.ready;

  return (
    <span
      role="group"
      aria-label={`${subjectLabel} scoring sheet`}
      style={{ ...p.group, ...(unset ? p.groupUnset : null), opacity: disabled ? 0.6 : 1 }}
      title={unset ? `No ${subjectLabel} scoring sheet chosen - students see raw scores only` : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {LEVELS.map((level) => {
        const on = value === level;
        const color = LEVEL_COLOR[level];
        return (
          <button
            key={level}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            style={{ ...p.btn, ...(on ? { background: color.bg, color: color.fg, fontWeight: 700 } : null) }}
            title={on && missing
              ? `The ${LEVEL_LABEL[level]} ${subjectLabel} sheet has not been added yet - students see raw scores only. Add it on the Scoring Sheets tab.`
              : `Grade ${subjectLabel} with the ${LEVEL_LABEL[level]} sheet`}
            onClick={() => { if (!on) onChange(level); }}
          >
            {LEVEL_LABEL[level]}
            {on && missing && <span style={p.warn} aria-label="sheet missing">⚠</span>}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={!value}
        disabled={disabled}
        style={{ ...p.btn, ...p.btnLast, ...(!value && hasCustomSheet ? p.custom : null), ...(!value ? { fontWeight: 700 } : null) }}
        title={hasCustomSheet
          ? `Grade ${subjectLabel} with the sheet uploaded just for this exam`
          : `Upload a ${subjectLabel} sheet just for this exam`}
        onClick={() => { if (value) onChange(null); onCustom?.(); }}
      >
        Custom
      </button>
    </span>
  );
}
