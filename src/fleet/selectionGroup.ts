import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createGroupFrame } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { frameAround } from "./groupLayout";
import { pantheonForNewGroup } from "./naming";
import { PANTHEONS } from "./names";

/** Why a selection cannot be grouped: a group is in it, or one of its terminals already belongs to one. */
export type GroupingBlock = "groupSelected" | "alreadyGrouped";

export interface Grouping {
  /** The terminals a group would wrap, in scene order. */
  terminals: ExcalidrawElement[];
  blocked: GroupingBlock | null;
}

/**
 * What "Group" does with a selection. Only terminals join the group: a fleet, a
 * note or a drawing in the selection stays where it is, outside the frame (a
 * frame holds terminals, and a fleet is linked to a group by a wire, not by
 * sitting in it). Excalidraw frames never nest, so a selection that holds a
 * frame, or a terminal already in one, is refused with its reason rather than
 * moved: pulling a terminal out of its group would leave that group's frame
 * empty or overlapped by the new one.
 */
export function groupingOf(elements: readonly ExcalidrawElement[], ids: readonly string[]): Grouping {
  const chosen = new Set(ids);
  const selected = elements.filter((e) => !e.isDeleted && chosen.has(e.id));
  const terminals = selected.filter((e) => nodeKindOf(e) === "terminal");
  if (selected.some((e) => e.type === "frame")) return { terminals, blocked: "groupSelected" };
  if (terminals.some((e) => e.frameId)) return { terminals, blocked: "alreadyGrouped" };
  return { terminals, blocked: null };
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
  const frame = createGroupFrame(frameAround(terminals), name, { role: "general", pantheon });
  const members = new Set(terminals.map((t) => t.id));
  api.updateScene({
    // The frame last: Excalidraw keeps a frame above its children.
    elements: [...elements.map((e) => (members.has(e.id) ? newElementWith(e, { frameId: frame.id }) : e)), frame],
    appState: { selectedElementIds: { [frame.id]: true }, selectedGroupIds: {}, activeEmbeddable: null },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  // As "Rename the group": its label's field takes the name, selected for typing. No keyboard hand-back after: it would blur the field.
  requestAnimationFrame(() => uiStore.getState().setRenamingGroup(frame.id));
  return frame.id;
}
