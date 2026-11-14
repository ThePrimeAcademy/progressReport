// features/report/components/ExamRow.jsx
// One SAT exam inside a program.
//
// The collapsed row is a single aligned line: drag handle, name, date, the
// English and Math scoring-sheet pickers (Easy / Medium / Hard / Custom) and
// the scoreboard. Everything used less often is one click away in the
// expanded panel: the four DSAT section tests, what grades each subject, and
// the exam's settings (practice, move to another program, hidden students,
// delete). Self-contained - saves each edit through the API, then asks the
// parent to refresh.
import React, { useCallback, useState } from 'react';
import {
  LuChevronRight,
  LuEyeOff,
  LuGripVertical,
  LuTrash2,
  LuTrophy,
} from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/common/confirm';
import DatePicker from '@/components/common/DatePicker';
import { updateExam, deleteExam } from '../api/reportApi.js';
import { SUBJECTS } from '../scoring.js';
import SheetLevelPicker from './SheetLevelPicker.jsx';
import ExamScoring from './ExamScoring.jsx';
import ScoreboardPanel from './ScoreboardPanel.jsx';
import RosterPanel from './RosterPanel.jsx';
import HiddenStudentsPanel from './HiddenStudentsPanel.jsx';
import TestPicker from './TestPicker.jsx';

// `short` names the module on screen; `hint` spells it out in tooltips.
export const SECTION_DEFS = [
  { key: '1', label: 'Section 1', short: 'English, module 1', hint: 'Reading & Writing · Module 1' },
  { key: '2', label: 'Section 2', short: 'English, module 2', hint: 'Reading & Writing · Module 2' },
  { key: '3', label: 'Section 3', short: 'Math, module 1', hint: 'Math · Module 1' },
  { key: '4', label: 'Section 4', short: 'Math, module 2', hint: 'Math · Module 2' },
];

// The columns every exam row - and the column header above them - share, so
// the pickers line up down a program: handle · chevron · name · date ·
// English · Math · scoreboard. Narrower screens move the date and pickers
// onto lines of their own under the name (see the row's cells); phones also
// drop the drag handle, as dragging needs a mouse.
export const EXAM_GRID = cn(
  'grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2',
  'sm:grid-cols-[1rem_1rem_minmax(0,1fr)_auto_auto]',
  'lg:grid-cols-[1rem_1rem_minmax(8rem,1fr)_8.5rem_13.5rem_13.5rem_7.5rem]'
);

const stop = (e) => e.stopPropagation();

