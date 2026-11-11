// features/report/components/ExamRow.jsx
// One SAT exam inside a program.
//
// The collapsed row is a single aligned line: drag handle, name, date, the
// English and Math scoring-sheet pickers (Easy / Medium / Hard / Custom) and
// the scoreboard. Everything used less often lives one click away in the
// expanded panel: the four DSAT section tests, what grades each subject, and
// the exam's settings (practice, move to another program, hidden students,
// delete). Self-contained - saves each edit through the API, then asks the
// parent to re-fetch.
import React, { useCallback, useState } from 'react';
import { updateExam, deleteExam } from '../api/reportApi.js';
import { SUBJECTS } from '../scoring.js';
import SheetLevelPicker from './SheetLevelPicker.jsx';
import ExamScoring from './ExamScoring.jsx';
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
  exam, tests, roster, programs, onChanged, onExamsChanged, onOpenSheets, onError,
  onDragStart, onDragEnd, onDragOver, onDrop, dragging,
}) {
  const assignedCount = SECTION_DEFS.filter((d) => exam.sections?.[d.key]?.testId).length;
  // Every exam starts collapsed - the list stays compact; click a row to open
  // it for editing.
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(exam.name);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // { key, group } of the section chip currently showing its inline select.
  const [sectionEditing, setSectionEditing] = useState(null);
  // Sheet choices just clicked but not yet confirmed by the server, so the
  // pickers respond instantly: { rw?: level|null, math?: level|null }.
  const [pendingDifficulty, setPendingDifficulty] = useState({});

  // Identifies the sheets currently grading this exam (level, table, bound).
  const scoringKey = SUBJECTS.map(({ key }) => {
    const scoring = exam.scoring?.[key];
    return `${scoring?.level || 'custom'}:${scoring?.sheet?.hash || 'none'}:${scoring?.sheet?.bound || ''}`;
  }).join('|');

  const grouped = Boolean(exam.programId);
  const hiddenCount = (exam.hiddenStudentIds || []).length;
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

  // Choose the scoring sheet for one subject. Only the exam list needs to be
  // re-read afterwards, which keeps clicking through a column of exams quick.
  async function setDifficulty(subject, level) {
    onError?.(null);
    setPendingDifficulty((prev) => ({ ...prev, [subject]: level }));
    try {
      await updateExam(exam.examId, { difficulty: { [subject]: level } });
      await onExamsChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to update the scoring sheet');
    } finally {
      setPendingDifficulty((prev) => {
        const next = { ...prev };
        delete next[subject];
        return next;
      });
    }
  }

  // Inline name edit (no prompt) - Enter/blur saves, Esc cancels.
  function commitName() {
    setEditingName(false);
    const v = nameDraft.trim();
    if (!v || v === exam.name) { setNameDraft(exam.name); return; }
    patchExam({ name: v });
  }

  // Inline date edit - Enter/blur saves (an emptied field clears the date),
  // Esc cancels.
  function startDateEdit() {
    setDateDraft(exam.date || exam.takenDate || '');
    setEditingDate(true);
  }

  function commitDate() {
    setEditingDate(false);
    if (dateDraft === (exam.date || '')) return;
    patchExam({ date: dateDraft });
  }

  // Options for one section chip. A test may be reused across exams, so the
  // only restriction is that it can't fill two sections of *this* exam.
  function sectionOptions(sectionKey) {
    const usedElsewhereInExam = new Set(
      SECTION_DEFS.filter((d) => d.key !== sectionKey)
        .map((d) => exam.sections?.[d.key]?.testId)
        .filter(Boolean)
    );
    return tests.filter((t) => !usedElsewhereInExam.has(t.testId));
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

  async function handleDelete() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete exam "${exam.name}"? Its custom scoring sheets are deleted with it.`)) return;
    onError?.(null);
    try {
      await deleteExam(exam.examId);
      await onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete exam');
    }
  }

  const togglePractice = () => patchExam({ isPractice: !exam.isPractice });

  return (
    <div
      style={{
        ...s.examRow,
        ...(dragging ? { opacity: 0.55, boxShadow: 'var(--shadow-lg)', borderColor: 'var(--accent)', transform: 'scale(0.99)' } : null),
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="exam-grid"
        style={s.examHead}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to show sections and settings'}
      >
        <span
          draggable={Boolean(onDragStart)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={stop}
          style={{ ...s.dragHandle, cursor: !onDragStart ? 'default' : dragging ? 'grabbing' : 'grab', visibility: onDragStart ? 'visible' : 'hidden' }}
          title="Drag to reorder within the program"
        >
          ⠿
        </span>
        <span style={s.chevron}>{expanded ? '▾' : '▸'}</span>

        <span style={s.examNameCell}>
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
              style={{ ...s.input, flex: 1, minWidth: 0, padding: '4px 8px', fontSize: '0.88rem', fontWeight: 600 }}
            />
          ) : (
            <span
              style={{ ...s.examName, flex: '0 1 auto', cursor: 'text' }}
              onClick={(e) => { stop(e); setNameDraft(exam.name); setEditingName(true); }}
              title="Click to rename"
            >
              {exam.name}
            </span>
          )}
          {exam.isPractice && <span style={s.practiceBadge} title="Practice exam - kept out of grade reports">Practice</span>}
          {assignedCount < SECTION_DEFS.length && (
            <span style={s.count} title="Sections with a test assigned">{assignedCount}/4 sections</span>
          )}
          {hiddenCount > 0 && (
            <span
              style={{ ...s.hiddenBadge, cursor: 'pointer' }}
              onClick={(e) => { stop(e); setHiddenOpen((v) => !v); }}
              title="Students whose attempts are ignored for this exam - click to edit"
            >
              {hiddenCount} hidden
            </span>
          )}
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
        </span>

        {editingDate ? (
          <input
            type="date"
            autoFocus
            value={dateDraft}
            onClick={stop}
            onChange={(e) => setDateDraft(e.target.value)}
            onBlur={commitDate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDate();
              if (e.key === 'Escape') setEditingDate(false);
            }}
            style={{ ...s.input, padding: '3px 6px', fontSize: '0.74rem', width: 128, justifySelf: 'start' }}
          />
        ) : (
          <span
            style={{ ...s.dateChip, cursor: 'pointer', justifySelf: 'start', ...(exam.date ? null : { opacity: 0.7 }) }}
            onClick={(e) => { stop(e); startDateEdit(); }}
            title={exam.date ? 'Click to change the exam date' : exam.takenDate ? 'Date the exam was taken - click to confirm or change' : 'Click to set the exam date'}
          >
            {exam.date || exam.takenDate || 'set date'}
          </span>
        )}

        <span className="exam-grid-pickers">
          {SUBJECTS.map((subject) => (
            <span key={subject.key} className="exam-picker">
              <span className="exam-picker-label">{subject.label}</span>
              <SheetLevelPicker
                subjectLabel={subject.label}
                value={subject.key in pendingDifficulty ? pendingDifficulty[subject.key] : (exam.difficulty?.[subject.key] || null)}
                scoring={exam.scoring?.[subject.key]}
                onChange={(level) => setDifficulty(subject.key, level)}
                onCustom={() => setExpanded(true)}
              />
            </span>
          ))}
        </span>

        <button
          type="button"
          style={{ ...s.btnGhost, justifySelf: 'end' }}
          onClick={(e) => { stop(e); setScoreboardOpen((v) => !v); }}
        >
          {scoreboardOpen ? 'Close scores' : 'Scoreboard'}
        </button>
      </div>

      {/* The roster, scoreboard and hidden-students panels open regardless of
          expand so they can be used from a collapsed row. */}
      {!grouped && rosterOpen && (
        <RosterPanel
          exam={exam}
          roster={roster}
          onError={onError}
          onSaved={async () => { setRosterOpen(false); await onChanged?.(); }}
        />
      )}
      {/* Keyed by what grades the exam, so an open scoreboard re-reads its
          scores the moment a sheet choice or the sheet itself changes. */}
      {scoreboardOpen && <ScoreboardPanel key={scoringKey} exam={exam} onError={onError} />}

      {expanded && (
        <>
          <div style={s.sectionList}>
            {SECTION_DEFS.map(({ key, label, hint }) => {
              const assigned = exam.sections?.[key];
              const editing = sectionEditing?.key === key;
              return (
                <div
                  key={key}
                  style={{ ...s.sectionChip, cursor: 'pointer', ...(editing ? s.sectionChipEditing : null) }}
                  onClick={() => !editing && setSectionEditing({ key, group: testGroup(assigned?.testId) })}
                  title={`${hint} - click to change this section's test`}
                >
                  <span style={s.sectionLabel}>{label}</span>
                  {editing ? (
                    <div
                      style={s.sectionEditPanel}
                      onClick={stop}
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
                        <option value="">- none -</option>
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

          <ExamScoring exam={exam} onChanged={onExamsChanged} onOpenSheets={onOpenSheets} onError={onError} />

          <div style={s.examSettings} onClick={stop}>
            <span
              role="switch"
              aria-checked={Boolean(exam.isPractice)}
              tabIndex={0}
              style={{ ...s.practiceToggle, ...(exam.isPractice ? s.practiceToggleOn : null) }}
              onClick={togglePractice}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePractice(); }
              }}
              title={exam.isPractice
                ? 'Practice exam - kept out of grade reports. Click to count it as a real exam.'
                : 'Real exam - counts in grade reports. Click to mark as practice.'}
            >
              <span style={{ ...s.practiceTrack, ...(exam.isPractice ? s.practiceTrackOn : null) }}>
                <span style={{ ...s.practiceKnob, ...(exam.isPractice ? s.practiceKnobOn : null) }} />
              </span>
              Practice
            </span>
            <label style={s.settingsField}>
              <span style={s.settingsLabel}>Program</span>
              <select
                style={s.moveSelect}
                value={exam.programId || ''}
                onChange={(e) => { if (e.target.value) patchExam({ programId: e.target.value }); }}
                title="Move this exam to another program"
              >
                {!exam.programId && <option value="" disabled>Move to a program…</option>}
                {programs.map((p) => (
                  <option key={p.programId} value={p.programId}>{p.name}</option>
                ))}
              </select>
            </label>
            <button type="button" style={s.btnGhost} onClick={() => setHiddenOpen((v) => !v)}>
              {hiddenOpen ? 'Close hidden students' : `Hidden students${hiddenCount ? ` (${hiddenCount})` : ''}`}
            </button>
            <button type="button" style={{ ...s.btnDanger, marginLeft: 'auto' }} onClick={handleDelete}>Delete exam</button>
          </div>
        </>
      )}

      {hiddenOpen && (
        <HiddenStudentsPanel
          exam={exam}
          onError={onError}
          onSaved={async () => { setHiddenOpen(false); await onChanged?.(); }}
        />
      )}
    </div>
  );
}
