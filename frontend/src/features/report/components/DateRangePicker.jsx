// features/report/components/DateRangePicker.jsx
import React from 'react';

const styles = {
  wrapper: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)' },
  input: {
    padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: '8px',
    background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--font-sans)',
    fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.15s', width: '100%',
    colorScheme: 'light',
  },
  hint: { fontSize: '0.73rem', color: 'var(--muted)', marginTop: '2px' },
  error: { fontSize: '0.73rem', color: '#ef4444', marginTop: '4px' },
};

function DateField({ id, label, value, onChange }) {
  return (
    <div style={styles.field}>
      <label style={styles.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        type="date"
        style={styles.input}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <span style={styles.hint}>Type or pick from calendar</span>
    </div>
  );
}

export default function DateRangePicker({ startDate, endDate, onStartChange, onEndChange }) {
  const rangeInvalid = startDate && endDate && new Date(startDate) > new Date(endDate);

  return (
    <div>
      <div style={styles.wrapper}>
        <DateField id="start-date" label="Start Date" value={startDate} onChange={onStartChange} />
        <DateField id="end-date" label="End Date" value={endDate} onChange={onEndChange} />
      </div>
      {rangeInvalid && <p style={styles.error}>⚠ Start date must be before end date.</p>}
    </div>
  );
}