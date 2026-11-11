import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { sceneOf } from "@/agents/placement";
import { canvasStore, viewFrom } from "./canvasStore";
import { releaseEraserLocks } from "./eraserGuard";
import { findTerminalOrFleetAt } from "./hitTest";
import { nodeKindOf } from "./nodeElement";

/** Two presses this close in time (ms) and in space (window px) are the two clicks of one double-click; the OS default delay is 500 ms. */
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_SLOP = 6;

/** Only the canvas itself: its pointer canvas, or the body of a node that is active (an inactive one lets the pointer through). */
const NODE_BODY = ".excalidraw [data-terminal], .excalidraw [data-fleet]";
const ON_CANVAS = `.excalidraw canvas.interactive, ${NODE_BODY}`;
/** The editor the text tool opens on the first click: the second click lands in it. */
const TEXT_EDITOR = ".excalidraw-wysiwyg";

/** The first click of a double-click made with a drawing tool, and the second one if it came. */
interface Press {
  x: number;
  y: number;
  /** When the latest press of the pair came. */
  at: number;
  /** The scene's elements before the first press: whatever is not in it came out of the double-click. */
  before: ReadonlySet<string>;
}

const onCanvas = (target: EventTarget | null) => target instanceof Element && target.closest(ON_CANVAS) !== null;
const inNodeBody = (target: EventTarget | null) => target instanceof Element && target.closest(NODE_BODY) !== null;
const inTextEditor = (target: EventTarget | null) => target instanceof Element && target.closest(TEXT_EDITOR) !== null;

/** A minimized card (MinimizedCard) expands on a double-click by itself: it is left alone. */
function overMinimizedCard(x: number, y: number): boolean {
  return [...document.querySelectorAll(".excalidraw [data-minimized]")].some((card) => {
    const box = card.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  });
}

/** Exactly this node selected: the selection is replaced, not added to. */
function selectOnly(api: ExcalidrawImperativeAPI, nodeId: string) {
  api.updateScene({ appState: { selectedElementIds: { [nodeId]: true }, selectedGroupIds: {} } });
}

/**
 * The first click of a double-click went to the drawing tool: a text editor opened,
 * a dot was drawn, an arrow was started (and, an elbow one, finished and bound to
 * the node). Closes the editor (an empty text is dropped on blur), deletes every
 * element the two clicks made, and unbinds it from the nodes it was bound to, outside
 * the undo history; and drops the drawing in progress.
 */
