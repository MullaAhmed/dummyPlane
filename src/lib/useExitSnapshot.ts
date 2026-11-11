import { useRef } from "react";

/**
 * What a dialog shows, held from its last open render while it animates out. The subject it
 * asked about may be gone by then (the group closed, the agents removed): an exit must never
 * show changed content, like "Close the group undefined?" fading away.
 */
export function useExitSnapshot<T>(open: boolean, value: T): T {
  const held = useRef(value);
  if (open) held.current = value;
  return open ? value : held.current;
}
