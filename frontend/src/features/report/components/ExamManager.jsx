// features/report/components/ExamManager.jsx
//
// Admin panel for SAT exams: pick the ClassMarker tests that make up an exam,
// assign each to a DSAT section (1-2 = Reading & Writing, 3-4 = Math), and
// upload the exam's scoring sheets. Replaces the old assumption that a group
// holds exactly one exam named "Section N: …".
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchExams,
  fetchAvailableTests,
  fetchExamTakers,
  fetchExamScoreboard,
  fetchStudents,
  createExam,
  updateExam,
  duplicateExam,
  deleteExam,
} from '../api/reportApi.js';
import ScoringSheetUpload from './ScoringSheetUpload.jsx';

const SECTION_DEFS = [
  { key: '1', label: 'Section 1', hint: 'Reading & Writing · Module 1' },
  { key: '2', label: 'Section 2', hint: 'Reading & Writing · Module 2' },
  { key: '3', label: 'Section 3', hint: 'Math · Module 1' },
  { key: '4', label: 'Section 4', hint: 'Math · Module 2' },
];

const s = {
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden', marginTop: 24 },
  head: { padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' },
  dot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  title: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', flex: 1 },
  count: { fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 500 },
  chevron: { fontSize: '0.8rem', color: 'var(--muted)' },
  body: { borderTop: '1px solid var(--border)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  examRow: { border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  examHead: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fafbff' },
  examName: { fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink)', flex: 1 },
  sectionList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, padding: '12px 16px' },
  sectionChip: { fontSize: '0.74rem', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: '#fff' },
  sectionLabel: { fontWeight: 700, fontSize: '0.66rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 3 },
  sectionEmpty: { color: 'var(--muted)', fontStyle: 'italic' },
  btn: { appearance: 'none', border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 },
  btnGhost: { appearance: 'none', border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 500 },
  btnDanger: { appearance: 'none', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 500 },
  form: { border: '1.5px dashed var(--border)', borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fafbff' },
  label: { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4, display: 'block' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: '0.85rem', fontFamily: 'inherit' },
  select: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: '0.8rem', background: '#fff', fontFamily: 'inherit' },
  hint: { fontSize: '0.68rem', color: 'var(--muted)', marginTop: 2 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  formActions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  error: { padding: '10px 14px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: '0.8rem' },
  empty: { fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center', padding: '12px 0' },
  hiddenPanel: { borderTop: '1px dashed var(--border)', background: '#fafbff', padding: '12px 16px' },
  hiddenTitle: { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 },
  hiddenList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 10 },
  hiddenRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.8rem', padding: '3px 4px', borderRadius: 6, cursor: 'pointer' },
  hiddenRowOn: { background: '#fff1f2', color: '#b91c1c', textDecoration: 'line-through' },
  hiddenBadge: { fontSize: '0.68rem', fontWeight: 700, color: '#b91c1c', background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 999, padding: '2px 8px' },
  dateChip: { fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' },
  rosterChip: { fontSize: '0.68rem', fontWeight: 600, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' },
  searchInput: { width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: 8 },
};

// Ranked results for one exam — name, RW, Math, Total, newest attempt date.
function ScoreboardPanel({ exam, onError }) {
  const [board, setBoard] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    fetchExamScoreboard(exam.examId)
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((err) => { if (!cancelled) { setBoard({ rows: [] }); onError?.(err.message || 'Failed to load scoreboard'); } });
    return () => { cancelled = true; };
  }, [exam.examId, onError]);

  const cell = { padding: '6px 12px', fontSize: '0.8rem' };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const header = { ...cell, fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', textAlign: 'left', background: '#f1f5ff' };
  const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);
  const fmt = (scaled, raw) => (scaled != null ? scaled : raw != null ? `${raw} raw` : '—');

  return (
    <div style={s.hiddenPanel}>
      <div style={s.hiddenTitle}>
        Scoreboard{board?.date ? ` · ${board.date}` : ''}
        {board && !(board.hasRwCurve && board.hasMathCurve) && (
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {' '}— upload {!board.hasRwCurve && !board.hasMathCurve ? 'the RW and Math sheets' : !board.hasRwCurve ? 'the RW sheet' : 'the Math sheet'} for scaled scores
          </span>
        )}
      </div>
      {board === null ? (
        <div style={s.empty}>Loading scoreboard…</div>
      ) : board.rows.length === 0 ? (
        <div style={s.empty}>No results yet for this exam's tests.</div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...header, width: 40 }}>#</th>
                <th style={header}>Student</th>
                <th style={{ ...header, textAlign: 'right' }}>RW</th>
                <th style={{ ...header, textAlign: 'right' }}>Math</th>
                <th style={{ ...header, textAlign: 'right' }}>Total</th>
                <th style={{ ...header, textAlign: 'right' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row, i) => (
                <tr key={row.studentId} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? '#fafbff' : '#fff' }}>
                  <td style={{ ...cell, color: 'var(--muted)' }}>{medal(i + 1)}</td>
                  <td style={{ ...cell, fontWeight: 500 }}>{row.name}</td>
                  <td style={num}>{fmt(row.rwScaled, row.rwRaw)}</td>
                  <td style={num}>{fmt(row.mathScaled, row.mathRaw)}</td>
                  <td style={{ ...num, fontWeight: 700, color: row.total != null ? 'var(--accent)' : 'var(--muted)' }}>
                    {row.total ?? '—'}
                  </td>
                  <td style={{ ...num, color: 'var(--muted)', fontSize: '0.72rem' }}>{row.date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Per-exam roster editor — pick the students taking this exam from the full
// student list. Opens from the "N students" chip on the exam row.
function RosterPanel({ exam, roster, onSaved, onError }) {
  const [selected, setSelected] = useState(() => new Set(exam.studentIds || []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = roster.filter(
    (st) => !search || st.name.toLowerCase().includes(search.toLowerCase())
  );

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
    try {
      await updateExam(exam.examId, { studentIds: Array.from(selected) });
      onSaved?.();
    } catch (err) {
      onError?.(err.message || 'Failed to save students');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.hiddenPanel}>
      <div style={s.hiddenTitle}>Students taking this exam — {selected.size} selected</div>
      <input
        style={s.searchInput}
        value={search}
        placeholder="Search students…"
        onChange={(e) => setSearch(e.target.value)}
      />
      <div style={s.hiddenList}>
        {filtered.map((st) => (
          <label key={st.id} style={s.hiddenRow}>
            <input type="checkbox" checked={selected.has(st.id)} onChange={() => toggle(st.id)} />
            {st.name}
          </label>
        ))}
        {filtered.length === 0 && <span style={{ ...s.hint, gridColumn: '1 / -1' }}>No students match.</span>}
      </div>
      <div style={s.formActions}>
        <button type="button" style={s.btn} disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Students'}
        </button>
      </div>
    </div>
  );
}

// Per-exam hidden-students editor: lists everyone who took the exam's tests;
// checked = hidden (their attempts are ignored when scoring this exam).
function HiddenStudentsPanel({ exam, onSaved, onError }) {
  const [takers, setTakers] = useState(null); // null = loading
  const [hidden, setHidden] = useState(new Set(exam.hiddenStudentIds || []));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchExamTakers(exam.examId)
      .then((list) => { if (!cancelled) setTakers(list); })
      .catch((err) => { if (!cancelled) { setTakers([]); onError?.(err.message || 'Failed to load students'); } });
    return () => { cancelled = true; };
  }, [exam.examId, onError]);

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
    try {
      await updateExam(exam.examId, { hiddenStudentIds: Array.from(hidden) });
      onSaved?.();
    } catch (err) {
      onError?.(err.message || 'Failed to save hidden students');
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    hidden.size !== (exam.hiddenStudentIds || []).length ||
    (exam.hiddenStudentIds || []).some((id) => !hidden.has(id));

  return (
    <div style={s.hiddenPanel}>
      <div style={s.hiddenTitle}>Hide students — checked students' attempts don't count for this exam</div>
      {takers === null ? (
        <div style={s.empty}>Loading students…</div>
      ) : takers.length === 0 ? (
        <div style={s.empty}>No one has taken this exam's tests yet.</div>
      ) : (
        <>
          <div style={s.hiddenList}>
            {takers.map((t) => (
              <label key={t.id} style={{ ...s.hiddenRow, ...(hidden.has(t.id) ? s.hiddenRowOn : {}) }}>
                <input
                  type="checkbox"
                  checked={hidden.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
          <div style={s.formActions}>
            <button type="button" style={s.btn} disabled={saving || !dirty} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Hidden Students'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const EMPTY_FORM = { name: '', date: '', sections: { 1: '', 2: '', 3: '', 4: '' }, studentIds: [] };

export default function ExamManager({ onExamsChanged }) {
  const [open, setOpen] = useState(false);
  const [exams, setExams] = useState([]);
  const [tests, setTests] = useState([]);
  const [roster, setRoster] = useState([]); // full student list for the planning picker
  const [studentSearch, setStudentSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // null = closed, 'new' = creating, otherwise the examId being edited.
  const [formMode, setFormMode] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [groupFilter, setGroupFilter] = useState('');
  const [saving, setSaving] = useState(false);
  // examId whose hidden-students panel is expanded (one at a time).
  const [studentsOpenFor, setStudentsOpenFor] = useState(null);
  // examId whose scoreboard is expanded (one at a time).
  const [scoreboardOpenFor, setScoreboardOpenFor] = useState(null);
  // examId whose roster panel is expanded (one at a time).
  const [rosterOpenFor, setRosterOpenFor] = useState(null);
  // { examId, key } of the section chip currently showing its inline select.
  const [sectionEditing, setSectionEditing] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [examList, testList, students] = await Promise.all([
        fetchExams(),
        fetchAvailableTests(),
        fetchStudents().catch(() => []),
      ]);
      setExams(examList);
      setTests(testList);
      setRoster(students || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load exams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // A test can be linked to several ClassMarker groups — offer every group
  // any test appears under, and match the filter against all of them.
  const groups = useMemo(() => {
    const seen = new Set();
    for (const t of tests) {
      for (const g of t.groups || []) {
        if (g.groupName) seen.add(g.groupName);
      }
      if (t.groupName) seen.add(t.groupName);
    }
    return Array.from(seen).sort();
  }, [tests]);

  const inGroup = useCallback((t, groupName) => {
    if (!groupName) return true;
    if ((t.groups || []).some((g) => g.groupName === groupName)) return true;
    return t.groupName === groupName;
  }, []);

  // Tests available for a given section slot of the CREATE form: not assigned
  // to another exam and not already chosen in a different slot.
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

  function openCreate() {
    setForm(EMPTY_FORM);
    setGroupFilter('');
    setStudentSearch('');
    setFormMode('new');
  }

  const toggleStudent = (id) => {
    setForm((f) => ({
      ...f,
      studentIds: f.studentIds.includes(id)
        ? f.studentIds.filter((x) => x !== id)
        : [...f.studentIds, id],
    }));
  };

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
      await createExam({ name: form.name, date: form.date, sections, studentIds: form.studentIds });
      setFormMode(null);
      await refresh();
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save exam');
    } finally {
      setSaving(false);
    }
  }

  // ── Inline click-to-edit (no edit form): every element on an exam row
  // saves itself — title and date via prompt, section chips via an inline
  // select, roster via its panel.
  async function patchExam(examId, patch) {
    setError(null);
    try {
      await updateExam(examId, patch);
      await refresh();
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update exam');
    }
  }

  function renameExam(exam) {
    // eslint-disable-next-line no-alert
    const name = window.prompt('Exam name', exam.name);
    if (name == null || !name.trim() || name.trim() === exam.name) return;
    patchExam(exam.examId, { name: name.trim() });
  }

  function changeDate(exam) {
    // eslint-disable-next-line no-alert
    const date = window.prompt('Exam date (YYYY-MM-DD — leave empty to clear)', exam.date || '');
    if (date == null || date.trim() === (exam.date || '')) return;
    patchExam(exam.examId, { date: date.trim() });
  }

  // Options for one exam's section chip: unassigned tests + the exam's own.
  function sectionOptions(exam, sectionKey) {
    const usedElsewhereInExam = new Set(
      SECTION_DEFS.filter((d) => d.key !== sectionKey)
        .map((d) => exam.sections?.[d.key]?.testId)
        .filter(Boolean)
    );
    return tests.filter((t) => {
      if (usedElsewhereInExam.has(t.testId)) return false;
      if (t.assignedToExamId && t.assignedToExamId !== exam.examId) return false;
      return true;
    });
  }

  function setSection(exam, sectionKey, testId) {
    const sections = {};
    for (const d of SECTION_DEFS) {
      const cur = exam.sections?.[d.key];
      sections[d.key] = cur ? { testId: cur.testId, testName: cur.testName } : null;
    }
    const test = tests.find((t) => t.testId === testId);
    sections[sectionKey] = testId ? { testId, testName: test?.testName || null } : null;
    setSectionEditing(null);
    patchExam(exam.examId, { sections });
  }

  async function handleDuplicate(exam) {
    setError(null);
    try {
      await duplicateExam(exam.examId);
      await refresh();
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to duplicate exam');
    }
  }

  async function handleDelete(exam) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete exam "${exam.name}" and its scoring sheets?`)) return;
    setError(null);
    try {
      await deleteExam(exam.examId);
      await refresh();
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete exam');
    }
  }

  // Placeholders are allowed: name is the only requirement; tests, date and
  // students can all come later via Edit.
  const formValid = Boolean(form.name.trim());

  const rosterFiltered = roster.filter(
    (st) => !studentSearch || st.name.toLowerCase().includes(studentSearch.toLowerCase())
  );

  return (
    <div style={s.card}>
      <div
        style={s.head}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <div style={s.dot} />
        <span style={s.title}>SAT Exams</span>
        {exams.length > 0 && <span style={s.count}>{exams.length} exam{exams.length === 1 ? '' : 's'}</span>}
        <span style={s.chevron}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={s.body}>
          {error && <div style={s.error}>⚠ {error}</div>}

          {loading && exams.length === 0 ? (
            <div style={s.empty}>Loading…</div>
          ) : exams.length === 0 && formMode === null ? (
            <div style={s.empty}>
              No exams defined yet. Create one to map tests onto SAT sections and upload its scoring sheets.
            </div>
          ) : (
            exams.map((exam) => (
              <div key={exam.examId} style={s.examRow}>
                <div style={s.examHead}>
                  <span
                    style={{ ...s.examName, cursor: 'pointer' }}
                    onClick={() => renameExam(exam)}
                    title="Click to rename"
                  >
                    {exam.name}
                  </span>
                  <span
                    style={{ ...s.dateChip, cursor: 'pointer' }}
                    onClick={() => changeDate(exam)}
                    title="Click to change the exam date"
                  >
                    {exam.date || 'set date'}
                  </span>
                  <span
                    style={{ ...s.rosterChip, cursor: 'pointer' }}
                    onClick={() => setRosterOpenFor((cur) => (cur === exam.examId ? null : exam.examId))}
                    title="Click to pick the students taking this exam"
                  >
                    {(exam.studentIds || []).length} student{(exam.studentIds || []).length === 1 ? '' : 's'}
                  </span>
                  {(exam.hiddenStudentIds || []).length > 0 && (
                    <span style={s.hiddenBadge}>{exam.hiddenStudentIds.length} hidden</span>
                  )}
                  <button
                    type="button"
                    style={s.btnGhost}
                    onClick={() => setScoreboardOpenFor((cur) => (cur === exam.examId ? null : exam.examId))}
                  >
                    {scoreboardOpenFor === exam.examId ? 'Close Scoreboard' : 'Scoreboard'}
                  </button>
                  <button
                    type="button"
                    style={s.btnGhost}
                    onClick={() => setStudentsOpenFor((cur) => (cur === exam.examId ? null : exam.examId))}
                  >
                    {studentsOpenFor === exam.examId ? 'Close Hidden' : 'Hidden'}
                  </button>
                  <button type="button" style={s.btnGhost} onClick={() => handleDuplicate(exam)} title="New exam with the same students — set its own date and tests">Duplicate</button>
                  <button type="button" style={s.btnDanger} onClick={() => handleDelete(exam)}>Delete</button>
                </div>
                <div style={s.sectionList}>
                  {SECTION_DEFS.map(({ key, label, hint }) => {
                    const assigned = exam.sections?.[key];
                    const editing = sectionEditing?.examId === exam.examId && sectionEditing?.key === key;
                    return (
                      <div
                        key={key}
                        style={{ ...s.sectionChip, cursor: 'pointer' }}
                        onClick={() => !editing && setSectionEditing({ examId: exam.examId, key })}
                        title="Click to change this section's test"
                      >
                        <span style={s.sectionLabel}>{label} · {hint}</span>
                        {editing ? (
                          <select
                            style={s.select}
                            autoFocus
                            value={assigned?.testId || ''}
                            onChange={(e) => setSection(exam, key, e.target.value)}
                            onBlur={() => setSectionEditing(null)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— none —</option>
                            {sectionOptions(exam, key).map((t) => (
                              <option key={t.testId} value={t.testId}>
                                {t.testName} ({t.attempts} attempt{t.attempts === 1 ? '' : 's'})
                              </option>
                            ))}
                          </select>
                        ) : assigned
                          ? <span>{assigned.testName || `Test #${assigned.testId}`}</span>
                          : <span style={s.sectionEmpty}>not assigned</span>}
                      </div>
                    );
                  })}
                </div>
                {rosterOpenFor === exam.examId && (
                  <RosterPanel
                    exam={exam}
                    roster={roster}
                    onError={setError}
                    onSaved={async () => {
                      setRosterOpenFor(null);
                      await refresh();
                      onExamsChanged?.();
                    }}
                  />
                )}
                {scoreboardOpenFor === exam.examId && (
                  <ScoreboardPanel exam={exam} onError={setError} />
                )}
                {studentsOpenFor === exam.examId && (
                  <HiddenStudentsPanel
                    exam={exam}
                    onError={setError}
                    onSaved={async () => {
                      setStudentsOpenFor(null);
                      await refresh();
                      onExamsChanged?.();
                    }}
                  />
                )}
                <ScoringSheetUpload
                  groupId={exam.curveKey}
                  sheets={exam.sheets}
                  onChanged={async () => { await refresh(); onExamsChanged?.(); }}
                />
              </div>
            ))
          )}

          {formMode !== null ? (
            <div style={s.form}>
              <div style={s.grid2}>
                <div>
                  <span style={s.label}>Exam name</span>
                  <input
                    style={s.input}
                    value={form.name}
                    placeholder="e.g. DSATEN 2025 3B"
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

              <div>
                <span style={s.label}>
                  Students taking this exam
                  <span style={{ fontWeight: 400 }}> · optional · {form.studentIds.length} selected</span>
                </span>
                <input
                  style={s.searchInput}
                  value={studentSearch}
                  placeholder="Search students…"
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <div style={s.hiddenList}>
                  {rosterFiltered.map((st) => (
                    <label key={st.id} style={s.hiddenRow}>
                      <input
                        type="checkbox"
                        checked={form.studentIds.includes(st.id)}
                        onChange={() => toggleStudent(st.id)}
                      />
                      {st.name}
                    </label>
                  ))}
                  {rosterFiltered.length === 0 && (
                    <span style={{ ...s.hint, gridColumn: '1 / -1' }}>No students match.</span>
                  )}
                </div>
              </div>

              <div style={s.formActions}>
                <button type="button" style={s.btnGhost} disabled={saving} onClick={() => setFormMode(null)}>Cancel</button>
                <button type="button" style={s.btn} disabled={saving || !formValid} onClick={handleSave}>
                  {saving ? 'Saving…' : 'Create Exam'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'right' }}>
              <button type="button" style={s.btn} onClick={openCreate}>+ New Exam</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
