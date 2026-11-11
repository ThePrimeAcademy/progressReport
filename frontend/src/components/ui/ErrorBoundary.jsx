// components/ui/ErrorBoundary.jsx
// Keeps one broken panel from taking the whole page down. Without it, an
// unexpected render error unmounts everything and leaves a blank screen with
// no way back. `resetKey` clears the error when it changes (e.g. on a tab
// switch), so moving elsewhere always works.
import React from 'react';

const s = {
  box: { padding: '20px 24px', background: '#fff1f2', border: '1.5px solid #fca5a5', borderRadius: 12, color: '#7f1d1d', fontSize: '0.86rem', lineHeight: 1.6 },
  title: { fontWeight: 700, marginBottom: 4 },
  detail: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.74rem', color: '#991b1b', marginTop: 8, overflowWrap: 'anywhere' },
  btn: { appearance: 'none', marginTop: 12, border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit' },
};

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] A section failed to render:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={s.box}>
        <div style={s.title}>This section could not be displayed.</div>
        Nothing was lost. Reload the page to try again; if it keeps happening, the details below will help fix it.
        <div style={s.detail}>{String(this.state.error?.message || this.state.error)}</div>
        <button type="button" style={s.btn} onClick={() => window.location.reload()}>Reload page</button>
      </div>
    );
  }
}