function undoFirstClick(api: ExcalidrawImperativeAPI, press: Press | null) {
  document.querySelector<HTMLElement>(TEXT_EDITOR)?.blur();
  const elements = api.getSceneElementsIncludingDeleted();
  const strays = new Set(press ? elements.filter((e) => !e.isDeleted && !press.before.has(e.id) && !nodeKindOf(e)).map((e) => e.id) : []);
  api.updateScene({
    ...(strays.size
      ? {
          elements: elements.map((e) =>
            strays.has(e.id)
              ? newElementWith(e, { isDeleted: true })
              : e.boundElements?.some((b) => strays.has(b.id))
                ? newElementWith(e, { boundElements: e.boundElements.filter((b) => !strays.has(b.id)) })
                : e,
          ),
        }
      : {}),
    appState: { newElement: null, multiElement: null, selectedLinearElement: null, startBoundElement: null, suggestedBindings: [] },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

/**
 * A click or a double-click on a terminal or the Fleet selects it, whatever tool is
 * active. Excalidraw keeps the pointer for a drawing tool (an inactive node lets it
 * through to the canvas): the click would draw a dot or a shape there, start an arrow
 * or a text, or pan with the hand; and its own double-click handler does nothing but
 * with the selection tool. Here, after a drawing tool's click(s): what they left goes,
 * the selection tool takes over, and the node is selected. The eraser leaves nothing
 * (it never erases a node: eraserGuard) and is a tool like the others here, except
 * the laser, which keeps its pointer. Excalidraw may have left the tool by itself
 * before the next click (a finished elbow arrow, a text started, a shape drawn): the
 * first click's tool is what counts, so the presses are tracked.
 *
 * A click is a press and a release on the same spot, within a double-click's time and
 * slop: a drag stays Excalidraw's (it draws, it pans). It is decided at the release and
 * carried out a tick later (`setTimeout`): Excalidraw finishes its own pointerup
 * handling after a capture listener has run, and the drawing in progress must not be
 * pulled out from under it. Over empty canvas, in reading mode, over a minimized
 * card (it expands by itself) and in the body of an active node (its own: xterm, a
 * button, a link), the click is not taken here.
 *
 * A double-click made of two such clicks ends the same way, and Excalidraw does not
 * hear it. With the selection tool a double-click goes on to Excalidraw (it activates
 * the node), the node selected first if it was not. A synthetic double-click (the
 * radial menu's text start) is ignored. Returns a function that stops listening.
 */
export function installDoubleClickSelect(doc: Document = document): () => void {
  let press: Press | null = null;
  /** The latest press with a tool that is not the selection one, until it is released (or cancelled, or followed by another press). */
  let pending: Press | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onPointerDown = (event: PointerEvent) => {
    // A press that has not been released by the next one never will be: dropped.
    if (event.isTrusted) pending = null;
    const api = canvasStore.getState().api;
    if (!event.isTrusted || event.button !== 0 || !api || !onCanvas(event.target)) return;
    const now = Date.now();
    const first =
      press && now - press.at <= DOUBLE_CLICK_MS && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DOUBLE_CLICK_SLOP ? press : null;
    const appState = api.getAppState();
    const tool = appState.activeTool.type;
    // With the selection tool and no drawing click before it, there is nothing to undo; with one, this is its second click.
    if (tool === "selection" && !first) {
      press = null;
      return;
    }
    // The second click keeps the first one's picture of the scene: the first one's marks are what to remove.
    press = { x: event.clientX, y: event.clientY, at: now, before: first?.before ?? new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id)) };
    // The laser draws nothing that stays: it keeps its pointer. The selection tool's second click is a double-click's.
    // A line or an arrow already under way takes this click as its next point (or its end, bound to a node): not a selection.
    // A click in the body of an active node (xterm, a header button, a link) is the node's own: selecting would switch the tool, and Excalidraw's tool change deactivates the node.
    if (tool !== "selection" && tool !== "laser" && !appState.multiElement && !inNodeBody(event.target)) pending = press;
  };

  const onPointerCancel = () => {
    pending = null;
  };

  const onPointerUp = (event: PointerEvent) => {
    const click = pending;
    if (!click || !event.isTrusted || event.button !== 0) return;
    pending = null;
    const api = canvasStore.getState().api;
    // The text tool opens its editor under the pointer: the release may land in it.
    if (!api || (!onCanvas(event.target) && !inTextEditor(event.target))) return;
    // A press that moved, or was held, is a drag or a long press: Excalidraw's.
    if (Date.now() - click.at > DOUBLE_CLICK_MS || Math.hypot(event.clientX - click.x, event.clientY - click.y) > DOUBLE_CLICK_SLOP) return;
    const view = viewFrom(api.getAppState());
    // Read-only: nothing can be selected. A minimized card expands by itself.
    if (view.mode === "reading" || overMinimizedCard(event.clientX, event.clientY)) return;
    const point = sceneOf({ x: event.clientX, y: event.clientY }, view);
    const node = findTerminalOrFleetAt(api.getSceneElements(), point.x, point.y);
    if (!node) return;
    const nodeId = node.id;

    // Excalidraw is not done with this pointerup: its own listeners come after this capture one.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Read again: the tool may have changed (a shape drawn, a text started), and the canvas may be gone.
      const current = canvasStore.getState().api;
      if (!current || !current.getSceneElements().some((e) => e.id === nodeId)) return;
      // The eraser had the nodes locked, so that its clicks could not erase them: unlocked before one is selected.
      releaseEraserLocks(current);
      undoFirstClick(current, click);
      if (current.getAppState().activeTool.type !== "selection") current.setActiveTool({ type: "selection" });
      selectOnly(current, nodeId);
      // `press` stays: a second click and the double-click after it are still the same burst.
    }, 0);
  };

  const onDoubleClick = (event: MouseEvent) => {
    const api = canvasStore.getState().api;
    if (!event.isTrusted || !api) return;
    // The double-click of a drawing tool's two clicks, whatever tool Excalidraw is on now.
    const burst = press && Date.now() - press.at <= 2 * DOUBLE_CLICK_MS ? press : null;
    if (!onCanvas(event.target) && !(burst && inTextEditor(event.target))) return;
    const appState = api.getAppState();
    const view = viewFrom(appState);
    // Read-only: nothing can be selected.
    if (view.mode === "reading" || overMinimizedCard(event.clientX, event.clientY)) return;
    const point = sceneOf({ x: event.clientX, y: event.clientY }, view);
    const node = findTerminalOrFleetAt(api.getSceneElements(), point.x, point.y);
    if (!node) return;

    if (view.tool === "selection" && !burst) {
      // An active node's own body takes it: a word in xterm, a rename in a header.
      if (appState.activeEmbeddable?.state === "active" && appState.activeEmbeddable.element.id === node.id) return;
      if (!view.selectedIds.includes(node.id)) selectOnly(api, node.id);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    // The eraser had the nodes locked, so that its clicks could not erase them: unlocked before one is selected.
    releaseEraserLocks(api);
    undoFirstClick(api, burst);
    press = null;
    if (view.tool !== "selection") api.setActiveTool({ type: "selection" });
    selectOnly(api, node.id);
  };

  // Capture: before Excalidraw's own listeners on the canvas, and before a node's body.
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("pointercancel", onPointerCancel, true);
  doc.addEventListener("dblclick", onDoubleClick, true);
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("pointerup", onPointerUp, true);
    doc.removeEventListener("pointercancel", onPointerCancel, true);
    doc.removeEventListener("dblclick", onDoubleClick, true);
    if (timer !== null) clearTimeout(timer);
  };
}
