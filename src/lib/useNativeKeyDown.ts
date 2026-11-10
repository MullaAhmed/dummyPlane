import { useEffect, useRef, type RefObject } from "react";

/**
 * Handles the keys of a field inside an Excalidraw embeddable (a fleet)
 * and keeps them from the canvas, as xterm does for terminals. Excalidraw
 * listens on its container, below React's root listener: a React handler's
 * stopPropagation comes too late, and Escape would deactivate the node, after
 * which Backspace deletes it.
 */
export function useNativeKeyDown<T extends HTMLElement>(ref: RefObject<T | null>, handler: (event: KeyboardEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: KeyboardEvent) => {
      latest.current(event);
      event.stopPropagation();
    };
    element.addEventListener("keydown", listener);
    return () => element.removeEventListener("keydown", listener);
  }, [ref]);
}
