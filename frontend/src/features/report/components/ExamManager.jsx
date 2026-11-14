// features/report/components/ExamManager.jsx
//
// The Programs page: SAT exams grouped by program. A program (e.g. a summer
// program "GA SAT 2026") owns the student roster for every exam inside it -
// enrolling a student makes all of that program's exams appear in their SAT
// report; students not in the program never see them. Exams can also stay
// ungrouped (visible to anyone who took them, rostered individually).
//
// This component is the orchestrator: it reads exams, tests, students and
// programs from the shared query cache, then renders each program with its
// exams nested underneath, the loose ungrouped exams below, and the create
// dialogs. Each exam row carries its English and Math scoring-sheet pickers,
// so a whole program can be categorised from this one list.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LuArchive,
  LuArchiveRestore,
  LuChevronRight,
  LuEllipsis,
  LuFileText,
  LuLayers,
  LuPencil,
  LuPlus,
  LuTrash2,
  LuUsers,
} from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/components/common/Notice';
import { useConfirm } from '@/components/common/confirm';
import {
  reorderExams,
  updateProgram,
  deleteProgram,
  programSummaryUrl,
} from '../api/reportApi.js';
import { queryKeys, useAvailableTests, useExams, usePrograms, useStudents } from '../api/queries.js';
import { LEVEL_LABEL, SUBJECTS } from '../scoring.js';
import ExamRow, { EXAM_GRID } from './ExamRow.jsx';
import ProgramRosterPanel from './ProgramRosterPanel.jsx';
import { NewExamDialog, NewProgramDialog } from './ProgramDialogs.jsx';

// Which programs are expanded survives switching pages (and a page refresh),
// so stepping over to Scoring sheets and back does not lose your place.
const OPEN_PROGRAMS_KEY = 'progressreport.openPrograms';
function loadOpenPrograms() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(OPEN_PROGRAMS_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored : []);
  } catch (_) {
    return new Set();
  }
}

// Which DSAT sections feed each subject's score.
const SUBJECT_SECTIONS = { rw: ['1', '2'], math: ['3', '4'] };

