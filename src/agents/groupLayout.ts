import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import { TIMELINE_ROOM } from "@/canvas/overlay/timeline";
import type { Point } from "./terminals";

/**
 * Group grid (spec theme §11.3): 32 of clear air between what stands side by
 * side and inside the frame's sides, 48 at the top for the label. A terminal's
 * step frieze hangs under it (TIMELINE_ROOM, 24), so the rows are that much
 * further apart: 56 from one terminal to the next, the same 32 of air under a
 * frieze as beside a terminal. Before, rows and columns were both 24 apart and
 * the frieze filled the whole gap.
 */
export const CELL = NODE_SIZE.terminal;
const AIR = 32;
/** Between two columns. */
export const COLUMN_GAP = AIR;
/** Between a terminal and the one below it: its frieze, then air. */
export const ROW_GAP = TIMELINE_ROOM + AIR;
export const PADDING = AIR;
export const PADDING_TOP = 48;
/** Under the last row: its frieze, then air, as between two rows. */
export const PADDING_BOTTOM = ROW_GAP;
/** A column holds this many terminals; the next one opens a new column to its right. */
export const MAX_ROWS = 4;

/** Cell (`col`, `row`) of a frame whose top-left corner is `origin`. */
export function cellAt(origin: { x: number; y: number }, col: number, row: number): Rect {
  return {
    x: origin.x + PADDING + col * (CELL.width + COLUMN_GAP),
    y: origin.y + PADDING_TOP + row * (CELL.height + ROW_GAP),
    width: CELL.width,
    height: CELL.height,
  };
}

/**
 * The frame of a new group of `count` agents and its cells, relative to the
 * frame's corner. Terminals stack in a column, top to bottom; a column holds
 * MAX_ROWS, then the next one opens to its right.
 */
export function groupGrid(count: number): { width: number; height: number; cells: Rect[] } {
  const n = Math.max(1, count);
  const rows = Math.min(n, MAX_ROWS);
  const columns = Math.ceil(n / rows);
  return {
    width: 2 * PADDING + columns * CELL.width + (columns - 1) * COLUMN_GAP,
    height: PADDING_TOP + PADDING_BOTTOM + rows * CELL.height + (rows - 1) * ROW_GAP,
    cells: Array.from({ length: n }, (_, i) => cellAt({ x: 0, y: 0 }, Math.floor(i / rows), i % rows)),
  };
}

/**
 * The frame of a group made around terminals that already stand where the user
 * put them: the grid's padding on every side, the label's room on top. Excalidraw
 * clips a child to its frame, so no member may poke out.
 */
export function frameAround(members: readonly Rect[]): Rect {
  const { x, y, width, height } = boundsOf(members);
  return { x: x - PADDING, y: y - PADDING_TOP, width: width + 2 * PADDING, height: height + PADDING_TOP + PADDING_BOTTOM };
}

/** The smallest rect holding all of `rects`. */
export function boundsOf(rects: readonly Rect[]): Rect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The area two rects share; 0 when they only touch. */
export function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * What a terminal keeps clear under it: its step frieze and half the air, so
 * one nudged a little by hand (up to AIR / 2) still leaves the cell below it free.
 */
const KEEP_CLEAR = TIMELINE_ROOM + AIR / 2;

/** `rect` and what it keeps clear under it. */
function withRoom(rect: Rect): Rect {
  return { ...rect, height: rect.height + KEEP_CLEAR };
}

/**
 * A cell is taken when it touches a member, or when the room under either one
 * (frieze and air) would touch the other. A terminal moved by hand keeps its
 * cell; and a group saved with the former 24-apart rows, whose members are off
 * this grid, never gets a new terminal on a member nor on a member's frieze.
 */
function isTaken(cell: Rect, members: readonly Rect[]): boolean {
  const room = withRoom(cell);
  return members.some((member) => overlap(room, member) > 0 || overlap(cell, withRoom(member)) > 0);
}

function grownTo(frame: Rect, cell: Rect): Rect {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(frame.width, cell.x + cell.width + PADDING - frame.x),
    height: Math.max(frame.height, cell.y + cell.height + PADDING_BOTTOM - frame.y),
  };
}

/**
 * Mathieu's alignment rule (spec §11.3): a terminal opened in a group takes the
 * first free cell of its grid, column by column, so it lands under the one
 * above it. A full frame grows by a row (down to MAX_ROWS), then by a column to
 * the right; growth cells a member already covers (one dragged past the edge
 * stays in its frame) are skipped. Returns the cell and the frame that holds it.
 * A frame saved with the former, tighter spacing counts a row or a column less
 * than it holds: the cells its members cover are taken all the same, so the new
 * terminal lands in the first cell of this grid that is clear of them.
 */
