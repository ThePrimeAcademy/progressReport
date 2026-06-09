// features/report/components/ExamManager.jsx
//
// Admin panel for SAT exams, grouped by program. A program (e.g. a summer
// program "GA SAT 2026") owns the student roster for every exam inside it —
// enrolling a student makes all of that program's exams appear in their SAT
// report; students not in the program never see them. Exams can also stay
// ungrouped (visible to anyone who took them, rostered individually).
//
// This component is the orchestrator: it loads exams, tests, students and
// programs, then renders each program with its exams nested underneath, the
// loose ungrouped exams below, and the create-exam / create-program forms.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchExams,
  fetchAvailableTests,
  fetchStudents,
  fetchPrograms,
  createExam,
  reorderExams,
  createProgram,
  updateProgram,
  deleteProgram,
} from '../api/reportApi.js';
import ExamRow, { SECTION_DEFS } from './ExamRow.jsx';
import ProgramRosterPanel from './ProgramRosterPanel.jsx';
import s from './examManagerStyles.js';

const EMPTY_FORM = { name: '', date: '', programId: '', sections: { 1: '', 2: '', 3: '', 4: '' }, studentIds: [] };

export default function ExamManager({ onExamsChanged }) {
  const [open, setOpen] = useState(false);
  const [exams, setExams] = useState([]);
  const [tests, setTests] = useState([]);
  const [roster, setRoster] = useState([]); // full student list for the pickers
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Exam create form: null = closed, 'new' = creating.
  const [formMode, setFormMode] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [groupFilter, setGroupFilter] = useState('');
  const [saving, setSaving] = useState(false);

  // Program create form + which program's roster panel is open.
  const [programFormName, setProgramFormName] = useState(null); // null = closed
  const [programSaving, setProgramSaving] = useState(false);
  const [rosterOpenFor, setRosterOpenFor] = useState(null); // programId
  const [dragExamId, setDragExamId] = useState(null); // exam being dragged
  // Which programs are expanded to show their exams. Collapsed by default so
  // the panel stays compact — click a program to reveal its exams.
  const [openPrograms, setOpenPrograms] = useState(() => new Set());

  const toggleProgram = (id) => {
    setOpenPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [examList, testList, students, programList] = await Promise.all([
        fetchExams(),
        fetchAvailableTests(),
        fetchStudents().catch(() => []),
        fetchPrograms().catch(() => []),
      ]);
      setExams(examList);
      setTests(testList);
      setRoster(students || []);
      setPrograms(programList || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load exams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const refreshAndNotify = useCallback(async () => {
    await refresh();
    onExamsChanged?.();
  }, [refresh, onExamsChanged]);

  // Distinct group names across all tests, for the create-form group filter.
  const groups = useMemo(() => {
    const seen = new Set();
    for (const t of tests) {
      for (const g of t.groups || []) if (g.groupName) seen.add(g.groupName);
      if (t.groupName) seen.add(t.groupName);
    }
    return Array.from(seen).sort();
  }, [tests]);

  const inGroup = useCallback((t, groupName) => {
    if (!groupName) return true;
    if ((t.groups || []).some((g) => g.groupName === groupName)) return true;
    return t.groupName === groupName;
  }, []);

  // Tests available for a section slot of the CREATE form: not assigned to
  // another exam and not already chosen in a different slot.
  const optionsForSection = useCallback((sectionKey) => {
    const chosenElsewhere = new Set(
      Object.entries(form.sections)
        .filter(([k, v]) => k !== sectionKey && v)
        .map(([, v]) => v)
    );
    return tests.filter((t) => {
      if (!inGroup(t, groupFilter)) return false;
      if (chosenElsewhere.has(t.testId)) return false;
      if (t.assignedToExamId) return false;
      return true;
    });
  }, [tests, form.sections, groupFilter, inGroup]);

  function openCreate(programId = '') {
    setForm({ ...EMPTY_FORM, programId });
    setGroupFilter('');
    setFormMode('new');
    // Expand the target program so the new exam is visible once created.
    if (programId) setOpenPrograms((prev) => new Set(prev).add(programId));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const sections = {};
      for (const { key } of SECTION_DEFS) {
        const testId = form.sections[key];
        const test = tests.find((t) => t.testId === testId);
        sections[key] = testId ? { testId, testName: test?.testName || null } : null;
      }
      await createExam({
        name: form.name,
        date: form.date,
        programId: form.programId || '',
        sections,
        // The program owns the roster — exams never carry their own.
        studentIds: [],
      });
      setFormMode(null);
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save exam');
    } finally {
      setSaving(false);
    }
  }

  // ── Program actions ──────────────────────────────────────────
  async function handleCreateProgram() {
    if (!programFormName?.trim()) return;
    setProgramSaving(true);
    setError(null);
    try {
      const created = await createProgram({ name: programFormName.trim() });
      setProgramFormName(null);
      await refreshAndNotify();
      // Program-first flow: jump straight to enrolling students into the
      // program you just made.
      if (created?.programId) setRosterOpenFor(created.programId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create program');
    } finally {
      setProgramSaving(false);
    }
  }

  async function renameProgram(program) {
    // eslint-disable-next-line no-alert
    const name = window.prompt('Program name', program.name);
    if (name == null || !name.trim() || name.trim() === program.name) return;
    setError(null);
    try {
      await updateProgram(program.programId, { name: name.trim() });
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to rename program');
    }
  }

  async function handleDeleteProgram(program) {
    // Exams must belong to a program, so a non-empty program can't be deleted —
    // move or delete its exams first.
    if (program.examCount > 0) {
      setError(`Move or delete ${program.name}'s ${program.examCount} exam${program.examCount === 1 ? '' : 's'} before deleting the program.`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete program "${program.name}"?`)) return;
    setError(null);
    try {
      await deleteProgram(program.programId);
      if (rosterOpenFor === program.programId) setRosterOpenFor(null);
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete program');
    }
  }

  // An exam must have a name and belong to a program.
  const formValid = Boolean(form.name.trim()) && Boolean(form.programId);

  const ungroupedExams = exams.filter(
    (e) => !e.programId || !programs.some((p) => p.programId === e.programId)
  );
  const examsOf = (programId) => exams.filter((e) => e.programId === programId);

  // Drag-to-reorder: drop the dragged exam at the target exam's position within
  // the same program, then persist the new order.
  async function handleDropOnExam(programId, targetId) {
    const fromId = dragExamId;
    setDragExamId(null);
    if (!fromId || fromId === targetId) return;
    const ids = examsOf(programId).map((e) => e.examId);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return; // different program — ignore cross-program drops
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    setError(null);
    try {
      await reorderExams(programId, ids);
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reorder exams');
    }
  }

  const rowProps = (exam) => ({
    exam,
    tests,
    roster,
    programs,
    onChanged: refreshAndNotify,
    onError: setError,
  });

  // The create-exam form. Rendered inside the targeted program (when one is
  // chosen) so it appears right where the exam will live, or at the bottom for
  // a general "+ New Exam" before a program is picked.
  function renderCreateForm() {
    return (
      <div style={s.form}>
        <div style={s.grid2}>
          <div>
            <span style={s.label}>Exam name</span>
            <input
              style={s.input}
              value={form.name}
              placeholder="e.g. Diagnostic, Test 1"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <span style={s.label}>Exam date <span style={{ fontWeight: 400 }}>· optional</span></span>
            <input
              type="date"
              style={s.input}
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <div style={s.hint}>Create the exam ahead of time — sections below can stay empty until the tests exist.</div>
          </div>
        </div>

        <div>
          <span style={s.label}>Program <span style={{ fontWeight: 400 }}>· required</span></span>
          <select
            style={s.select}
            value={form.programId}
            onChange={(e) => {
              const pid = e.target.value;
              setForm((f) => ({ ...f, programId: pid }));
              // The form lives inside its program — expand it so picking one
              // here keeps the form visible (instead of it vanishing).
              if (pid) setOpenPrograms((prev) => new Set(prev).add(pid));
            }}
          >
            <option value="">{programs.length ? 'Select a program…' : 'No programs yet — create one first'}</option>
            {programs.map((p) => <option key={p.programId} value={p.programId}>{p.name}</option>)}
          </select>
          <div style={s.hint}>
            Every exam belongs to a program — only its enrolled students are part of the exam, and they see it automatically.
          </div>
        </div>

        <div>
          <span style={s.label}>Filter tests by group</span>
          <select style={s.select} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div style={s.hint}>Narrows the section dropdowns below — tests already used by another exam are hidden.</div>
        </div>

        <div style={s.grid2}>
          {SECTION_DEFS.map(({ key, label, hint }) => (
            <div key={key}>
              <span style={s.label}>{label} <span style={{ fontWeight: 400 }}>· {hint}</span></span>
              <select
                style={s.select}
                value={form.sections[key]}
                onChange={(e) => setForm((f) => ({ ...f, sections: { ...f.sections, [key]: e.target.value } }))}
              >
                <option value="">— none —</option>
                {optionsForSection(key).map((t) => (
                  <option key={t.testId} value={t.testId}>
                    {t.testName} ({t.attempts} attempt{t.attempts === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div style={s.formActions}>
          <button type="button" style={s.btnGhost} disabled={saving} onClick={() => setFormMode(null)}>Cancel</button>
          <button type="button" style={s.btn} disabled={saving || !formValid} onClick={handleSave}>
            {saving ? 'Saving…' : 'Create Exam'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.head} onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>
        <div style={s.dot} />
        <span style={s.title}>Programs</span>
        {programs.length > 0 && <span style={s.count}>{programs.length} program{programs.length === 1 ? '' : 's'}</span>}
        {exams.length > 0 && <span style={s.count}>· {exams.length} exam{exams.length === 1 ? '' : 's'}</span>}
        <span style={s.chevron}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={s.body}>
          {error && <div style={s.error}>⚠ {error}</div>}

          {loading && exams.length === 0 && programs.length === 0 ? (
            <div style={s.empty}>Loading…</div>
          ) : exams.length === 0 && programs.length === 0 && formMode === null && programFormName === null ? (
            <div style={s.empty}>
              No programs yet. Create a program (e.g. “GA SAT 2026”), enroll students, then add its exams.
            </div>
          ) : null}

          {/* ── Programs, each with its exams nested underneath ── */}
          {programs.map((program) => {
            const members = examsOf(program.programId);
            const count = (program.studentIds || []).length;
            const expanded = openPrograms.has(program.programId);
            const stop = (e) => e.stopPropagation();
            return (
              <div key={program.programId} style={s.programCard}>
                {/* Click the header to expand/collapse the program's exams. The
                    name, enroll chip, +Exam and Delete keep their own actions. */}
                <div
                  style={{ ...s.programHead, cursor: 'pointer' }}
                  onClick={() => toggleProgram(program.programId)}
                  role="button"
                  aria-expanded={expanded}
                  title={expanded ? 'Click to collapse' : 'Click to show this program’s exams'}
                >
                  <span style={s.chevron}>{expanded ? '▾' : '▸'}</span>
                  <span style={s.programBadge}>Program</span>
                  <span
                    style={s.programName}
                    onClick={(e) => { stop(e); renameProgram(program); }}
                    title="Click to rename this program"
                  >
                    {program.name}
                  </span>
                  <span style={s.count}>{members.length} exam{members.length === 1 ? '' : 's'}</span>
                  <span
                    style={{ ...s.rosterChip, cursor: 'pointer' }}
                    onClick={(e) => { stop(e); setRosterOpenFor((cur) => (cur === program.programId ? null : program.programId)); }}
                    title="Click to enroll students — they'll see every exam in this program"
                  >
                    {count} enrolled
                  </span>
                  <button type="button" style={s.btnGhost} onClick={(e) => { stop(e); openCreate(program.programId); }}>+ Exam</button>
                  <button type="button" style={s.btnDanger} onClick={(e) => { stop(e); handleDeleteProgram(program); }}>Delete</button>
                </div>
                {/* Enrollment opens independently of expand so you can roster a
                    collapsed program. */}
                {rosterOpenFor === program.programId && (
                  <ProgramRosterPanel
                    program={program}
                    roster={roster}
                    onError={setError}
                    onSaved={async () => { setRosterOpenFor(null); await refreshAndNotify(); }}
                  />
                )}
                {expanded && (
                  <div style={s.programBody}>
                    {members.length === 0 ? (
                      <div style={s.programEmpty}>No exams in this program yet — use “+ Exam”, or move an exam in from the list below.</div>
                    ) : (
                      members.map((exam) => (
                        <ExamRow
                          key={exam.examId}
                          {...rowProps(exam)}
                          dragging={dragExamId === exam.examId}
                          onDragStart={(e) => { setDragExamId(exam.examId); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragOver={(e) => { if (dragExamId && dragExamId !== exam.examId) e.preventDefault(); }}
                          onDrop={(e) => { e.preventDefault(); handleDropOnExam(program.programId, exam.examId); }}
                        />
                      ))
                    )}
                    {/* Creating an exam for this program shows the form right
                        here, inside the program it'll belong to. */}
                    {formMode === 'new' && form.programId === program.programId && renderCreateForm()}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Ungrouped exams ── */}
          {ungroupedExams.length > 0 && (
            <>
              {programs.length > 0 && <div style={s.ungroupedLabel}>Ungrouped exams</div>}
              {ungroupedExams.map((exam) => <ExamRow key={exam.examId} {...rowProps(exam)} />)}
            </>
          )}

          {/* ── Create-exam form (general "+ New Exam", before a program is
              chosen — once a program is selected it moves into that program). ── */}
          {formMode === 'new' && !form.programId && renderCreateForm()}

          {/* ── Create-program form ── */}
          {programFormName !== null && (
            <div style={s.form}>
              <div>
                <span style={s.label}>Program name</span>
                <input
                  style={s.input}
                  autoFocus
                  value={programFormName}
                  placeholder="e.g. GA SAT 2026"
                  onChange={(e) => setProgramFormName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProgram(); }}
                />
                <div style={s.hint}>Group your diagnostics and tests under one cohort, then enroll students into it.</div>
              </div>
              <div style={s.formActions}>
                <button type="button" style={s.btnGhost} disabled={programSaving} onClick={() => setProgramFormName(null)}>Cancel</button>
                <button type="button" style={s.btn} disabled={programSaving || !programFormName.trim()} onClick={handleCreateProgram}>
                  {programSaving ? 'Creating…' : 'Create Program'}
                </button>
              </div>
            </div>
          )}

          {/* ── Action buttons ── */}
          {formMode === null && programFormName === null && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={s.btnGhost} onClick={() => openCreate('')}>+ New Exam</button>
              <button type="button" style={s.btn} onClick={() => setProgramFormName('')}>+ New Program</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
