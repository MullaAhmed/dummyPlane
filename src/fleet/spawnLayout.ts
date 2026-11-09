import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { flowLayout, type Size } from "./flowLayout";
import { GAP, PADDING } from "./groupLayout";
import type { Point } from "./terminals";
import { createWire } from "./wires";

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
 * else: moved down or right only (never back over their parent), GAP clear of
 * every obstacle, the smallest move first. Always finds one: past the right
 * edge of every obstacle is free.
 */
export function clearRegion(region: Rect, obstacles: readonly Rect[]): Point {
  const grown = obstacles.map((o) => ({ x: o.x - GAP, y: o.y - GAP, width: o.width + 2 * GAP, height: o.height + 2 * GAP }));
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

/**
 * The scene with a spawn tree laid out as a flowchart (see `flowLayout`): the
 * root stays, its descendants take their columns, moved down or right as one
 * block when they would cover a node or a frame outside the tree; a pinned
 * node stays too and lays out its own subtree. A group frame holding the root
 * grows to hold its descendants in it, and the wires of whatever moved are
 * routed again. Null when nothing moves.
 */
export function layoutSpawnTree(elements: readonly ExcalidrawElement[], parentOf: ParentOf, nodeId: string): ExcalidrawElement[] | null {
  const tree = spawnTreeOf(elements, parentOf, nodeId);
  if (!tree || !tree.children[tree.rootId]) return null;
  const live = liveNodes(elements);
  const node = (id: string) => live.get(id)!;
  const rectOf = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

  // A pinned node starts a layout of its own; its siblings close up without it.
  const subRoots = [tree.rootId, ...[...tree.ids].filter((id) => id !== tree.rootId && isPinned(node(id)))];
  const isSubRoot = new Set(subRoots);
  const unpinned = Object.fromEntries(Object.entries(tree.children).map(([id, kids]) => [id, kids.filter((kid) => !isSubRoot.has(kid))]));
  const sizes: Record<string, Size> = Object.fromEntries([...tree.ids].map((id) => [id, { width: node(id).width, height: node(id).height }]));

  const root = node(tree.rootId);
  // A group's frame, or a plain one: Excalidraw clips its members to it either way.
  const rootFrame = root.frameId ? elements.find((e) => e.id === root.frameId && !e.isDeleted && e.type === "frame") : undefined;
  // What the tree must not cover: nodes outside it, frames other than its group's.
  const outside: Rect[] = elements
    .filter((e) => !e.isDeleted && !tree.ids.has(e.id) && e.id !== rootFrame?.id && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(rectOf);
  // Neither may one block cover the root, a pinned node or a block placed before it.
  const placed: Rect[] = subRoots.map((id) => rectOf(node(id)));

  const targets = new Map<string, Point>();
  for (const subRoot of subRoots) {
    const positions = flowLayout({ rootId: subRoot, root: rectOf(node(subRoot)), children: unpinned, sizes });
    positions.delete(subRoot);
    if (positions.size === 0) continue;
    const rects = [...positions].map(([id, p]) => ({ x: p.x, y: p.y, width: sizes[id].width, height: sizes[id].height }));
    const block = bounds(rects);
    const spot = clearRegion(block, [...outside, ...placed]);
    const dx = spot.x - block.x;
    const dy = spot.y - block.y;
    for (const [id, p] of positions) targets.set(id, { x: p.x + dx, y: p.y + dy });
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
    const height = Math.max(rootFrame.height, ...members.map((m) => m.y + m.height + PADDING - rootFrame.y));
    if (width > rootFrame.width || height > rootFrame.height) moved.set(rootFrame.id, changed(rootFrame, { width, height }));
  }
  if (moved.size === 0) return null;

  const current = (e: ExcalidrawElement) => moved.get(e.id) ?? e;
  const byId = new Map(elements.map((e) => [e.id, current(e)]));
  return elements.map((e) => {
    if (moved.has(e.id)) return moved.get(e.id)!;
    if (e.isDeleted || e.type !== "arrow" || !(e as ExcalidrawArrowElement).elbowed) return e;
    const { startBinding, endBinding } = e as ExcalidrawArrowElement;
    if (!startBinding || !endBinding || !(moved.has(startBinding.elementId) || moved.has(endBinding.elementId))) return e;
    const from = byId.get(startBinding.elementId);
    const to = byId.get(endBinding.elementId);
    if (!from || !to || from.isDeleted || to.isDeleted) return e;
    return rerouted(e as ExcalidrawArrowElement, from, to);
  });
}

/** An elbow wire routed again between its two ends as they now stand: same id, color and marks. */
function rerouted(wire: ExcalidrawArrowElement, from: ExcalidrawElement, to: ExcalidrawElement): ExcalidrawElement {
  // The palette only colors a new wire: this one keeps its stroke.
  const route = createWire(from, to, "calm");
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
  } as Partial<ExcalidrawArrowElement>);
}
