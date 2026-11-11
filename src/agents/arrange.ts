import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, type Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { notesAt, notesByHost, settleNotes } from "@/nodes/note/link";
import { COLUMN_GAP, GROUP_GAP, MAX_ROWS, NODE_GAP, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";
import type { ParentOf } from "./spawnLayout";

/**
 * "Arrange" (and Auto-arrange): the nodes of a canvas laid out in a tidy grid.
 *
 * What moves as one block: a frame (a group, or a frame drawn by hand) with
 * everything in it; a spawn tree (agents that opened agents) as it stands, its
 * flowchart kept; any other node alone. The blocks keep their reading order
 * (top to bottom, then left to right, as they stood), are packed in rows whose
 * width gives the whole about the view's shape, and start where the first of
 * them started. Minimized terminals are tabs: they gather in rows of their own
 * under the rest. Inside a group, the terminals take the group's grid again
 * (columns of MAX_ROWS, its tabs in a row under them) and the frame fits them.
 * Drawings outside a frame stay where they are. A terminal's quick notes move
 * with it and its block makes room for them (src/nodes/note); a note whose
 * terminal closed is a node of its own. Pure: the caller writes the scene.
 */

export interface ArrangeInput {
  elements: readonly ExcalidrawElement[];
  /** Who spawned a node (spawn_agent), closed ones included. */
  parentOf: ParentOf;
  /** Whether a node is a minimized terminal (a tab). */
  isMinimized: (nodeId: string) => boolean;
  /**
   * A selection to arrange instead of the whole canvas: nodes and frames (drawings are ignored).
   * One group, or nodes of one group: that group is tidied inside. Fewer than two blocks: the whole canvas.
   */
  only?: readonly string[];
  /** Width over height the layout aims at: the view's. */
  aspect?: number;
}

/** The view's shape when none is given: a wide window. */
const DEFAULT_ASPECT = 16 / 10;

interface Block {
  /** Elements that move with it: its nodes and frames, and whatever its frames hold. */
  ids: Set<string>;
  rect: Rect;
  /** A group, a frame or a tree: given more air around it than a lone node. */
  compound: boolean;
  /** A lone minimized terminal. */
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

/** Each element's unit: an element and the ones joined to it by a frame or a spawn. */
class Units {
  private parent = new Map<string, string>();
  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
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

/** A group's members laid out again in its grid, and the frame fitted to them; null when its members cannot move. */
function tidyGroup(frame: ExcalidrawElement, members: readonly ExcalidrawElement[], isMinimized: (id: string) => boolean): Map<string, Rect> | null {
  if (members.length === 0) return null;
  // The grid fills column by column: read back that way, a tidy group stays as it is.
  const full = columnOrder(
    members.filter((m) => !isMinimized(m.id)),
    rectOf,
  );
  const tabs = readingOrder(
    members.filter((m) => isMinimized(m.id)),
    rectOf,
  );
  const out = new Map<string, Rect>();
  const left = frame.x + PADDING;
  const top = frame.y + PADDING_TOP;

  // The group's grid: top to bottom, a new column to the right after MAX_ROWS.
  const rows = Math.min(full.length, MAX_ROWS);
  const columns = rows === 0 ? 0 : Math.ceil(full.length / rows);
  const colWidths = Array.from({ length: columns }, (_, c) => Math.max(...full.slice(c * rows, c * rows + rows).map((m) => m.width)));
  const rowHeights = Array.from({ length: rows }, (_, r) => Math.max(...full.filter((_, i) => i % rows === r).map((m) => m.height)));
  full.forEach((m, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    const x = left + colWidths.slice(0, c).reduce((sum, w) => sum + w + COLUMN_GAP, 0);
    const y = top + rowHeights.slice(0, r).reduce((sum, h) => sum + h + ROW_GAP, 0);
    out.set(m.id, { x, y, width: m.width, height: m.height });
  });
  const gridWidth = colWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, columns - 1) * COLUMN_GAP;
  const gridHeight = rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows - 1) * ROW_GAP;

  // Its tabs in rows under the grid, as wide as the grid (or four tabs, alone).
  let tabsWidth = 0;
  let tabsHeight = 0;
  if (tabs.length > 0) {
    const tabWidth = Math.max(...tabs.map((t) => t.width));
    const wrap = gridWidth > 0 ? Math.max(gridWidth, tabWidth) : Math.min(tabs.length, MAX_ROWS) * (tabWidth + COLUMN_GAP) - COLUMN_GAP;
    const layout = shelves(tabs, (t) => t, wrap, () => COLUMN_GAP, () => ROW_GAP);
    const tabsTop = top + (gridHeight > 0 ? gridHeight + ROW_GAP : 0);
    for (const { item, x, y } of layout.placed) out.set(item.id, { x: left + x, y: tabsTop + y, width: item.width, height: item.height });
    tabsWidth = layout.width;
    tabsHeight = layout.height;
  }
  const contentWidth = Math.max(gridWidth, tabsWidth);
  const contentHeight = gridHeight + (tabsHeight > 0 ? (gridHeight > 0 ? ROW_GAP : 0) + tabsHeight : 0);
  out.set(frame.id, { x: frame.x, y: frame.y, width: 2 * PADDING + contentWidth, height: PADDING_TOP + contentHeight + PADDING_BOTTOM });
  return out;
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/** `element` at `rect`, its version bumped as Excalidraw's newElementWith does (tests cannot load Excalidraw). */
function moved(element: ExcalidrawElement, rect: Rect): ExcalidrawElement {
  return { ...element, ...rect, version: element.version + 1, versionNonce: random(), updated: Date.now() } as ExcalidrawElement;
}

const differs = (a: Rect, b: Rect) => Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;

/**
 * The scene arranged (see the top of this file), with the elements that moved
 * changed and every other one as it was; the ids of the nodes that moved, for
 * their wires to be routed again. Null when nothing moves.
 */
export function arrangedElements(input: ArrangeInput): { elements: ExcalidrawElement[]; movedNodeIds: Set<string> } | null {
  const { elements, parentOf, isMinimized } = input;
  const aspect = input.aspect && Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : DEFAULT_ASPECT;
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const frames = live.filter((e) => e.type === "frame");
  const frameIds = new Set(frames.map((f) => f.id));
  // A host's quick notes are not blocks: they follow their host, and its block holds them.
  const notesOf = notesByHost(live);
  const noteHost = new Map([...notesOf].flatMap(([hostId, notes]) => notes.map((n) => [n.id, hostId] as const)));
  const nodes = live.filter((e) => nodeKindOf(e) !== null && !noteHost.has(e.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inFrame = (e: ExcalidrawElement) => (e.frameId && frameIds.has(e.frameId) ? e.frameId : null);

  // Units: a frame with its nodes, a spawn tree, a node alone.
  const units = new Units();
  for (const e of [...frames, ...nodes]) units.add(e.id);
  for (const node of nodes) {
    const frameId = inFrame(node);
    if (frameId) units.join(node.id, frameId);
    const parent = liveParentOf(node.id, parentOf, nodeIds);
    if (parent) units.join(node.id, parent);
  }
  const unitOf = (id: string) => units.find(id);
  const unitMembers = new Map<string, ExcalidrawElement[]>();
  for (const e of [...frames, ...nodes]) {
    const unit = unitOf(e.id);
    unitMembers.set(unit, [...(unitMembers.get(unit) ?? []), e]);
  }

  // What to arrange: the selection's units, else all of them.
  const selected = [...new Set((input.only ?? []).map((id) => noteHost.get(id) ?? id))].filter((id) => nodeIds.has(id) || frameIds.has(id));
  const selectedFrames = new Set(selected.map((id) => (frameIds.has(id) ? id : inFrame(byId.get(id)!))));
  const insideOne = selected.length > 0 && selectedFrames.size === 1 && !selectedFrames.has(null) ? [...selectedFrames][0] : null;
  const selectedUnits = new Set(selected.map(unitOf));
  const scope = insideOne ? new Set([unitOf(insideOne)]) : selectedUnits.size >= 2 ? selectedUnits : new Set(unitMembers.keys());

  const targets = new Map<string, Rect>();

  // Inside each group in scope: its grid again. Not a folded group (its terminals are hidden), nor one holding a spawn tree (its flowchart wins).
  const tidyFrames = insideOne ? [byId.get(insideOne)!] : frames.filter((f) => scope.has(unitOf(f.id)));
  for (const frame of tidyFrames) {
    const info = groupInfoOf(frame);
    if (!info || info.folded) continue;
    const members = nodes.filter((n) => n.frameId === frame.id && nodeKindOf(n) !== "note");
    const spawns = members.some((m) => liveParentOf(m.id, parentOf, nodeIds) !== null || nodes.some((n) => liveParentOf(n.id, parentOf, nodeIds) === m.id));
    if (spawns) continue;
    const tidy = tidyGroup(frame, members, isMinimized);
    if (!tidy) continue;
    // The frame stays where it is; what it holds that is not a node (a drawing) stays where it was.
    for (const [id, rect] of tidy) targets.set(id, rect);
  }

  // The blocks, as they stand once their groups are tidied.
  const now = (e: ExcalidrawElement): Rect => targets.get(e.id) ?? rectOf(e);
  const blocks: Block[] = insideOne
    ? []
    : [...scope].map((unit) => {
        const members = unitMembers.get(unit) ?? [];
        const ids = new Set(members.map((m) => m.id));
        const held = members.filter((m) => frameIds.has(m.id)).map((m) => m.id);
        for (const e of live) if (e.frameId && held.includes(e.frameId)) ids.add(e.id);
        const lone = members.length === 1 && !frameIds.has(members[0].id);
        // Its notes beside each host, where they will stand: the block keeps room for them.
        const notes = members.flatMap((m) => notesAt(now(m), notesOf.get(m.id) ?? []));
        return { ids, rect: boundsOf([...members.map(now), ...notes]), compound: !lone, tab: lone && isMinimized(members[0].id) };
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
        const at = now(e);
        targets.set(id, { ...at, x: at.x + dx, y: at.y + dy });
      }
    }
  }

  // Text bound to a moved element (a label in a drawn shape inside a frame) follows it.
  for (const e of live) {
    const container = "containerId" in e && e.containerId ? byId.get(e.containerId as string) : undefined;
    if (!container || targets.has(e.id) || !targets.has(container.id)) continue;
    const to = targets.get(container.id)!;
    targets.set(e.id, { ...rectOf(e), x: e.x + to.x - container.x, y: e.y + to.y - container.y });
  }

  const movedNodeIds = new Set<string>();
  let changed = false;
  const next = elements.map((e) => {
    const target = targets.get(e.id);
    if (!target || e.isDeleted || !differs(rectOf(e), target)) return e;
    changed = true;
    if (nodeIds.has(e.id) || frameIds.has(e.id)) movedNodeIds.add(e.id);
    return moved(e, target);
  });
  // The quick notes join their hosts where they now stand.
  const settled = settleNotes(next);
  return changed || settled !== next ? { elements: [...settled], movedNodeIds } : null;
}
