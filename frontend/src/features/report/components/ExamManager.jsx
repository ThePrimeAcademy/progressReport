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
  createExam,
  updateExam,
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
};

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

const EMPTY_FORM = { name: '', sections: { 1: '', 2: '', 3: '', 4: '' } };

export default function ExamManager({ onExamsChanged }) {
  const [open, setOpen] = useState(false);
  const [exams, setExams] = useState([]);
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // null = closed, 'new' = creating, otherwise the examId being edited.
  const [formMode, setFormMode] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [groupFilter, setGroupFilter] = useState('');
  const [saving, setSaving] = useState(false);
  // examId whose hidden-students panel is expanded (one at a time).
  const [studentsOpenFor, setStudentsOpenFor] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [examList, testList] = await Promise.all([fetchExams(), fetchAvailableTests()]);
      setExams(examList);
      setTests(testList);
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

  const editingExamId = formMode && formMode !== 'new' ? formMode : null;

  // Tests available for a given section slot: not assigned to another exam and
  // not already chosen in a different slot of this form.
  const optionsForSection = useCallback((sectionKey) => {
    const chosenElsewhere = new Set(
      Object.entries(form.sections)
        .filter(([k, v]) => k !== sectionKey && v)
        .map(([, v]) => v)
    );
    return tests.filter((t) => {
      if (!inGroup(t, groupFilter)) return false;
      if (chosenElsewhere.has(t.testId)) return false;
      if (t.assignedToExamId && t.assignedToExamId !== editingExamId) return false;
      return true;
    });
  }, [tests, form.sections, groupFilter, editingExamId, inGroup]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setGroupFilter('');
    setFormMode('new');
  }

  function openEdit(exam) {
    setForm({
      name: exam.name,
      sections: {
        1: exam.sections?.['1']?.testId || '',
        2: exam.sections?.['2']?.testId || '',
        3: exam.sections?.['3']?.testId || '',
        4: exam.sections?.['4']?.testId || '',
      },
    });
    setGroupFilter('');
    setFormMode(exam.examId);
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
      if (formMode === 'new') {
        await createExam({ name: form.name, sections });
      } else {
        await updateExam(formMode, { name: form.name, sections });
      }
      setFormMode(null);
      await refresh();
      onExamsChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save exam');
    } finally {
      setSaving(false);
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

  const formValid = form.name.trim() && Object.values(form.sections).some(Boolean);

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
                  <span style={s.examName}>{exam.name}</span>
                  {(exam.hiddenStudentIds || []).length > 0 && (
                    <span style={s.hiddenBadge}>{exam.hiddenStudentIds.length} hidden</span>
                  )}
                  <button
                    type="button"
                    style={s.btnGhost}
                    onClick={() => setStudentsOpenFor((cur) => (cur === exam.examId ? null : exam.examId))}
                  >
                    {studentsOpenFor === exam.examId ? 'Close Students' : 'Students'}
                  </button>
                  <button type="button" style={s.btnGhost} onClick={() => openEdit(exam)}>Edit</button>
                  <button type="button" style={s.btnDanger} onClick={() => handleDelete(exam)}>Delete</button>
                </div>
                <div style={s.sectionList}>
                  {SECTION_DEFS.map(({ key, label, hint }) => {
                    const assigned = exam.sections?.[key];
                    return (
                      <div key={key} style={s.sectionChip}>
                        <span style={s.sectionLabel}>{label} · {hint}</span>
                        {assigned
                          ? <span>{assigned.testName || `Test #${assigned.testId}`}</span>
                          : <span style={s.sectionEmpty}>not assigned</span>}
                      </div>
                    );
                  })}
                </div>
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
                  {saving ? 'Saving…' : formMode === 'new' ? 'Create Exam' : 'Save Changes'}
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
