// components/ui/Modal.jsx
// Centered dialog over a dimmed page. Closes on Escape or a click outside
// (unless `busy`, so an in-flight save can't be abandoned by a stray click).
import React, { useEffect, useRef } from 'react';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(15, 22, 35, 0.45)', zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  card: {
    background: 'var(--bg)', borderRadius: 14, width: '100%', maxHeight: 'calc(100vh - 32px)',
    display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(15, 22, 35, 0.28)',
    animation: 'rise-in 180ms var(--ease) both', outline: 'none',
  },
  head: { padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 },
  title: { fontWeight: 700, fontSize: '0.98rem', color: 'var(--ink)', lineHeight: 1.3 },
  subtitle: { fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 },
  close: {
    appearance: 'none', border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
    fontSize: '1.25rem', lineHeight: 1, padding: '2px 6px', marginLeft: 'auto', borderRadius: 6,
  },
  body: { padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  foot: { padding: '12px 20px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' },
};

export default function Modal({ title, subtitle, width = 520, busy = false, onClose, footer, children }) {
  const cardRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Move focus into the dialog so Escape and Tab act on it, and give it back
  // to whatever opened it afterwards.
  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ ...s.card, maxWidth: width }}
      >
        <div style={s.head}>
          <div>
            <div style={s.title}>{title}</div>
            {subtitle && <div style={s.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" style={s.close} onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div style={s.body}>{children}</div>
        {footer && <div style={s.foot}>{footer}</div>}
      </div>
    </div>
  );
}