// What still needs an admin's attention before every exam produces scaled
// scores. Archived programs are finished, so their exams are left out.
//   missing:       sheets that exams are set to but nobody has added yet,
//                  e.g. ['Math Hard'], and how many exams that affects
//   uncategorised: exams with tests assigned but no sheet chosen for a subject
function scoringGaps(exams, programs) {
  const archived = new Set(programs.filter((p) => p.archived).map((p) => p.programId));
  const missing = new Set();
  const waiting = new Set();
  const uncategorised = new Set();
  for (const exam of exams) {
    if (archived.has(exam.programId)) continue;
    for (const subject of SUBJECTS) {
      const scoring = exam.scoring?.[subject.key];
      if (!scoring || scoring.ready) continue;
      if (scoring.level) {
        missing.add(`${subject.label} ${LEVEL_LABEL[scoring.level]}`);
        waiting.add(exam.examId);
      } else if (SUBJECT_SECTIONS[subject.key].some((key) => exam.sections?.[key]?.testId)) {
        uncategorised.add(exam.examId);
      }
    }
  }
  return { missing: [...missing], waiting: waiting.size, uncategorised: uncategorised.size };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const stop = (e) => e.stopPropagation();

function LoadingPrograms() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading programs">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-3">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ml-auto h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export default function ExamManager({ onExamsChanged, onOpenSheets }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { exams, isPending: examsPending, error: examsError } = useExams();
  const { programs, isPending: programsPending, error: programsError } = usePrograms();
  const { tests } = useAvailableTests();
  const { students: roster } = useStudents();

  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const [newProgramOpen, setNewProgramOpen] = useState(false);
  const [newExamFor, setNewExamFor] = useState(null); // programId the create-exam dialog is for
  const [rosterOpenFor, setRosterOpenFor] = useState(null); // programId whose enrollment is open
  // Inline program rename: which program's name is being edited, and its draft.
  const [editingProgramId, setEditingProgramId] = useState(null);
  const [programNameDraft, setProgramNameDraft] = useState('');
  // Which programs are expanded to show their exams. Collapsed by default so
  // the list stays compact - click a program to reveal its exams.
  const [openPrograms, setOpenPrograms] = useState(loadOpenPrograms);
  const [dragExamId, setDragExamId] = useState(null); // exam being dragged (for styling)
  // The dragged id mirrored in a ref so dragover/drop guards read it
  // synchronously - state hasn't committed yet within a fast drag gesture.
  const dragIdRef = useRef(null);
  const dragMovedRef = useRef(false); // did the live preview actually reorder?
  const dragOrderRef = useRef(null); // { programId, ids } settled by the preview

  // Most errors come from an action far down the list; bring the message
  // into view instead of leaving it at the top of the card.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(OPEN_PROGRAMS_KEY, JSON.stringify([...openPrograms]));
    } catch (_) { /* storage unavailable - the choice just won't persist */ }
  }, [openPrograms]);

  const toggleProgram = (id) => {
    setOpenPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandProgram = (id) => setOpenPrograms((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // After a change: re-read the exams (and programs, whose exam counts and
  // rosters it may have changed) and the sheet library, whose usage lists
  // name exams. Inactive queries are only marked stale, so this costs one or
  // two requests here. Students and tests never change from this page.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.exams }),
      queryClient.invalidateQueries({ queryKey: queryKeys.programs }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sheetLibrary }),
    ]);
    onExamsChanged?.();
  }, [queryClient, onExamsChanged]);

  // After a scoring-sheet change only the exams (and the library's usage
  // counts) are stale - skip programs so clicking through pickers stays quick.
  const refreshExams = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.exams }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sheetLibrary }),
    ]);
    onExamsChanged?.();
  }, [queryClient, onExamsChanged]);

  const examsOf = (programId) => exams.filter((e) => e.programId === programId);
  const ungroupedExams = exams.filter(
    (e) => !e.programId || !programs.some((p) => p.programId === e.programId)
  );

  // ── Program actions ──────────────────────────────────────────
  // Inline rename - click the name to edit in place. Enter/blur saves,
  // Escape cancels.
  function startRenameProgram(program) {
    setEditingProgramId(program.programId);
    setProgramNameDraft(program.name);
  }

  async function commitRenameProgram(program) {
    setEditingProgramId(null);
    const name = programNameDraft.trim();
    if (!name || name === program.name) return;
    setError(null);
    try {
      await updateProgram(program.programId, { name });
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to rename program');
    }
  }

  // Archive ("it's over") / unarchive a program. Archiving keeps all data but
  // takes the program's exams out of every student's SAT report until restored.
  async function handleArchiveProgram(program) {
    setError(null);
    try {
      await updateProgram(program.programId, { archived: !program.archived });
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to update program');
    }
  }

  async function handleDeleteProgram(program) {
    // Exams must belong to a program, so a non-empty program can't be deleted -
    // move or delete its exams first.
    const examCount = Math.max(program.examCount || 0, examsOf(program.programId).length);
    if (examCount > 0) {
      setError(`Move or delete ${program.name}’s ${plural(examCount, 'exam')} before deleting the program.`);
      return;
    }
    const ok = await confirm({
      title: `Delete “${program.name}”?`,
      description: 'The program and its enrollment list are deleted. Students’ test results are not affected.',
      confirmLabel: 'Delete program',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteProgram(program.programId);
      if (rosterOpenFor === program.programId) setRosterOpenFor(null);
      await refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to delete program');
    }
  }

  function openCreateExam(programId) {
    // Expand the target program so the new exam is visible once created.
    if (programId) expandProgram(programId);
    setNewExamFor(programId || '');
  }

  // ── Drag-to-reorder with a live preview ──────────────────────
  // The authoritative order lives in dragOrderRef and is updated synchronously
  // on every dragover - independent of React's batched state, so persistOrder
  // always reads the settled order even when drop fires in the same tick. The
  // cached exam list only mirrors it for the visuals.
  function startDrag(programId, examId, e) {
    dragIdRef.current = examId;
    dragMovedRef.current = false;
    dragOrderRef.current = { programId, ids: examsOf(programId).map((x) => x.examId) };
    setDragExamId(examId);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox/Safari won't begin a drag unless data is set.
    e.dataTransfer.setData('text/plain', examId);
  }

  function previewMove(targetId) {
    const order = dragOrderRef.current;
    const fromId = dragIdRef.current;
    if (!order || !fromId || fromId === targetId) return;
    const from = order.ids.indexOf(fromId);
    const to = order.ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return; // cross-program / no-op
    const ids = [...order.ids];
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    dragOrderRef.current = { programId: order.programId, ids };
    dragMovedRef.current = true;
    applyOrder(order.programId, ids);
  }

  // Reorder a program's exams in the cached list to match the given id order,
  // leaving every other program untouched.
  function applyOrder(programId, ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    queryClient.setQueryData(queryKeys.exams, (prev) => {
      if (!prev) return prev;
      const inProgram = prev
        .filter((e) => e.programId === programId)
        .sort((a, b) => pos.get(a.examId) - pos.get(b.examId));
      let i = 0;
      return prev.map((e) => (e.programId === programId ? inProgram[i++] : e));
    });
  }

  // Fires on both drop and dragend (whichever the browser delivers); guarded by
  // the refs so it persists exactly once and skips clicks / no-op drags.
  async function persistOrder() {
    const moved = dragMovedRef.current;
    const order = dragOrderRef.current;
    dragMovedRef.current = false;
    dragOrderRef.current = null;
    dragIdRef.current = null;
    setDragExamId(null);
    if (!moved || !order) return;
    setError(null);
    try {
      await reorderExams(order.programId, order.ids);
    } catch (err) {
      setError(err.message || 'Failed to reorder exams');
    }
    // Either way, show the order the server now has.
    await refreshAll();
  }

  const rowProps = (exam) => ({
    exam,
    tests,
    roster,
    programs,
    onChanged: refreshAll,
    onExamsChanged: refreshExams,
    onOpenSheets,
    onError: setError,
  });

  const gaps = useMemo(() => scoringGaps(exams, programs), [exams, programs]);
  const loading = examsPending || programsPending;
  const loadError = examsError || programsError;
  const rosterProgram = programs.find((p) => p.programId === rosterOpenFor) || null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Programs</CardTitle>
        <CardDescription>
          {loading ? 'Loading…' : `${plural(programs.length, 'program')} · ${plural(exams.length, 'exam')}`}
        </CardDescription>
        <CardAction>
          <Button onClick={() => setNewProgramOpen(true)}>
            <LuPlus data-icon="inline-start" />
            New program
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-6">
        {loadError && <Notice variant="destructive">Could not load the programs: {loadError.message}</Notice>}
        {error && (
          <div ref={errorRef} className="scroll-mt-32">
            <Notice variant="destructive">{error}</Notice>
          </div>
        )}

        {(gaps.waiting > 0 || gaps.uncategorised > 0) && (
          <div className="grid gap-3">
            {gaps.waiting > 0 && (
              <Notice
                variant="warning"
                title={`${plural(gaps.waiting, 'exam')} ${gaps.waiting === 1 ? 'is' : 'are'} waiting for a scoring sheet`}
              >
                <p>
                  {gaps.missing.join(', ')} {gaps.missing.length === 1 ? 'hasn’t' : 'haven’t'} been added yet, so students
                  see raw scores only for {gaps.waiting === 1 ? 'that exam' : 'those exams'}.
                </p>
                <Button variant="outline" size="sm" className="mt-2 text-foreground" onClick={onOpenSheets}>
                  Open scoring sheets
                </Button>
              </Notice>
            )}
            {gaps.uncategorised > 0 && (
              <Notice
                variant="warning"
                title={`${plural(gaps.uncategorised, 'exam')} with tests ${gaps.uncategorised === 1 ? 'has' : 'have'} no scoring sheet yet`}
              >
                {gaps.uncategorised === 1 ? 'Its scores show as raw.' : 'Their scores show as raw.'} Pick Easy, Medium or Hard
                for English and Math on each one.
              </Notice>
            )}
          </div>
        )}

        {loading ? (
          <LoadingPrograms />
        ) : programs.length === 0 && exams.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><LuLayers /></EmptyMedia>
              <EmptyTitle>No programs yet</EmptyTitle>
              <EmptyDescription>
                Create a program (e.g. “GA SAT 2026”), enroll its students, then add its exams.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setNewProgramOpen(true)}>
                <LuPlus data-icon="inline-start" />
                New program
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-3">
            {programs.map((program) => {
              const members = examsOf(program.programId);
              const enrolled = (program.studentIds || []).length;
              const expanded = openPrograms.has(program.programId);
              return (
                <section
                  key={program.programId}
                  aria-label={program.name}
                  className={cn(
                    'overflow-hidden rounded-lg border bg-card transition-opacity',
                    program.archived && 'opacity-60 focus-within:opacity-100 hover:opacity-100'
                  )}
                >
                  {/* Click the header to show or hide the program's exams. The
                      name, enrollment, Add exam and the menu keep their own actions. */}
                  <div
                    className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 bg-muted/40 px-3 py-2.5"
                    onClick={() => toggleProgram(program.programId)}
                  >
                    <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={expanded ? `Hide ${program.name}’s exams` : `Show ${program.name}’s exams`}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        onClick={(e) => { stop(e); toggleProgram(program.programId); }}
                      >
                        <LuChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                      </button>
                      {editingProgramId === program.programId ? (
                        <Input
                          autoFocus
                          value={programNameDraft}
                          aria-label="Program name"
                          className="h-8 max-w-sm font-medium"
                          onClick={stop}
                          onChange={(e) => setProgramNameDraft(e.target.value)}
                          onBlur={() => commitRenameProgram(program)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRenameProgram(program);
                            if (e.key === 'Escape') setEditingProgramId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="group/name flex min-w-0 cursor-text items-center gap-1.5 rounded-sm text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          title="Click to rename this program"
                          onClick={(e) => { stop(e); startRenameProgram(program); }}
                        >
                          <span className="truncate">{program.name}</span>
                          <LuPencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100" />
                        </button>
                      )}
                      <Badge variant="secondary" className="shrink-0 tabular-nums">{plural(members.length, 'exam')}</Badge>
                      {program.archived && (
                        <Badge variant="warning" className="shrink-0" title="This program’s exams are left out of student SAT reports">
                          Archived
                        </Badge>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-2" onClick={stop}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRosterOpenFor(program.programId)}
                        title="Enroll students - they see every exam in this program"
                      >
                        <LuUsers data-icon="inline-start" />
                        <span className="tabular-nums">{enrolled}</span>
                        <span className="hidden sm:inline">enrolled</span>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openCreateExam(program.programId)}>
                        <LuPlus data-icon="inline-start" />
                        Add exam
                      </Button>
                      {/* Not modal: a confirm dialog opened from an item must
                          not fight the menu for focus and pointer events. */}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`${program.name} actions`}>
                            <LuEllipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onSelect={() => window.open(programSummaryUrl(program.programId), '_blank', 'noopener')}>
                            <LuFileText />
                            Summary PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleArchiveProgram(program)}>
                            {program.archived ? <LuArchiveRestore /> : <LuArchive />}
                            {program.archived ? 'Unarchive' : 'Archive'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => handleDeleteProgram(program)}>
                            <LuTrash2 />
                            Delete program
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {expanded && (
                    <div className="grid gap-2 border-t p-3">
                      {members.length === 0 ? (
                        <p className="px-1 py-1 text-sm text-muted-foreground">
                          No exams in this program yet - use Add exam to create one.
                        </p>
                      ) : (
                        <>
                          <div
                            className={cn(EXAM_GRID, 'hidden px-[13px] text-xs font-medium text-muted-foreground lg:grid')}
                            aria-hidden="true"
                          >
                            <span />
                            <span />
                            <span>Exam</span>
                            <span>Date</span>
                            <span>English sheet</span>
                            <span>Math sheet</span>
                            <span />
                          </div>
                          {members.map((exam) => (
                            <ExamRow
                              key={exam.examId}
                              {...rowProps(exam)}
                              dragging={dragExamId === exam.examId}
                              onDragStart={(e) => startDrag(program.programId, exam.examId, e)}
                              onDragEnd={persistOrder}
                              onDragOver={(e) => {
                                if (!dragIdRef.current || dragIdRef.current === exam.examId) return;
                                e.preventDefault();
                                previewMove(exam.examId);
                              }}
                              onDrop={(e) => { e.preventDefault(); persistOrder(); }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {ungroupedExams.length > 0 && (
              <section aria-label="Ungrouped exams" className="grid gap-2">
                {programs.length > 0 && (
                  <h3 className="mt-2 text-xs font-medium text-muted-foreground">Ungrouped exams</h3>
                )}
                {ungroupedExams.map((exam) => <ExamRow key={exam.examId} {...rowProps(exam)} />)}
              </section>
            )}
          </div>
        )}
      </CardContent>

      {newProgramOpen && (
        <NewProgramDialog
          onClose={() => setNewProgramOpen(false)}
          onCreated={async (created) => {
            setNewProgramOpen(false);
            await refreshAll();
            // Program-first flow: go straight to enrolling its students.
            if (created?.programId) setRosterOpenFor(created.programId);
          }}
        />
      )}
      {newExamFor !== null && (
        <NewExamDialog
          programs={programs}
          tests={tests}
          programId={newExamFor}
          onClose={() => setNewExamFor(null)}
          onCreated={async (programId) => {
            setNewExamFor(null);
            if (programId) expandProgram(programId);
            await refreshAll();
          }}
        />
      )}
      {rosterProgram && (
        <ProgramRosterPanel
          program={rosterProgram}
          roster={roster}
          exams={exams}
          tests={tests}
          onClose={() => setRosterOpenFor(null)}
          onSaved={async () => { setRosterOpenFor(null); await refreshAll(); }}
        />
      )}
    </Card>
  );
}
