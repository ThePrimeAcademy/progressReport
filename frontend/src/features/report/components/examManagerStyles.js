// features/report/components/examManagerStyles.js
// Shared inline-style tokens for the SAT exam/program admin UI. Extracted from
// ExamManager so the program section and the per-exam/panel components can all
// reference one source of truth.
export const s = {
  card: { background: 'var(--bg)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--border)', overflow: 'hidden', marginTop: 24 },
  head: { padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' },
  dot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' },
  title: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', flex: 1 },
  count: { fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 500 },
  chevron: { fontSize: '0.8rem', color: 'var(--muted)' },
  body: { borderTop: '1px solid var(--border)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  examRow: { border: '1.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  examHead: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fafbff', flexWrap: 'wrap' },
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

  // ── Program grouping ──────────────────────────────────────────
  // A program is a labelled container that nests its exams. The left accent
  // bar + tinted header set it apart from the loose "ungrouped" exams so the
  // cohort structure reads at a glance.
  programCard: { border: '1.5px solid var(--accent)', borderRadius: 14, overflow: 'hidden', borderLeftWidth: 4 },
  programHead: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--accent-dim)', flexWrap: 'wrap' },
  programName: { fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)', flex: 1, letterSpacing: '-0.01em' },
  programBadge: { fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 8px' },
  programBody: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff' },
  programEmpty: { fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 2px' },
  ungroupedLabel: { fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 4 },
  moveSelect: { boxSizing: 'border-box', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.72rem', background: '#fff', fontFamily: 'inherit', maxWidth: 170 },
};

export default s;
