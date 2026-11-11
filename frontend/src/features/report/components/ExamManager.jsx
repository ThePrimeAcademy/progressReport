// features/report/components/ExamManager.jsx
//
// The Programs tab: SAT exams grouped by program. A program (e.g. a summer
// program "GA SAT 2026") owns the student roster for every exam inside it -
// enrolling a student makes all of that program's exams appear in their SAT
// report; students not in the program never see them. Exams can also stay
// ungrouped (visible to anyone who took them, rostered individually).
//
// This component is the orchestrator: it loads exams, tests, students and
// programs, then renders each program with its exams nested underneath, the
// loose ungrouped exams below, and the create-exam / create-program forms.
// Each exam row carries its English and Math scoring-sheet pickers, so a whole
// program can be categorised from this one list.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  programSummaryUrl,
} from '../api/reportApi.js';
import ExamRow, { SECTION_DEFS } from './ExamRow.jsx';
import ProgramRosterPanel from './ProgramRosterPanel.jsx';
import { LEVELS, LEVEL_LABEL, SUBJECTS } from '../scoring.js';
import s from './examManagerStyles.js';

const EMPTY_FORM = { name: '', date: '', programId: '', sections: { 1: '', 2: '', 3: '', 4: '' }, studentIds: [], difficulty: { rw: '', math: '' } };

// Which programs are expanded survives switching tabs (and a page refresh),
// so stepping over to Scoring Sheets and back does not lose your place.
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

