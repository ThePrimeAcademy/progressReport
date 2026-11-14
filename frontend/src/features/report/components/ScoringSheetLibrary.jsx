// features/report/components/ScoringSheetLibrary.jsx
// The Scoring Sheets page: three shared sheets per subject (Easy, Medium,
// Hard) that every exam picks from. Each slot can be filled from a file, from
// pasted cells, or by copying a sheet that is already stored somewhere else
// (another level, or a custom sheet uploaded to an exam in the past).
import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LuEye, LuPlus, LuTrash2, LuTriangleAlert, LuUpload } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Notice } from '@/components/common/Notice';
import { useConfirm } from '@/components/common/confirm';
import { copyScoringSheet, deleteScoringSheet, setScoringSheetBound } from '../api/reportApi.js';
import { queryKeys, useExams, useSheetLibrary } from '../api/queries.js';
import { LEVELS, LEVEL_LABEL, LEVEL_STYLE, SUBJECTS, formatDate } from '../scoring.js';
import { SheetImportDialog, SheetTableDialog } from './SheetDialogs.jsx';

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "Used by 3 exams" (or "2 exams waiting"), opening the list of those exams.
function ExamUsage({ usedBy, waiting }) {
  if (usedBy.length === 0) {
    return <span className="text-xs text-muted-foreground">Not used yet</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-sm text-xs underline decoration-dotted underline-offset-3 outline-none hover:decoration-solid focus-visible:ring-[3px] focus-visible:ring-ring/50',
            waiting ? 'font-medium text-warning' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {waiting && <LuTriangleAlert className="size-3.5" aria-hidden="true" />}
          {waiting ? `${plural(usedBy.length, 'exam')} waiting` : `Used by ${plural(usedBy.length, 'exam')}`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{waiting ? 'Exams waiting for this sheet' : 'Exams graded with this sheet'}</PopoverTitle>
        </PopoverHeader>
        <ul className="grid max-h-64 gap-1.5 overflow-y-auto text-sm">
          {usedBy.map((exam) => (
            <li key={exam.examId}>
              {exam.programName && <span className="text-muted-foreground">{exam.programName}: </span>}
              {exam.name}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const COPY_PLACEHOLDER = '';

function Slot({ section, level, subject, library, exams, onImport, onView, onChanged, onError }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const sheet = library.sheets[section][level];
  const usedBy = library.usage?.[section]?.[level] || [];
  const key = library.keys[level];
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

  async function remove() {
    const impact = usedBy.length
      ? `${plural(usedBy.length, 'exam')} ${usedBy.length === 1 ? 'uses' : 'use'} it and will show raw scores only until a new sheet is added.`
      : 'No exam uses it yet.';
    const confirmed = await confirm({
      title: `Remove the ${LEVEL_LABEL[level]} ${subject.label} sheet?`,
      description: impact,
      confirmLabel: 'Remove sheet',
      destructive: true,
    });
    if (confirmed) run(() => deleteScoringSheet({ groupId: key, section }), 'Could not remove the sheet');
  }

  const meta = sheet && [
    `${sheet.points} raw scores (${sheet.rawMin} to ${sheet.rawMax})`,
    sheet.columnLabel || null,
    formatDate(sheet.uploadedAt) ? `added ${formatDate(sheet.uploadedAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      role="group"
      aria-label={`${subject.label} ${LEVEL_LABEL[level]} scoring sheet`}
      aria-busy={busy || undefined}
      className={cn(
        // Side by side, tiles share a height so their buttons line up.
        'flex flex-col gap-3 rounded-lg border p-4 sm:min-h-52',
        sheet ? 'bg-card' : 'border-dashed bg-muted/30'
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Badge variant="outline" className={LEVEL_STYLE[level].badge}>{LEVEL_LABEL[level]}</Badge>
        <ExamUsage usedBy={usedBy} waiting={!sheet} />
      </div>

      {sheet ? (
        <>
          <div className="grid gap-1">
            <div className="text-sm font-medium break-words">{sheet.originalFilename || 'Pasted cells'}</div>
            <div className="text-xs text-muted-foreground">{meta}</div>
          </div>
          {(sheet.samples || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Sample scores">
              {sheet.samples.map((p) => (
                <span key={p.raw} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {p.raw} → <span className="font-medium text-foreground">{p.score}</span>
                </span>
              ))}
            </div>
          )}
          {sheet.hasRange && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Score range - use the</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={sheet.bound}
                disabled={busy}
                aria-label="Which end of the score range to use"
                onValueChange={(bound) => {
                  if (bound && bound !== sheet.bound) {
                    run(() => setScoringSheetBound({ groupId: key, section, bound }), 'Could not update the sheet');
                  }
                }}
              >
                <ToggleGroupItem value="lower" className="h-7 text-xs">Lower</ToggleGroupItem>
                <ToggleGroupItem value="upper" className="h-7 text-xs">Upper</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onView({ section, level })}>
              <LuEye data-icon="inline-start" />
              View
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onImport({ section, level, replacing: true })}>
              <LuUpload data-icon="inline-start" />
              Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={remove}
            >
              {busy ? <Spinner data-icon="inline-start" /> : <LuTrash2 data-icon="inline-start" />}
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            No sheet yet.
            {usedBy.length > 0 && ' Exams set to this level show raw scores only until one is added.'}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" disabled={busy} onClick={() => onImport({ section, level })}>
              {busy ? <Spinner data-icon="inline-start" /> : <LuPlus data-icon="inline-start" />}
              Add sheet
            </Button>
            {sources.length > 0 && (
              <Select
                value={COPY_PLACEHOLDER}
                disabled={busy}
                onValueChange={(fromGroupId) => {
                  if (fromGroupId) run(() => copyScoringSheet({ fromGroupId, toGroupId: key, section }), 'Could not copy the sheet');
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-0 flex-1 bg-background"
                  aria-label={`Copy an existing sheet into ${LEVEL_LABEL[level]} ${subject.label}`}
                >
                  <SelectValue placeholder="Copy existing…" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {sources.map((src) => <SelectItem key={src.key} value={src.key}>{src.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading scoring sheets">
      {SUBJECTS.map((subject) => (
        <Card key={subject.key}>
          <CardHeader>
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LEVELS.map((level) => <Skeleton key={level} className="h-52 rounded-lg" />)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ScoringSheetLibrary({ onChanged }) {
  const queryClient = useQueryClient();
  const libraryQuery = useSheetLibrary();
  const { exams } = useExams();
  const library = libraryQuery.data;
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(null); // { section, level, replacing }
  const [viewing, setViewing] = useState(null); // { section, level }

  // Exams are graded with these sheets, so both lists are re-read after a change.
  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.sheetLibrary }),
      queryClient.invalidateQueries({ queryKey: queryKeys.exams }),
    ]);
    onChanged?.();
  }, [queryClient, onChanged]);

  const slotLabel = (slot) => `${SUBJECTS.find((x) => x.key === slot.section).label} · ${LEVEL_LABEL[slot.level]}`;

  if (libraryQuery.isPending) return <LibrarySkeleton />;
  if (!library) {
    return (
      <Notice variant="destructive" title="Could not load the scoring sheets">
        {libraryQuery.error?.message || 'Try reloading the page.'}
      </Notice>
    );
  }

  return (
    <div className="grid gap-6">
      {error && <Notice variant="destructive">{error}</Notice>}

      {SUBJECTS.map((subject) => {
        const filled = LEVELS.filter((level) => library.sheets[subject.key][level]).length;
        return (
          <Card key={subject.key} aria-label={`${subject.long} scoring sheets`}>
            <CardHeader>
              <CardTitle>{subject.long}</CardTitle>
              <CardDescription>{filled} of {LEVELS.length} sheets added</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            </CardContent>
          </Card>
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
