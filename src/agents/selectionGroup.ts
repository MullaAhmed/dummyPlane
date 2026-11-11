import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { LABEL_ROOM, ZONE_OFFSETS } from "@/canvas/canvasFocus";
import { canvasStore, type CanvasView } from "@/canvas/canvasStore";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import { nodesStore, terminalOf } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { boundsOf, frameAround, overlap } from "./groupLayout";
import { pantheonForNewGroup } from "./naming";
import { PANTHEONS } from "./names";
import { screenRectOf } from "./placement";

/** Why a selection cannot be grouped: see `groupingOf`. */
export type GroupingBlock = "groupSelected" | "alreadyGrouped" | "inTheWay";

export interface Grouping {
  /** The terminals a group would wrap, in scene order. */
  terminals: ExcalidrawElement[];
  blocked: GroupingBlock | null;
}

/**
 * The room a terminal takes once open: a minimized one is a card now, but
 * expands to its old height, and Excalidraw clips a child to its frame.
 */
function fullRect(terminal: ExcalidrawElement): Rect {
  const payload = terminalOf(nodesStore.getState().nodes[terminal.id]);
  if (!payload?.minimized) return { x: terminal.x, y: terminal.y, width: terminal.width, height: terminal.height };
  const width = Math.max(terminal.width, payload.expandedWidth ?? NODE_SIZE.terminal.width);
  const height = Math.max(terminal.height, payload.expandedHeight ?? NODE_SIZE.terminal.height);
  return { x: terminal.x, y: terminal.y, width, height };
}

/**
 * What "Group" does with a selection. Only terminals join the group: a fleet, a
 * note or a drawing in the selection stays where it is, outside the frame (a
 * frame holds terminals, and a fleet is linked to a group by a wire, not by
 * sitting in it). Excalidraw frames never nest, and a frame holds only what is
 * its child, so the selection is refused, with its reason, rather than bent
 * into a group that lies:
 * - it holds a frame, or a terminal already in one (pulling a terminal out of
 *   its group would leave that group's frame empty or overlapped by the new one);
 * - a node or frame that is not one of the terminals stands inside their box
 *   (Shift+click on either side of a terminal: the frame would show it in the
 *   group, and a drag of the group would leave it behind).
 */
export function groupingOf(elements: readonly ExcalidrawElement[], ids: readonly string[]): Grouping {
  const chosen = new Set(ids);
  const live = elements.filter((e) => !e.isDeleted);
  const selected = live.filter((e) => chosen.has(e.id));
  const terminals = selected.filter((e) => nodeKindOf(e) === "terminal");
  if (selected.some((e) => e.type === "frame")) return { terminals, blocked: "groupSelected" };
  if (terminals.some((e) => e.frameId)) return { terminals, blocked: "alreadyGrouped" };
  if (terminals.length >= 2) {
    const box = boundsOf(terminals.map(fullRect));
    const members = new Set(terminals.map((t) => t.id));
    const inTheWay = live.some((e) => !members.has(e.id) && (e.type === "frame" || nodeKindOf(e) !== null) && overlap(e, box) > 0);
    if (inTheWay) return { terminals, blocked: "inTheWay" };
  }
  return { terminals, blocked: null };
}

/** The label sits `LABEL_ROOM` above its frame (GroupLabels), under the glass bars that cover the canvas edges. */
function labelShows(frame: Rect, view: CanvasView): boolean {
  const { x, y } = screenRectOf(frame, view);
  const top = y - LABEL_ROOM;
  return x >= 0 && x < view.width && top >= ZONE_OFFSETS.top && top + LABEL_ROOM <= view.height - ZONE_OFFSETS.bottom;
}

/**
 * Wraps the selected terminals in a new group and starts naming it: the frame
 * and the members' `frameId` are one scene update, so one undo takes the group
 * back. The group is selected, so a drag moves it whole; Excalidraw moves a
 * frame's children with it. Returns the frame's id, or null when there is
 * nothing to group.
 */
export function groupSelection(ids: readonly string[]): string | null {
  const { api } = canvasStore.getState();
  const workspaceId = workspacesStore.getState().activeId;
  if (!api || !workspaceId) return null;
  const elements = api.getSceneElementsIncludingDeleted();
  const { terminals, blocked } = groupingOf(elements, ids);
  if (blocked || terminals.length < 2) return null;
  // The pantheon is unused by the other groups, so its label is a name no other group has; the agents keep theirs.
  const pantheon = pantheonForNewGroup(workspaceId);
  const name = PANTHEONS.find((p) => p.id === pantheon)?.label ?? pantheon;
  const frame = createGroupFrame(frameAround(terminals.map(fullRect)), name, { role: "general", pantheon });
  const members = new Set(terminals.map((t) => t.id));
  api.updateScene({
    // The frame last: Excalidraw keeps a frame above its children.
    elements: [...elements.map((e) => (members.has(e.id) ? newElementWith(e, { frameId: frame.id }) : e)), frame],
    appState: { selectedElementIds: { [frame.id]: true }, selectedGroupIds: {}, activeEmbeddable: null },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  requestAnimationFrame(() => {
    // Its label's field takes the name, so the label must show: scrolled to, without `focusGroup`, whose
    // hand-back to the canvas would clear the selection and blur the field.
    if (!labelShows(frame, canvasStore.getState().view)) {
      api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true, maxZoom: 1, canvasOffsets: { ...ZONE_OFFSETS, top: ZONE_OFFSETS.top + LABEL_ROOM } });
    }
    uiStore.getState().setRenamingGroup(frame.id);
  });
  return frame.id;
}
