import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Names the part of the interface in the log line. */
  scope: string;
  fallback: (error: Error, retry: () => void) => ReactNode;
  /**
   * Changes when the part is asked for again: a dialog's open flag, the palette's openings. A boundary that
   * fell back tries its children again then, instead of staying down until the app restarts.
   */
  resetKey?: unknown;
  children: ReactNode;
}

/**
 * Keeps a render error to the part of the interface it happened in, instead of
 * blanking the whole window (spec première version §3.4). The error goes to the
 * log through `console.error`.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[ui] ${this.props.scope}`, error, info.componentStack ?? "");
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) this.retry();
  }

  retry = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}

/**
 * A part that shows nothing once it failed, a dialog or a meter, until `useResetKey` gives another value: asked for
 * again, it tries again. The key is read here, so only this boundary re-renders when it changes, not its parent.
 */
export function QuietBoundary({ scope, useResetKey, children }: { scope: string; useResetKey: () => unknown; children: ReactNode }) {
  return (
    <ErrorBoundary scope={scope} fallback={() => null} resetKey={useResetKey()}>
      {children}
    </ErrorBoundary>
  );
}
