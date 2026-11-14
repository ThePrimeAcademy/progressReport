// features/report/components/ScoreboardPanel.jsx
// Ranked results for one exam - name, RW, Math, Total, newest attempt date -
// plus admin editing of RAW scores. Scaled scores are never edited directly:
// they regenerate from the scoring sheet after every raw edit. An edited score
// carries a pencil mark; hovering it shows the imported original and the reason.
import React, { useCallback, useEffect, useState } from 'react';
import { LuPencil, LuPencilLine } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/common/Notice';
import { displayDay } from '@/lib/dates';
import {
  fetchExamScoreboard,
  updateRawScore,
  revertRawScore,
  createRawScoreOverride,
} from '../api/reportApi.js';

const SECTION_LABEL = { 1: 'RW', 2: 'RW (2)', 3: 'Math', 4: 'Math (2)' };

function overrideTitle(tests, isMath) {
  const edited = (tests || []).filter(
    (t) => t.manualOverride && (isMath ? t.section > 2 : t.section <= 2)
  );
  if (!edited.length) return null;
  return edited
    .map((t) => `Edited by hand - imported value: ${t.originalRaw ?? '-'}${t.overrideReason ? ` (${t.overrideReason})` : ''}`)
    .join('\n');
}

// Subjects with no scoring sheet to scale them, e.g. ['English', 'Math'].
function missingSheets(board) {
  return [!board.hasRwCurve && 'English', !board.hasMathCurve && 'Math'].filter(Boolean);
}

// What to do about it: a level was picked but its shared sheet is not added
// yet, or nothing has been picked at all.
function missingHint(board) {
  const waiting = ['rw', 'math']
    .map((key) => board.scoring?.[key])
    .filter((sc) => sc && !sc.ready && sc.level);
  if (waiting.length > 0) return 'the chosen sheet has not been added on the Scoring sheets page yet';
  return 'choose a scoring sheet for this exam to see scaled scores';
}