export default function ExamRow({
  exam, tests, roster, programs, onChanged, onExamsChanged, onOpenSheets, onError,
  onDragStart, onDragEnd, onDragOver, onDrop, dragging,
}) {
  const confirm = useConfirm();
  const assignedCount = SECTION_DEFS.filter((d) => exam.sections?.[d.key]?.testId).length;
  // Every exam starts collapsed - the list stays compact; click a row to open
  // it for editing.
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(exam.name);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // Sheet choices just clicked but not yet confirmed by the server, so the
  // pickers respond instantly: { rw?: level|null, math?: level|null }.
  const [pendingDifficulty, setPendingDifficulty] = useState({});

  // Identifies the sheets currently grading this exam (level, table, bound).
  const scoringKey = SUBJECTS.map(({ key }) => {
    const scoring = exam.scoring?.[key];
    return `${scoring?.level || 'custom'}:${scoring?.sheet?.hash || 'none'}:${scoring?.sheet?.bound || ''}`;
  }).join('|');

  const grouped = Boolean(exam.programId);
  const hiddenCount = (exam.hiddenStudentIds || []).length;
  const studentCount = (exam.studentIds || []).length;

  const patchExam = useCallback(async (patch) => {
    onError?.(null);
    try {
      await updateExam(exam.examId, patch);
      await onChanged?.();
    } catch (err) {
      onError?.(err.message || 'Failed to update exam');
    }
  }, [exam.examId, onChanged, onError]);

  // Choose the scoring sheet for one subject. Only the exam list needs to be
  // re-read afterwards, which keeps clicking through a column of exams quick.
  async function setDifficulty(subject, level) {
    onError?.(null);
    setPendingDifficulty((prev) => ({ ...prev, [subject]: level }));
    try {
      await updateExam(exam.examId, { difficulty: { [subject]: level } });
      await onExamsChanged?.();
    } catch (err) {
      onError?.(err.message || 'Failed to update the scoring sheet');
    } finally {
      setPendingDifficulty((prev) => {
        const next = { ...prev };
        delete next[subject];
        return next;
      });
    }
  }

  // Inline name edit - Enter/blur saves, Escape cancels.
  function commitName() {
    setEditingName(false);
    const v = nameDraft.trim();
    if (!v || v === exam.name) { setNameDraft(exam.name); return; }
    patchExam({ name: v });
  }

  // A picked date is saved at once; clearing removes the exam's own date
  // (the date it was taken, if known, then shows in its place).
  function commitDate(next) {
    if (next === (exam.date || '')) return;
    patchExam({ date: next });
  }

  // Options for one section. A test may be reused across exams, so the only
  // restriction is that it can't fill two sections of *this* exam.
  function sectionOptions(sectionKey) {
    const usedElsewhereInExam = new Set(
      SECTION_DEFS.filter((d) => d.key !== sectionKey)
        .map((d) => exam.sections?.[d.key]?.testId)
        .filter(Boolean)
        .map(String)
    );
    return tests.filter((t) => !usedElsewhereInExam.has(String(t.testId)));
  }

  function setSection(sectionKey, testId) {
    const sections = {};
    for (const d of SECTION_DEFS) {
      const cur = exam.sections?.[d.key];
      sections[d.key] = cur ? { testId: cur.testId, testName: cur.testName } : null;
    }
    const test = tests.find((t) => String(t.testId) === String(testId));
    sections[sectionKey] = testId ? { testId, testName: test?.testName || null } : null;
    patchExam({ sections });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete “${exam.name}”?`,
      description: 'The exam and its custom scoring sheets are deleted. Test results in ClassMarker are not affected.',
      confirmLabel: 'Delete exam',
      destructive: true,
    });
    if (!ok) return;
    onError?.(null);
    try {
      await deleteExam(exam.examId);
      await onChanged?.();
    } catch (err) {
      onError?.(err.message || 'Failed to delete exam');
    }
  }

  const togglePractice = () => patchExam({ isPractice: !exam.isPractice });
  const shownDate = exam.date || exam.takenDate || '';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-card transition-[box-shadow,opacity,transform,border-color] duration-150',
        dragging && 'scale-[0.99] border-ring opacity-60 shadow-md'
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className={cn(EXAM_GRID, 'cursor-pointer px-3 py-2 transition-colors hover:bg-muted/40', expanded && 'bg-muted/40')}
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          draggable={Boolean(onDragStart)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={stop}
          className={cn(
            'hidden justify-center text-muted-foreground sm:flex',
            onDragStart ? (dragging ? 'cursor-grabbing' : 'cursor-grab hover:text-foreground') : 'invisible'
          )}
          title="Drag to reorder within the program"
          aria-hidden="true"
        >
          <LuGripVertical className="size-4" />
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${exam.name}` : `Show ${exam.name}’s sections and settings`}
          className="flex rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={(e) => { stop(e); setExpanded((v) => !v); }}
        >
          <LuChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
        </button>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {editingName ? (
            <Input
              autoFocus
              value={nameDraft}
              aria-label="Exam name"
              className="h-7 min-w-0 flex-1 font-medium"
              onClick={stop}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') { setNameDraft(exam.name); setEditingName(false); }
              }}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 cursor-text rounded-sm text-left text-sm font-medium break-words outline-none hover:underline hover:decoration-muted-foreground/50 hover:decoration-dotted hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              title="Click to rename"
              onClick={(e) => { stop(e); setNameDraft(exam.name); setEditingName(true); }}
            >
              {exam.name}
            </button>
          )}
          {exam.isPractice && (
            <Badge variant="warning" title="Practice exam - kept out of grade reports">Practice</Badge>
          )}
          {assignedCount < SECTION_DEFS.length && (
            <span className="text-xs text-muted-foreground tabular-nums" title="Sections with a test assigned">
              {assignedCount}/4 sections
            </span>
          )}
          {hiddenCount > 0 && (
            <Badge asChild variant="destructive">
              <button
                type="button"
                title="Students whose attempts are ignored for this exam - click to edit"
                onClick={(e) => { stop(e); setHiddenOpen(true); }}
              >
                {hiddenCount} hidden
              </button>
            </Badge>
          )}
          {/* Ungrouped (legacy) exams keep their own roster; grouped exams
              use the program's. */}
          {!grouped && (
            <Badge asChild variant="outline">
              <button
                type="button"
                title="Click to pick the students taking this exam"
                onClick={(e) => { stop(e); setRosterOpen(true); }}
              >
                {studentCount} student{studentCount === 1 ? '' : 's'}
              </button>
            </Badge>
          )}
        </div>

        <div className="col-[1/-1] row-start-2 sm:col-auto sm:row-auto" onClick={stop}>
          <DatePicker
            value={shownDate}
            onChange={commitDate}
            clearable={Boolean(exam.date)}
            placeholder="Set date"
            size="sm"
            className={cn('h-7 justify-start px-2 text-xs lg:w-full', !exam.date && 'text-muted-foreground')}
            aria-label={exam.date
              ? 'Exam date - click to change'
              : exam.takenDate ? 'Date the exam was taken - click to confirm or change' : 'Set the exam date'}
          />
        </div>

        <div className="col-[1/-1] row-start-3 flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-[3/-1] sm:row-start-2 lg:contents">
          {SUBJECTS.map((subject) => (
            <div key={subject.key} className="flex items-center gap-2" onClick={stop}>
              <span className="w-12 text-xs font-medium text-muted-foreground lg:hidden">{subject.label}</span>
              <SheetLevelPicker
                subjectLabel={subject.label}
                value={subject.key in pendingDifficulty ? pendingDifficulty[subject.key] : (exam.difficulty?.[subject.key] || null)}
                scoring={exam.scoring?.[subject.key]}
                onChange={(level) => setDifficulty(subject.key, level)}
                onCustom={() => setExpanded(true)}
              />
            </div>
          ))}
        </div>

        <div className="justify-self-end" onClick={stop}>
          <Button
            variant={scoreboardOpen ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={scoreboardOpen}
            aria-label={scoreboardOpen ? 'Hide the scoreboard' : 'Show the scoreboard'}
            onClick={() => setScoreboardOpen((v) => !v)}
          >
            <LuTrophy data-icon="inline-start" />
            <span className="hidden sm:inline">{scoreboardOpen ? 'Hide scores' : 'Scoreboard'}</span>
          </Button>
        </div>
      </div>

      {/* Keyed by what grades the exam, so an open scoreboard re-reads its
          scores the moment a sheet choice or the sheet itself changes. */}
      {scoreboardOpen && <ScoreboardPanel key={scoringKey} exam={exam} onError={onError} />}

      {expanded && (
        <>
          <div className="grid gap-2 border-t px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
            {SECTION_DEFS.map(({ key, label, short, hint }) => {
              const assigned = exam.sections?.[key];
              return (
                <TestPicker
                  key={key}
                  tests={sectionOptions(key)}
                  value={assigned?.testId || ''}
                  onChange={(testId) => setSection(key, testId)}
                >
                  <button
                    type="button"
                    className="grid min-w-0 gap-0.5 rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/50"
                    title={`${hint} - click to change this section's test`}
                  >
                    <span className="truncate text-xs text-muted-foreground">{label} · {short}</span>
                    {assigned
                      ? <span className="truncate font-medium">{assigned.testName || `Test #${assigned.testId}`}</span>
                      : <span className="text-muted-foreground italic">Not assigned</span>}
                  </button>
                </TestPicker>
              );
            })}
          </div>

          <ExamScoring exam={exam} onChanged={onExamsChanged} onOpenSheets={onOpenSheets} onError={onError} />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t px-3 py-3">
            <div className="flex items-center gap-2" title="Practice exams are kept out of grade reports">
              <Switch id={`practice-${exam.examId}`} checked={Boolean(exam.isPractice)} onCheckedChange={togglePractice} />
              <Label htmlFor={`practice-${exam.examId}`}>Practice exam</Label>
            </div>
            <div className="flex max-w-full min-w-0 items-center gap-2">
              <Label htmlFor={`program-${exam.examId}`} className="text-muted-foreground">Program</Label>
              <Select
                value={exam.programId || ''}
                onValueChange={(programId) => { if (programId && programId !== exam.programId) patchExam({ programId }); }}
              >
                <SelectTrigger id={`program-${exam.examId}`} size="sm" className="max-w-64 min-w-0" title="Move this exam to another program">
                  {/* A long program name ends in an ellipsis rather than being clipped. */}
                  <SelectValue placeholder="Move to a program…">
                    <span className="min-w-0 truncate">{programs.find((p) => p.programId === exam.programId)?.name}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {programs.map((p) => <SelectItem key={p.programId} value={p.programId}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHiddenOpen(true)}>
              <LuEyeOff data-icon="inline-start" />
              Hidden students{hiddenCount ? ` (${hiddenCount})` : ''}
            </Button>
            <Button variant="destructive" size="sm" className="sm:ml-auto" onClick={handleDelete}>
              <LuTrash2 data-icon="inline-start" />
              Delete exam
            </Button>
          </div>
        </>
      )}

      {!grouped && rosterOpen && (
        <RosterPanel
          exam={exam}
          roster={roster}
          onClose={() => setRosterOpen(false)}
          onSaved={async () => { setRosterOpen(false); await onChanged?.(); }}
        />
      )}
      {hiddenOpen && (
        <HiddenStudentsPanel
          exam={exam}
          onClose={() => setHiddenOpen(false)}
          onSaved={async () => { setHiddenOpen(false); await onChanged?.(); }}
        />
      )}
    </div>
  );
}