export default function ExamManager({ onExamsChanged, onOpenSheets }) {
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
  const [dragExamId, setDragExamId] = useState(null); // exam being dragged (for styling)
  // The dragged id mirrored in a ref so dragover/drop guards read it
  // synchronously — state hasn't committed yet within a fast drag gesture.
  const dragIdRef = useRef(null);
  const dragMovedRef = useRef(false); // did the live preview actually reorder?
  const dragOrderRef = useRef(null); // { programId, ids } settled by the preview
  // Inline program rename: which program's name is being edited, and its draft.
  const [editingProgramId, setEditingProgramId] = useState(null);
  const [programNameDraft, setProgramNameDraft] = useState('');
  // Which programs are expanded to show their exams. Collapsed by default so
  // the list stays compact - click a program to reveal its exams.
  const [openPrograms, setOpenPrograms] = useState(loadOpenPrograms);

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

  useEffect(() => { refresh(); }, [refresh]);

  const refreshAndNotify = useCallback(async () => {
    await refresh();
    onExamsChanged?.();
  }, [refresh, onExamsChanged]);

  // After a scoring-sheet change only the exam list is stale - skip re-reading
  // tests, students and programs so the pickers stay quick.
  const refreshExams = useCallback(async () => {
    try {
      setExams(await fetchExams());
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load exams');
    }
  }, [onExamsChanged]);

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

  // Tests available for a section slot of the CREATE form: not already chosen
  // in a different slot of this exam. A test may be reused across exams.
  const optionsForSection = useCallback((sectionKey) => {
    const chosenElsewhere = new Set(
      Object.entries(form.sections)
        .filter(([k, v]) => k !== sectionKey && v)
        .map(([, v]) => v)
    );
    return tests.filter((t) => {
      if (!inGroup(t, groupFilter)) return false;
      if (chosenElsewhere.has(t.testId)) return false;
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
        // The program owns the roster - exams never carry their own.
        studentIds: [],
        difficulty: { rw: form.difficulty.rw || null, math: form.difficulty.math || null },
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

  // Inline rename — click the name to edit in place (no prompt). Enter/blur
  // saves, Esc cancels.
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
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to rename program');
    }
  }

  // Archive ("it's over") / unarchive a program. Archiving keeps all data but
  // pulls the program's exams out of every student's SAT report until restored.
  async function handleArchiveProgram(program) {
    setError(null);
    try {
      await updateProgram(program.programId, { archived: !program.archived });
      await refreshAndNotify();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update program');
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

  // Drag-to-reorder with a LIVE preview. The authoritative order lives in
  // dragOrderRef and is updated synchronously on every dragover — independent of
  // React's batched state, so persistOrder always reads the settled order even
  // when drop fires in the same tick. setExams only mirrors it for the visuals.
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

  // Reorder a program's exams in local state to match the given id order, leaving
  // every other program untouched.
  function applyOrder(programId, ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    setExams((prev) => {
      const inProgram = prev
        .filter((e) => e.programId === programId)
        .sort((a, b) => pos.get(a.examId) - pos.get(b.examId));
      let i = 0;
      return prev.map((e) => (e.programId === programId ? inProgram[i++] : e));
    });
  }

  // Fires on both drop and dragend (whichever the browser delivers); guarded by
  // the ref so it persists exactly once and skips clicks / no-op drags.
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
    onExamsChanged: refreshExams,
    onOpenSheets,
    onError: setError,
  });

  const gaps = useMemo(() => scoringGaps(exams, programs), [exams, programs]);

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
            <div style={s.hint}>Create the exam ahead of time - sections below can stay empty until the tests exist.</div>
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
            <option value="">{programs.length ? 'Select a program…' : 'No programs yet - create one first'}</option>
            {programs.map((p) => <option key={p.programId} value={p.programId}>{p.name}</option>)}
          </select>
          <div style={s.hint}>
            Every exam belongs to a program - only its enrolled students are part of the exam, and they see it automatically.
          </div>
        </div>

        <div>
          <span style={s.label}>Filter tests by group</span>
          <select style={s.select} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div style={s.hint}>Narrows the section dropdowns below to the chosen group.</div>
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
                <option value="">- none -</option>
                {optionsForSection(key).map((t) => (
                  <option key={t.testId} value={t.testId}>
                    {t.testName} ({t.attempts} attempt{t.attempts === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div style={s.grid2}>
          {SUBJECTS.map((subject) => (
            <div key={subject.key}>
              <span style={s.label}>{subject.label} scoring sheet <span style={{ fontWeight: 400 }}>· optional</span></span>
              <select
                style={s.select}
                value={form.difficulty[subject.key]}
                onChange={(e) => setForm((f) => ({ ...f, difficulty: { ...f.difficulty, [subject.key]: e.target.value } }))}
              >
                <option value="">Choose later</option>
                {LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABEL[level]}</option>)}
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
      <div style={s.head}>
        <div style={s.dot} />
        <span style={s.title}>Programs</span>
        {programs.length > 0 && <span style={s.count}>{programs.length} program{programs.length === 1 ? '' : 's'}</span>}
        {exams.length > 0 && <span style={s.count}>· {exams.length} exam{exams.length === 1 ? '' : 's'}</span>}
        <button
          type="button"
          style={{ ...s.btn, marginLeft: 6 }}
          disabled={programFormName !== null}
          onClick={() => setProgramFormName('')}
        >
          + New Program
        </button>
      </div>

      <div style={s.body}>
        {error && <div style={s.error}>⚠ {error}</div>}

        {gaps.waiting > 0 && (
          <div style={s.notice} role="status">
            <span>
              ⚠ {gaps.waiting} exam{gaps.waiting === 1 ? ' is' : 's are'} set to a scoring sheet that has not been added yet
              ({gaps.missing.join(', ')}). Students see raw scores only for {gaps.waiting === 1 ? 'it' : 'those'}.
            </span>
            <button type="button" style={s.noticeAction} onClick={onOpenSheets}>Open Scoring Sheets</button>
          </div>
        )}
        {gaps.uncategorised > 0 && (
          <div style={s.notice} role="status">
            {gaps.uncategorised === 1
              ? '1 exam with tests assigned has no scoring sheet chosen yet, so its scores show as raw.'
              : `${gaps.uncategorised} exams with tests assigned have no scoring sheet chosen yet, so their scores show as raw.`}
            {' '}Pick Easy, Medium or Hard for English and Math on each one.
          </div>
        )}

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
            <div key={program.programId} style={{ ...s.programCard, ...(program.archived ? { opacity: 0.6, borderColor: '#fcd34d' } : {}) }}>
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
                {editingProgramId === program.programId ? (
                  <input
                    autoFocus
                    value={programNameDraft}
                    onClick={stop}
                    onChange={(e) => setProgramNameDraft(e.target.value)}
                    onBlur={() => commitRenameProgram(program)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRenameProgram(program);
                      if (e.key === 'Escape') setEditingProgramId(null);
                    }}
                    style={{ ...s.input, flex: 1, padding: '4px 8px', fontSize: '0.9rem', fontWeight: 700 }}
                  />
                ) : (
                  <span
                    style={{ ...s.programName, cursor: 'text' }}
                    onClick={(e) => { stop(e); startRenameProgram(program); }}
                    title="Click to rename this program"
                  >
                    {program.name}
                  </span>
                )}
                <span style={s.count}>{members.length} exam{members.length === 1 ? '' : 's'}</span>
                {program.archived && <span style={s.archivedBadge} title="This program's exams are hidden from student SAT reports">Archived</span>}
                <span
                  style={{ ...s.rosterChip, cursor: 'pointer' }}
                  onClick={(e) => { stop(e); setRosterOpenFor((cur) => (cur === program.programId ? null : program.programId)); }}
                  title="Click to enroll students - they'll see every exam in this program"
                >
                  {count} enrolled
                </span>
                <button type="button" style={s.btnGhost} onClick={(e) => { stop(e); openCreate(program.programId); }}>+ Exam</button>
                <button
                  type="button"
                  style={s.btnGhost}
                  onClick={(e) => { stop(e); window.open(programSummaryUrl(program.programId), '_blank', 'noopener'); }}
                  title="Open the cohort summary report - overall improvement and per-student performance"
                >
                  Summary
                </button>
                <button
                  type="button"
                  style={s.btnGhost}
                  onClick={(e) => { stop(e); handleArchiveProgram(program); }}
                  title={program.archived
                    ? 'Bring this program’s exams back into student SAT reports'
                    : 'Hide this finished program’s exams from student SAT reports (keeps all data)'}
                >
                  {program.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button type="button" style={s.btnDanger} onClick={(e) => { stop(e); handleDeleteProgram(program); }}>Delete</button>
              </div>
              {/* Enrollment opens independently of expand so you can roster a
                  collapsed program. */}
              {rosterOpenFor === program.programId && (
                <ProgramRosterPanel
                  program={program}
                  roster={roster}
                  exams={exams}
                  tests={tests}
                  onError={setError}
                  onSaved={async () => { setRosterOpenFor(null); await refreshAndNotify(); }}
                />
              )}
              {expanded && (
                <div style={s.programBody}>
                  {members.length > 0 && (
                    <div className="exam-grid exam-grid-header" style={s.examColumns} aria-hidden="true">
                      <span />
                      <span />
                      <span>Exam</span>
                      <span>Date</span>
                      <span>English sheet</span>
                      <span>Math sheet</span>
                      <span />
                    </div>
                  )}
                  {members.length === 0 ? (
                    <div style={s.programEmpty}>No exams in this program yet - use “+ Exam” to add one.</div>
                  ) : (
                    members.map((exam) => (
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

        {/* ── Create-exam form with no program picked (its Program field was
            cleared) - once a program is selected it moves into that program. ── */}
        {formMode === 'new' && !form.programId && renderCreateForm()}
      </div>
    </div>
  );
}
