// features/report/components/ExamScoring.jsx
// Inside an expanded exam: which scoring sheet grades each subject, and the
// controls for a custom sheet when the subject is set to Custom.
//
// The choice itself (Easy / Medium / Hard / Custom) is made with the pickers
// on the exam row; this panel explains the result and manages the custom file.
import React, { useState } from 'react';
import { LuEye, LuTrash2, LuTriangleAlert, LuUpload } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useConfirm } from '@/components/common/confirm';
import { deleteScoringSheet, setScoringSheetBound } from '../api/reportApi.js';
import { LEVEL_LABEL, LEVEL_STYLE, SUBJECTS } from '../scoring.js';
import { SheetImportDialog, SheetTableDialog } from './SheetDialogs.jsx';

function SubjectRow({ exam, subject, onChanged, onOpenSheets, onError }) {
  const confirm = useConfirm();
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

  async function removeCustom() {
    const ok = await confirm({
      title: `Remove the custom ${subject.label} sheet?`,
      description: `“${exam.name}” will show raw ${subject.label} scores until a sheet is chosen.`,
      confirmLabel: 'Remove sheet',
      destructive: true,
    });
    if (ok) run(() => deleteScoringSheet(customTarget), 'Could not remove the sheet');
  }

  const filename = (
    <span className="min-w-0 truncate text-muted-foreground" title={sheet?.originalFilename || 'Pasted cells'}>
      {sheet?.originalFilename || 'Pasted cells'}
    </span>
  );

  let body;
  if (level) {
    body = scoring.ready ? (
      <>
        <Badge variant="outline" className={LEVEL_STYLE[level].badge}>{LEVEL_LABEL[level]} sheet</Badge>
        {filename}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setViewing({ groupId: sheet.groupId, section: subject.key })}>
            <LuEye data-icon="inline-start" />
            View
          </Button>
        </div>
      </>
    ) : (
      <>
        <Badge variant="warning">
          <LuTriangleAlert data-icon="inline-start" />
          {LEVEL_LABEL[level]} sheet not added yet
        </Badge>
        <span className="text-muted-foreground">Students see raw scores only.</span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="link" size="sm" className="h-auto px-0" onClick={onOpenSheets}>
            Add it on the Scoring sheets page
          </Button>
        </div>
      </>
    );
  } else if (sheet) {
    body = (
      <>
        <Badge variant="secondary">Custom sheet</Badge>
        {filename}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {sheet.hasRange && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={sheet.bound}
              disabled={busy}
              aria-label="Which end of the score range to use"
              onValueChange={(bound) => {
                if (bound && bound !== sheet.bound) run(() => setScoringSheetBound({ ...customTarget, bound }), 'Could not update the sheet');
              }}
            >
              {['lower', 'upper'].map((bound) => (
                <ToggleGroupItem key={bound} value={bound} className="h-8 px-2.5 text-xs capitalize" title={`Use the ${bound} end of the score range`}>
                  {bound}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setViewing(customTarget)}>
            <LuEye data-icon="inline-start" />
            View
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setImporting(true)}>
            <LuUpload data-icon="inline-start" />
            Replace
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={removeCustom}>
            <LuTrash2 data-icon="inline-start" />
            Remove
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Badge variant="warning">No sheet chosen</Badge>
        <span className="text-muted-foreground">Pick Easy, Medium or Hard above, or upload a sheet just for this exam.</span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setImporting(true)}>
            <LuUpload data-icon="inline-start" />
            Upload custom sheet
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className={cn('flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 text-sm', busy && 'opacity-80')}>
      <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{subject.label}</span>
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
    <div className="grid gap-3 border-t px-3 py-3">
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
