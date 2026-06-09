// features/report/components/ExamRow.jsx
// One SAT exam. Collapsible (configured exams collapse to a one-line header to
// save space; brand-new/unconfigured ones open expanded so you can set them up
// without scrolling). Inline-editable name, the four DSAT section chips
// (browse group → pick test), a "move to program" selector, a drag handle to
// reorder within the program, and the scoreboard / hidden-students panels plus
// scoring-sheet upload. Self-contained — saves each edit through the API, then
// calls onChanged() so the parent re-fetches.
import React, { useCallback, useState } from 'react';
import { updateExam, duplicateExam, deleteExam } from '../api/reportApi.js';
import ScoringSheetUpload from './ScoringSheetUpload.jsx';
import ScoreboardPanel from './ScoreboardPanel.jsx';
import RosterPanel from './RosterPanel.jsx';
import HiddenStudentsPanel from './HiddenStudentsPanel.jsx';
import s from './examManagerStyles.js';

export const SECTION_DEFS = [
  { key: '1', label: 'Section 1', hint: 'Reading & Writing · Module 1' },
  { key: '2', label: 'Section 2', hint: 'Reading & Writing · Module 2' },
  { key: '3', label: 'Section 3', hint: 'Math · Module 1' },
  { key: '4', label: 'Section 4', hint: 'Math · Module 2' },
];

