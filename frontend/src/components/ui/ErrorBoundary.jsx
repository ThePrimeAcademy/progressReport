// components/ui/ErrorBoundary.jsx
// Keeps one broken panel from taking the whole page down. Without it, an
// unexpected render error unmounts everything and leaves a blank screen with
// no way back. `resetKey` clears the error when it changes (e.g. on a tab
// switch), so moving elsewhere always works.
import React from 'react';
import { LuCircleAlert, LuRotateCcw } from 'react-icons/lu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
      <Alert variant="destructive">
        <LuCircleAlert aria-hidden="true" />
        <AlertTitle>This section could not be displayed.</AlertTitle>
        <AlertDescription>
          <p>Nothing was lost. Reload the page to try again; if it keeps happening, the details below will help fix it.</p>
          <p className="font-mono text-xs break-all">{String(this.state.error?.message || this.state.error)}</p>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => window.location.reload()}>
            <LuRotateCcw data-icon="inline-start" />
            Reload page
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}
