import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { closeRadial } from "@/radial/radialState";
import { currentWorkArea } from "@/shell/lane";
import type { Insets } from "@/shell/layout";
import { uiStore } from "@/store/ui";
import { canvasStore } from "./canvasStore";
import { groupInfoOf } from "./groups";
import { nodeKindOf } from "./nodeElement";
import { cameraMotion, type CameraInput } from "./viewActions";

/**
 * The glass bars, the rails and an occupied lane cover the canvas's edges: views fit the zone utile, the work area
 * (shell/layout.ts), not the whole window.
 */
export function zoneOffsets(): Insets {
  return currentWorkArea();
}

/** A group's name sits on its frame, above it: room for the label under the tabs. */
export const LABEL_ROOM = 24;

/**
 * Shift+Escape: the terminal or field that has the keyboard
 * loses it, the active terminal is deactivated, nothing gets selected (a
 * click into a terminal selects it: that selection is cleared, or Suppr
 * would delete the terminal just left), and the keyboard goes to Excalidraw's
 * container, where Excalidraw reads its keys (dummyPlane does not set
 * `handleKeyboardGlobally`). The terminal left stays the one Send goes to
 * without a selection (see `activeTerminal`): the command bar names it.
 */
export function releaseToCanvas(doc: Document = document) {
  const active = doc.activeElement;
  // A rename field validates on blur: Escape first, so Shift+Escape cancels it like Escape does.
  // Never into a terminal's textarea: the agent would read it.
  if (active instanceof HTMLInputElement) active.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  if (active instanceof HTMLElement) active.blur();
  canvasStore.getState().api?.updateScene({ appState: { activeEmbeddable: null, selectedElementIds: {}, selectedGroupIds: {} } });
  // Placement and link modes end here too: their own Escape listeners never see Shift+Escape. Nor does the radial ring's:
  // the shortcuts' listener comes first (main.tsx) and consumes the key.
  uiStore.getState().setPlacing(null);
  uiStore.getState().setLinking(null);
  closeRadial();
  doc.querySelector<HTMLElement>(".excalidraw-container")?.focus();
}

/** What the overview frames: the nodes and their group frames; the whole scene without nodes. */
export function overviewTargets(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const live = elements.filter((e) => !e.isDeleted);
  const nodes = live.filter((e) => {
    const kind = nodeKindOf(e);
    return kind === "terminal" || kind === "fleet";
  });
  if (nodes.length === 0) return live;
  const holding = new Set(nodes.map((n) => n.frameId));
  return [...live.filter((e) => e.type === "frame" && holding.has(e.id) && groupInfoOf(e) !== null), ...nodes];
}

/**
 * Ctrl+Shift+A: every node in view, with a 10 % margin, then the keyboard to the canvas. At once from the keyboard;
 * a glide of CAMERA_MS from the pointer (cameraMotion).
 */
export function overview(input: CameraInput) {
  const api = canvasStore.getState().api;
  if (!api) return;
  const targets = overviewTargets(api.getSceneElements());
  if (targets.length > 0) api.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: 0.9, ...cameraMotion(input), canvasOffsets: zoneOffsets() });
  releaseToCanvas();
}

/**
 * A group of "Go to": its frame fitted, at 100 % at most, then the keyboard to the canvas, moved as `input` asked
 * (cameraMotion). False when it is gone.
 */
export function focusGroup(frameId: string, input: CameraInput): boolean {
  const api = canvasStore.getState().api;
  const frame = api?.getSceneElements().find((e) => e.id === frameId && e.type === "frame");
  if (!api || !frame) return false;
  const offsets = zoneOffsets();
  api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.9, ...cameraMotion(input), maxZoom: 1, canvasOffsets: { ...offsets, top: offsets.top + LABEL_ROOM } });
  releaseToCanvas();
  return true;
}