export default function ExamRow({
  exam, tests, roster, programs, onChanged, onError,
  onDragStart, onDragOver, onDrop, dragging,
}) {
  const assignedCount = SECTION_DEFS.filter((d) => exam.sections?.[d.key]?.testId).length;
  // Unconfigured exams (no tests yet) open expanded so a freshly created one is
  // ready to edit; configured ones start collapsed.
  const [expanded, setExpanded] = useState(assignedCount === 0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(exam.name);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // { key, group } of the section chip currently showing its inline select.
  const [sectionEditing, setSectionEditing] = useState(null);

  const grouped = Boolean(exam.programId);
  const stop = (e) => e.stopPropagation();

  const inGroup = useCallback((t, groupName) => {
    if (!groupName) return true;
    if ((t.groups || []).some((g) => g.groupName === groupName)) return true;
    return t.groupName === groupName;
  }, []);

  async function patchExam(patch) {
    onError?.(null);
    try {
      await updateExam(exam.examId, patch);
      await onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to update exam');
    }
  }

  // Inline name edit (no prompt) — Enter/blur saves, Esc cancels.
  function commitName() {
    setEditingName(false);
    const v = nameDraft.trim();
    if (!v || v === exam.name) { setNameDraft(exam.name); return; }
    patchExam({ name: v });
  }

  function changeDate() {
    const suggested = exam.date || exam.takenDate || '';
    // eslint-disable-next-line no-alert
    const date = window.prompt('Exam date (YYYY-MM-DD — leave empty to clear)', suggested);
    if (date == null || date.trim() === (exam.date || '')) return;
    patchExam({ date: date.trim() });
  }

  // Options for one section chip: unassigned tests + the exam's own.
  function sectionOptions(sectionKey) {
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

  // First group a test appears under (to pre-select the drill-down).
  function testGroup(testId) {
    if (!testId) return '';
    const t = tests.find((x) => x.testId === testId);
    return t?.groups?.[0]?.groupName || t?.groupName || '';
  }

  // Distinct groups that still have an assignable test for this slot.
  function groupsForSlot(sectionKey) {
    const set = new Set();
    for (const t of sectionOptions(sectionKey)) {
      for (const g of t.groups || []) if (g.groupName) set.add(g.groupName);
      if (t.groupName) set.add(t.groupName);
    }
    return Array.from(set).sort();
  }

  function setSection(sectionKey, testId) {
    const sections = {};
    for (const d of SECTION_DEFS) {
      const cur = exam.sections?.[d.key];
      sections[d.key] = cur ? { testId: cur.testId, testName: cur.testName } : null;
    }
    const test = tests.find((t) => t.testId === testId);
    sections[sectionKey] = testId ? { testId, testName: test?.testName || null } : null;
    setSectionEditing(null);
    patchExam({ sections });
  }

  async function handleDuplicate() {
    onError?.(null);
    try {
      await duplicateExam(exam.examId);
      await onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to duplicate exam');
    }
  }

  async function handleDelete() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete exam "${exam.name}" and its scoring sheets?`)) return;
    onError?.(null);
    try {
      await deleteExam(exam.examId);
      await onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete exam');
    }
  }

  const handleStyle = { cursor: 'grab', color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px', userSelect: 'none' };

  return (
    <div
      style={{ ...s.examRow, ...(dragging ? { opacity: 0.4 } : null) }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        style={{ ...s.examHead, cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <span
          draggable
          onDragStart={onDragStart}
          onClick={stop}
          style={handleStyle}
          title="Drag to reorder within the program"
        >
          ⠿
        </span>
        <span style={s.chevron}>{expanded ? '▾' : '▸'}</span>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onClick={stop}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setNameDraft(exam.name); setEditingName(false); }
            }}
            style={{ ...s.input, flex: 1, padding: '4px 8px', fontSize: '0.88rem', fontWeight: 600 }}
          />
        ) : (
          <span
            style={{ ...s.examName, cursor: 'text' }}
            onClick={(e) => { stop(e); setNameDraft(exam.name); setEditingName(true); }}
            title="Click to rename"
          >
            {exam.name}
          </span>
        )}
        {!expanded && (
          <span style={s.count}>{assignedCount}/4 sections</span>
        )}
        <span
          style={{ ...s.dateChip, cursor: 'pointer', ...(exam.date ? null : exam.takenDate ? { opacity: 0.7 } : null) }}
          onClick={(e) => { stop(e); changeDate(); }}
          title={exam.date ? 'Click to change the exam date' : exam.takenDate ? 'Date the exam was taken — click to confirm or change' : 'Click to set the exam date'}
        >
          {exam.date || exam.takenDate || 'set date'}
        </span>
        {/* Ungrouped (legacy) exams keep their own roster chip; grouped exams
            inherit the program roster. */}
        {!grouped && (
          <span
            style={{ ...s.rosterChip, cursor: 'pointer' }}
            onClick={(e) => { stop(e); setRosterOpen((v) => !v); }}
            title="Click to pick the students taking this exam"
          >
            {(exam.studentIds || []).length} student{(exam.studentIds || []).length === 1 ? '' : 's'}
          </span>
        )}
        {(exam.hiddenStudentIds || []).length > 0 && (
          <span style={s.hiddenBadge}>{exam.hiddenStudentIds.length} hidden</span>
        )}
        <select
          style={s.moveSelect}
          value={exam.programId || ''}
          onClick={stop}
          onChange={(e) => { if (e.target.value) patchExam({ programId: e.target.value }); }}
          title="Move this exam to another program"
        >
          {!exam.programId && <option value="" disabled>Move to a program…</option>}
          {programs.map((p) => (
            <option key={p.programId} value={p.programId}>{p.name}</option>
          ))}
        </select>
        <button type="button" style={s.btnGhost} onClick={(e) => { stop(e); setScoreboardOpen((v) => !v); }}>
          {scoreboardOpen ? 'Close Scoreboard' : 'Scoreboard'}
        </button>
        <button type="button" style={s.btnGhost} onClick={(e) => { stop(e); setHiddenOpen((v) => !v); }}>
          {hiddenOpen ? 'Close Hidden' : 'Hidden'}
        </button>
        <button type="button" style={s.btnGhost} onClick={(e) => { stop(e); handleDuplicate(); }} title="New exam with the same students — set its own date and tests">Duplicate</button>
        <button type="button" style={s.btnDanger} onClick={(e) => { stop(e); handleDelete(); }}>Delete</button>
      </div>

      {/* Scoreboard / hidden panels open regardless of expand so you can use
          them from a collapsed row. */}
      {!grouped && rosterOpen && (
        <RosterPanel
          exam={exam}
          roster={roster}
          onError={onError}
          onSaved={async () => { setRosterOpen(false); await onChanged?.(); }}
        />
      )}
      {scoreboardOpen && <ScoreboardPanel exam={exam} onError={onError} />}
      {hiddenOpen && (
        <HiddenStudentsPanel
          exam={exam}
          onError={onError}
          onSaved={async () => { setHiddenOpen(false); await onChanged?.(); }}
        />
      )}

      {expanded && (
        <>
          <div style={s.sectionList}>
            {SECTION_DEFS.map(({ key, label }) => {
              const assigned = exam.sections?.[key];
              const editing = sectionEditing?.key === key;
              return (
                <div
                  key={key}
                  style={{ ...s.sectionChip, cursor: 'pointer' }}
                  onClick={() => !editing && setSectionEditing({ key, group: testGroup(assigned?.testId) })}
                  title="Click to change this section's test"
                >
                  <span style={s.sectionLabel}>{label}</span>
                  {editing ? (
                    <div
                      style={{ display: 'grid', gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSectionEditing(null); }}
                    >
                      <select
                        style={s.select}
                        autoFocus
                        value={sectionEditing.group || ''}
                        onChange={(e) => setSectionEditing((cur) => ({ ...cur, group: e.target.value }))}
                      >
                        <option value="">All groups</option>
                        {groupsForSlot(key).map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                      <select
                        style={s.select}
                        value={assigned?.testId || ''}
                        onChange={(e) => setSection(key, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {sectionOptions(key)
                          .filter((t) => inGroup(t, sectionEditing.group))
                          .map((t) => (
                            <option key={t.testId} value={t.testId}>
                              {t.testName} ({t.attempts} attempt{t.attempts === 1 ? '' : 's'})
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : assigned
                    ? <span>{assigned.testName || `Test #${assigned.testId}`}</span>
                    : <span style={s.sectionEmpty}>not assigned</span>}
                </div>
              );
            })}
          </div>
          <ScoringSheetUpload
            groupId={exam.curveKey}
            sheets={exam.sheets}
            onChanged={onChanged}
          />
        </>
      )}
    </div>
  );
}
