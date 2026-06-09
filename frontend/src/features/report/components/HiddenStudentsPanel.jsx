// features/report/components/HiddenStudentsPanel.jsx
// Per-exam hidden-students editor: lists everyone who took the exam's tests;
// checked = hidden (their attempts are ignored when scoring this exam).
// Hidden exclusions stay per-exam even for program-grouped exams.
import React, { useEffect, useState } from 'react';
import { fetchExamTakers, updateExam } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function HiddenStudentsPanel({ exam, onSaved, onError }) {
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
