import { expandTerminal } from "@/nodes/terminal/minimize";
import { focusTerminal } from "@/nodes/terminal/registry";
import { currentWorkArea, laneOccupied } from "@/shell/lane";
import { BOTTOM_BAR_HEIGHT, LANE_ROOM, TOP_ROW_HEIGHT, workArea, type Insets } from "@/shell/layout";
import { setActiveTerminal } from "./activeTerminal";
import { signalArrival } from "./arrivalSignal";
import { canvasStore, fullSizeView } from "./canvasStore";
import { terminalWithKeyboard } from "./keyboardFocus";
import { nodeKindOf, type NodeKind } from "./nodeElement";
import { cameraMotion } from "./viewActions";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** The work area with the lane free: what the pure reckonings below take when they are given none. */
const FREE_LANE = workArea(false);

/**
 * The view stays when the terminal shows whole, at 100 %, in the zone utile
 * (`area`, shell/layout.ts): the canvas less the bars at the top, the command
 * bar's band at the bottom, the rails and, while it has an occupant, the lane.
 */
export function needsMove(rect: Rect, view: Viewport, area: Insets = FREE_LANE): boolean {
  if (view.zoom !== 1) return true;
  const left = rect.x + view.scrollX;
  const top = rect.y + view.scrollY;
  return left < area.left || top < area.top || left + rect.width > view.width - area.right || top + rect.height > view.height - area.bottom;
}

/** The waiting notice would hide part of the node: an agent's question sits at the bottom of its terminal. */
function underWaitingNotice(rect: Rect, view: Viewport): boolean {
  const notice = document.querySelector("[data-waiting-notice]")?.getBoundingClientRect();
  if (!notice) return false;
  const left = rect.x + view.scrollX;
  const top = rect.y + view.scrollY;
  return left < notice.right && left + rect.width > notice.left && top < notice.bottom && top + rect.height > notice.top;
}

/**
 * The terminal at 100 %, centered in the usable area (`area`): clear of the rails and of an occupied lane. One wider
 * than the area keeps its left edge on the area's, where its lines start, and runs on under the lane's side.
 */
export function arrivalView(rect: Rect, viewport: { width: number; height: number }, area: Insets = FREE_LANE) {
  return fullSizeView(rect, viewport, area);
}

/** How long the activation an arrival in place made is told apart from another (Canvas reads it on its next change). */
const IN_PLACE_MS = 1000;

/** The node an arrival that leaves the view just activated, and when: Canvas must not bring it to 100 % for that. */
let inPlace: { nodeId: string; at: number } | null = null;

/**
 * Whether the activation of `nodeId` comes from an arrival that leaves the view (a launch, which showed its terminal
 * as it does): Canvas then keeps the zoom the person has, and does not bring the terminal to 100 %. Read once.
 */
export function arrivedInPlace(nodeId: string): boolean {
  const mark = inPlace;
  inPlace = null;
  return mark !== null && mark.nodeId === nodeId && Date.now() - mark.at <= IN_PLACE_MS;
}

/** How many frames (about two seconds) the keyboard is offered to an arriving node: after a workspace switch its terminal mounts late. */
export const FOCUS_FRAMES = 120;

/**
 * Offers the keyboard on each of the next frames until `focus` succeeds:
 * Excalidraw shows a node that was off screen once the view has moved, and
 * after a workspace switch its terminal may only be mounted a frame later.
 */
function focusSoon(focus: () => boolean, token: number, frames = FOCUS_FRAMES) {
  requestAnimationFrame(() => {
    // A newer arrival owns the keyboard: its loop replaces this one.
    if (token !== generation) return;
    if (!focus() && frames > 1) focusSoon(focus, token, frames - 1);
    else arriving = null;
  });
}

let generation = 0;
let arriving: string | null = null;

/** The node an arrival is still giving the keyboard to: a Ctrl+Tab repeat steps on from it, not from the terminal left. */
export function arrivingNode(): string | null {
  return arriving;
}

/** Gives the keyboard to the xterm of a terminal or of a fleet's session. */
function focusNodeInput(nodeId: string, kind: NodeKind | null): boolean {
  focusTerminal(nodeId);
  if (kind === "fleet") return document.activeElement?.closest(`[data-fleet="${nodeId}"]`) != null;
  return terminalWithKeyboard() === nodeId;
}

/**
 * Arrival on a node, shared by Ctrl+Tab and Ctrl+P:
 * the view moves only if needed; the node is activated as by a click in its
 * body, without selecting it, and the selection left behind is cleared: the
 * canvas keys (Suppr, arrows) must not act on a node out of sight. A terminal
 * takes the keyboard and flashes; a fleet gets the cursor in its
 * field. False when the node is not on the canvas. `moveView: false` leaves the view to the
 * caller: a launch, which has already shown its terminal (or its group) as it does.
 */
