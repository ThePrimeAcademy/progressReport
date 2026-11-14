// features/report/components/ProgramRosterPanel.jsx
// The program's enrollment dialog. The program owns the roster for every exam
// inside it: enrolling a student makes all of the program's exams appear in
// their SAT report, and removing them hides those exams. "Add all takers"
// selects everyone who took one of the program's exams (optionally only in
// one ClassMarker group), so 100+-student cohorts don't need a click each.
// Nothing is saved until Save enrollment, so a pull can be reviewed first.
import React, { useState } from 'react';
import { LuUserPlus } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import { updateProgram, fetchExamTakers } from '../api/reportApi.js';
import StudentChecklist from './StudentChecklist.jsx';
import { testGroupNames } from './TestPicker.jsx';

const ALL_GROUPS = '__all__';

export default function ProgramRosterPanel({ program, roster, exams = [], tests = [], onClose, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(program.studentIds || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pullExamId, setPullExamId] = useState('');
  const [pullGroup, setPullGroup] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState(null); // { added: boolean, text }

  // Only this program's own exams can be a pull source - the roster is
  // program-scoped, so another program's takers would be meaningless here.
  const programExams = exams.filter((e) => e.programId === program.programId);

  // ClassMarker groups linked to the chosen exam's tests - the same test can
  // be linked to several groups, so the pull can be narrowed to one cohort.
  const pullExam = programExams.find((e) => e.examId === pullExamId);
  const pullGroups = (() => {
    if (!pullExam) return [];
    const ids = new Set(Object.values(pullExam.sections || {}).filter(Boolean).map((sec) => String(sec.testId)));
    const names = new Set();
    for (const t of tests) {
      if (ids.has(String(t.testId))) testGroupNames(t).forEach((name) => names.add(name));
    }
    return [...names].sort();
  })();

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handlePullTakers() {
    if (!pullExamId) return;
    setPulling(true);
    setPullNote(null);
    setError(null);
    try {
      const takers = await fetchExamTakers(pullExamId, { all: true, group: pullGroup });
      const newOnes = takers.filter((t) => !selected.has(t.id));
      setSelected((prev) => new Set([...prev, ...takers.map((t) => t.id)]));
      const examName = pullExam?.name || 'that exam';
      const scope = pullGroup ? `${examName} in ${pullGroup}` : examName;
      setPullNote(
        newOnes.length > 0
          ? { added: true, text: `Added ${newOnes.length} student${newOnes.length === 1 ? '' : 's'} who took ${scope}. Save enrollment to keep them.` }
          : { added: false, text: takers.length > 0 ? `Everyone who took ${scope} is already selected.` : `No attempts found for ${scope}.` }
      );
    } catch (err) {
      setError(err.message || 'Could not load the exam’s takers.');
    } finally {
      setPulling(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateProgram(program.programId, { studentIds: Array.from(selected) });
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save the enrollment.');
      setSaving(false);
    }
  }

  const blockWhileSaving = (e) => { if (saving) e.preventDefault(); };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={!saving}
        onInteractOutside={blockWhileSaving}
        onEscapeKeyDown={blockWhileSaving}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Enroll students in {program.name}</DialogTitle>
          <DialogDescription>Enrolled students see every exam in this program on their report.</DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-4">
          {programExams.length > 0 && (
            <div className="grid gap-2.5 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm font-medium">Add everyone who took an exam</div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={pullExamId}
                  onValueChange={(value) => { setPullExamId(value); setPullGroup(''); setPullNote(null); }}
                >
                  <SelectTrigger size="sm" className="w-52 bg-background" aria-label="Exam to pull students from">
                    <SelectValue placeholder="Choose an exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {programExams.map((e) => <SelectItem key={e.examId} value={e.examId}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {pullExamId && pullGroups.length > 0 && (
                  <Select
                    value={pullGroup || ALL_GROUPS}
                    onValueChange={(value) => { setPullGroup(value === ALL_GROUPS ? '' : value); setPullNote(null); }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-48 bg-background"
                      aria-label="ClassMarker group"
                      title="Only count attempts made under this ClassMarker group"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_GROUPS}>All groups</SelectItem>
                      {pullGroups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pullExamId || pulling}
                  onClick={handlePullTakers}
                  title="Select everyone with an attempt on this exam's tests"
                >
                  {pulling ? <Spinner data-icon="inline-start" /> : <LuUserPlus data-icon="inline-start" />}
                  Add all takers
                </Button>
              </div>
              {pullNote && (
                <p className={pullNote.added ? 'text-sm text-success' : 'text-sm text-muted-foreground'} aria-live="polite">
                  {pullNote.text}
                </p>
              )}
            </div>
          )}

          <StudentChecklist students={roster} selected={selected} onToggle={toggle} />

          {error && <Notice variant="destructive">{error}</Notice>}
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              Save enrollment
            </Button>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums sm:order-first">
            {selected.size} student{selected.size === 1 ? '' : 's'} enrolled
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
