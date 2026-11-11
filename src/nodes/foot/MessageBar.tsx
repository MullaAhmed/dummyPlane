import type { ReactNode } from "react";

/**
 * The last line of a node's foot, a Fleet's or an agent's: the message field
 * itself, as tall at rest as the one-line fold it replaces. Writing to an
 * agent is a click and typing, never a fold to open first; the field grows
 * with what is written (six lines at most, then it scrolls) and is one line
 * again once sent. It never takes the keyboard by itself: a node mounted,
 * reloaded or panned into view leaves the user's field alone.
 */
export function MessageBar({ children }: { children: ReactNode }) {
  return (
    <div data-message-line className="px-1.5 py-0.5">
      {children}
    </div>
  );
}
