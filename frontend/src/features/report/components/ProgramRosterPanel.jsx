// features/report/components/ProgramRosterPanel.jsx
// Program-level roster editor. The program owns the roster for every exam
// inside it — enrolling a student here makes all the program's exams appear in
// their SAT report; removing them hides those exams. Opens from the "N
// enrolled" chip on the program header. "Pull takers" bulk-selects everyone
// who took a chosen exam so 100+-student cohorts don't need per-student clicks.
import React, { useState } from 'react';
import { updateProgram, fetchExamTakers } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function ProgramRosterPanel({ program, roster, exams = [], onSaved, onError }) {
  const [selected, setSelected] = useState(() => new Set(program.studentIds || []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [pullExamId, setPullExamId] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState(null);

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

  // Fetch everyone who took the chosen exam (unfiltered) and add them to the
  // selection. Nothing persists until Save Enrollment, so the admin can review.
  async function handlePullTakers() {
    if (!pullExamId) return;
    setPulling(true);
    setPullNote(null);
    try {
      const takers = await fetchExamTakers(pullExamId, { all: true });
      const newOnes = takers.filter((t) => !selected.has(t.id));
      setSelected((prev) => new Set([...prev, ...takers.map((t) => t.id)]));
      const examName = exams.find((e) => e.examId === pullExamId)?.name || 'that exam';
      setPullNote(
        newOnes.length > 0
          ? `Added ${newOnes.length} student${newOnes.length === 1 ? '' : 's'} who took ${examName} — click Save Enrollment to keep.`
          : takers.length > 0
            ? `Everyone who took ${examName} is already selected.`
            : `No attempts found for ${examName}.`
      );
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to pull exam takers');
    } finally {
      setPulling(false);
    }
  }

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          style={{ ...s.select, width: 'auto', flex: '0 1 240px', padding: '5px 28px 5px 10px' }}
          value={pullExamId}
          onChange={(e) => { setPullExamId(e.target.value); setPullNote(null); }}
        >
          <option value="">Pull students from an exam…</option>
          {exams.map((e) => (
            <option key={e.examId} value={e.examId}>{e.name}</option>
          ))}
        </select>
        <button
          type="button"
          style={s.btnGhost}
          disabled={!pullExamId || pulling}
          onClick={handlePullTakers}
          title="Select everyone with an attempt on this exam's tests"
        >
          {pulling ? 'Pulling…' : 'Add all takers'}
        </button>
        {pullNote && <span style={{ ...s.hint, color: '#15803d' }}>{pullNote}</span>}
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
