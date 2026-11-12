import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";
import { notesByHost } from "@/nodes/note/link";
import type { Size } from "./flowLayout";
import { isDownTree, isPinned, layoutSpawnTree, spawnTreeOf, type ParentOf } from "./spawnLayout";
import type { Point } from "./terminals";
import { downLayout } from "./treeLayout";
import { isSpawnWire, isTalkWire, isWire, wireReading } from "./wires";

/**
 * Arrange's `tree` layout (./arrange.ts, ./arrangeLayout.ts): who opened
 * whom, downward.
 *
 * - A spawn tree (agents that opened agents) is laid out downward from its
 *   root, its children in rows under it, as a mission's Manager lays out its
 *   team (`downLayout`), by the spawn layout itself (`layoutSpawnTree`), its
 *   wires routed as a vertical tree's. Its root is marked (`isDownTree`), so
 *   the next sub-agent, a close or an undo lay it out downward again instead
 *   of back into a flowchart; the nodes the user had moved by hand are no
 *   longer pinned: the tree is laid out whole. It then moves whole, as in the
 *   other layouts.
 * - What the tree arranges side by side (the blocks of the canvas, the pieces
 *   of a group) hang under one another by the wires between them, for the
 *   nodes no agent opened: a Fleet's link to its group or its agents, an
 *   agent's link to a board or to another agent. A wire is read the way its
 *   light runs (from a Fleet, else from where it starts); a talk wire (a
 *   message that passed) and a spawn wire join nobody here; each piece hangs
 *   under one other at most, the first wire in scene order, never under its
 *   own descendant.
 * - What nothing joins is a root of its own. The trees stand side by side,
 *   packed to the view's shape as the grid packs its blocks.
 *
 * Pure: elements in, elements and positions out.
 */

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` with `fields`, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function changed(element: ExcalidrawElement, fields: Partial<ExcalidrawElement>): ExcalidrawElement {
  return { ...element, ...fields, version: element.version + 1, versionNonce: random(), updated: Date.now() } as ExcalidrawElement;
}

/** `customData` without the marks a tree arrange takes off a node under the root: its pin, an old root's mark. */
function withoutMarks(customData: ExcalidrawElement["customData"]): ExcalidrawElement["customData"] {
  const { pinned: _pinned, downTree: _downTree, ...rest } = customData ?? {};
  return rest;
}

/**
 * The scene with the spawn trees of `rootIds` laid out downward, each alone
 * (only its nodes, their quick notes and the wires between them: what stands
 * around it moves after, with the rest of the arrange), its root marked, the
 * marks of the nodes under it taken off. The scene itself when nothing
 * changes; `moved` holds the nodes that moved, for their other wires to be
 * routed again.
 */
export function treesLaidDown(
  elements: readonly ExcalidrawElement[],
  rootIds: readonly string[],
  parentOf: ParentOf,
): { elements: readonly ExcalidrawElement[]; moved: Set<string> } {
  let scene = elements;
  const moved = new Set<string>();
  for (const rootId of rootIds) {
    const tree = spawnTreeOf(scene, parentOf, rootId);
    if (!tree || tree.rootId !== rootId || !tree.children[rootId]?.length) continue;
    const marked = scene.map((e) => {
      if (e.isDeleted || !tree.ids.has(e.id)) return e;
      if (e.id === rootId) return isDownTree(e) ? e : changed(e, { customData: { ...e.customData, downTree: true } });
      return isPinned(e) || isDownTree(e) ? changed(e, { customData: withoutMarks(e.customData) }) : e;
    });
    if (marked.some((e, i) => e !== scene[i])) scene = marked;
    const byHost = notesByHost(scene);
    const notes = new Set([...tree.ids].flatMap((id) => (byHost.get(id) ?? []).map((n) => n.id)));
    const joins = (e: ExcalidrawElement) => {
      const { startBinding, endBinding } = e as ExcalidrawArrowElement;
      return isWire(e) && startBinding != null && endBinding != null && tree.ids.has(startBinding.elementId) && tree.ids.has(endBinding.elementId);
    };
    const alone = scene.filter((e) => !e.isDeleted && (tree.ids.has(e.id) || notes.has(e.id) || joins(e)));
    const laid = layoutSpawnTree(alone, parentOf, rootId, (id) => id === rootId);
    if (!laid) continue;
    const byId = new Map(laid.map((e) => [e.id, e]));
    scene = scene.map((e) => {
      const next = byId.get(e.id);
      if (!next || next === e) return e;
      if (tree.ids.has(e.id) && (Math.abs(next.x - e.x) > 0.5 || Math.abs(next.y - e.y) > 0.5)) moved.add(e.id);
      return next;
    });
  }
  return { elements: scene, moved };
}

/**
 * Who hangs under whom among `items` by the wires of `elements` (see the top
 * of this file): `itemOf` names the item an element belongs to (none for one
 * out of the arrange), `spawned` whether a node was opened by another (its
 * place is its spawner's, not a wire's).
 */
export function wireParents<T>(
  items: readonly T[],
  itemOf: (elementId: string) => T | undefined,
  elements: readonly ExcalidrawElement[],
  spawned: (nodeId: string) => boolean,
): Map<T, T> {
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const isFleet = (id: string) => {
    const element = byId.get(id);
    return element !== undefined && nodeKindOf(element) === "fleet";
  };
  const parents = new Map<T, T>();
  const above = (item: T, other: T) => {
    const seen = new Set<T>();
    for (let up: T | undefined = item; up !== undefined && !seen.has(up); up = parents.get(up)) {
      if (up === other) return true;
      seen.add(up);
    }
    return false;
  };
  const inArrange = new Set(items);
  for (const e of elements) {
    if (e.isDeleted || !isWire(e) || isTalkWire(e) || isSpawnWire(e)) continue;
    const { startBinding, endBinding } = e as ExcalidrawArrowElement;
    if (!startBinding || !endBinding || !byId.has(startBinding.elementId) || !byId.has(endBinding.elementId)) continue;
    const { from, to } = wireReading(startBinding.elementId, endBinding.elementId, isFleet);
    if (spawned(to)) continue;
    const parent = itemOf(from);
    const child = itemOf(to);
    if (parent === undefined || child === undefined || parent === child || !inArrange.has(parent) || !inArrange.has(child)) continue;
    if (parents.has(child) || above(parent, child)) continue;
    parents.set(child, parent);
  }
  return parents;
}

/** A tree of items laid out downward: where each item's corner goes in the tree's box, and the box's size. */
export interface LaidTree<T> {
  items: T[];
  placed: Map<T, Point>;
  width: number;
  height: number;
}

/**
 * Each tree of `items` (roots: those without a parent in `parents`, in the
 * order given) laid out downward as `downLayout` lays out a team: children in
 * rows of at most four under their parent, in the order given, COLUMN_GAP
 * apart, GROUP_GAP between rows. `margin` widens an item on both sides (a
 * group keeps a group's gap from what stands beside it).
 */
export function treesOf<T>(items: readonly T[], parents: ReadonlyMap<T, T>, size: (item: T) => Size, margin: (item: T) => number = () => 0): LaidTree<T>[] {
  const ids = new Map(items.map((item, i) => [item, String(i)]));
  const children: Record<string, string[]> = {};
  for (const item of items) {
    const parent = parents.get(item);
    if (parent !== undefined && ids.has(parent)) (children[ids.get(parent)!] ??= []).push(ids.get(item)!);
  }
  const slot = (item: T): Size => ({ width: size(item).width + 2 * margin(item), height: size(item).height });
  const sizes = Object.fromEntries(items.map((item) => [ids.get(item)!, slot(item)]));
  const roots = items.filter((item) => parents.get(item) === undefined || !ids.has(parents.get(item)!));
  return roots.map((root) => {
    const { positions } = downLayout({ rootId: ids.get(root)!, root: { x: 0, y: 0, ...slot(root) }, children, sizes });
    const laid = items.filter((item) => positions.has(ids.get(item)!));
    const corner = (item: T) => {
      const p = positions.get(ids.get(item)!)!;
      return { x: p.x + margin(item), y: p.y };
    };
    const left = Math.min(...laid.map((item) => corner(item).x));
    const top = Math.min(...laid.map((item) => corner(item).y));
    const placed = new Map(laid.map((item) => [item, { x: corner(item).x - left, y: corner(item).y - top }]));
    const width = Math.max(...laid.map((item) => placed.get(item)!.x + size(item).width));
    const height = Math.max(...laid.map((item) => placed.get(item)!.y + size(item).height));
    return { items: laid, placed, width, height };
  });
}
