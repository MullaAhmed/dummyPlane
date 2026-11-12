import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import { notesByHost } from "@/nodes/note/link";
import { frameAround, GROUP_GAP, overlap } from "./groupLayout";
import { spawnTreeOf, type ParentOf } from "./spawnLayout";

/**
 * The group an agent in no group gathers its sub-agents in: spawn_agent
 * (./spawn.ts) makes it at the first one, the next ones join it as they join
 * any group.
 *
 * The parent is in it, with its whole live spawn tree: a group holds a family,
 * not just the children. The layouts need it so: the flowchart
 * (`layoutSpawnTree`) grows only the frame of the tree's root and takes any
 * other frame for an obstacle, so children in a frame their parent is not in
 * would be pushed out of it; and a group's Arrange leaves alone a group whose
 * spawn tree reaches out of its frame (`tidyGroup`). With the parent in it,
 * the frame grows with the tree, Arrange keeps the tree whole, folding the
 * group folds the family, and closing or ungrouping it does what it does to
 * any group. The parent closed alone leaves its sub-agents in the group.
 */

export interface FamilyOptions {
  /** The frame's name, from the tree's root: "Batman's sub-agents". */
  label: (rootId: string) => string;
  /** The set the family's new agents are named from: one no group uses. */
  pantheon: string;
  /** A mission's Manager: its team keeps the vertical tree it lays out, in no group. */
  isManager: (nodeId: string) => boolean;
  /** The room a terminal takes once open (a minimized one expands): Excalidraw clips a child to its frame. */
  fullRect: (element: ExcalidrawElement) => Rect;
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` with `fields`, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function changed<T extends ExcalidrawElement>(element: T, fields: Partial<T>): T {
  return { ...element, ...fields, version: element.version + 1, versionNonce: random(), updated: Date.now() };
}

/**
 * The scene with a new group around `parentId`'s family, and the group's id;
 * null when its sub-agent opens beside it instead, as before. A family gets a
 * group when its whole live spawn tree is terminals in no frame, none of them
 * a Manager (a mission's team keeps its own layout), its root a terminal (a
 * Fleet is wired to groups, never held in one), and the frame would cover no
 * other node nor frame: around the tree's members, the grid's padding on every
 * side, and, for a parent with no live child yet, the spot its first one takes
 * right of it (the flowchart's), so the frame is the size it ends at. The
 * members' quick notes are not in the way: they stand in no frame, beside
 * their host. The frame comes last, above its members, as Excalidraw keeps it.
 */
export function withFamilyGroup(
  elements: readonly ExcalidrawElement[],
  parentId: string,
  parentOf: ParentOf,
  options: FamilyOptions,
): { elements: ExcalidrawElement[]; frameId: string } | null {
  const live = elements.filter((e) => !e.isDeleted);
  const parent = live.find((e) => e.id === parentId);
  if (!parent || nodeKindOf(parent) !== "terminal") return null;
  const tree = spawnTreeOf(elements, parentOf, parentId);
  if (!tree) return null;
  const members = live.filter((e) => tree.ids.has(e.id));
  if (members.some((m) => nodeKindOf(m) !== "terminal" || m.frameId || options.isManager(m.id))) return null;
  const rects = members.map(options.fullRect);
  if (!tree.children[parentId]?.length) {
    rects.push({ x: parent.x + parent.width + GROUP_GAP, y: parent.y, width: NODE_SIZE.terminal.width, height: NODE_SIZE.terminal.height });
  }
  const box = frameAround(rects);
  const byHost = notesByHost(elements);
  const notes = new Set(members.flatMap((m) => (byHost.get(m.id) ?? []).map((n) => n.id)));
  const inTheWay = live.some((e) => !tree.ids.has(e.id) && !notes.has(e.id) && (nodeKindOf(e) !== null || e.type === "frame") && overlap(e, box) > 0);
  if (inTheWay) return null;
  const frame = createGroupFrame(box, options.label(tree.rootId), { role: "general", pantheon: options.pantheon });
  return {
    elements: [...elements.map((e) => (tree.ids.has(e.id) ? changed(e, { frameId: frame.id }) : e)), frame],
    frameId: frame.id,
  };
}
