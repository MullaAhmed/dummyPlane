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
  /**
   * After an error: a dialog that failed while open clears its open flag here, since its own close is gone with it.
   * The next request then sets it again, a change `resetKey` sees.
   */
  onError?: () => void;
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
    this.props.onError?.();
  }

  componentDidUpdate(previous: Props, before: { error: Error | null }) {
    // Only an error caught earlier: one caught in this very update is not tried again at once (it would log twice).
    if (before.error && this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) this.retry();
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
export function QuietBoundary({
  scope,
  useResetKey,
  onError,
  children,
}: {
  scope: string;
  useResetKey: () => unknown;
  /** Clears an open flag the failed dialog can no longer clear (see ErrorBoundary). */
  onError?: () => void;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary scope={scope} fallback={() => null} resetKey={useResetKey()} onError={onError}>
      {children}
    </ErrorBoundary>
  );
}