export function arrive(nodeId: string, { moveView = true }: { moveView?: boolean } = {}): boolean {
  const api = canvasStore.getState().api;
  let element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return false;
  // A folded group keeps its terminals off the screen: unfold it, then arrive.
  const folded = canvasStore.getState().frames.find((f) => f.group?.folded && f.memberIds.includes(nodeId));
  if (folded) {
    void import("@/agents/groups").then(({ setGroupFolded }) => {
      setGroupFolded(folded.id, false);
      setTimeout(() => arrive(nodeId, { moveView }), 0);
    });
    return true;
  }
  // A minimized terminal expands first; the view and the activation take its element at full size.
  if (expandTerminal(nodeId)) element = api.getSceneElements().find((e) => e.id === nodeId) ?? element;
  const app = api.getAppState();
  const view = { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value, width: app.width, height: app.height };
  const area = currentWorkArea();
  const move = moveView && (needsMove(element, view, area) || underWaitingNotice(element, view)) ? arrivalView(element, view, area) : {};
  // Left where the launch showed it, at the person's zoom: the activation below must not zoom to 100 % (Canvas).
  inPlace = moveView ? null : { nodeId, at: Date.now() };
  api.updateScene({
    appState: { ...move, activeEmbeddable: { element, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
  });
  const kind = nodeKindOf(element);
  // Send goes here from now on (the activation reaches the command bar a frame later, and not at all for a repeat).
  if (kind === "terminal") setActiveTerminal(nodeId);
  generation += 1;
  arriving = nodeId;
  focusSoon(() => focusNodeInput(nodeId, kind), generation);
  // A fleet takes only the view and the keyboard of an arrival, not its flash
  // (the palette's Fleets row: "same view as an arrival").
  if (kind === "terminal") signalArrival(nodeId);
  return true;
}

/** Brings a node whole into the zone utile at 100 % if it is not, without activating it or taking the keyboard. False when it is gone. */
export function showNode(nodeId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return false;
  const app = api.getAppState();
  const view = { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value, width: app.width, height: app.height };
  const area = currentWorkArea();
  if (needsMove(element, view, area)) api.updateScene({ appState: arrivalView(element, view, area) });
  return true;
}

/**
 * Where a node counts as in sight: the window under the bars and above the command band, less the lane while it has
 * an occupant. The rails do not count: a node seen beside them is seen, and a launch that shows it leaves the view.
 */
function seenArea(occupied: boolean): Insets {
  return { top: TOP_ROW_HEIGHT, right: occupied ? LANE_ROOM : 0, bottom: BOTTOM_BAR_HEIGHT, left: 0 };
}

/** The scroll that centres `element` in `area` at the zoom `app` has: what `scrollToContent`'s fit held to that zoom lands on. */
function centredIn(element: Rect, app: { width: number; height: number; zoom: { value: number } }, area: Insets) {
  const zoom = app.zoom.value;
  return {
    scrollX: (app.width - area.right + area.left) / 2 / zoom - (element.x + element.width / 2),
    scrollY: (app.height - area.bottom + area.top) / 2 / zoom - (element.y + element.height / 2),
  };
}

/**
 * Scrolls to a node added out of sight (Excalidraw mounts a node, and so
 * starts its agent, only once it is shown), at the zoom the view has, centred
 * in the work area: the app asked, so it glides for CAMERA_MS (at once under
 * reduced motion). False when it is gone. Excalidraw reads `canvasOffsets`
 * only when it fits: a fit held to the zoom the view has centres without zooming.
 * - A node in sight in the window, even partly, beside the rails included, leaves the view alone.
 * - One the occupied lane hides whole moves the view only if the node the person was at (the active one: the Fleet
 *   whose Launch the mission was pressed) stays in sight after it; else the view stays where the press was.
 */
export function revealNode(nodeId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return false;
  const app = api.getAppState();
  const occupied = laneOccupied();
  if (inSight(element, app, seenArea(occupied))) return true;
  const area = currentWorkArea();
  if (occupied && inSight(element, app, seenArea(false))) {
    const launcherId = app.activeEmbeddable?.element.id;
    const launcher = launcherId && launcherId !== nodeId ? api.getSceneElements().find((e) => e.id === launcherId && !e.isDeleted) : undefined;
    if (launcher && !inSight(launcher, { ...app, ...centredIn(element, app, area) }, seenArea(true))) return true;
  }
  const zoom = app.zoom.value;
  api.scrollToContent(element, { ...cameraMotion("app"), fitToContent: true, minZoom: zoom, maxZoom: zoom, canvasOffsets: area });
  return true;
}

/** Some of the node shows in the zone utile (`area`), at the zoom the view has. */
function inSight(element: Rect, app: { scrollX: number; scrollY: number; zoom: { value: number }; width: number; height: number }, area: Insets): boolean {
  const zoom = app.zoom.value;
  const left = (element.x + app.scrollX) * zoom;
  const top = (element.y + app.scrollY) * zoom;
  return left + element.width * zoom > area.left && left < app.width - area.right && top + element.height * zoom > area.top && top < app.height - area.bottom;
}

/** Whether the canvas on screen shows some of the node `nodeId`, left of an occupied lane (deleted or on another workspace's canvas: no). */
export function nodeInSight(nodeId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === nodeId && !e.isDeleted);
  return api !== null && api !== undefined && element !== undefined && inSight(element, api.getAppState(), seenArea(laneOccupied()));
}
