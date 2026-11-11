import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, type Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { boxOf, containerOf, endsOf, followedArrow } from "./arrangeDrawings";
import type { Attachment } from "./attachments";
import { COLUMN_GAP, GROUP_GAP, MAX_ROWS, NODE_GAP, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";
import type { ParentOf } from "./spawnLayout";
import type { Point } from "./terminals";
import { isWire } from "./wires";

/**
 * "Arrange" (and Auto-arrange): the canvas laid out in a tidy grid.
 *
 * What moves as one block: a frame (a group, or a frame drawn by hand) with
 * everything in it, a frame drawn by hand inside a group's frame being one of
 * the group's members; a spawn tree (agents that opened agents) as it stands,
 * its flowchart kept; any other node alone. What belongs to a block goes with
 * it: an item attached to one of its nodes (./attachments.ts), a drawing in an
 * Excalidraw group with one of them. The blocks keep their reading order (top
 * to bottom, then left to right, as they stood), are packed in rows whose width
 * gives the whole about the view's shape, and start where the first of them
 * started. Minimized terminals are tabs: they gather in rows of their own under
 * the rest. Other drawings outside a frame stay where they are; an arrow bound
 * to something that moved follows it.
 *
 * Inside a group, every member is laid out again (`tidyGroup`) and the frame
 * fits them. Pieces that hold a node take the group's grid (columns of
 * MAX_ROWS, each as wide as its widest piece); the drawings go in rows under
 * it, the tabs under them. A folded group is left as it is (its terminals are
 * hidden), and so is one whose spawn tree reaches out of its frame (the
 * flowchart wins). Pure: the caller writes the scene.
 */

export interface ArrangeInput {
  elements: readonly ExcalidrawElement[];
  /** Who spawned a node (spawn_agent), closed ones included. */
  parentOf: ParentOf;
  /** Whether a node is a minimized terminal (a tab). */
  isMinimized: (nodeId: string) => boolean;
  /** The element an item is attached to, which it moves with (./attachments.ts); none when absent. */
  attachedTo?: (element: ExcalidrawElement) => string | Attachment | null | undefined;
  /**
   * A selection to arrange instead of the whole canvas: nodes, frames and what a group holds (drawings outside groups are ignored).
   * One group, or members of one group: that group is tidied inside. Fewer than two blocks: the whole canvas.
   */
  only?: readonly string[];
  /** Width over height the layout aims at: the view's. */
  aspect?: number;
}

/** The view's shape when none is given: a wide window. */
const DEFAULT_ASPECT = 16 / 10;

interface Block {
  /** Elements that move with it: its nodes and frames, whatever its frames hold, and the drawings joined to them. */
  ids: Set<string>;
  rect: Rect;
  /** A group, a frame, a tree or a node with what belongs to it: given more air around it than a lone node. */
  compound: boolean;
  /** Minimized terminals outside any frame (a lone one, or one with what is attached to it). */
  tab: boolean;
}

interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

const rectOf = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

function boundsOf(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

/**
 * Reading order: rows top to bottom, each left to right. An item joins the row
 * when its top is above the middle of the row's first item, so a laid-out grid
 * reads back in the order it was laid out (arranging twice moves nothing).
 */
export function readingOrder<T>(items: readonly T[], rect: (item: T) => Rect): T[] {
  const byTop = [...items].sort((a, b) => rect(a).y - rect(b).y || rect(a).x - rect(b).x);
  const rows: T[][] = [];
  let line = -Infinity;
  for (const item of byTop) {
    const r = rect(item);
    if (rows.length > 0 && r.y < line) rows[rows.length - 1].push(item);
    else {
      rows.push([item]);
      line = r.y + r.height / 2;
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => rect(a).x - rect(b).x));
}

/** Column order, a group's grid's: columns left to right, each top to bottom (`readingOrder` turned a quarter). */
export function columnOrder<T>(items: readonly T[], rect: (item: T) => Rect): T[] {
  const turned = (item: T): Rect => {
    const r = rect(item);
    return { x: r.y, y: r.x, width: r.height, height: r.width };
  };
  return readingOrder(items, turned);
}

/**
 * Items packed in rows no wider than `wrap` (a row holds one item at least),
 * tops aligned, `hGap` between two side by side, `vGap` between two rows. The
 * positions are relative to the layout's corner; `width` and `height` its size.
 */
function shelves<T>(
  items: readonly T[],
  size: (item: T) => { width: number; height: number },
  wrap: number,
  hGap: (left: T, right: T) => number,
  vGap: (above: readonly T[], below: readonly T[]) => number,
): { placed: Placed<T>[]; width: number; height: number } {
  const rows: T[][] = [];
  let rowWidth = 0;
  for (const item of items) {
    const row = rows[rows.length - 1];
    const gap = row ? hGap(row[row.length - 1], item) : 0;
    if (row && rowWidth + gap + size(item).width <= wrap) {
      row.push(item);
      rowWidth += gap + size(item).width;
    } else {
      rows.push([item]);
      rowWidth = size(item).width;
    }
  }
  const placed: Placed<T>[] = [];
  let y = 0;
  let width = 0;
  rows.forEach((row, i) => {
    let x = 0;
    row.forEach((item, j) => {
      if (j > 0) x += hGap(row[j - 1], item);
      placed.push({ item, x, y });
      x += size(item).width;
    });
    width = Math.max(width, x);
    y += Math.max(...row.map((item) => size(item).height));
    if (i < rows.length - 1) y += vGap(row, rows[i + 1]);
  });
  return { placed, width, height: y };
}

/**
 * The rows of `items` that a view of shape `aspect` shows at the largest zoom
 * (the whole layout in view): each width the first items would take side by
 * side is tried; the smaller area wins a tie.
 */
function bestShelves<T>(
  items: readonly T[],
  size: (item: T) => { width: number; height: number },
  aspect: number,
  hGap: (left: T, right: T) => number,
  vGap: (above: readonly T[], below: readonly T[]) => number,
): { placed: Placed<T>[]; width: number; height: number } {
  const wraps: number[] = [];
  let run = 0;
  items.forEach((item, i) => {
    run += (i > 0 ? hGap(items[i - 1], item) : 0) + size(item).width;
    wraps.push(run);
  });
  let best: ReturnType<typeof shelves<T>> | null = null;
  let bestScore = -Infinity;
  for (const wrap of wraps) {
    const layout = shelves(items, size, wrap, hGap, vGap);
    // The zoom at which a view `aspect` wide and 1 high holds it all.
    const score = Math.min(aspect / Math.max(layout.width, 1), 1 / Math.max(layout.height, 1));
    if (!best || score > bestScore * (1 + 1e-9) || (Math.abs(score - bestScore) <= bestScore * 1e-9 && layout.width * layout.height < best.width * best.height)) {
      best = layout;
      bestScore = score;
    }
  }
  return best ?? { placed: [], width: 0, height: 0 };
}

/** Each element's unit: an element and the ones joined to it (by a frame, a spawn, an attachment, an Excalidraw group…). */
class Units {
  private parent = new Map<string, string>();
  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  has(id: string | null | undefined): id is string {
    return typeof id === "string" && this.parent.has(id);
  }
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path halving is not worth it for a canvas of a few hundred nodes.
    return root;
  }
  join(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** The live node `nodeId` hangs from: its spawner, or the nearest live one up the chain. */
function liveParentOf(nodeId: string, parentOf: ParentOf, live: ReadonlySet<string>): string | null {
  const seen = new Set([nodeId]);
  for (let up = parentOf(nodeId); up && !seen.has(up); up = parentOf(up)) {
    if (live.has(up)) return up;
    seen.add(up);
  }
  return null;
}

const within = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

/**
 * Each frame drawn by hand that lies inside a group's frame, and that group
 * (the smallest, when several hold it). Excalidraw does not nest frames: such
 * a frame is one of the group's members all the same.
 */
function hostsOf(frames: readonly ExcalidrawElement[]): Map<string, string> {
  const groups = frames.filter((f) => groupInfoOf(f) !== null);
  const hosts = new Map<string, string>();
  for (const frame of frames) {
    if (groupInfoOf(frame)) continue;
    const around = groups.filter((g) => within(frame, g)).sort((a, b) => a.width * a.height - b.width * b.height);
    if (around.length > 0) hosts.set(frame.id, around[0].id);
  }
  return hosts;
}

/** What `tidyGroup` reads of the scene. */
interface GroupScene {
  live: readonly ExcalidrawElement[];
  byId: ReadonlyMap<string, ExcalidrawElement>;
  nodeIds: ReadonlySet<string>;
  isMinimized: (nodeId: string) => boolean;
  liveParent: (nodeId: string) => string | null;
  attachmentOf: (element: ExcalidrawElement) => Attachment | null;
  /** Whether an element lies in no frame. */
  loose: (element: ExcalidrawElement) => boolean;
  aspect: number;
}

/** Members of a group laid out together, and the room they take. */
interface Piece {
  elements: ExcalidrawElement[];
  box: Rect;
}

/**
 * A group's members laid out again and its frame fitted to them; the arrows
 * left to follow their ends (they join two pieces, or a piece and something
 * outside). Null when it holds nothing to move, or when one of its spawn trees
 * reaches out of its frame.
 *
 * Its pieces: a spawn tree whole (its flowchart kept), a node with what is
 * attached to it, an Excalidraw group whole, a shape with its label, drawings
 * joined by arrows (a diagram) whole, a frame drawn by hand with what it holds,
 * an arrow bound at one end with that end; else each member alone. The pieces
 * that hold a node not minimized take the group's grid: top to bottom, a new
 * column to the right after MAX_ROWS, each column as wide as its widest piece.
 * The drawings go in rows under it, as wide as it; the tabs in rows under them.
 * What is attached to a member but lies outside the frame never becomes a
 * member: it stays outside and moves with the side of the frame it stands by,
 * or, kept `beside` its anchor (a quick note), it is laid out with it.
 */
function tidyGroup(frame: ExcalidrawElement, members: readonly ExcalidrawElement[], scene: GroupScene): { targets: Map<string, Rect>; followers: Set<string> } | null {
  const { byId, nodeIds, isMinimized, liveParent, attachmentOf } = scene;
  const anchorOf = (e: ExcalidrawElement) => attachmentOf(e)?.anchor ?? null;
  // Wires are routed again between their ends once these stand where they go.
  const kept = members.filter((m) => !isWire(m));
  if (kept.length === 0) return null;
  const inGroup = new Set(kept.map((m) => m.id));
  for (const id of nodeIds) {
    const parent = liveParent(id);
    if (parent && inGroup.has(id) !== inGroup.has(parent)) return null;
  }
  // Outside the frame, kept beside a member: laid out with it, the grid making room for it, still no member of the frame.
  const besides = scene.live.filter((e) => {
    if (inGroup.has(e.id) || e.id === frame.id || e.type === "frame" || !scene.loose(e)) return false;
    const attachment = attachmentOf(e);
    return attachment?.beside === true && inGroup.has(attachment.anchor);
  });
  const own = [...kept, ...besides];
  const ownIds = new Set(own.map((m) => m.id));

  // Arrows bound at both ends (outside an Excalidraw group): placed with their ends when one piece holds both, else following them.
  const links = own.filter((m) => {
    const { start, end } = endsOf(m);
    return start !== null && end !== null && (m.groupIds ?? []).length === 0;
  });
  const linkIds = new Set(links.map((l) => l.id));
  const pieces = new Units();
  const placed = own.filter((m) => !linkIds.has(m.id) && !linkIds.has(containerOf(m) ?? ""));
  for (const m of placed) pieces.add(m.id);
  const drawnGroups = new Map<string, string[]>();
  for (const m of placed) {
    const container = containerOf(m);
    if (pieces.has(container)) pieces.join(m.id, container);
    if (pieces.has(m.frameId)) pieces.join(m.id, m.frameId);
    const parent = nodeIds.has(m.id) ? liveParent(m.id) : null;
    if (pieces.has(parent)) pieces.join(m.id, parent);
    const anchor = anchorOf(m);
    if (pieces.has(anchor)) pieces.join(m.id, anchor);
    const { start, end } = endsOf(m);
    if ((start === null) !== (end === null) && pieces.has(start ?? end)) pieces.join(m.id, (start ?? end)!);
    for (const g of m.groupIds ?? []) drawnGroups.set(g, [...(drawnGroups.get(g) ?? []), m.id]);
  }
  for (const ids of drawnGroups.values()) for (const id of ids.slice(1)) pieces.join(id, ids[0]);
  // Drawings joined by an arrow are a diagram: kept whole.
  const drawing = (id: string | null): id is string => pieces.has(id) && !nodeIds.has(id) && byId.get(id)?.type !== "frame";
  for (const link of links) {
    const { start, end } = endsOf(link);
    if (drawing(start) && drawing(end)) pieces.join(start, end);
  }
  const followers = new Set<string>();
  for (const link of links) {
    const { start, end } = endsOf(link);
    if (pieces.has(start) && pieces.has(end) && pieces.find(start) === pieces.find(end)) {
      pieces.add(link.id);
      pieces.join(link.id, start);
    } else followers.add(link.id);
  }
  // A placed arrow's label goes with it (a follower's follows it, see arrangedElements).
  for (const m of own) {
    const container = containerOf(m);
    if (container && linkIds.has(container) && pieces.has(container)) {
      pieces.add(m.id);
      pieces.join(m.id, container);
    }
  }

  const grouped = new Map<string, ExcalidrawElement[]>();
  for (const m of own) {
    if (!pieces.has(m.id)) continue;
    const root = pieces.find(m.id);
    grouped.set(root, [...(grouped.get(root) ?? []), m]);
  }
  const all: Piece[] = [...grouped.values()].map((elements) => ({ elements, box: boundsOf(elements.map(boxOf)) }));
  // Its nodes, not counting what is attached to another of them (a note beside a minimized terminal is a tab's).
  const nodesOf = (p: Piece) => hostsIn(p.elements, nodeIds, anchorOf);
  const boxOfPiece = (p: Piece) => p.box;
  // The grid fills column by column: read back that way, a tidy group stays as it is.
  const grid = columnOrder(
    all.filter((p) => nodesOf(p).some((n) => !isMinimized(n.id))),
    boxOfPiece,
  );
  const drawings = readingOrder(
    all.filter((p) => nodesOf(p).length === 0),
    boxOfPiece,
  );
  const tabs = readingOrder(
    all.filter((p) => nodesOf(p).length > 0 && nodesOf(p).every((n) => isMinimized(n.id))),
    boxOfPiece,
  );

  const at = new Map<Piece, Point>();
  const left = frame.x + PADDING;
  const top = frame.y + PADDING_TOP;
  let width = 0;
  let bottom = top;
  // Each band starts under the one above it: its friezes, then air.
  const nextBand = () => (bottom > top ? bottom + ROW_GAP : top);

  // The group's grid: top to bottom, a new column to the right after MAX_ROWS.
  const rows = Math.min(grid.length, MAX_ROWS);
  let x = left;
  for (let c = 0; c * rows < grid.length; c++) {
    const column = grid.slice(c * rows, c * rows + rows);
    let y = top;
    column.forEach((piece, r) => {
      if (r > 0) y += ROW_GAP;
      at.set(piece, { x, y });
      y += piece.box.height;
    });
    bottom = Math.max(bottom, y);
    x += Math.max(...column.map((p) => p.box.width)) + COLUMN_GAP;
  }
  if (grid.length > 0) width = x - COLUMN_GAP - left;

  // Its drawings in rows under the grid, as wide as it (alone, about the view's shape).
  if (drawings.length > 0) {
    const layout =
      width > 0
        ? shelves(drawings, boxOfPiece, Math.max(width, ...drawings.map((p) => p.box.width)), () => COLUMN_GAP, () => COLUMN_GAP)
        : bestShelves(drawings, boxOfPiece, scene.aspect, () => COLUMN_GAP, () => COLUMN_GAP);
    const bandTop = nextBand();
    for (const { item, x: px, y: py } of layout.placed) at.set(item, { x: left + px, y: bandTop + py });
    width = Math.max(width, layout.width);
    bottom = bandTop + layout.height;
  }

  // Its tabs in rows under the rest, as wide as it (or four tabs, alone).
  if (tabs.length > 0) {
    const tabWidth = Math.max(...tabs.map((t) => t.box.width));
    const wrap = width > 0 ? Math.max(width, tabWidth) : Math.min(tabs.length, MAX_ROWS) * (tabWidth + COLUMN_GAP) - COLUMN_GAP;
    const layout = shelves(tabs, boxOfPiece, wrap, () => COLUMN_GAP, () => ROW_GAP);
    const bandTop = nextBand();
    for (const { item, x: px, y: py } of layout.placed) at.set(item, { x: left + px, y: bandTop + py });
    width = Math.max(width, layout.width);
    bottom = bandTop + layout.height;
  }

  const targets = new Map<string, Rect>();
  for (const [piece, to] of at) {
    const dx = to.x - piece.box.x;
    const dy = to.y - piece.box.y;
    for (const e of piece.elements) targets.set(e.id, { x: e.x + dx, y: e.y + dy, width: e.width, height: e.height });
  }
  const fitted = { x: frame.x, y: frame.y, width: 2 * PADDING + width, height: PADDING_TOP + (bottom - top) + PADDING_BOTTOM };
  targets.set(frame.id, fitted);

  // Attached to a member but outside the frame (not kept beside it): it stays outside, moved with the side of the frame it stands by.
  for (const e of scene.live) {
    if (ownIds.has(e.id) || e.id === frame.id || e.type === "frame" || !scene.loose(e)) continue;
    const anchor = anchorOf(e);
    if (!anchor || !inGroup.has(anchor)) continue;
    const box = boxOf(e);
    const dx = box.x >= frame.x + frame.width ? fitted.width - frame.width : 0;
    const dy = box.y >= frame.y + frame.height ? fitted.height - frame.height : 0;
    if (dx !== 0 || dy !== 0) targets.set(e.id, { ...rectOf(e), x: e.x + dx, y: e.y + dy });
  }
  return { targets, followers };
}

/** The nodes of `elements` that are not attached to another of them: those that make it a grid's piece or a tab. */
function hostsIn(elements: readonly ExcalidrawElement[], nodeIds: ReadonlySet<string>, anchorOf: (e: ExcalidrawElement) => string | null): ExcalidrawElement[] {
  const ids = new Set(elements.map((e) => e.id));
  return elements.filter((e) => nodeIds.has(e.id) && !ids.has(anchorOf(e) ?? ""));
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` with `fields`, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function changed(element: ExcalidrawElement, fields: Partial<ExcalidrawElement>): ExcalidrawElement {
  return { ...element, ...fields, version: element.version + 1, versionNonce: random(), updated: Date.now() } as ExcalidrawElement;
}

const differs = (a: Rect, b: Rect) => Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;

/**
 * The scene arranged (see the top of this file), with the elements that moved
 * changed and every other one as it was; the ids of the nodes and frames that
 * moved, for their wires to be routed again. Null when nothing moves.
 */
export function arrangedElements(input: ArrangeInput): { elements: ExcalidrawElement[]; movedNodeIds: Set<string> } | null {
  const { elements, parentOf, isMinimized } = input;
  const aspect = input.aspect && Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : DEFAULT_ASPECT;
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const frames = live.filter((e) => e.type === "frame");
  const frameIds = new Set(frames.map((f) => f.id));
  const nodes = live.filter((e) => nodeKindOf(e) !== null);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inFrame = (e: ExcalidrawElement) => (e.frameId && frameIds.has(e.frameId) ? e.frameId : null);
  const liveParent = (nodeId: string) => liveParentOf(nodeId, parentOf, nodeIds);
  const attachmentOf = (e: ExcalidrawElement): Attachment | null => {
    const found = input.attachedTo?.(e);
    const attachment = typeof found === "string" ? { anchor: found } : found;
    return attachment && attachment.anchor !== e.id && byId.has(attachment.anchor) ? attachment : null;
  };
  const anchorOf = (e: ExcalidrawElement) => attachmentOf(e)?.anchor ?? null;
  const hostOf = hostsOf(frames);
  /** The group an element is laid out in: its frame's, or the one around its frame drawn by hand. */
  const groupFrameOf = (e: ExcalidrawElement): string | null => {
    if (hostOf.has(e.id)) return hostOf.get(e.id)!;
    const frameId = inFrame(e);
    if (!frameId) return null;
    return groupInfoOf(byId.get(frameId)!) ? frameId : (hostOf.get(frameId) ?? null);
  };

  // Units: a frame with its nodes, a spawn tree, a node alone.
  const units = new Units();
  for (const e of [...frames, ...nodes]) units.add(e.id);
  for (const node of nodes) {
    const frameId = inFrame(node);
    if (frameId) units.join(node.id, frameId);
    const parent = liveParent(node.id);
    if (parent) units.join(node.id, parent);
  }
  for (const [frameId, hostId] of hostOf) units.join(frameId, hostId);
  // What an element moves with: itself when it is a unit's, else its frame; nothing for a drawing outside frames.
  const carrier = (e: ExcalidrawElement) => (units.has(e.id) ? e.id : inFrame(e));
  // Elements that go together: what holds a node or a frame joins its unit, drawings joined to it included; drawings alone stay put.
  const together = (members: readonly ExcalidrawElement[]) => {
    const carried = members.map(carrier);
    if (carried.every((c) => c === null)) return;
    const ids = members.map((m, i) => {
      const id = carried[i];
      if (id) return id;
      units.add(m.id);
      return m.id;
    });
    for (const id of ids.slice(1)) units.join(id, ids[0]);
  };
  for (const e of live) {
    const anchor = anchorOf(e);
    if (anchor) together([e, byId.get(anchor)!]);
  }
  const drawnGroups = new Map<string, ExcalidrawElement[]>();
  for (const e of live) for (const g of e.groupIds ?? []) drawnGroups.set(g, [...(drawnGroups.get(g) ?? []), e]);
  for (const members of drawnGroups.values()) if (members.length > 1) together(members);

  const unitOf = (id: string) => units.find(id);
  const unitMembers = new Map<string, ExcalidrawElement[]>();
  for (const e of live) {
    if (!units.has(e.id)) continue;
    const unit = unitOf(e.id);
    unitMembers.set(unit, [...(unitMembers.get(unit) ?? []), e]);
  }

  // What to arrange: the selection's units, else all of them.
  const selected = (input.only ?? []).filter((id) => nodeIds.has(id) || frameIds.has(id) || (byId.has(id) && groupFrameOf(byId.get(id)!) !== null));
  const frameOfSelected = (id: string): string | null => {
    if (frameIds.has(id)) return hostOf.get(id) ?? id;
    const e = byId.get(id)!;
    return groupFrameOf(e) ?? inFrame(e);
  };
  const selectedFrames = new Set(selected.map(frameOfSelected));
  const insideOne = selected.length > 0 && selectedFrames.size === 1 && !selectedFrames.has(null) ? [...selectedFrames][0] : null;
  const selectedUnits = new Set(selected.map((id) => unitOf(units.has(id) ? id : frameOfSelected(id)!)));
  const scope = insideOne ? new Set([unitOf(insideOne)]) : selectedUnits.size >= 2 ? selectedUnits : new Set(unitMembers.keys());

  const targets = new Map<string, Rect>();
  const followers = new Set<string>();

  // Inside each group in scope: every member laid out again. Not a folded group (its terminals are hidden).
  const groupScene: GroupScene = { live, byId, nodeIds, isMinimized, liveParent, attachmentOf, loose: (e) => inFrame(e) === null, aspect };
  const tidyFrames = insideOne ? [byId.get(insideOne)!] : frames.filter((f) => scope.has(unitOf(f.id)));
  for (const frame of tidyFrames) {
    const info = groupInfoOf(frame);
    if (!info || info.folded) continue;
    const tidy = tidyGroup(
      frame,
      live.filter((e) => e.id !== frame.id && groupFrameOf(e) === frame.id),
      groupScene,
    );
    if (!tidy) continue;
    // The frame stays where it is and fits its members.
    for (const [id, rect] of tidy.targets) targets.set(id, rect);
    for (const id of tidy.followers) followers.add(id);
  }

  // The blocks, as they stand once their groups are tidied.
  const rectNow = (e: ExcalidrawElement): Rect => targets.get(e.id) ?? rectOf(e);
  const boxNow = (e: ExcalidrawElement): Rect => {
    const box = boxOf(e);
    const to = targets.get(e.id);
    return to ? { x: box.x + to.x - e.x, y: box.y + to.y - e.y, width: box.width + to.width - e.width, height: box.height + to.height - e.height } : box;
  };
  const blocks: Block[] = insideOne
    ? []
    : [...scope].map((unit) => {
        const members = unitMembers.get(unit) ?? [];
        const ids = new Set(members.map((m) => m.id));
        const held = new Set(members.filter((m) => frameIds.has(m.id)).map((m) => m.id));
        for (const e of live) if (e.frameId && held.has(e.frameId)) ids.add(e.id);
        const unitNodes = hostsIn(members, nodeIds, anchorOf);
        const lone = members.length === 1 && nodeIds.has(members[0].id);
        const tab = held.size === 0 && unitNodes.length > 0 && unitNodes.every((n) => isMinimized(n.id));
        return { ids, rect: boundsOf(members.map(boxNow)), compound: !lone, tab };
      });

  if (blocks.length > 0) {
    const origin = boundsOf(blocks.map((b) => b.rect));
    const hGap = (a: Block, b: Block) => (a.compound || b.compound ? GROUP_GAP : NODE_GAP);
    const vGap = (above: readonly Block[], below: readonly Block[]) => ([...above, ...below].some((b) => b.compound) ? GROUP_GAP : ROW_GAP);
    const size = (b: Block) => b.rect;
    const full = readingOrder(
      blocks.filter((b) => !b.tab),
      (b) => b.rect,
    );
    const tabs = readingOrder(
      blocks.filter((b) => b.tab),
      (b) => b.rect,
    );
    const main = bestShelves(full, size, aspect, hGap, vGap);
    const tabTop = main.height > 0 ? main.height + (full.some((b) => b.compound) ? GROUP_GAP : ROW_GAP) : 0;
    const tabRows =
      tabs.length === 0
        ? { placed: [] as Placed<Block>[] }
        : main.width > 0
          ? shelves(tabs, size, Math.max(main.width, ...tabs.map((t) => t.rect.width)), () => NODE_GAP, () => ROW_GAP)
          : bestShelves(tabs, size, aspect, () => NODE_GAP, () => ROW_GAP);
    const placed = [...main.placed, ...tabRows.placed.map((p) => ({ ...p, y: p.y + tabTop }))];
    for (const { item, x, y } of placed) {
      const dx = origin.x + x - item.rect.x;
      const dy = origin.y + y - item.rect.y;
      if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) continue;
      for (const id of item.ids) {
        const e = byId.get(id);
        if (!e) continue;
        const at = rectNow(e);
        targets.set(id, { ...at, x: at.x + dx, y: at.y + dy });
      }
    }
  }

  // Arrows that follow their ends: those a group left to them, and the drawn ones outside frames bound to something.
  for (const e of live) {
    const { start, end } = endsOf(e);
    if ((start || end) && !isWire(e) && !units.has(e.id) && inFrame(e) === null) followers.add(e.id);
  }
  const shiftOf = (id: string | null): Point => {
    const e = id ? byId.get(id) : undefined;
    const to = e && targets.get(e.id);
    return e && to ? { x: to.x - e.x, y: to.y - e.y } : { x: 0, y: 0 };
  };
  const standing = (id: string | null) => {
    const e = id ? byId.get(id) : undefined;
    return e && ({ ...e, ...rectNow(e) } as ExcalidrawElement);
  };
  const reshaped = new Map<string, Partial<ExcalidrawElement>>();
  for (const id of followers) {
    const arrow = byId.get(id) as ExcalidrawArrowElement;
    const { start, end } = endsOf(arrow);
    // Computed from where it stood, whatever block it rode with.
    targets.delete(id);
    const shape = followedArrow(arrow, shiftOf(start), shiftOf(end), { from: standing(start), to: standing(end) });
    if (shape) reshaped.set(id, shape as Partial<ExcalidrawElement>);
  }
  for (const e of live) {
    const container = containerOf(e);
    if (!container || !followers.has(container)) continue;
    // A follower's label: half way between how far its ends went.
    const { start, end } = endsOf(byId.get(container)!);
    const a = shiftOf(start);
    const b = shiftOf(end);
    const dx = (a.x + b.x) / 2;
    const dy = (a.y + b.y) / 2;
    if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) targets.delete(e.id);
    else targets.set(e.id, { ...rectOf(e), x: e.x + dx, y: e.y + dy });
  }

  // Text bound to a moved element (a label in a drawn shape) follows it.
  for (const e of live) {
    const container = byId.get(containerOf(e) ?? "");
    if (!container || targets.has(e.id) || !targets.has(container.id)) continue;
    const to = targets.get(container.id)!;
    targets.set(e.id, { ...rectOf(e), x: e.x + to.x - container.x, y: e.y + to.y - container.y });
  }

  const movedNodeIds = new Set<string>();
  let any = false;
  const next = elements.map((e) => {
    if (e.isDeleted) return e;
    const shape = reshaped.get(e.id);
    if (shape) {
      any = true;
      return changed(e, shape);
    }
    const target = targets.get(e.id);
    if (!target || !differs(rectOf(e), target)) return e;
    any = true;
    if (nodeIds.has(e.id) || frameIds.has(e.id)) movedNodeIds.add(e.id);
    return changed(e, target);
  });
  return any ? { elements: next, movedNodeIds } : null;
}