export function freeCell(frame: Rect, members: readonly Rect[]): { cell: Rect; frame: Rect } {
  const columns = Math.max(1, Math.floor((frame.width - 2 * PADDING + COLUMN_GAP) / (CELL.width + COLUMN_GAP)));
  const rows = Math.max(1, Math.floor((frame.height - PADDING_TOP - PADDING_BOTTOM + ROW_GAP) / (CELL.height + ROW_GAP)));
  const free = (col: number, row: number) => {
    const cell = cellAt(frame, col, row);
    return isTaken(cell, members) ? null : { cell, frame: grownTo(frame, cell) };
  };
  // The grid as the frame holds it, holes first.
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      const found = free(col, row);
      if (found) return found;
    }
  }
  // Then growth: rows up to MAX_ROWS (a frame taller than that keeps its rows), then new columns.
  // Members are finite: some column to the right is free.
  const depth = Math.max(rows, MAX_ROWS);
  for (let col = 0; ; col++) {
    for (let row = 0; row < depth; row++) {
      if (col < columns && row < rows) continue;
      const found = free(col, row);
      if (found) return found;
    }
  }
}

/** `count` new terminals placed one after the other in `frame`. */
export function arrangeInFrame(frame: Rect, members: readonly Rect[], count: number): { cells: Rect[]; frame: Rect } {
  const cells: Rect[] = [];
  let current = frame;
  for (let i = 0; i < count; i++) {
    const next = freeCell(current, [...members, ...cells]);
    cells.push(next.cell);
    current = next.frame;
  }
  return { cells, frame: current };
}

/**
 * Space kept between a new group and the content it was moved past, and
 * between a Fleet and the group beside it, and between the columns of a spawn
 * tree: three times the air of the grid, so it reads as a step apart. A wire
 * needs about ten of it (src/agents/wires.ts), the rest is its run.
 */
export const GROUP_GAP = 3 * AIR;

/**
 * Where a new group goes: `spot` (centered on the view) when it covers
 * nothing, else moved down past what it would cover, so a group never lands
 * on top of another one.
 */
export function clearSpot(spot: Rect, obstacles: readonly Rect[]): Rect {
  let current = spot;
  for (;;) {
    const covered = obstacles.filter((o) => overlap(current, o) > 0);
    if (covered.length === 0) return current;
    current = { ...current, y: Math.max(...covered.map((o) => o.y + o.height)) + GROUP_GAP };
  }
}

/** Space kept between a new node and the nodes or groups it is placed beside (right or left of). Below one, ROW_GAP: its frieze hangs there. */
export const NODE_GAP = COLUMN_GAP;

/** The rect of `size` centered on `center`. */
export function rectAround(center: Point, size: { width: number; height: number }): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

/**
 * Where a node without a group goes: `spot` when it keeps NODE_GAP beside and
 * ROW_GAP above and below every obstacle (the frieze under a terminal, its own
 * or the one above), else the nearest free spot. Candidates sit right of or
 * below an obstacle's edge (preferred: left or above costs double distance), so
 * the node stays close to the one the user asked for. Always finds one: the
 * spot just right of every obstacle is free.
 */
export function freeSpot(spot: Rect, obstacles: readonly Rect[]): Rect {
  // Obstacles grown by the gaps: a spot is free when it overlaps none of them.
  const grown = obstacles.map((o) => ({ x: o.x - NODE_GAP, y: o.y - ROW_GAP, width: o.width + 2 * NODE_GAP, height: o.height + 2 * ROW_GAP }));
  const isFree = (r: Rect) => grown.every((o) => overlap(r, o) === 0);
  if (isFree(spot)) return spot;
  const xs = [spot.x, ...grown.flatMap((o) => [o.x + o.width, o.x - spot.width])];
  const ys = [spot.y, ...grown.flatMap((o) => [o.y + o.height, o.y - spot.height])];
  const cost = (r: Rect) => {
    const dx = r.x - spot.x;
    const dy = r.y - spot.y;
    return Math.hypot(dx < 0 ? 2 * dx : dx, dy < 0 ? 2 * dy : dy);
  };
  const candidates = xs.flatMap((x) => ys.map((y) => ({ ...spot, x, y }))).sort((a, b) => cost(a) - cost(b));
  return candidates.find(isFree) ?? spot;
}

/** Where "Link a fleet" puts it: left of the group, tops aligned (spec theme §11.4). */
export function fleetSpot(frame: Rect): Point {
  const { width, height } = NODE_SIZE.fleet;
  return { x: frame.x - GROUP_GAP - width / 2, y: frame.y + height / 2 };
}
