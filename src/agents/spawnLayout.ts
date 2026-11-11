import type { ExcalidrawArrowElement, ExcalidrawElement, FixedPointBinding } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { footprint, notesByHost, settleNotes } from "@/nodes/note/link";
import { flowLayout, type Size } from "./flowLayout";
import { COLUMN_GAP, PADDING, PADDING_BOTTOM, ROW_GAP } from "./groupLayout";
import type { Point } from "./terminals";
import { downLayout } from "./treeLayout";
import { elbowForm, isWire, sameFlags, withWireFlags, wireFlagsOf, type ElbowForm, type TreeRoute, type WireFlags } from "./wires";

/** Who spawned a node (its `spawnedBy`), deleted nodes included; null or undefined for none. */
export type ParentOf = (nodeId: string) => string | null | undefined;

/** A spawned node the user moved by hand: reflows leave it where it is, its own children follow it. */
export function isPinned(element: ExcalidrawElement): boolean {
  return element.customData?.pinned === true;
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` with `fields`, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function changed<T extends ExcalidrawElement>(element: T, fields: Partial<T>): T {
  return { ...element, ...fields, version: element.version + 1, versionNonce: random(), updated: Date.now() };
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

function bounds(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

/**
 * Where a spawn tree's descendants go when `region` would cover something
 * else: moved down or right only (never back over their parent), COLUMN_GAP
 * clear of every obstacle beside them and ROW_GAP above and below (the friezes
 * of steps hang there), the smallest move first. Always finds one: past the right
 * edge of every obstacle is free.
 */
export function clearRegion(region: Rect, obstacles: readonly Rect[]): Point {
  const grown = obstacles.map((o) => ({ x: o.x - COLUMN_GAP, y: o.y - ROW_GAP, width: o.width + 2 * COLUMN_GAP, height: o.height + 2 * ROW_GAP }));
  const isFree = (r: Rect) => grown.every((o) => !overlaps(r, o));
  if (isFree(region)) return { x: region.x, y: region.y };
  const xs = [region.x, ...grown.map((o) => o.x + o.width).filter((x) => x > region.x)];
  const ys = [region.y, ...grown.map((o) => o.y + o.height).filter((y) => y > region.y)];
  const candidates = xs
    .flatMap((x) => ys.map((y) => ({ ...region, x, y })))
    .sort((a, b) => Math.hypot(a.x - region.x, a.y - region.y) - Math.hypot(b.x - region.x, b.y - region.y));
  const found = candidates.find(isFree);
  return found ? { x: found.x, y: found.y } : { x: Math.max(...xs), y: region.y };
}

/** The live nodes of the scene by id. */
function liveNodes(elements: readonly ExcalidrawElement[]): Map<string, ExcalidrawElement> {
  return new Map(elements.filter((e) => !e.isDeleted && nodeKindOf(e) !== null).map((e) => [e.id, e]));
}

/**
 * The live node `nodeId` hangs from: its spawner, or the nearest live one up
 * the `spawnedBy` chain when that one was closed (its children move up a
 * column). Null for a root, or when the chain is broken.
 */
function liveParent(nodeId: string, parentOf: ParentOf, live: ReadonlyMap<string, ExcalidrawElement>): string | null {
  const seen = new Set([nodeId]);
  let parent = parentOf(nodeId);
  while (parent && !seen.has(parent)) {
    if (live.has(parent)) return parent;
    seen.add(parent);
    parent = parentOf(parent);
  }
  return null;
}

/** A spawn tree as the scene holds it: its root and each node's live children, in scene order. */
export interface SpawnTree {
  rootId: string;
  children: Record<string, string[]>;
  /** Every node of the tree, the root included. */
  ids: Set<string>;
}

/**
 * The spawn tree `nodeId` belongs to, from any of its nodes, `nodeId` itself
 * possibly closed (its nearest live ancestor stands for it). Null when no
 * live node stands for it.
 */
export function spawnTreeOf(elements: readonly ExcalidrawElement[], parentOf: ParentOf, nodeId: string): SpawnTree | null {
  const live = liveNodes(elements);
  let rootId = live.has(nodeId) ? nodeId : liveParent(nodeId, parentOf, live);
  if (!rootId) return null;
  const seen = new Set([rootId]);
  for (let up = liveParent(rootId, parentOf, live); up && !seen.has(up); up = liveParent(rootId, parentOf, live)) {
    seen.add(up);
    rootId = up;
  }
  const all: Record<string, string[]> = {};
  for (const id of live.keys()) {
    const parent = liveParent(id, parentOf, live);
    if (parent) (all[parent] ??= []).push(id);
  }
  const ids = new Set<string>();
  const children: Record<string, string[]> = {};
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    if (all[id]) children[id] = all[id];
    all[id]?.forEach(visit);
  };
  visit(rootId);
  return { rootId, children, ids };
}

/** Whether a node lays out its spawn tree downward from itself, as a Manager does (./treeLayout.ts). */
export type IsDownRoot = (nodeId: string) => boolean;

/**
 * The scene with a spawn tree laid out: the root stays, its descendants take
 * their places, moved down or right as one block when they would cover a node
 * or a frame outside the tree; a pinned node stays too and lays out its own
 * subtree. A group frame holding the root grows to hold its descendants in it,
 * and the wires of whatever moved are routed again. A node's quick notes stand
 * beside it: the layout makes room for them, and they follow (src/nodes/note).
 *
 * A tree is a flowchart read left to right (`flowLayout`), unless `isDownRoot`
 * names one of its nodes (a Manager): from there down it is laid out downward
 * (`downLayout`), that node staying where it is like a pinned one. Each wire
 * from a parent to a child laid out under it takes the vertical tree's route
 * (`down`, and `riser` past the first row: ./wires.ts `elbowForm`), rewritten
 * whenever its route or its flags differ from the layout's, nodes moved or not;
 * any other wire between a node and its parent loses those flags. So a second
 * layout changes nothing. Null when nothing changes.
 */
export function layoutSpawnTree(elements: readonly ExcalidrawElement[], parentOf: ParentOf, nodeId: string, isDownRoot?: IsDownRoot): ExcalidrawElement[] | null {
  const tree = spawnTreeOf(elements, parentOf, nodeId);
  if (!tree || !tree.children[tree.rootId]) return null;
  const live = liveNodes(elements);
  const node = (id: string) => live.get(id)!;
  const rectOf = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

  const parentIn = new Map<string, string>();
  for (const [id, kids] of Object.entries(tree.children)) for (const kid of kids) parentIn.set(kid, id);
  const downRoots = new Set(isDownRoot ? [...tree.ids].filter(isDownRoot) : []);
  /** Laid out downward: a down root, and every node under one. */
  const isDown = (id: string): boolean => {
    const seen = new Set<string>();
    for (let up: string | undefined = id; up !== undefined && !seen.has(up); up = parentIn.get(up)) {
      if (downRoots.has(up)) return true;
      seen.add(up);
    }
    return false;
  };

  // A pinned node, or a down root inside the tree, starts a layout of its own; its siblings close up without it.
  const subRoots = [tree.rootId, ...[...tree.ids].filter((id) => id !== tree.rootId && (isPinned(node(id)) || downRoots.has(id)))];
  const isSubRoot = new Set(subRoots);
  const unpinned = Object.fromEntries(Object.entries(tree.children).map(([id, kids]) => [id, kids.filter((kid) => !isSubRoot.has(kid))]));
  // Each node with its notes: the box the layout places, and where the node sits in it. A node in a
  // group lays out bare: its notes stand outside the frame, which grows around its members, not them.
  const notes = notesByHost(elements);
  const prints = new Map([...tree.ids].map((id) => [id, footprint(node(id), node(id).frameId ? [] : (notes.get(id) ?? []))]));
  const printOf = (id: string) => prints.get(id)!;
  const sizes: Record<string, Size> = Object.fromEntries([...tree.ids].map((id) => [id, { width: printOf(id).rect.width, height: printOf(id).rect.height }]));
  const insets: Record<string, number> = Object.fromEntries([...tree.ids].map((id) => [id, printOf(id).offset.x]));

  const root = node(tree.rootId);
  // A group's frame, or a plain one: Excalidraw clips its members to it either way.
  const rootFrame = root.frameId ? elements.find((e) => e.id === root.frameId && !e.isDeleted && e.type === "frame") : undefined;
  // What the tree must not cover: nodes outside it (its own notes are in it), frames other than its group's.
  const ownNotes = new Set([...tree.ids].flatMap((id) => (notes.get(id) ?? []).map((n) => n.id)));
  const outside: Rect[] = elements
    .filter((e) => !e.isDeleted && !tree.ids.has(e.id) && !ownNotes.has(e.id) && e.id !== rootFrame?.id && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(rectOf);
  // Neither may one block cover the root, a pinned node or a block placed before it.
  const placed: Rect[] = subRoots.map((id) => printOf(id).rect);

  const targets = new Map<string, Point>();
  /** The row each node laid out downward sits in under its parent. */
  const rows = new Map<string, number>();
  for (const subRoot of subRoots) {
    let positions: Map<string, Point>;
    if (isDown(subRoot)) {
      const down = downLayout({ rootId: subRoot, root: printOf(subRoot).rect, children: unpinned, sizes, insets });
      positions = down.positions;
      for (const [id, row] of down.rows) rows.set(id, row);
    } else positions = flowLayout({ rootId: subRoot, root: printOf(subRoot).rect, children: unpinned, sizes });
    positions.delete(subRoot);
    if (positions.size === 0) continue;
    const rects = [...positions].map(([id, p]) => ({ x: p.x, y: p.y, width: sizes[id].width, height: sizes[id].height }));
    const block = bounds(rects);
    const spot = clearRegion(block, [...outside, ...placed]);
    const dx = spot.x - block.x;
    const dy = spot.y - block.y;
    // The node at its place in its box.
    for (const [id, p] of positions) targets.set(id, { x: p.x + dx + printOf(id).offset.x, y: p.y + dy + printOf(id).offset.y });
    placed.push({ ...block, x: spot.x, y: spot.y });
  }

  const moved = new Map<string, ExcalidrawElement>();
  for (const [id, p] of targets) {
    const e = node(id);
    if (Math.abs(e.x - p.x) > 0.5 || Math.abs(e.y - p.y) > 0.5) moved.set(id, changed(e, { x: p.x, y: p.y }));
  }
  // The group grows around its members of the tree, where they now stand; it never shrinks.
  if (rootFrame) {
    const members = [...tree.ids].filter((id) => node(id).frameId === rootFrame.id).map((id) => moved.get(id) ?? node(id));
    const width = Math.max(rootFrame.width, ...members.map((m) => m.x + m.width + PADDING - rootFrame.x));
    const height = Math.max(rootFrame.height, ...members.map((m) => m.y + m.height + PADDING_BOTTOM - rootFrame.y));
    if (width > rootFrame.width || height > rootFrame.height) moved.set(rootFrame.id, changed(rootFrame, { width, height }));
  }

  /** How a wire from `start` to `end` is routed when it joins a node of the tree to its parent; null for any other arrow. */
  const treeRouteOf = (start: string, end: string): TreeRoute | null => {
    if (parentIn.get(end) === start) return rows.has(end) && !isSubRoot.has(end) ? { down: true, riser: rows.get(end)! > 0 } : {};
    return parentIn.get(start) === end ? {} : null;
  };
  const current = (e: ExcalidrawElement) => moved.get(e.id) ?? e;
  const byId = new Map(elements.map((e) => [e.id, current(e)]));
  let rewired = false;
  const laidOut = elements.map((e) => {
    if (moved.has(e.id)) return moved.get(e.id)!;
    if (e.isDeleted || e.type !== "arrow" || !(e as ExcalidrawArrowElement).elbowed) return e;
    const arrow = e as ExcalidrawArrowElement;
    const { startBinding, endBinding } = arrow;
    if (!startBinding || !endBinding) return e;
    const from = byId.get(startBinding.elementId);
    const to = byId.get(endBinding.elementId);
    if (!from || !to || from.isDeleted || to.isDeleted) return e;
    const endMoved = moved.has(from.id) || moved.has(to.id);
    const route = isWire(e) ? treeRouteOf(from.id, to.id) : null;
    if (!route) return endMoved ? rerouted(arrow, from, to, isWire(e) ? wireFlagsOf(e) : {}) : e;
    const before = wireFlagsOf(e);
    const flags: WireFlags = { ...before, down: route.down, riser: route.riser };
    const reflagged = !sameFlags(flags, before);
    if (!reflagged && !endMoved && !(flags.down && !sameRoute(arrow, elbowForm(from, to, flags)))) return e;
    rewired = true;
    return rerouted(arrow, from, to, flags, reflagged);
  });
  if (moved.size === 0 && !rewired) return null;
  // The quick notes join their nodes where they now stand.
  return [...settleNotes(laidOut)];
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;

/** Whether an arrow's binding is `b`: the same element, the same fixed point on it. */
function sameBinding(a: ExcalidrawArrowElement["startBinding"], b: FixedPointBinding): boolean {
  const point = (a as FixedPointBinding | null)?.fixedPoint;
  return a?.elementId === b.elementId && point != null && Math.abs(point[0] - b.fixedPoint[0]) < 1e-6 && Math.abs(point[1] - b.fixedPoint[1]) < 1e-6;
}

/** Whether `wire` already takes the route `form` gives it. */
function sameRoute(wire: ExcalidrawArrowElement, form: ElbowForm): boolean {
  return (
    near(wire.x, form.x) &&
    near(wire.y, form.y) &&
    wire.points.length === form.points.length &&
    wire.points.every(([x, y], i) => near(x, form.points[i][0]) && near(y, form.points[i][1])) &&
    sameBinding(wire.startBinding, form.startBinding!) &&
    sameBinding(wire.endBinding, form.endBinding!)
  );
}

/**
 * An elbow wire routed again between its two ends as they now stand, as its
 * `flags` say: same id, color, stroke and marks; `reflag` writes the flags in
 * its mark.
 */
function rerouted(wire: ExcalidrawArrowElement, from: ExcalidrawElement, to: ExcalidrawElement, flags: WireFlags, reflag = false): ExcalidrawElement {
  const route = elbowForm(from, to, flags);
  return changed(wire, {
    x: route.x,
    y: route.y,
    width: route.width,
    height: route.height,
    points: route.points,
    lastCommittedPoint: route.lastCommittedPoint,
    startBinding: route.startBinding,
    endBinding: route.endBinding,
    fixedSegments: route.fixedSegments,
    startIsSpecial: route.startIsSpecial,
    endIsSpecial: route.endIsSpecial,
    ...(reflag ? { customData: withWireFlags(wire, flags) } : {}),
  } as Partial<ExcalidrawArrowElement>);
}
