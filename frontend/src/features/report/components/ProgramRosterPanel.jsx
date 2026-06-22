// features/report/components/ProgramRosterPanel.jsx
// Program-level roster editor. The program owns the roster for every exam
// inside it — enrolling a student here makes all the program's exams appear in
// their SAT report; removing them hides those exams. Opens from the "N
// enrolled" chip on the program header. "Pull takers" bulk-selects everyone
// who took a chosen exam so 100+-student cohorts don't need per-student clicks.
import React, { useState } from 'react';
import { updateProgram, fetchExamTakers } from '../api/reportApi.js';
import s from './examManagerStyles.js';

export default function ProgramRosterPanel({ program, roster, exams = [], tests = [], onSaved, onError }) {
  const [selected, setSelected] = useState(() => new Set(program.studentIds || []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [pullExamId, setPullExamId] = useState('');
  const [pullGroup, setPullGroup] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState(null);

  // Only this program's own exams can be a pull source — the roster is
  // program-scoped, so pulling takers from another program's exam would be
  // meaningless here.
  const programExams = exams.filter((e) => e.programId === program.programId);

  // ClassMarker groups linked to the chosen exam's tests — the same test can
  // be linked to several groups, so the pull can be narrowed to one cohort.
  const pullExam = programExams.find((e) => e.examId === pullExamId);
  const pullGroups = (() => {
    if (!pullExam) return [];
    const ids = new Set(Object.values(pullExam.sections || {}).filter(Boolean).map((sec) => String(sec.testId)));
    const names = new Set();
    for (const t of tests) {
      if (!ids.has(String(t.testId))) continue;
      for (const g of (t.groups || [])) if (g.groupName) names.add(g.groupName);
      if (t.groupName) names.add(t.groupName);
    }
    return [...names].sort();
  })();

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
      const takers = await fetchExamTakers(pullExamId, { all: true, group: pullGroup });
      const newOnes = takers.filter((t) => !selected.has(t.id));
      setSelected((prev) => new Set([...prev, ...takers.map((t) => t.id)]));
      const examName = exams.find((e) => e.examId === pullExamId)?.name || 'that exam';
      const scope = pullGroup ? `${examName} in ${pullGroup}` : examName;
      setPullNote(
        newOnes.length > 0
          ? `Added ${newOnes.length} student${newOnes.length === 1 ? '' : 's'} who took ${scope} — click Save Enrollment to keep.`
          : takers.length > 0
            ? `Everyone who took ${scope} is already selected.`
            : `No attempts found for ${scope}.`
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
          style={{ ...s.select, width: 'auto', flex: '0 1 220px', padding: '5px 28px 5px 10px' }}
          value={pullExamId}
          onChange={(e) => { setPullExamId(e.target.value); setPullGroup(''); setPullNote(null); }}
        >
          <option value="">Pull students from an exam…</option>
          {programExams.map((e) => (
            <option key={e.examId} value={e.examId}>{e.name}</option>
          ))}
        </select>
        {pullExamId && pullGroups.length > 0 && (
          <select
            style={{ ...s.select, width: 'auto', flex: '0 1 180px', padding: '5px 28px 5px 10px' }}
            value={pullGroup}
            onChange={(e) => { setPullGroup(e.target.value); setPullNote(null); }}
            title="Only count attempts made under this ClassMarker group"
          >
            <option value="">All groups</option>
            {pullGroups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
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
