// features/report/components/ProgramDialogs.jsx
// The two create dialogs on the Programs page: a new program, and a new exam
// inside a program.
import React, { useState } from 'react';
import { LuChevronsUpDown } from 'react-icons/lu';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import DatePicker from '@/components/common/DatePicker';
import { createExam, createProgram } from '../api/reportApi.js';
import { LEVELS, LEVEL_LABEL, SUBJECTS } from '../scoring.js';
import TestPicker from './TestPicker.jsx';
import { SECTION_DEFS } from './ExamRow.jsx';

const LATER = '__later__';

// Shared dialog chrome: while `busy`, it can't be dismissed.
function GuardedDialog({ busy, onClose, className, children }) {
  const block = (e) => { if (busy) e.preventDefault(); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className={className} showCloseButton={!busy} onInteractOutside={block} onEscapeKeyDown={block}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function NewProgramDialog({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createProgram({ name: name.trim() });
      await onCreated?.(created);
    } catch (err) {
      setError(err.message || 'Could not create the program.');
      setSaving(false);
    }
  }

  return (
    <GuardedDialog busy={saving} onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-6">
        <DialogHeader className="pr-8">
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>Group a cohort’s diagnostics and tests under one program, then enroll its students.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="new-program-name">Program name</FieldLabel>
          <Input
            id="new-program-name"
            autoFocus
            value={name}
            placeholder="e.g. GA SAT 2026"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {error && <Notice variant="destructive">{error}</Notice>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving && <Spinner data-icon="inline-start" />}
            Create program
          </Button>
        </DialogFooter>
      </form>
    </GuardedDialog>
  );
}

// programId: the program the exam goes into (required to create).
export function NewExamDialog({ programs, tests, programId: initialProgramId = '', onClose, onCreated }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [programId, setProgramId] = useState(initialProgramId);
  const [sections, setSections] = useState({ 1: '', 2: '', 3: '', 4: '' });
  const [difficulty, setDifficulty] = useState({ rw: '', math: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A test may be reused across exams; it just can't fill two sections of this one.
  const optionsFor = (key) => {
    const chosenElsewhere = new Set(Object.entries(sections).filter(([k, v]) => k !== key && v).map(([, v]) => v));
    return tests.filter((t) => !chosenElsewhere.has(String(t.testId)));
  };
  const testName = (testId) => tests.find((t) => String(t.testId) === String(testId))?.testName || `Test #${testId}`;

  // An exam must have a name and belong to a program.
  const valid = Boolean(name.trim()) && Boolean(programId);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const payloadSections = {};
      for (const { key } of SECTION_DEFS) {
        const testId = sections[key];
        payloadSections[key] = testId ? { testId, testName: testName(testId) } : null;
      }
      await createExam({
        name: name.trim(),
        date,
        programId,
        sections: payloadSections,
        // The program owns the roster - exams never carry their own.
        studentIds: [],
        difficulty: { rw: difficulty.rw || null, math: difficulty.math || null },
      });
      await onCreated?.(programId);
    } catch (err) {
      setError(err.message || 'Could not create the exam.');
      setSaving(false);
    }
  }

  return (
    <GuardedDialog busy={saving} onClose={onClose} className="sm:max-w-2xl">
      <form onSubmit={handleSubmit} className="grid min-w-0 gap-6">
        <DialogHeader className="pr-8">
          <DialogTitle>New exam</DialogTitle>
          <DialogDescription>
            Exams can be created ahead of time - the sections can stay empty until their ClassMarker tests exist.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="new-exam-name">Exam name</FieldLabel>
              <Input
                id="new-exam-name"
                autoFocus
                value={name}
                placeholder="e.g. Diagnostic, Test 1"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-exam-date">Exam date <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
              <DatePicker id="new-exam-date" value={date} onChange={setDate} clearable className="w-full" />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="new-exam-program">Program</FieldLabel>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger id="new-exam-program" className="w-full">
                <SelectValue placeholder={programs.length ? 'Select a program' : 'No programs yet - create one first'} />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => <SelectItem key={p.programId} value={p.programId}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldDescription>Only the program’s enrolled students take the exam, and they see it automatically.</FieldDescription>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            {SECTION_DEFS.map(({ key, label, short, hint }) => (
              <Field key={key}>
                <FieldLabel htmlFor={`new-exam-section-${key}`} title={hint}>
                  {label} <span className="font-normal text-muted-foreground">· {short}</span>
                </FieldLabel>
                <TestPicker
                  modal
                  tests={optionsFor(key)}
                  value={sections[key]}
                  onChange={(testId) => setSections((prev) => ({ ...prev, [key]: testId }))}
                >
                  <Button
                    id={`new-exam-section-${key}`}
                    type="button"
                    variant="outline"
                    role="combobox"
                    className={cn('w-full justify-between font-normal', !sections[key] && 'text-muted-foreground')}
                  >
                    <span className="truncate">{sections[key] ? testName(sections[key]) : 'No test yet'}</span>
                    <LuChevronsUpDown data-icon="inline-end" className="opacity-50" />
                  </Button>
                </TestPicker>
              </Field>
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {SUBJECTS.map((subject) => (
              <Field key={subject.key}>
                <FieldLabel htmlFor={`new-exam-sheet-${subject.key}`}>{subject.label} scoring sheet</FieldLabel>
                <Select
                  value={difficulty[subject.key] || LATER}
                  onValueChange={(value) => setDifficulty((prev) => ({ ...prev, [subject.key]: value === LATER ? '' : value }))}
                >
                  <SelectTrigger id={`new-exam-sheet-${subject.key}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LATER}>Choose later</SelectItem>
                    {LEVELS.map((level) => <SelectItem key={level} value={level}>{LEVEL_LABEL[level]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </div>
        </div>

        {error && <Notice variant="destructive">{error}</Notice>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !valid}>
            {saving && <Spinner data-icon="inline-start" />}
            Create exam
          </Button>
        </DialogFooter>
      </form>
    </GuardedDialog>
  );
}
