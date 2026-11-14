// features/report/components/SheetLevelPicker.jsx
// One exam's scoring-sheet choice for one subject: Easy / Medium / Hard (the
// shared sheets) or Custom (a sheet uploaded just for this exam).
//
// value:   'easy' | 'medium' | 'hard' | null   (null = Custom)
// scoring: the exam's `scoring[subject]` from the API - { source, level, ready }
//          - tells us whether the chosen sheet actually exists yet.
import React from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LEVELS, LEVEL_LABEL, LEVEL_STYLE } from '../scoring.js';

const CUSTOM = 'custom';
// Phones get a little less padding so a picker fits beside its label.
const item = 'h-7 text-xs group-data-[spacing=0]/toggle-group:px-1.5 sm:group-data-[spacing=0]/toggle-group:px-2';

export default function SheetLevelPicker({ subjectLabel, value, scoring, disabled, onChange, onCustom }) {
  const hasCustomSheet = scoring?.source === 'custom';
  // Custom is the choice whenever no level is, but it only grades anything
  // once a custom sheet exists - until then nothing is shown as chosen.
  const unset = !value && !hasCustomSheet;
  const missing = Boolean(value) && !scoring?.ready;
  const current = value || (hasCustomSheet ? CUSTOM : '');

  function handleChange(next) {
    if (!next) {
      // The chosen item was clicked again: a level stays as it is, Custom
      // opens the exam to manage its sheet.
      if (current === CUSTOM) onCustom?.();
      return;
    }
    if (next === CUSTOM) {
      if (value) onChange(null);
      onCustom?.();
      return;
    }
    onChange(next);
  }

  // The dashed "nothing chosen" outline sits on a wrapper: Radix puts an
  // inline `outline: none` on the group itself.
  return (
    <span
      className={cn('inline-flex rounded-md', unset && 'outline-1 outline-offset-2 outline-warning/70 outline-dashed')}
      title={unset ? `No ${subjectLabel} scoring sheet chosen - students see raw scores only` : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={current}
        onValueChange={handleChange}
        disabled={disabled}
        aria-label={`${subjectLabel} scoring sheet`}
        className="bg-background"
      >
        {LEVELS.map((level) => {
          const on = value === level;
          return (
            <ToggleGroupItem
              key={level}
              value={level}
              className={cn(item, LEVEL_STYLE[level].on)}
              title={on && missing
                ? `The ${LEVEL_LABEL[level]} ${subjectLabel} sheet has not been added yet - students see raw scores only. Add it on the Scoring sheets page.`
                : `Grade ${subjectLabel} with the ${LEVEL_LABEL[level]} sheet`}
            >
              {LEVEL_LABEL[level]}
              {on && missing && <LuTriangleAlert className="size-3 text-warning" aria-label="sheet missing" />}
            </ToggleGroupItem>
          );
        })}
        <ToggleGroupItem
          value={CUSTOM}
          className={item}
          title={hasCustomSheet
            ? `Grade ${subjectLabel} with the sheet uploaded just for this exam`
            : `Upload a ${subjectLabel} sheet just for this exam`}
        >
          Custom
        </ToggleGroupItem>
      </ToggleGroup>
    </span>
  );
}