function EditScoresDialog({ row, onClose, onSaved }) {
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries((row.tests || []).map((t) => [t.testId, String(t.correct ?? '')]))
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const changed = (row.tests || []).filter(
    (t) => drafts[t.testId] !== '' && Number(drafts[t.testId]) !== Number(t.correct)
  );

  async function save() {
    if (!changed.length) return onClose();
    if (!reason.trim()) return setError('A reason is required for every manual score edit.');
    for (const t of changed) {
      const n = Number(drafts[t.testId]);
      if (!Number.isInteger(n) || n < 0 || (t.maxScore != null && n > t.maxScore)) {
        return setError(`${t.testName}: the score must be a whole number from 0 to ${t.maxScore ?? '?'}.`);
      }
    }
    setBusy(true);
    setError(null);
    try {
      for (const t of changed) {
        const payload = { score: Number(drafts[t.testId]), reason: reason.trim() };
        if (t.recordId != null) await updateRawScore(t.recordId, payload);
        else await createRawScoreOverride({ studentId: row.studentId, testId: t.testId, ...payload });
      }
      await onSaved();
    } catch (err) {
      setError(err.message || 'Could not save the score edit.');
      setBusy(false);
    }
    return undefined;
  }

  async function revert(t) {
    if (t.recordId == null) return;
    setBusy(true);
    setError(null);
    try {
      await revertRawScore(t.recordId);
      await onSaved();
    } catch (err) {
      setError(err.message || 'Could not revert the score.');
      setBusy(false);
    }
  }

  const blockWhileBusy = (e) => { if (busy) e.preventDefault(); };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!busy}
        onInteractOutside={blockWhileBusy}
        onEscapeKeyDown={blockWhileBusy}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Edit raw scores</DialogTitle>
          <DialogDescription>{row.name} - scaled scores recalculate from the scoring sheet automatically.</DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-4">
          <div className="overflow-hidden rounded-lg border">
            {(row.tests || []).map((t) => (
              <div key={t.testId} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {SECTION_LABEL[t.section] || `Section ${t.section}`}
                    <span className="font-normal text-muted-foreground"> · {t.testName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.manualOverride ? (
                      <>
                        Edited - imported value {t.originalRaw ?? '-'} ·{' '}
                        <Button variant="link" size="xs" className="h-auto p-0 text-xs" disabled={busy} onClick={() => revert(t)}>
                          Revert
                        </Button>
                      </>
                    ) : (
                      `Imported${t.recordId == null ? ' from the API only' : ''}`
                    )}
                    {t.maxScore != null ? ` · max ${t.maxScore}` : ''}
                  </div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={t.maxScore ?? undefined}
                  className="w-20 text-right tabular-nums"
                  disabled={busy}
                  value={drafts[t.testId]}
                  aria-label={`${SECTION_LABEL[t.section] || `Section ${t.section}`} raw score`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [t.testId]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <Field>
            <FieldLabel htmlFor="raw-edit-reason">Reason (required)</FieldLabel>
            <Textarea
              id="raw-edit-reason"
              rows={2}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Question 12 mis-keyed on ClassMarker; regraded by hand"
            />
          </Field>

          {error && <Notice variant="destructive">{error}</Notice>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !changed.length} onClick={save}>
            {busy && <Spinner data-icon="inline-start" />}
            Save edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const fmt = (scaled, raw) => (scaled != null ? scaled : raw != null ? `${raw} raw` : '-');
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank);

function ScoreCell({ row, isMath }) {
  const title = overrideTitle(row.tests, isMath);
  return (
    <span className="inline-flex items-center gap-1" title={title || undefined}>
      {fmt(isMath ? row.mathScaled : row.rwScaled, isMath ? row.mathRaw : row.rwRaw)}
      {title && <LuPencilLine className="size-3 text-muted-foreground" aria-label="edited by hand" />}
    </span>
  );
}

export default function ScoreboardPanel({ exam, onError }) {
  const [board, setBoard] = useState(null); // null = loading
  const [editing, setEditing] = useState(null); // the row being edited

  const load = useCallback(() => fetchExamScoreboard(exam.examId)
    .then(setBoard)
    .catch((err) => { setBoard({ rows: [] }); onError?.(err.message || 'Failed to load scoreboard'); }), [exam.examId, onError]);

  useEffect(() => {
    let cancelled = false;
    fetchExamScoreboard(exam.examId)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((err) => {
        if (cancelled) return;
        setBoard({ rows: [] });
        onError?.(err.message || 'Failed to load scoreboard');
      });
    return () => { cancelled = true; };
  }, [exam.examId, onError]);

  const head = 'h-9 text-xs font-medium text-muted-foreground';

  return (
    <div className="grid gap-3 border-t bg-muted/30 px-3 py-3">
      <div className="text-sm">
        <span className="font-medium">Scoreboard</span>
        {board?.date && <span className="text-muted-foreground"> · {displayDay(board.date) || board.date}</span>}
        {board && board.rows && !(board.hasRwCurve && board.hasMathCurve) && (
          <span className="text-warning"> · raw scores for {missingSheets(board).join(' and ')}: {missingHint(board)}</span>
        )}
      </div>
      {board === null ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading scoreboard">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : board.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results yet for this exam’s tests.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`${head} w-12 pl-4`}>#</TableHead>
                <TableHead className={head}>Student</TableHead>
                <TableHead className={`${head} text-right`}>RW</TableHead>
                <TableHead className={`${head} text-right`}>Math</TableHead>
                <TableHead className={`${head} text-right`}>Total</TableHead>
                <TableHead className={`${head} text-right`}>Date</TableHead>
                <TableHead className={`${head} w-12 pr-4`}><span className="sr-only">Edit</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.rows.map((row, i) => (
                <TableRow key={row.studentId} className="last:border-b-0">
                  <TableCell className="pl-4 text-muted-foreground tabular-nums">{medal(i + 1)}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums"><ScoreCell row={row} isMath={false} /></TableCell>
                  <TableCell className="text-right tabular-nums"><ScoreCell row={row} isMath /></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {row.total ?? <span className="font-normal text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{row.date ? displayDay(row.date, 'MMM d') || row.date : '-'}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${row.name}'s raw scores`}
                      title="Edit raw scores"
                      onClick={() => setEditing(row)}
                    >
                      <LuPencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <EditScoresDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}
