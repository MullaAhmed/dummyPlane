import { forwardWheel } from "@/agents/linkOverlay";
import { canvasStore } from "./canvasStore";
import { setActiveTerminal } from "./activeTerminal";
import { nodeKindOf } from "./nodeElement";

/**
 * Where a node's controls are: its header, an agent's foot, a Fleet's mission panel, a minimized terminal's card.
 * Marked by the components (NodeHeader, AgentFoot, MissionPanel, MinimizedCard); NodeHost marks the node they
 * belong to (`data-node-id`).
 */
export const CHROME_ATTRIBUTE = "data-node-chrome";
export const NODE_ID_ATTRIBUTE = "data-node-id";

/**
 * What a press on a node's chrome is meant for: a control. A sub-agent's task line is a button for its tooltip
 * and the keyboard only, not an action: it stays a place to drag the node by. Kept in step with the rule of
 * theme/excalidraw.css that lets the pointer through to these on an inactive node.
 */
export const LIVE_CONTROL =
  'button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="combobox"]';
const NOT_LIVE = "[data-task-line], :disabled";

/** How long after its press an activation is still the press's: Excalidraw tells the change within a frame or two. */
const PRESS_WINDOW_MS = 1000;

/** The control of a node's chrome under a press, and the node it belongs to; null for anything else. */
export function liveControlAt(target: EventTarget | null): { nodeId: string; control: Element } | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(LIVE_CONTROL);
  if (!control || control.matches(NOT_LIVE)) return null;
  const chrome = control.closest(`[${CHROME_ATTRIBUTE}]`);
  const node = chrome?.closest(`.excalidraw [${NODE_ID_ATTRIBUTE}]`);
  const nodeId = node?.getAttribute(NODE_ID_ATTRIBUTE);
  return nodeId ? { nodeId, control } : null;
}

let pressed: { nodeId: string; at: number } | null = null;

/**
 * Whether a press on one of its controls activated this node (installLiveControls): then the view stays where
 * it is and the keyboard on the control, where an activation by a click in the node's middle shows it at
 * 100 % and gives its terminal the keyboard (Canvas). Answers once.
 */
export function activatedByPress(nodeId: string): boolean {
  const press = pressed;
  pressed = null;
  return press !== null && press.nodeId === nodeId && Date.now() - press.at <= PRESS_WINDOW_MS;
}

/**
 * A press on a control of a node that is not the active one (its header's buttons, an agent's Link, a Fleet's
 * mission panel, a minimized card's Expand) is the control's: theme/excalidraw.css lets the pointer through to it, with the selection tool,
 * where Excalidraw keeps it from the rest of an inactive node. Here, before the control hears it, the node
 * becomes the active one, as a click in its middle makes it, but without selecting it (the selection left behind
 * goes: the canvas keys must not act on it while a control of this node has the keyboard) and without moving the
 * view: the click lands on the control it was pressed on. A terminal is where Send goes from now on. The wheel
 * over those controls stays the canvas's, as over the rest of an inactive node: Excalidraw pans and zooms only
 * for a wheel aimed at its canvas (or a text field), so it is passed on to it. Returns a function that stops
 * listening.
 */
export function installLiveControls(doc: Document = document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    const hit = liveControlAt(event.target);
    const api = canvasStore.getState().api;
    if (!hit || !api) return;
    const appState = api.getAppState();
    // Only the selection tool lets the pointer through to them (excalidraw.css): with another, the press is the tool's.
    if (appState.activeTool.type !== "selection") return;
    const active = appState.activeEmbeddable;
    if (active?.state === "active" && active.element.id === hit.nodeId) return;
    const element = api.getSceneElements().find((e) => e.id === hit.nodeId);
    if (!element || element.type !== "embeddable") return;
    pressed = { nodeId: hit.nodeId, at: Date.now() };
    api.updateScene({ appState: { activeEmbeddable: { element, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} } });
    if (nodeKindOf(element) === "terminal") setActiveTerminal(hit.nodeId);
  };
  const onWheel = (event: WheelEvent) => {
    const hit = event.isTrusted ? liveControlAt(event.target) : null;
    // A field's text scrolls (keepFieldWheel), as in the active node.
    if (!hit || hit.control instanceof HTMLTextAreaElement) return;
    const active = canvasStore.getState().api?.getAppState().activeEmbeddable;
    if (!canvasStore.getState().api || (active?.state === "active" && active.element.id === hit.nodeId)) return;
    // Nor the list it may sit in, nor the page's zoom: the canvas's own.
    event.preventDefault();
    forwardWheel(event);
  };
  // Capture: before the control's own handlers (a menu opens on its press) and before Excalidraw's.
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("wheel", onWheel, true);
  };
}
