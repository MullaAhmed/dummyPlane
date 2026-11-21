import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { LABEL_ROOM, zoneOffsets } from "@/canvas/canvasFocus";
import { canvasStore, type CanvasView } from "@/canvas/canvasStore";
import { createGroupFrame, groupInfoOf, type Rect } from "@/canvas/groups";
import { NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import { cameraMotion, type CameraInput } from "@/canvas/viewActions";
import { nodesStore, terminalOf } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { anchorsOf } from "./attachments";
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
 * Any other element: its own box.
 */
export function fullRect(terminal: ExcalidrawElement): Rect {
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
 *   group, and a drag of the group would leave it behind). What the terminals
 *   carry is not in the way: a quick note of one of them, which its own watch
 *   keeps beside its host (src/nodes/note), so it goes where the group goes, and
 *   Arrange puts it right of its host, between two terminals; and an output one
 *   of them showed (src/nodes/output), which belongs in its agent's group and
 *   becomes a member of it. See `groupBox`.
 * The box is checked for a single terminal too: linking two agents may make a
 * group around one of them (./linkGroup.ts).
 */
export function groupingOf(elements: readonly ExcalidrawElement[], ids: readonly string[]): Grouping {
  const chosen = new Set(ids);
  const live = elements.filter((e) => !e.isDeleted);
  const selected = live.filter((e) => chosen.has(e.id));
  const terminals = selected.filter((e) => nodeKindOf(e) === "terminal");
  if (selected.some((e) => e.type === "frame")) return { terminals, blocked: "groupSelected" };
  if (terminals.some((e) => e.frameId)) return { terminals, blocked: "alreadyGrouped" };
  if (terminals.length > 0) {
    const { box, carried } = groupBox(live, terminals);
    const members = new Set(terminals.map((t) => t.id));
    const inTheWay = live.some((e) => !members.has(e.id) && !carried.has(e.id) && (e.type === "frame" || nodeKindOf(e) !== null) && overlap(e, box) > 0);
    if (inTheWay) return { terminals, blocked: "inTheWay" };
  }
  return { terminals, blocked: null };
}

/**
 * What a group of `terminals` holds on the canvas: their box, grown around what
 * they carry that stands in it (a stack of notes may run past the terminals'
 * bottom, an output too), and `carried`, every quick note kept beside one of
 * them and every output one of them showed. The frame goes around this box, so
 * this box is the one nothing else may stand in. `outputs` are the carried
 * outputs it holds: they become members of the group. A carried note stays in
 * no frame (its watch keeps it beside its host); a carried item outside the box
 * stays outside the frame, as it did.
 */
function groupBox(live: readonly ExcalidrawElement[], terminals: readonly ExcalidrawElement[]): { box: Rect; carried: Set<string>; outputs: Set<string> } {
  const members = new Set(terminals.map((t) => t.id));
  const anchorOf = anchorsOf(live);
  const items = live.filter((e) => {
    const attachment = anchorOf(e);
    if (!attachment || !members.has(attachment.anchor)) return false;
    return attachment.beside === true || nodeKindOf(e) === "output";
  });
  const held: Rect[] = terminals.map(fullRect);
  const outputs = new Set<string>();
  let box = boundsOf(held);
  // An item taken in grows the box, which may reach the next one (a stack of notes).
  let waiting = items;
  for (;;) {
    const reached = waiting.filter((n) => overlap(n, box) > 0);
    if (reached.length === 0) break;
    held.push(...reached);
    for (const item of reached) if (nodeKindOf(item) === "output") outputs.add(item.id);
    box = boundsOf(held);
    waiting = waiting.filter((n) => !reached.includes(n));
  }
  return { box, carried: new Set(items.map((n) => n.id)), outputs };
}

/** Why a selection's Ungroup is greyed: see `ungroupingOf`. */
export type UngroupingBlock = "manyGroups" | "outsideGroup";

/**
 * What "Ungroup" does with a selection: a dummyPlane group's frame goes (`group`), or
 * Excalidraw's groups of drawings come apart (`shapes`, their ids). Null when it has
 * nothing to ungroup: the key and the ring's place are then Excalidraw's and Group's.
 */
export type Ungrouping =
  | { kind: "group"; groupId: string | null; blocked: UngroupingBlock | null }
  | { kind: "shapes"; groupIds: string[]; blocked: null };

/**
 * What "Ungroup" does with the selection `ids` (Ctrl+Shift+G, the selection ring, the palette):
 * - A dummyPlane group, when the selection holds its frame or one of its members (a terminal,
 *   a Fleet): the whole group, as its menu's Ungroup does, a single member selected included
 *   (as Excalidraw ungroups a group from any of its elements). Greyed when the selection spans
 *   several groups (`manyGroups`) or holds something outside the frame (`outsideGroup`). What
 *   else sits in the frame (a drawing, a quick note) is not a member: selected with members it
 *   is not outside either; alone, it ungroups as a drawing. Nor is a member's quick note outside,
 *   though it is in no frame: a box around the group takes it with the rest.
 * - Else Excalidraw's groups of drawings, with no terminal in the selection: the outermost
 *   group of each selected element, as Excalidraw's own Ungroup takes them (`editingGroupId`,
 *   the group entered by a double-click, and those around it are kept), a group of one
 *   element left aside.
 */
export function ungroupingOf(elements: readonly ExcalidrawElement[], ids: readonly string[], editingGroupId: string | null = null): Ungrouping | null {
  const chosen = new Set(ids);
  const live = elements.filter((e) => !e.isDeleted);
  const selected = live.filter((e) => chosen.has(e.id));
  if (selected.length === 0) return null;
  const groupFrames = new Set(live.filter((e) => groupInfoOf(e) !== null).map((e) => e.id));
  // Its members are its terminals and a Fleet dragged in. A quick note, an output or a board in its frame is not one:
  // alone, it never ungroups the group (it has no ring of its own, and opens the selection's).
  const member = (e: ExcalidrawElement) => nodeKindOf(e) === "terminal" || nodeKindOf(e) === "fleet";
  const homes = new Set(
    selected.flatMap((e) => {
      if (groupFrames.has(e.id)) return [e.id];
      return e.frameId && groupFrames.has(e.frameId) && member(e) ? [e.frameId] : [];
    }),
  );
  if (homes.size > 1) return { kind: "group", groupId: null, blocked: "manyGroups" };
  if (homes.size === 1) {
    const [groupId] = homes;
    // A member's quick note is in no frame (src/nodes/note), yet stands beside it and goes with it: not outside.
    const anchorOf = anchorsOf(live);
    const byId = new Map(live.map((e) => [e.id, e]));
    const carried = (e: ExcalidrawElement) => {
      const attachment = anchorOf(e);
      return attachment?.beside === true && byId.get(attachment.anchor)?.frameId === groupId;
    };
    const outside = selected.some((e) => e.id !== groupId && e.frameId !== groupId && !carried(e));
    return outside ? { kind: "group", groupId, blocked: "outsideGroup" } : { kind: "group", groupId, blocked: null };
  }
  if (selected.some((e) => nodeKindOf(e) === "terminal")) return null;
  const outermost = new Set(
    selected.flatMap((e) => {
      const own = e.groupIds ?? [];
      const at = editingGroupId ? own.indexOf(editingGroupId) : -1;
      const groupIds = at > -1 ? own.slice(0, at) : own;
      return groupIds.length > 0 ? [groupIds[groupIds.length - 1]] : [];
    }),
  );
  const groupIds = [...outermost].filter((id) => live.filter((e) => e.groupIds?.includes(id)).length >= 2);
  return groupIds.length > 0 ? { kind: "shapes", groupIds, blocked: null } : null;
}

/** The label sits `LABEL_ROOM` above its frame (GroupLabels), in the work area: under the glass bars, clear of the rails and of an occupied lane. */
function labelShows(frame: Rect, view: CanvasView): boolean {
  const { x, y } = screenRectOf(frame, view);
  const top = y - LABEL_ROOM;
  const area = zoneOffsets();
  return x >= area.left && x < view.width - area.right && top >= area.top && top + LABEL_ROOM <= view.height - area.bottom;
}

/**
 * `elements` with `terminals` (a grouping `groupingOf` lets through) wrapped in a
 * new general group of `pantheon`, named after it, and that group's frame. The
 * frame fits the terminals and what they carry between them: the outputs they
 * showed there join the group with them; a quick note stays in no frame, as
 * beside any grouped terminal (a frame would clip it, and the note watch takes
 * it out again). The frame comes last: Excalidraw keeps a frame above its
 * children. Nothing moves.
 */
export function withNewGroup(elements: readonly ExcalidrawElement[], terminals: readonly ExcalidrawElement[], pantheon: string): { elements: ExcalidrawElement[]; frame: ExcalidrawElement } {
  // The pantheon is unused by the other groups, so its label is a name no other group has; the agents keep theirs.
  const name = PANTHEONS.find((p) => p.id === pantheon)?.label ?? pantheon;
  const { box, outputs } = groupBox(
    elements.filter((e) => !e.isDeleted),
    terminals,
  );
  const frame = createGroupFrame(frameAround([box]), name, { role: "general", pantheon });
  const members = new Set([...terminals.map((t) => t.id), ...outputs]);
  return { elements: [...elements.map((e) => (members.has(e.id) ? newElementWith(e, { frameId: frame.id }) : e)), frame], frame };
}

/**
 * Wraps the selected terminals in a new group (`withNewGroup`) and starts naming
 * it: the frame and the members' `frameId` are one scene update, so one undo
 * takes the group back. The group is selected, so a drag moves it whole;
 * Excalidraw moves a frame's children with it. The view, when it must move to
 * show the label, moves as `input` asked (cameraMotion). Returns the frame's id,
 * or null when there is nothing to group.
 */
export function groupSelection(ids: readonly string[], input: CameraInput): string | null {
  const { api } = canvasStore.getState();
  const workspaceId = workspacesStore.getState().activeId;
  if (!api || !workspaceId) return null;
  const elements = api.getSceneElementsIncludingDeleted();
  const { terminals, blocked } = groupingOf(elements, ids);
  if (blocked || terminals.length < 2) return null;
  const { elements: next, frame } = withNewGroup(elements, terminals, pantheonForNewGroup(workspaceId));
  api.updateScene({
    elements: next,
    appState: { selectedElementIds: { [frame.id]: true }, selectedGroupIds: {}, activeEmbeddable: null },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  requestAnimationFrame(() => {
    // Its label's field takes the name, so the label must show: scrolled to, without `focusGroup`, whose
    // hand-back to the canvas would clear the selection and blur the field.
    if (!labelShows(frame, canvasStore.getState().view)) {
      const offsets = zoneOffsets();
      api.scrollToContent(frame, { fitToViewport: true, viewportZoomFactor: 0.9, ...cameraMotion(input), maxZoom: 1, canvasOffsets: { ...offsets, top: offsets.top + LABEL_ROOM } });
    }
    uiStore.getState().setRenamingGroup(frame.id);
  });
  return frame.id;
}
