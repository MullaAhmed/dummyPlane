import type { AppState } from "@excalidraw/excalidraw/types";
import { nodeKindOf } from "./nodeElement";

/**
 * Returns the id of a terminal the moment Excalidraw activates it,
 * once per activation; null the rest of the time.
 */
export function createActivationTracker() {
  let last: string | null = null;
  return (active: AppState["activeEmbeddable"]): string | null => {
    if (!active || active.state !== "active" || nodeKindOf(active.element) !== "terminal") {
      last = null;
      return null;
    }
    if (active.element.id === last) return null;
    last = active.element.id;
    return last;
  };
}
