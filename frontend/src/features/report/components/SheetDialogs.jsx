// features/report/components/SheetDialogs.jsx
// The two dialogs for scoring sheets:
//   SheetImportDialog - add or replace a sheet from a file or pasted cells,
//                       with a preview of what was read before anything saves
//   SheetTableDialog  - look at a stored sheet's full raw → score table
// Both are shown by mounting them and closed through onClose.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LuArrowLeft, LuCheck, LuClipboardPaste, LuFileSpreadsheet, LuSave, LuUpload } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Notice } from '@/components/common/Notice';
import { parseScoringSheet, saveScoringSheet, fetchScoringSheet } from '../api/reportApi.js';
import { buildCurve, defaultColumnIndex, defaultTableIndex, formatDate, sourceDetail } from '../scoring.js';

// Raw → score pairs flowing down newspaper-style columns. `rows` are
// { raw, lower, upper }; when a row is a range, both ends show and the end
// named by `bound` is emphasised.
export function ScoreTable({ rows, bound = 'upper' }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="columns-[7.5rem] gap-x-5 [column-rule:1px_solid_var(--border)]">
        {rows.map((row) => {
          const ranged = row.lower !== row.upper;
          return (
            <div key={row.raw} className="flex break-inside-avoid items-baseline gap-1.5 py-0.5 text-xs tabular-nums">
              <span className="w-6 shrink-0 text-right text-muted-foreground">{row.raw}</span>
              <span className="text-muted-foreground/60" aria-hidden="true">→</span>
              {ranged ? (
                <span>
                  <span className={bound === 'lower' ? 'font-medium text-foreground' : 'text-muted-foreground'}>{row.lower}</span>
                  <span className="text-muted-foreground"> - </span>
                  <span className={bound === 'upper' ? 'font-medium text-foreground' : 'text-muted-foreground'}>{row.upper}</span>
                </span>
              ) : (
                <span className="font-medium text-foreground">{row.upper}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A dialog that stays open while `busy`, so a save in flight can't be
// abandoned by a stray click or Escape.
function SheetDialog({ busy = false, onClose, className, children }) {
  const holdWhileBusy = (event) => { if (busy) event.preventDefault(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose?.(); }}>
      <DialogContent
        className={cn('max-h-[calc(100svh-2rem)] overflow-y-auto', className)}
        onEscapeKeyDown={holdWhileBusy}
        onInteractOutside={holdWhileBusy}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

// One choice out of a few (a worksheet, a score column), always keeping one picked.
function Choice({ legend, value, options, onChange, description }) {
  return (
    <FieldSet className="gap-0">
      <FieldLegend variant="label">{legend}</FieldLegend>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="flex-wrap"
        value={String(value)}
        onValueChange={(next) => { if (next !== '') onChange(Number(next)); }}
      >
        {options.map((label, i) => (
          <ToggleGroupItem key={`${label}-${i}`} value={String(i)} className="data-[state=on]:border-foreground/25">
            <LuCheck className="hidden size-3.5 group-data-[state=on]/toggle:block" aria-hidden="true" />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {description && <FieldDescription className="mt-2">{description}</FieldDescription>}
    </FieldSet>
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
  const [readingFrom, setReadingFrom] = useState(null); // 'file' | 'text' while parsing
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const table = tables?.[tableIndex] || null;
  const picked = useMemo(() => (table ? buildCurve(table, columnIndex) : null), [table, columnIndex]);

  async function read(source, name) {
    setBusy(true);
    setReadingFrom(source.file ? 'file' : 'text');
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
      setReadingFrom(null);
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
      <SheetDialog busy={busy} onClose={onClose} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
              dragOver ? 'border-foreground/40 bg-muted' : 'bg-muted/30'
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file && !busy) read({ file }, file.name);
            }}
          >
            <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-background ring-1 ring-foreground/10">
              <LuFileSpreadsheet className="size-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="text-sm font-medium">Drop the scoring sheet here</div>
            <p className="max-w-xs text-xs text-muted-foreground">
              Excel (.xlsx) or .csv. Any layout works as long as it has a raw-score column and a score column.
            </p>
            <Button size="sm" className="mt-3" disabled={busy} onClick={() => fileInput.current?.click()}>
              {readingFrom === 'file' ? <Spinner data-icon="inline-start" /> : <LuUpload data-icon="inline-start" />}
              {readingFrom === 'file' ? 'Reading…' : 'Choose file'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) read({ file }, file.name);
              }}
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>

          <Field>
            <FieldLabel htmlFor="sheet-paste">Paste the cells</FieldLabel>
            <Textarea
              id="sheet-paste"
              className="max-h-48 min-h-28 overflow-y-auto font-mono text-xs md:text-xs"
              value={text}
              disabled={busy}
              placeholder={'0\t200\n1\t210\n2\t220'}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <FieldDescription className="min-w-0 sm:flex-1">Copy the raw-score and score columns in Excel or Google Sheets and paste them here.</FieldDescription>
              <Button variant="outline" size="sm" className="self-end sm:self-auto" disabled={busy || !text.trim()} onClick={() => read({ text }, null)}>
                {readingFrom === 'text' ? <Spinner data-icon="inline-start" /> : <LuClipboardPaste data-icon="inline-start" />}
                {readingFrom === 'text' ? 'Reading…' : 'Read pasted cells'}
              </Button>
            </div>
          </Field>

          {error && <Notice variant="destructive">{error}</Notice>}
        </div>
      </SheetDialog>
    );
  }

  const scores = picked.curve.map((p) => (picked.bound === 'lower' ? p.lower : p.upper));
  return (
    <SheetDialog busy={busy} onClose={onClose} className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {label} · {filename ? <>read from <span className="font-medium text-foreground">{filename}</span></> : 'read from pasted cells'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        {tables.length > 1 && (
          <Choice
            legend="Worksheet"
            value={tableIndex}
            options={tables.map((t, i) => t.sheetName || `Sheet ${i + 1}`)}
            onChange={chooseTable}
          />
        )}

        {table.columns.length > 1 && (
          <Choice
            legend="Score column to use"
            value={columnIndex}
            options={table.columns.map((c) => c.label)}
            onChange={setColumnIndex}
            description={`This sheet lists ${table.columns.length} scores for each raw score. Pick the one this sheet should use.`}
          />
        )}

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{picked.curve.length} raw scores</span> ({table.rawMin} to {table.rawMax}) convert to scores from{' '}
          <span className="font-medium text-foreground tabular-nums">{Math.min(...scores)}</span> to{' '}
          <span className="font-medium text-foreground tabular-nums">{Math.max(...scores)}</span>.
        </p>

        {table.warnings.map((w) => <Notice key={w} variant="warning">{w}</Notice>)}

        <ScoreTable rows={picked.curve} bound={picked.bound} />

        {error && <Notice variant="destructive">{error}</Notice>}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => { setTables(null); setError(null); }}>
          <LuArrowLeft data-icon="inline-start" />
          Choose a different sheet
        </Button>
        <Button disabled={busy || picked.curve.length < 2} onClick={save}>
          {busy ? <Spinner data-icon="inline-start" /> : <LuSave data-icon="inline-start" />}
          {busy ? 'Saving…' : 'Save sheet'}
        </Button>
      </DialogFooter>
    </SheetDialog>
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
    <SheetDialog onClose={onClose} className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{meta || (error ? 'The sheet could not be loaded.' : 'Loading…')}</DialogDescription>
      </DialogHeader>

      {error && <Notice variant="destructive">{error}</Notice>}
      {!sheet && !error && (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      )}
      {sheet && (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{summary.points} raw scores</span> ({summary.rawMin} to {summary.rawMax}) convert to scores from{' '}
            <span className="font-medium text-foreground tabular-nums">{summary.scoreMin}</span> to{' '}
            <span className="font-medium text-foreground tabular-nums">{summary.scoreMax}</span>.
          </p>
          <ScoreTable rows={sheet.curve} bound={summary.bound} />
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </SheetDialog>
  );
}
