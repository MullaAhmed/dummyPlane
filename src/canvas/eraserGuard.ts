import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ERASER_MARK, isMarked } from "./eraserLock";
import { groupInfoOf } from "./groups";
import { nodeKindOf } from "./nodeElement";

/**
 * What the eraser must not take: the nodes, the frames that hold one (Excalidraw
 * erases a frame's children with it) and what is grouped with one (it erases a
 * group whole). Each of those is protected in turn: a frame grouped with a drawing
 * would be taken with it, and the nodes it holds with the frame, so the set grows
 * until a frame or a group adds nothing more.
 */
function protectedIds(elements: readonly ExcalidrawElement[]): Set<string> {
  const live = elements.filter((e) => !e.isDeleted);
  const kept = new Set(live.filter((e) => nodeKindOf(e) !== null).map((e) => e.id));
  for (let grew = true; grew; ) {
    const before = kept.size;
    const frames = new Set<string>();
    const groups = new Set<string>();
    for (const e of live) {
      if (!kept.has(e.id)) continue;
      if (e.frameId) frames.add(e.frameId);
      e.groupIds.forEach((g) => groups.add(g));
    }
    for (const e of live) if (frames.has(e.id) || e.groupIds.some((g) => groups.has(g))) kept.add(e.id);
    grew = kept.size > before;
  }
  return kept;
}

/**
 * Excalidraw's eraser skips what is locked, for a click and for a drag, and
 * does not even fade it. So, with the eraser active, the guard locks the nodes
 * (and what the eraser would take them with); with another tool, it takes its
 * locks back. Derived from the scene: a scene saved or restored with the eraser
 * on gets released on its next change. What was locked by someone else (a folded
 * group, a lock the user set) is left alone, and comes back to what it was, a
 * folded group's terminals staying locked. `remembered` are the ids the guard
 * locked before: an undo writes an element's `customData` back whole, the mark
 * gone and the lock not, and a lock of theirs is still the guard's. Returns the
 * elements to put in the scene, or null when there is nothing to change.
 */
export function eraserGuard(elements: readonly ExcalidrawElement[], eraserActive: boolean, remembered: ReadonlySet<string> = new Set()): ExcalidrawElement[] | null {
  const owned = (e: ExcalidrawElement) => isMarked(e) || (e.locked && remembered.has(e.id));
  if (!eraserActive && !elements.some(owned)) return null;
  const wanted = eraserActive ? protectedIds(elements) : new Set<string>();
  const folded = new Set(elements.filter((e) => groupInfoOf(e)?.folded).map((e) => e.id));
  let changed = false;
  const next = elements.map((e) => {
    if (wanted.has(e.id)) {
      // Marked again when an undo took the mark off: a save would keep the lock without it.
      if (e.locked && (isMarked(e) || !remembered.has(e.id))) return e;
      changed = true;
      return newElementWith(e, { locked: true, customData: { ...e.customData, [ERASER_MARK]: true } });
    }
    if (!owned(e)) return e;
    changed = true;
    const { [ERASER_MARK]: _mark, ...rest } = e.customData ?? {};
    // Forced: without a change of `locked` the mark alone would not count as one, and would stay.
    const locked = nodeKindOf(e) === "terminal" && !!e.frameId && folded.has(e.frameId);
    return newElementWith(e, { locked, customData: Object.keys(rest).length ? rest : undefined }, true);
  });
  return changed ? next : null;
}

/** The ids of the elements the guard has locked, as of its last change. */
let remembered: ReadonlySet<string> = new Set();

function apply(api: ExcalidrawImperativeAPI, eraserActive: boolean) {
  const elements = eraserGuard(api.getSceneElementsIncludingDeleted(), eraserActive, remembered);
  if (!elements) return;
  remembered = new Set(elements.filter(isMarked).map((e) => e.id));
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
}

/** The nodes unlocked now, whatever the tool: the double-click selects one before the eraser is left. */
export function releaseEraserLocks(api: ExcalidrawImperativeAPI) {
  apply(api, false);
}

/** A change of the guard is already programmed for the next frame: the next one reads the scene as it is then. */
let pending = false;

/**
 * Locks or unlocks the nodes as the tool asks, outside the undo history, a frame
 * after the change: changing the scene from inside `onChange` would re-enter it.
 */
export function scheduleEraserGuard(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], eraserActive: boolean) {
  if (pending || !eraserGuard(elements, eraserActive, remembered)) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    apply(api, api.getAppState().activeTool.type === "eraser");
  });
}
