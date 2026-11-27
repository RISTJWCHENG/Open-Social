/**
 * Last line of defence: if rendering fails, show what happened and a way out
 * instead of a blank page.
 */
import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('OpenSocial: render error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>This page hit an error. Your chats and keys are safe on this device.</p>
        <pre className="crash-detail">{this.state.error.message}</pre>
        <button type="button" className="pill-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
