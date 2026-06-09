// features/report/components/ProgramRosterPanel.jsx
// Program-level roster editor. The program owns the roster for every exam
// inside it — enrolling a student here makes all the program's exams appear in
// their SAT report; removing them hides those exams. Opens from the "N
// enrolled" chip on the program header.
import React, { useState } from 'react';
import { updateProgram } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function ProgramRosterPanel({ program, roster, onSaved, onError }) {
  const [selected, setSelected] = useState(() => new Set(program.studentIds || []));
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
      await updateProgram(program.programId, { studentIds: Array.from(selected) });
      onSaved?.();
    } catch (err) {
      onError?.(err.message || 'Failed to save enrolled students');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.hiddenPanel}>
      <div style={s.hiddenTitle}>
        Enrolled in {program.name} — {selected.size} student{selected.size === 1 ? '' : 's'} · they see every exam in this program
      </div>
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
          {saving ? 'Saving…' : 'Save Enrollment'}
        </button>
      </div>
    </div>
  );
}
