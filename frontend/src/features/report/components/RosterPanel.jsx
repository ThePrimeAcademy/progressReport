// features/report/components/RosterPanel.jsx
// Who takes an UNGROUPED exam - chosen from the full student list. Exams in a
// program use the program's roster instead (see ProgramRosterPanel), so this
// dialog only opens from the "N students" chip of a loose exam.
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import { updateExam } from '../api/reportApi.js';
import StudentChecklist from './StudentChecklist.jsx';

export default function RosterPanel({ exam, roster, onClose, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(exam.studentIds || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (id) => {
    setSelected((prev) => {
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
      await updateExam(exam.examId, { studentIds: Array.from(selected) });
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save the students.');
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
          <DialogTitle>Students taking {exam.name}</DialogTitle>
          <DialogDescription>This exam isn’t in a program, so it has its own list of students.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <StudentChecklist students={roster} selected={selected} onToggle={toggle} />
          {error && <Notice variant="destructive">{error}</Notice>}
        </div>
        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              Save students
            </Button>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums sm:order-first">{selected.size} selected</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
