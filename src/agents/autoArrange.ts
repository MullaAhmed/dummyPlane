import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { autoArrangeStore } from "@/app/autoArrangeSetting";
import { nodeKindOf } from "@/canvas/nodeElement";

/** How long the canvas stays still before it is tidied: a launch places its node and starts it first. */
export const AUTO_ARRANGE_DELAY_MS = 350;

/** What the user is in the middle of: nothing moves under the pointer. */
type Gesture = Pick<AppState, "selectedElementsAreBeingDragged" | "isResizing" | "isRotating" | "newElement" | "editingFrame">;

const busy = (appState: Gesture) =>
  appState.selectedElementsAreBeingDragged || appState.isResizing || appState.isRotating || appState.newElement !== null || appState.editingFrame !== null;

/**
 * What Auto-arrange answers to: which nodes stand on the canvas, and which of
 * them are minimized. A move, a resize or a drawing changes nothing here, so
 * the user can still place things by hand between two openings.
 */
export function layoutSignature(elements: readonly ExcalidrawElement[], isMinimized: (nodeId: string) => boolean): string {
  return elements
    .filter((e) => !e.isDeleted && nodeKindOf(e) !== null)
    .map((e) => `${e.id}${isMinimized(e.id) ? ":m" : ""}`)
    .sort()
    .join(",");
}

/**
 * Watches one workspace's canvas, from its onChange: when Auto-arrange is on
 * and a node opened or closed, or a terminal was minimized or expanded, the
 * canvas is arranged AUTO_ARRANGE_DELAY_MS after the last such change (a
 * second one restarts the wait), never during a drag, a resize or a drawing. The first look at a canvas only takes
 * note: opening a workspace moves nothing. The canvas's own moves (the
 * arrangement itself) change no signature, so they do not call it again.
 */
export function createAutoArrangeWatch(options: {
  isMinimized: (nodeId: string) => boolean;
  arrange: () => void;
  enabled?: () => boolean;
  schedule?: (run: () => void, ms: number) => () => void;
}) {
  const enabled = options.enabled ?? (() => autoArrangeStore.getState().enabled);
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let seen: string | null = null;
  let pending = false;
  let gesture: Gesture | null = null;
  let cancel: (() => void) | null = null;

  const fire = () => {
    cancel = null;
    if (!pending) return;
    // Still in a gesture: try again once it may be over.
    if (gesture && busy(gesture)) {
      cancel = schedule(fire, AUTO_ARRANGE_DELAY_MS);
      return;
    }
    pending = false;
    if (enabled()) options.arrange();
  };

  const watch = (elements: readonly ExcalidrawElement[], appState: Gesture) => {
    gesture = appState;
    const signature = layoutSignature(elements, options.isMinimized);
    // onChange also fires as the pointer moves: only a new signature starts the wait, a gesture only holds it.
    if (seen === null || signature === seen) {
      seen ??= signature;
      return;
    }
    seen = signature;
    if (!enabled()) return;
    pending = true;
    cancel?.();
    cancel = schedule(fire, AUTO_ARRANGE_DELAY_MS);
  };
  watch.dispose = () => {
    cancel?.();
    cancel = null;
    pending = false;
  };
  return watch;
}
