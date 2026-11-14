// features/report/components/HiddenStudentsPanel.jsx
// Per-exam hidden students: everyone enrolled who took the exam's tests;
// checked = hidden (their attempts are ignored when scoring this exam).
// Hidden exclusions stay per-exam even for exams inside a program.
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import { fetchExamTakers, updateExam } from '../api/reportApi.js';
import StudentChecklist from './StudentChecklist.jsx';

export default function HiddenStudentsPanel({ exam, onClose, onSaved }) {
  const [takers, setTakers] = useState(null); // null = loading
  const [hidden, setHidden] = useState(() => new Set(exam.hiddenStudentIds || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchExamTakers(exam.examId)
      .then((list) => { if (!cancelled) setTakers(list); })
      .catch((err) => {
        if (cancelled) return;
        setTakers([]);
        setError(err.message || 'Could not load the students.');
      });
    return () => { cancelled = true; };
  }, [exam.examId]);

  const toggle = (id) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateExam(exam.examId, { hiddenStudentIds: Array.from(hidden) });
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save the hidden students.');
      setSaving(false);
    }
  }

  const before = exam.hiddenStudentIds || [];
  const dirty = hidden.size !== before.length || before.some((id) => !hidden.has(id));
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
          <DialogTitle>Hidden students · {exam.name}</DialogTitle>
          <DialogDescription>Checked students’ attempts don’t count for this exam - on its scoreboard or in their reports.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          {takers === null ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Loading students">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : takers.length === 0 && !error ? (
            <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
              No one has taken this exam’s tests yet.
            </p>
          ) : (
            <StudentChecklist
              students={takers}
              selected={hidden}
              onToggle={toggle}
              checkedClassName="bg-destructive/5 text-destructive line-through"
            />
          )}
          {error && <Notice variant="destructive">{error}</Notice>}
        </div>
        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !dirty || takers === null}>
              {saving && <Spinner data-icon="inline-start" />}
              Save hidden students
            </Button>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums sm:order-first">{hidden.size} hidden</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
