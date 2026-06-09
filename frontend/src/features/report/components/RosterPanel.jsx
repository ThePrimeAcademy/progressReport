// features/report/components/RosterPanel.jsx
// Per-exam roster editor for UNGROUPED exams — pick the students taking this
// exam from the full student list. Exams that belong to a program inherit the
// program's roster instead (see ProgramRosterPanel), so this only shows for
// loose exams. Opens from the "N students" chip on the exam row.
import React, { useState } from 'react';
import { updateExam } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function RosterPanel({ exam, roster, onSaved, onError }) {
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
