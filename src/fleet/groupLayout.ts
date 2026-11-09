import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import type { Point } from "./terminals";

/** Group grid (spec habillage §11.3): terminals 24 apart, 32 inside the frame, 48 at the top for the label. */
export const CELL = NODE_SIZE.terminal;
export const GAP = 24;
export const PADDING = 32;
export const PADDING_TOP = 48;
export const MAX_COLUMNS = 4;

/** Cell (`col`, `row`) of a frame whose top-left corner is `origin`. */
export function cellAt(origin: { x: number; y: number }, col: number, row: number): Rect {
  return {
    x: origin.x + PADDING + col * (CELL.width + GAP),
    y: origin.y + PADDING_TOP + row * (CELL.height + GAP),
    width: CELL.width,
    height: CELL.height,
  };
}

/** The frame of a new group of `count` agents and its cells, relative to the frame's corner. */
export function groupGrid(count: number): { width: number; height: number; cells: Rect[] } {
  const n = Math.max(1, count);
  const columns = Math.min(n, MAX_COLUMNS);
  const rows = Math.ceil(n / columns);
  return {
    width: 2 * PADDING + columns * CELL.width + (columns - 1) * GAP,
    height: PADDING_TOP + PADDING + rows * CELL.height + (rows - 1) * GAP,
    cells: Array.from({ length: n }, (_, i) => cellAt({ x: 0, y: 0 }, i % columns, Math.floor(i / columns))),
  };
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A cell is taken when an element covers more than a tenth of it: a terminal moved by hand keeps its cell. */
function isTaken(cell: Rect, members: readonly Rect[]): boolean {
  return members.some((member) => overlap(cell, member) > 0.1 * cell.width * cell.height);
}

function grownTo(frame: Rect, cell: Rect): Rect {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(frame.width, cell.x + cell.width + PADDING - frame.x),
    height: Math.max(frame.height, cell.y + cell.height + PADDING - frame.y),
  };
}

/**
 * Mathieu's alignment rule (spec §11.3): a terminal opened in a group takes the
 * first free cell of its grid, row by row. A full frame grows by a column (up
 * to four), else by rows; growth cells a member already covers (one dragged
 * past the edge stays in its frame) are skipped. Returns the cell and the
 * frame that holds it.
 */
export function freeCell(frame: Rect, members: readonly Rect[]): { cell: Rect; frame: Rect } {
  const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.floor((frame.width - 2 * PADDING + GAP) / (CELL.width + GAP))));
  const rows = Math.max(1, Math.floor((frame.height - PADDING_TOP - PADDING + GAP) / (CELL.height + GAP)));
  const free = (col: number, row: number) => {
    const cell = cellAt(frame, col, row);
    return isTaken(cell, members) ? null : { cell, frame: grownTo(frame, cell) };
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const found = free(col, row);
      if (found) return found;
    }
  }
  if (columns < MAX_COLUMNS) {
    for (let row = 0; row < rows; row++) {
      const found = free(columns, row);
      if (found) return found;
    }
  }
  // Members are finite: some row below is free.
  for (let row = rows; ; row++) {
    for (let col = 0; col < columns; col++) {
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

/** Space kept between a new group and the content it was moved past. */
export const GROUP_GAP = 96;

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

/** Space kept between a new node and the nodes or groups it is placed beside. */
export const NODE_GAP = GAP;

/** The rect of `size` centered on `center`. */
export function rectAround(center: Point, size: { width: number; height: number }): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

/**
 * Where a node without a group goes: `spot` when it keeps NODE_GAP from every
 * obstacle, else the nearest free spot. Candidates sit right of or below an
 * obstacle's edge (preferred: left or above costs double distance), so the
 * node stays close to the one the user asked for. Always finds one: the spot
 * just right of every obstacle is free.
 */
export function freeSpot(spot: Rect, obstacles: readonly Rect[]): Rect {
  // Obstacles grown by the gap: a spot is free when it overlaps none of them.
  const grown = obstacles.map((o) => ({ x: o.x - NODE_GAP, y: o.y - NODE_GAP, width: o.width + 2 * NODE_GAP, height: o.height + 2 * NODE_GAP }));
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

/** Where "Relier un orchestrateur" puts it: left of the group, tops aligned (spec habillage §11.4). */
export function orchestratorSpot(frame: Rect): Point {
  const { width, height } = NODE_SIZE.orchestrator;
  return { x: frame.x - GROUP_GAP - width / 2, y: frame.y + height / 2 };
}
